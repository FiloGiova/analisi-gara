# Changelog

Registro delle modifiche al progetto, per poterle ricostruire in caso di errori.
Ogni consegna riporta: file toccati, migrazioni al database, dipendenze e decisioni.

Nota: oltre a questo file, ogni modifica ai **dati** delle gare (manuale o da
sincronizzazione) è tracciata nella tabella `game_changes` ed è visibile nella
sezione "Storico modifiche" del dettaglio gara.

## 2026-07-15 — Importazione PDF e miglioramenti operativi

- Nuovo parser deterministico del template federale digitale: numero gara,
  arbitro valutato, sezioni, note, voto e potenzialità vengono letti dal
  contenuto del PDF e mai dal nome file.
- Anteprima batch fino a 20 PDF con associazione di gara, arbitri, osservatore,
  alias e scelta esplicita in presenza di conflitti o rapporti esistenti.
- Applicazione atomica per gara: creazione/aggiornamento del rapporto,
  designazioni confermate e bloccate, storico modifiche e reset dell'invio email
  per le sole valutazioni sostituite.
- Import disponibile da Rapporti, dettaglio Gara e dettaglio Rapporto per admin
  e formatori nel perimetro dei campionati assegnati.
- PDF originali elaborati soltanto in memoria; nessuna AI, OCR o persistenza del
  documento sorgente.
- Export XLSX dedicato alla classifica arbitri, con posizione, categoria, elenco
  voti, numero di valutazioni e media; stagione e scoping del formatore sono gli
  stessi della vista web.
- Il riepilogo iniziale del rapporto mostra livello e motivazione delle
  Potenzialità per entrambi gli arbitri ai soli ruoli autorizzati; il dato resta
  nascosto agli arbitri ed escluso dai PDF.
- Nella Matrice incroci la colonna con i nomi degli osservatori resta fissa
  durante lo scorrimento orizzontale.
- Il parser PDF ricompone le righe create dall'impaginazione del documento e
  non porta più nella webapp ritorni a capo artificiali; descrizioni comuni
  quasi identiche non bloccano l'import, mentre differenze sostanziali
  richiedono ancora la scelta esplicita della fonte.
- In Copertura la colonna arbitri resta fissa; passando sui visionamenti
  completati compare il voto e il clic apre il relativo rapporto.
- Nella Classifica arbitri ogni voto mostra al passaggio del mouse
  l'osservatore e apre direttamente il rapporto da cui proviene.

## 2026-07-13 — Statistiche, test PostgreSQL, sync automatico e template designatore

### Statistiche
- Selettore multiplo delle fasi FIP in Copertura, Matrice e Impiego.
- Ordinamento iniziale alfabetico; colonna arbitro fissa nell'Impiego.
- Numeri gara senza zeri iniziali nella UI e squadre visibili nell'Impiego.
- Arbitri disattivati esclusi automaticamente da tutte le statistiche.
- Copertura semplificata rimuovendo “Osservatori diversi” e “Programmati”.
- Export XLSX della tab attiva, coerente con stagione, campionato, fasi, fascia,
  ricerca e ordinamento impostati nella pagina.
- Export XLSX dell'elenco Gare coerente con fase, giornata, arbitro, stato e
  ricerca impostati nella pagina, mantenendo lo scoping del formatore.
- Export XLSX dell'anagrafica arbitri coerente con stagione, campionato, fascia,
  stato e ricerca; la colonna Fascia riporta tutte le appartenenze stagionali.
- Gestione delle fasce disponibile anche sulle stagioni archiviate; controlli
  Fasce e ricerca Statistiche resi più leggibili.
- Nuovo marchio FischioLab: simbolo F con fischietto per favicon e icona,
  wordmark blu-teal nella topbar e nella schermata di accesso.

### Qualità e automazione
- Otto file di test migrati da `getDb().prepare(...)` agli helper PostgreSQL
  asincroni; database separato obbligatorio e protetto da reset accidentali.
- Suite verde: 53 test. GitHub Actions esegue test e build con PostgreSQL 17
  effimero a ogni push.
- Sync FIP giornaliero nel processo web alle 13:15 Europe/Rome: sorgenti attive
  in sequenza, stato persistente anti-duplicazione/recupero dopo riavvio, esito
  in pagina Sorgenti ed email opzionale per errori.

### Designatore e documentazione
- Template XLSX con colonna Campionato, rimozione Arbitro 3 e menu a tendina per
  Arbitro 1/2 basati sugli arbitri attivi del campionato e della stagione.
- Selezione multipla delle fasi nel download del template: playoff e playout
  possono essere consegnati senza includere nuovamente la fase regolare.
- README e CLAUDE aggiornati all'architettura Render + Supabase; NEXT_STEPS
  ripulito e attività completate depennate.

## 2026-07-12 — Migrazione cloud: SQLite→Postgres (Supabase) + Storage (branch `cloud-migration`)

Prima fase della migrazione da NAS a cloud (NEXT_STEPS_2.md). Host scelto: **Render**
(processo Node persistente) + **Supabase** (Postgres + Storage). Non Vercel: la sync
FIP lunga e il cron periodico sono incompatibili col serverless. Il frontend è servito
dallo stesso processo Express (single origin, cookie invariati). **Lavoro sul branch
`cloud-migration`, non ancora in produzione.**

### Nuova base dati/storage
- `src/database/db.js` (nuovo) — pool `pg` asincrono con helper `dbGet/dbAll/dbRun/dbTx`;
  conversione automatica placeholder `?`→`$n`; type-parser per far tornare `COUNT/SUM`
  come numeri (come better-sqlite3).
- `src/database/schema.postgres.sql` (nuovo) — port dello schema; timestamp come TEXT e
  flag come INTEGER 0/1 per minimizzare le modifiche; funzioni `iso_now()`/`ts_now()`.
- `src/services/storageService.js` (nuovo) — astrazione file con driver `supabase`/`local`
  (put/get/signedUrl/remove); scelto da `config.storageDriver`.
- `src/config.js` — `DATABASE_URL`, `DATABASE_SSL`, `SUPABASE_*`, `STORAGE_BUCKET`.
- Dipendenze nuove: `pg`, `@supabase/supabase-js`.

### Conversione backend (sync→async), ~313 call-site
- `connection.js` riscritto: `initializeDatabase()` async (applica schema + backfill dati).
- Tutti i service e le route convertiti ad async: auth/userService, reportService (+
  pdfService/emailService), refereeService, gameService, nameMatching, statsService,
  syncService, xlsxService, accessLogService, photoService. `server.js` con boot async.
- Fix dialetto: `strftime/CURRENT_TIMESTAMP`→`iso_now/ts_now`, `INSERT OR IGNORE`→
  `ON CONFLICT DO NOTHING`, `GROUP_CONCAT`→`string_agg`, `COLLATE NOCASE`→`LOWER()`,
  ricerche `LIKE`→`ILIKE`, alias camelCase quotati, `GROUP BY` reso esplicito nel ranking,
  `lastInsertRowid`→`RETURNING id`.
- **PDF ora generati in memoria** (buffer) e caricati su Supabase Storage; il download
  rigenera dal payload; le foto profilo passano dallo Storage. Nessuna scrittura su disco
  in produzione.

### Migrazione dati e deploy
- `scripts/migrate-sqlite-to-postgres.js` (nuovo) — copia il DB del NAS preservando gli ID,
  resetta le sequence, carica le foto su Storage; salta `sessions` (re-login al cutover) e
  `exports` (PDF rigenerati). Dry-run di default, `--commit` per eseguire. Validato in
  dry-run sul DB locale (180 gare, 365 designazioni, 566 audit).
- `scripts/setup.js` e `scripts/create-admin.js` adattati (async, Postgres).
- `render.yaml` (nuovo) — blueprint Render.

### Verifica
- Schema applicato su Supabase Postgres 17.6; smoke test end-to-end verde: login/sessione,
  CRUD arbitri/rapporti, **generazione+upload PDF su Storage e download**, ranking, copertura/
  matrice/impiego, gare+designazioni+suggerimenti, validazione finale (422), template XLSX,
  delete con cascade.

### Decisioni / da fare
- **Cutover**: lanciare `migrate-sqlite-to-postgres.js --commit` coi dati del NAS (operazione
  distruttiva sul target: fa TRUNCATE) e configurare Render dal `render.yaml`.
- **Follow-up**: adattare la suite `tests/` a Postgres (serve un DB di test dedicato, non la
  produzione). `better-sqlite3` resta come dipendenza perché usato dallo script di migrazione.

## 2026-07-11 — Link FIP senza girone: import automatico di tutti i gironi della fase

Fix di usabilità segnalato dall'utente: la pagina Risultati FIP non mette
`codice_girone` nell'URL finché non si usa il menu a tendina, quindi il link
"naturale" (es. DR1 Piemonte con solo campionato+fase) veniva rifiutato.
Su indicazione dell'utente, con più gironi non si chiede quale importare:
si importano tutti.

- `src/services/fip/fipAdapter.js` — `parseFipUrl` accetta link senza girone (serve almeno il campionato); nuove `parseGironiOptions(html)` e `discoverGironi(params)`: leggono i gironi dal `select[name="gironi"]` della pagina.
- `src/services/syncService.js` — `createSource` (ora async): senza girone nel link, li scopre dalla pagina e crea **una sorgente per ogni girone** (nome = "prefisso — Girone X" se fornito, altrimenti l'etichetta FIP); i gironi già configurati nella stagione vengono saltati (riprovare lo stesso link non duplica: 409 se non c'è nulla di nuovo). `updateSource`: un nuovo URL senza girone eredita quello configurato. La risposta API diventa `{ sources, skipped }`.
- `client/src/pages/AdminSourcesPage.jsx` — nessuna scelta richiesta: messaggio con l'elenco dei gironi creati e di quelli saltati.
- Verificato su casi reali piemontesi (fixture salvate in `tests/fixtures/`): DR1 fase 1 → 3 gironi creati in un colpo (con skip di quello già presente); Serie C regular season (`codice_campionato=C1&codice_fase=1`) → girone unico auto-risolto; **Serie C playoff** (`codice_fase=6`) → stessa struttura HTML, l'accoppiamento ("Finale 1 posto") fa da girone e le gare della serie da giornate: sincronizzate gara 1 e gara 2 della finale senza alcun adattamento del parser.
- Test: 36 totali; nuove fixture DR1-senza-girone e C1-playoff, test su parsing gironi, creazione multipla con skip e fase finale.

## 2026-07-11 — Impiego arbitri (storico designazioni)

Vista dell'impiego di ogni arbitro (gare dirette, non visionamenti), su tre livelli:

- `src/services/statsService.js` — `getEmployment({season})`: per arbitro totale gare dirette, da 1°/2°/3°, ultima designazione, griglia per giornata (numero gara + ruolo, link alla gara). Derivato da `game_officials`×`games`; gare annullate escluse. Route `GET /api/stats/employment` in `src/routes/stats.routes.js`.
- `client/src/pages/CoveragePage.jsx` — terza tab **"Impiego arbitri"**; la pagina ora si chiama **"Statistiche"** (voce topbar rinominata in `Shell.jsx`).
- `client/src/pages/RefereeDetailPage.jsx` — sezione **"Designazioni stagione"**: elenco cronologico delle gare dirette con giornata, ruolo, collega, osservatore e link al rapporto (riusa `GET /api/games?refereeId=`).
- `client/src/pages/GamesPage.jsx` — filtro **"Tutti gli arbitri"** (client-side, opzioni derivate dalle gare caricate).

Nota multi-campionato: rimandato d'accordo con l'utente il filtro "Campionato" trasversale a quando verrà attivata la Serie C (basterà aggiungere la sorgente FIP del girone; il modello dati ha già la colonna `competition`).

Test: 33 (`npm test`), nuovo test su conteggi impiego ed esclusione gare annullate.

## 2026-07-11 — Fase 2 + Fase 3: Import XLSX designazioni, visionamenti, matrice e suggerimenti

Seconda e terza fase di NEXT_STEPS_2.md, più una correzione richiesta: i
nominativi FIP conservano solo Cognome Nome (senza "di CITTÀ (XX)").

### Correzione nomi FIP

- `src/utils/personNames.js` (nuovo) — funzioni pure di normalizzazione (`cleanExternalName`, `normalizedNameKey`), estratte da `nameMatching.js` che ora le ri-esporta.
- `src/services/fip/fipAdapter.js` — il parser rimuove il suffisso territoriale già in importazione.
- `src/database/connection.js` — backfill all'avvio (`backfillOfficialExternalNames`): normalizza i nominativi già salvati in `game_officials`. Nessuna migrazione di schema.

### Fase 2 — Import designazioni XLSX

- `src/services/xlsxService.js` (nuovo, dipendenza `exceljs` JS puro):
  - **Template scaricabile** per il designatore: un foglio per giornata, precompilato con numero gara, data, ora, squadre, campo e designazioni note, più foglio "Istruzioni". Rigenerato a ogni download → dopo modifiche in corso d'opera basta riscaricarlo.
  - **Parsing tollerante** del file compilato: intestazioni riconosciute per nome, zeri iniziali del numero gara ripristinati se Excel li ha persi (311 → 000311), celle vuote ignorate (mai cancellano designazioni).
  - **Anteprima senza scritture** e **applicazione transazionale** con esito per riga (nuovo/aggiornato/invariato/conflitto), risoluzione nomi (arbitri → anagrafica, osservatori → utenti), conflitti su valori bloccati/manuali mai sovrascritti, run registrato in `sync_runs` (tipo `xlsx_import`), audit in `game_changes`.
- `src/services/nameMatching.js` — risoluzione osservatori (`resolveObserverName`, alias utente in `person_aliases.user_id`, propagazione alias alle designazioni non risolte) e nuovo match "per inclusione univoca": "Tonon" trova l'unico utente compatibile, resta irrisolto in caso di omonimi. Vale anche per gli arbitri.
- `src/routes/imports.routes.js` (nuovo) — `/api/imports/template` (GET, download), `/preview` (upload multipart, max 4MB), `/apply`; solo admin.
- Client: `client/src/pages/AdminImportsPage.jsx` (nuova, voce "Import designazioni" nel menu Admin) — download template per stagione, upload, anteprima dettagliata, conferma, esito.

### Fase 3 — Visionamenti derivati, copertura, matrice, suggerimenti

- `src/services/statsService.js` (nuovo) — tutto **calcolato, mai salvato**:
  - visionamento **completato** = rapporto definitivo (2 righe, una per arbitro); **programmato** = gara con osservatore+arbitri senza rapporto definitivo (bozze incluse tra i programmati); gare annullate escluse; rapporti storici senza utente collegato compaiono come osservatori "(storico)".
  - `getCoverage` — per arbitro: completati, osservatori diversi, ultimo visionamento e giorni trascorsi, programmati, timeline per giornata con link a gare/rapporti.
  - `getMatrix` / `getMatrixDetail` — matrice osservatore×arbitro con conteggi completati (+programmati) e dettaglio cella cliccabile.
  - `getObserverSuggestions` — graduatoria deterministica con pesi in un unico oggetto `SUGGESTION_WEIGHTS`, due modalità (diversificazione / follow-up), motivazione testuale per candidato, penalità forte per doppia assegnazione nello stesso giorno.
- `src/routes/stats.routes.js` (nuovo) — `/api/stats/coverage|matrix|matrix-detail` (admin+formatori); suggerimenti in `/api/games/:id/observer-suggestions`.
- Client: `client/src/pages/CoveragePage.jsx` (nuova, voce "Visionamenti" in topbar per admin/formatori) con tab "Copertura arbitri" e "Matrice incroci" (soglie colore 0/1/2/3+ col numero sempre visibile); pannello suggerimenti nel dettaglio gara con assegnazione a un click; associazione osservatori "da associare" nel dettaglio gara.

### Test e verifica

- Suite ampliata a **32 test** (`npm test`): template round-trip, ripristino zeri, anteprima senza scritture, applicazione idempotente con audit, conflitti manual-lock da file, copertura (bozze escluse), matrice, dettaglio cella, graduatorie nelle due modalità, penalità stesso-giorno, risoluzione osservatore per cognome.
- Verifica end-to-end su server reale: template 12 fogli (55 gare DR1), file compilato → anteprima (110 invariate, 1 aggiornata, 2 nuove, 1 da associare) → applicazione → gara aggiornata con provenienza `xlsx`; coverage/matrice/suggerimenti coerenti; backfill nomi verificato su dati importati in precedenza.

### Note

- Nessun lavoro dedicato al NAS in questa consegna: la migrazione cloud è il prossimo passo previsto.
- Dipendenza nuova: `exceljs` (JavaScript puro).

## 2026-07-11 — Fase 1: Gestione gare, designazioni e sincronizzazione FIP

Prima fase di NEXT_STEPS_2.md: le gare diventano il fatto centrale registrato
una volta sola; calendario e designazioni si importano dal sito pubblico FIP.

### Migrazioni database (additive, nessuna colonna eliminata)

Nuove tabelle in `src/database/schema.sql`:

- `competition_sources` — sorgenti FIP configurate (URL, parametri, stagione, stato ultimo sync).
- `games` — le gare: `UNIQUE(sport_season, match_number)`, numero gara TEXT con zeri iniziali, stato (`scheduled`/`played`/`postponed`/`cancelled`).
- `game_officials` — ufficiali per gara (ruoli `referee1/2/3`, `observer`), con provenienza (`fip_public`/`xlsx`/`manual`), stato e `manual_lock`. L'osservatore è opzionale: la riga può non esistere (gara "scoperta").
- `person_aliases` — associazioni verificate nome esterno → arbitro anagrafica, riusate nei sync successivi.
- `sync_runs` — storico sincronizzazioni con contatori e riepilogo JSON.
- `game_changes` — audit per campo di ogni modifica alle gare (valore precedente/nuovo, origine, autore, motivazione, sync di riferimento).

Nuove colonne (array `MIGRATIONS` in `src/database/connection.js`):

- `reports.game_id` — collegamento facoltativo rapporto → gara.
- `reports.observer_id` — chi ha osservato (distinto da `created_by`, chi ha inserito). Backfill prudente a ogni avvio: `observer_id = created_by` solo se `observer_name` coincide col `display_name` del creatore.

Nuovi indici su games, game_officials, game_changes, sync_runs, person_aliases, reports(game_id/observer_id).

Rollback: le tabelle nuove possono essere eliminate con `DROP TABLE`; le due colonne su `reports` sono nullable e ignorate dal codice precedente. Backup consigliato prima del deploy: copia di `storage/data/rapporti.sqlite`.

### Backend

- `src/services/fip/fipAdapter.js` (nuovo) — tutta la logica FIP isolata: validazione URL (solo HTTPS, host fip.it/www.fip.it — anti SSRF), parsing HTML server-rendered con cheerio, fetch con timeout 15s, pausa 1s tra giornate, controllo host dopo i redirect.
- `src/services/nameMatching.js` (nuovo) — normalizzazione nomi (maiuscole, accenti, apostrofi, suffisso "di CITTÀ (XX)"), matching prudente con anagrafica (solo match esatti non ambigui), candidati ordinati per affinità, gestione alias.
- `src/services/gameService.js` (nuovo) — CRUD gare e ufficiali, stati derivati mai mantenuti a mano, audit su ogni update, modifica di gara con rapporto definitivo solo con conferma esplicita (`force`), elenco osservatori assegnabili (utenti attivi non-arbitro), dati di precompilazione rapporto.
- `src/services/syncService.js` (nuovo) — CRUD sorgenti + sincronizzazione manuale idempotente: crea/aggiorna per `(sport_season, match_number)`, non tocca mai osservatore né valori bloccati o modificati manualmente (→ conflitti mostrati con valore attuale/nuovo/origini), guard anti doppio-click, esiti in `sync_runs`.
- `src/routes/games.routes.js` (nuovo) — `/api/games`: lettura per tutti i ruoli interni (arbitri esclusi), mutazioni admin/formatore, alias solo admin.
- `src/routes/sources.routes.js` (nuovo) — `/api/sources` (CRUD, sync, storico run), solo admin.
- `server.js` — mount delle due nuove route.
- `src/services/reportService.js` — supporto `gameId`/`observerUserId` nel payload, colonne `game_id`/`observer_id` in insert/update, blocco rapporto duplicato per la stessa gara (409 con conferma esplicita `allowDuplicate`).
- `src/routes/reports.routes.js` — passa `allowDuplicate` dal body.

### Frontend

- `client/src/lib/navigation.js` — route `/games`, `/games/:id`, `/admin/sources`; supporto query string (`/reports/new?game=ID`).
- `client/src/lib/api.js` — metodi per gare, ufficiali, alias, sorgenti, sync.
- `client/src/components/GameStateBadge.jsx` (nuovo) — badge stato gara (testo + colore, mai solo colore).
- `client/src/pages/GamesPage.jsx` (nuovo) — elenco con filtri (stagione, giornata, stato, ricerca, "solo scoperte") e creazione manuale.
- `client/src/pages/GameDetailPage.jsx` (nuovo) — dettaglio con ufficiali e provenienza, assegnazione osservatore, blocco/sblocco, risoluzione nomi da associare, storico modifiche, pulsante Compila/Apri rapporto.
- `client/src/pages/AdminSourcesPage.jsx` (nuovo) — sorgenti FIP, sincronizzazione con esito (conflitti, nomi da associare), storico run.
- `client/src/pages/ReportFormPage.jsx` — precompilazione da gara (numero, data, squadre, campionato, arbitri, osservatore), avviso rapporto già esistente, conferma per duplicato.
- `client/src/App.jsx`, `client/src/components/Shell.jsx` — dispatch nuove pagine, voce "Gare" in topbar, "Sorgenti gare" nel menu Admin.

### Dipendenze e test

- Nuova dipendenza: `cheerio` (JavaScript puro, compatibile Node 18 e ARM64 — nessun modulo nativo).
  **Deploy NAS**: dopo `./deploy-nas.sh` servono `npm install --omit=dev` via SSH e `sudo systemctl restart analisi-gara`.
- Test (`npm test`, runner `node:test` integrato, nessuna dipendenza): 21 test in `tests/` con fixture HTML FIP reale (`tests/fixtures/fip-risultati-dr1-giornata1.html`) — parsing, normalizzazione nomi, alias, idempotenza sync, conservazione osservatore, manual lock, audit, collegamento gara-rapporto, backfill `observer_id`.

### Decisioni e assunzioni

- La stagione resta la stringa `sport_season` (es. `2025/2026`) già usata da rapporti e anagrafica: nessuna tabella `seasons`.
- Gli osservatori restano utenti (`users` con ruolo non-arbitro): `observer_id` → `users.id`; osservatori storici/esterni = utenti disattivati.
- Numero gara univoco per stagione (`UNIQUE(sport_season, match_number)`); se in futuro due campionati riusassero lo stesso numero, si disambigua con la colonna `competition`.
- Sync FIP: solo manuale (pulsante). L'architettura (sorgenti + `runFipSync`) è pronta per una periodica opzionale futura.
- Se la FIP smette di esporre un dato (es. designazione ritirata), il sync non cancella nulla: i vuoti non sovrascrivono valori esistenti.
- Fasi successive previste: import XLSX (Fase 2), copertura arbitri/matrice/suggerimenti osservatore (Fase 3).
