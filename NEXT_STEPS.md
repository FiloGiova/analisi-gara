# Next Steps

## Tecnici / Qualità del codice

### Valutare migrazione a TypeScript
Il progetto è attualmente in JavaScript puro. La scelta iniziale è stata pragmatica: meno configurazione, più velocità di sviluppo, nessuna dipendenza da `tsc`. Per un progetto di questa dimensione e con un solo sviluppatore JS è accettabile.

**Motivi per migrare a TS:**
- Errori di tipo scoperti a compile-time invece che a runtime
- Autocompletamento più preciso nell'IDE
- `shared/reportTemplate.js` beneficerebbe molto dei tipi (le sezioni, le valutazioni, i ruoli)

**Costo:** refactoring non banale — tutti i file `.js`/`.jsx` diventano `.ts`/`.tsx`, va aggiunta la configurazione `tsconfig.json`, e le dipendenze native come `better-sqlite3` richiedono i tipi `@types/better-sqlite3`.

**Consiglio:** valutare quando il progetto cresce ulteriormente o quando si aggiunge un secondo sviluppatore.

### Refactoring generale
- Rivedere la gestione degli errori lato frontend (oggi alcuni errori sono silenziosi)
- Aggiungere test (almeno unit test su `reportService.js` e `reportTemplate.js`)
- Separare meglio la logica di business dalla logica di routing nel backend

---

## Documentazione

### Riscrivere il README
Il README attuale contiene informazioni non aggiornate:
- I nomi dei file PDF generati non corrispondono alla realtà
- I path di installazione fanno riferimento a `/volume1/` (Synology) invece di `/home/Filippo/AnalisiGara/`
- La sezione "Deploy sul NAS UGREEN" va riscritta con i passi reali testati
- Aggiungere screenshot dell'interfaccia

---

## UI / UX

### Dashboard rapporti
Implementato: card intera cliccabile, statistiche nella hero (totale, definitivi, bozze, ultimi 30gg), filtro per anno sportivo.

### Divisione per anni sportivi
Implementato: anno sportivo calcolato automaticamente dalla data gara (inizia il 1° luglio). Filtro nella dashboard.

---

## Funzionalità nuove

### Anagrafica arbitri
Implementato: DB arbitri (nome, cognome, data nascita, email, categoria), pannello admin "Arbitri" nella topbar.

### Liste arbitri per campionato e anno sportivo
Implementato: roster per campionato+anno sportivo. Nel form rapporto, se esiste un roster per il campionato e anno corrente, appare un select con gli arbitri; altrimenti rimane il testo libero con autocomplete dall'anagrafica.

### Invio rapporto via email
Implementato. Il pulsante "Invia PDF all'arbitro" appare nella pagina di dettaglio solo se SMTP è configurato nel `.env`.

**TODO: scegliere e configurare l'indirizzo email mittente**
- Decidere quale account Gmail (o altro) usare come mittente
- Creare un'App Password su https://myaccount.google.com/apppasswords (richiede 2FA attiva)
- Impostare nel `.env` del NAS: `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`
- L'email dell'arbitro deve essere presente nell'anagrafica — senza email il pulsante restituisce un errore esplicito

### AI helper giudizio globale — fase 2: esempi few-shot
Implementata la fase 1 (zero-shot): l'helper AI genera e raffina il giudizio globale a partire dai soli dati del rapporto, governato dal flag `ENABLE_AI_FEATURES`.

**TODO fase 2:** migliorare lo stile e la coerenza dell'output passando al modello 2-3 esempi di giudizi globali ben fatti come few-shot examples nel prompt.

Due opzioni:
- **Statici (consigliato come primo passo):** 2-3 esempi curati a mano, cablati in `src/services/judgmentPromptBuilder.js` come messaggi `assistant` precedenti. Semplice, e con `cache_control: { type: 'ephemeral' }` sul system gli esempi pesano sui token solo alla prima chiamata.
- **Dinamici dal DB:** pescare giudizi di rapporti `final` con voto > soglia o flaggati a mano come "esempio di riferimento". Più potente ma niente cache hit (il prompt cambia tra chiamate) e serve un criterio di selezione.

Punto di partenza: scegliere 2-3 rapporti finalizzati con giudizi che ti soddisfano, copiarli in `judgmentPromptBuilder.js`, attivare il prompt caching ephemeral.

---

## UI / UX — Miglioramenti in corso

### Avviso scadenza certificato
Nella tabella arbitri, la data di scadenza certificato è evidenziata in rosso se entro 90 giorni.
**TODO:** aggiungere un banner o badge nella dashboard admin quando esistono arbitri con certificato in scadenza (es. "3 arbitri con certificato in scadenza entro 30 giorni").

### Paginazione elenco arbitri
Con 47+ arbitri la tabella è già lunga. Valutare paginazione client-side (es. 25 per pagina) o un filtro aggiuntivo per lettera iniziale cognome.

### Esportazione elenco arbitri
Aggiungere un pulsante "Esporta CSV" nella pagina Anagrafica arbitri per poter usare i dati in Excel o simili.

### Sezione Note arbitro nella pagina dettaglio rapporto
Attualmente le note dell'arbitro (campo `notes` in anagrafica) non sono visibili nel dettaglio del rapporto. Valutare se mostrarle all'osservatore come promemoria privato durante la compilazione.

### Tipologia rapporto da video
TODO: introdurre una tipologia separata di rapporto per le gare visionate da video
(non in presenza). La struttura della scheda sarà diversa da quella del rapporto
dal vivo e verrà definita più avanti.

Regole di accesso:
- solo admin e formatori possono creare rapporti da video.
- gli osservatori possono creare solo rapporti dal vivo, senza scelta iniziale.
- gli arbitri mantengono accesso read-only secondo le regole già previste.

UX desiderata:
- per admin/formatori: click su "Nuovo rapporto" → scelta iniziale "Dal vivo" o
  "A video".
- se scelgono "Dal vivo", si apre il flusso attuale.
- se scelgono "A video", prima viene richiesto il link per visionare la gara,
  poi si apre la nuova struttura del rapporto video.
- per osservatori: "Nuovo rapporto" apre direttamente il rapporto dal vivo.

Note implementative:
- non modellarlo come semplice flag sul rapporto live.
- prevedere una struttura dati/validazione dedicata per il rapporto video.
- PDF di esportazione con header specifico ("Rapporto da video") e link alla gara.

Effort stimato: medio/alto, perché richiederà una nuova struttura scheda,
validazioni dedicate, UI di scelta iniziale e layout PDF specifico.

---

## Gare e designazioni — prossimi sviluppi

### Designazione osservatori in blocco (pagina dedicata)
> **✅ Implementato:** pagina [DesignateObserversPage.jsx](client/src/pages/DesignateObserversPage.jsx)
> su route `#/games/designate`, raggiungibile dal bottone **"Designa osservatori"**
> nell'hero della pagina Gare. Filtri campionato (scopato per il formatore) + fase
> (MultiSelect) + giornata (MultiSelect); per ogni gara select osservatore +
> "Suggerisci" (pannello con graduatoria, badge "già designato quel giorno").
> Riusa `listGames`/`listGameObservers`/`observer-suggestions`/`setGameOfficial`
> (nessuna nuova API) e rispetta lo scoping per ruolo. Il dettaglio gara resta per
> le modifiche complete.

Pagina pensata per i formatori responsabili di un campionato, per **designare
velocemente gli osservatori** su molte gare senza passare dal dettaglio di
ognuna.

**Dove:** pagina dedicata (non un modal), raggiungibile da un pulsante
**"Designa osservatori"** nella pagina Gare. Motivo: contiene filtri + elenco
gare + un menu a tendina per riga + suggeritore — troppo per un modal, e la
pagina si integra con l'hash-routing già esistente ([navigation.js](client/src/lib/navigation.js)
+ [App.jsx](client/src/App.jsx)). Il dettaglio gara resta il posto dove si
modifica *tutto*; questa è una pagina in più, focalizzata solo sull'osservatore.

**Flusso:**
1. Filtri in alto: **campionato**; **fase** (più di una, checkbox multi-select);
   **giornata** (più di una, checkbox multi-select). Riusare il componente
   [MultiSelect.jsx](client/src/components/MultiSelect.jsx).
2. Sotto, l'elenco delle gare che corrispondono alla ricerca; per ogni gara:
   dati sintetici (n. gara, data, squadre, arbitri) + a destra un **menu a
   tendina per scegliere l'osservatore**, con accanto il tasto **"Suggerisci"**
   (riusa `getObserverSuggestions`, già a criterio unico "diversificazione").
3. Assegnazione riga per riga con feedback immediato (riusa
   `setGameOfficial`).

**Note:** nessuna nuova API dovrebbe servire (bastano `listGames`,
`observer-suggestions`, `setGameOfficial`). Evidenziare, come nel dettaglio, se
l'osservatore è **già designato quello stesso giorno**. Solo admin/instructor.

### Sincronizzazione FIP automatica giornaliera (cron 13:15)
La FIP pubblica gli arbitri designati **5 giorni prima** della gara **alle 13:00**.
Un job schedulato **ogni giorno alle 13:15** che risincronizza le sorgenti già
configurate tiene aggiornate le gare con gli arbitri appena pubblicati (e con
eventuali sostituzioni/cambi successivi), senza sync manuale.

**Beneficio:** le gare già designate a un osservatore si **popolano con gli
arbitri**, così il prefill del rapporto e il suggeritore funzionano, e nelle
pagine Rapporti gli osservatori trovano le loro gare pronte da compilare.

**Nota di allineamento:** il sync FIP aggiorna **solo gli arbitri**, mai gli
osservatori (interni). Il cron quindi non fa *comparire* nuove gare agli
osservatori (quelle compaiono quando il formatore designa l'osservatore): le
**popola con gli arbitri**.

**Requisiti implementativi:**
- Riusa `runFipSync(sourceId)` (già idempotente, con audit in `sync_runs` e
  gestione conflitti/lock manuali). Sincronizza **solo le sorgenti attive**, in
  sequenza, con una piccola pausa tra sorgenti, rispettando il lock
  `syncInFlight`.
- **Configurabile e disattivabile via env** (es. `ENABLE_SCHEDULED_SYNC`,
  `SCHEDULED_SYNC_TIME=13:15`), come da requisiti originari; deve girare nel
  singolo processo Node systemd senza duplicati.
- **Timezone:** 13:15 = ora italiana → il NAS deve essere su `Europe/Rome` (o il
  job deve gestire esplicitamente il fuso).
- Due approcci: **(a)** scheduler in-process (piccolo timer che calcola il
  prossimo 13:15, nessuna dipendenza nativa) — consigliato per il processo
  systemd unico; **(b)** systemd timer che invoca uno script/endpoint — più
  robusto ma richiede configurazione lato NAS.
- Non martellare la FIP: l'adapter ha già la pausa tra le richieste (andata +
  ritorno ≈ 22 richieste/sorgente).
- Esito visibile: la pagina Sorgenti mostra già `last_synced_at` + stato;
  opzionale un badge "ultimo sync automatico" o una notifica in caso di errore.

### Nuovo template designatore (DOPO l'import degli arbitri)
Rifare il template XLSX che si passa al designatore:
- aggiungere una colonna **Campionato** per ogni partita;
- **eliminare la colonna ARBITRO 3** (in questi campionati non serve);
- rendere le celle sotto **ARBITRO 1** e **ARBITRO 2** dei **menu a tendina**
  (data-validation XLSX) con i nomi degli **arbitri di quel campionato** (dal
  roster), così si evitano i typo.

Prerequisito: anagrafica/roster arbitri già importati e associati per
campionato. Riusare/estendere [xlsxService.js](src/services/xlsxService.js).
Nota tecnica: la tendina in `exceljs` si imposta come data-validation `list` su
un intervallo di celle; per liste lunghe conviene un **foglio nascosto** con
l'elenco arbitri per campionato come sorgente dei valori.

### Refactoring dashboard compilazione rapporti (per ruolo)
> **✅ Implementato (nucleo):** split visibilità/modifica lato server basato sulla
> **designazione** (`assertReportAccess` / `assertReportMutationAccess` +
> `isDesignatedObserver`), visibilità osservatore allargata a `observer_id`,
> endpoint `GET /api/reports/pending-games` + coda **"Da compilare"** in dashboard,
> `canManage`/bottone Modifica basati sulla designazione, test in
> [tests/reportAccess.test.js](tests/reportAccess.test.js). **Resta:** il
> refactoring visivo più profondo (raggruppamenti, stati) e lo scoping trasversale
> del formatore su Gare/Statistiche/Anagrafica (vedi "Permessi e visibilità per
> ruolo") + filtro `competition` in `listGames`.

Refactoring anche **visivo** della dashboard da cui si compilano i rapporti, con
visibilità e permessi legati al ruolo:
- **Osservatore:** vede **tutte le gare per cui è designato** e può
  **creare/modificare i rapporti** delle gare dove è designato.
- **Formatore:** vede i rapporti di **tutte le gare del suo campionato**; può
  **creare/modificare** i rapporti dove è **lui designato**.
- **Admin:** vede e modifica tutto.

**Idea chiave — separare VISIBILITÀ da MODIFICA** (oggi coincidono):

| Ruolo | Vede | Può creare/modificare |
|---|---|---|
| Admin | tutto | tutto |
| Formatore | tutte le gare/rapporti dei suoi campionati | solo dove è designato lui |
| Osservatore | le gare per cui è designato | solo dove è designato |
| Arbitro | i propri rapporti (read-only) | niente |

**Cosa esiste già (riuso, non da rifare):**
- `listGames({ observerUserId, season })` in
  [gameService.js](src/services/gameService.js) restituisce già le gare di un
  osservatore **con lo stato del rapporto collegato** (`reportId`,
  `reportStatus`, `derivedState`) → "le gare per cui sono designato" è quasi
  gratis.
- `instructorCompetitionsForUser(user)` + `users.formatter_competition` →
  scoping formatore↔campionati già presente
  ([reportService.js](src/services/reportService.js)).
- `reports.observer_id` distinto da `created_by` → si può basare la modifica
  sulla **designazione**, non su chi ha creato il rapporto.
- `game_officials(role='observer', user_id)` → link designazione↔utente.

**Cosa manca (da costruire):**
1. **Dashboard game-centric** per osservatore/formatore: non più solo lista
   rapporti, ma **coda di lavoro** = gare designate con stato rapporto
   (nessuno / bozza / definitivo) e azione per riga (Compila / Modifica / Apri).
   Fonte dati: osservatore → `listGames({ observerUserId: me })`; formatore →
   `listGames` filtrato per i suoi campionati (aggiungere il filtro
   `competition` a `listGames`, oggi assente).
2. **Split VISIBILITÀ/MODIFICA lato server:**
   - `appendUserVisibilityClause` (visibilità): per l'osservatore includere
     anche `observer_id = me` (non solo `created_by = me`), così vede i rapporti
     creati per suo conto.
   - Autorizzazione alla **modifica** (`assertReportAccess` + rotta PUT
     [reports.routes.js](src/routes/reports.routes.js)): consentire se admin,
     oppure se l'utente è l'**osservatore designato** della gara
     (`game_officials.observer.user_id = me`) o `report.observer_id = me`.
     Restringere il formatore: oggi può modificare qualsiasi rapporto del suo
     campionato; deve poter modificare **solo dove è designato**.
3. **UI role-aware in [DashboardPage.jsx](client/src/pages/DashboardPage.jsx):**
   `canManage` basato sulla designazione (non su `createdBy`); nascondere azioni
   di modifica dove non consentito; raggruppare "Da compilare" vs "Compilati".

**Approccio a fasi consigliato:** (a) split visibilità/modifica lato server con
test; (b) filtro `competition` in `listGames`; (c) refactor UI dashboard come
coda di lavoro per ruolo. Coordinare con la sezione "Permessi e visibilità per
ruolo".

### Reset totale con export completo (DA FARE PER ULTIMO)
Possibilità di **ripulire tutto** — eliminare sorgenti, arbitri e gare — ma solo
**dopo aver salvato un export completo in Excel** (multi-foglio) con *tutti* i
dati, statistiche comprese.

**Perché per ultimo:** la struttura con cui salviamo i dati può ancora cambiare
più volte; ha senso implementare export+reset solo quando lo schema è stabile,
per non doverlo rifare a ogni cambiamento.

**Requisiti:**
- Export XLSX su più fogli: sorgenti, arbitri, gare, designazioni/ufficiali,
  rapporti, e le statistiche (copertura arbitri, matrice osservatore-arbitro,
  impiego). Riusare/estendere [xlsxService.js](src/services/xlsxService.js).
- Il reset avviene **solo dopo** che l'export è stato generato e scaricato, con
  conferma esplicita (operazione distruttiva, solo admin).
- Non toccare i rapporti/PDF storici se non esplicitamente incluso: decidere il
  perimetro esatto quando si implementa.

---

## Arbitri: fasce (esordienti / playoff / playout)

> **✅ Implementato:** tabella `referee_bands(referee_id, competition, sport_season, band)`
> (schema + indice), CRUD in `refereeService` (`listBandMembers`/`addBandMember`/
> `removeBandMember`) con endpoint `GET /api/referees/bands`, `POST /api/referees/:id/bands`,
> `DELETE /api/referees/bands/:bandId` (scoping formatore). Vista **"Fasce"** nella
> pagina Arbitri (campionato + fascia, aggiungi/rimuovi). Statistiche: **filtro
> Fascia** + **search bar** su nome/cognome/tessera (`license` ora esposto).
> Corretto anche il filtro campionato delle statistiche (usa
> `referee_season_categories`, non più `referee_rosters`). Test in
> [tests/bands.test.js](tests/bands.test.js). **Possibile estensione:** ricerca
> lato server e semantica "esordio in categoria" derivata automaticamente.

Gestione di **fasce/liste di arbitri per campionato e stagione**, con i relativi
filtri nelle statistiche.

### Fasce previste
- **ESORDIENTE** — arbitro all'esordio nella categoria (per statistiche dedicate
  ai soli esordienti).
- **PLAYOFF** — arbitri assegnati alla lista playoff al termine della stagione
  regolare.
- **PLAYOUT** — come playoff, per i playout.

Le fasce sono **per campionato e per stagione**: ogni campionato ha la sua lista
per ciascuna fascia. Un arbitro può appartenere a più fasce.

### Modello dati (additivo, non distruttivo)
Nuova tabella, sullo stile di `referee_rosters`:
```
referee_bands(id, referee_id, competition, sport_season, band)
band ∈ ('esordiente','playoff','playout')
UNIQUE(referee_id, competition, sport_season, band)
```
Il numero tessera esiste già come `referees.license_number` — nessun campo nuovo
per la ricerca.

### Anagrafica: vista "Fasce"
Nella pagina Arbitri, una vista/tab **"Fasce"** per:
- vedere, per campionato + stagione, gli arbitri in ciascuna fascia
  (ESORDIENTI, PLAYOFF, PLAYOUT);
- aggiungere/rimuovere arbitri dalla lista di una fascia (come già si fa con i
  roster di campionato).

Rispetta lo scoping per ruolo: il formatore vede/gestisce solo i propri
campionati.

### Statistiche: filtro fascia + ricerca
Nella pagina Statistiche:
- **filtro "Fascia"** (Tutte / Esordienti / Playoff / Playout) che restringe gli
  arbitri a quelli iscritti a quella fascia per il campionato+stagione
  selezionati (intersezione con `referee_bands`);
- **search bar** come quella della pagina Gare, che filtra gli arbitri per
  **nome, cognome o numero tessera** (`license_number`). Da applicare alla
  dimensione arbitri in tutte e tre le viste (copertura, matrice, impiego).

### Note implementative
- API: estendere `refereeService` (CRUD delle fasce) e `statsService` (filtro
  per fascia, come già fatto per il campionato con il parametro `competitions`).
- Riusa i componenti esistenti (`MultiSelect`/`Select`, la search dei filtri
  gare) e lo scoping campionato già introdotto.

---

## Permessi e visibilità per ruolo (trasversale)

> **✅ Implementato (scoping principale):** `/api/games` riservato ad
> admin/formatori (osservatori solo `report-prefill` per compilare; arbitri
> esclusi) con **scoping del formatore ai suoi campionati** (`listGames({ competitions })`
> + `assertGameCompetitionAccess`); `/api/stats` con scoping formatore
> (`effectiveCompetitions` → `competitions` array in `statsService`); `/api/referees`
> era già scopato. Topbar: **"Dashboard"→"Rapporti"**, **"Nuovo rapporto" rimosso**,
> **Gare/Statistiche/Arbitri nascoste agli osservatori**; guardie di pagina su
> Gare/Statistiche. Test in [tests/scoping.test.js](tests/scoping.test.js).
> **Resta:** far rispettare lo scoping anche alla futura pagina "Designa
> osservatori"; eventuale enforcement che l'osservatore crei rapporti solo per le
> gare dove è designato (oggi il prefill è aperto, ma la coda mostra solo le sue).

Tutto deve funzionare **in funzione del ruolo dell'utente**. Regole:

- **Admin:** vede e gestisce sempre tutto, senza restrizioni.
- **Formatore (instructor):** vede e gestisce **solo ciò che riguarda i
  campionati di cui è formatore**. Vale ovunque: pagina Gare, Statistiche,
  Anagrafica arbitri, designazioni, suggerimenti. Serve un legame
  formatore↔campionato/i (es. tabella `instructor_competitions` o campo sui
  `users`), da leggere nei filtri e nelle query lato server.
- **Osservatore:** **può solo compilare i propri rapporti**. Non vede le pagine
  Gare, Statistiche, Anagrafica arbitri, Sorgenti, Import. La topbar deve
  nascondere le voci non accessibili e le route devono rifiutare l'accesso lato
  server (non basta nascondere in UI).
- **Arbitro:** invariato — accesso in sola lettura ai propri rapporti secondo le
  regole già esistenti.

Note implementative:
- Oggi esistono già le guard `requireAdminOrInstructor` ecc. in
  [auth.js](src/middleware/auth.js), ma **il formatore non è ancora ristretto ai
  suoi campionati**: va introdotto lo scoping per competizione in TUTTE le query
  di gare/statistiche/arbitri (filtro implicito lato server, non solo nel
  Select).
- La visibilità va applicata **sia in UI** (nascondere voci/menu e filtri) **sia
  in API** (ogni endpoint verifica ruolo + perimetro campionati).
- Coordinare con il filtro "campionato" appena introdotto nelle Statistiche: per
  un formatore il set di campionati selezionabili deve essere limitato ai suoi.
- Definire il comportamento per un formatore con più campionati (default: unione
  dei suoi; possibilità di filtrare su uno solo).

---

## Roadmap futura: app Android/iOS

Obiettivo futuro, non immediato: trasformare AnalisiGara da webapp completa a
vera applicazione installabile su Android e iOS.

Priorità attuale: completare e stabilizzare prima la versione webapp.

### Strategia consigliata

Usare Capacitor sopra l'attuale frontend React/Vite, così da riutilizzare gran
parte della webapp esistente senza riscriverla da zero.

Il backend, il database SQLite, lo storage dei PDF e la generazione dei rapporti
restano lato NAS/server. L'app mobile deve collegarsi a un backend remoto tramite
HTTPS.

### Prerequisiti

- Esporre AnalisiGara con un dominio HTTPS stabile, non solo tramite IP locale.
- Verificare login, sessioni, cookie e logout da rete esterna.
- Rendere tutte le schermate principali comode da usare su mobile.
- Sistemare apertura, download e condivisione PDF in ambiente mobile.
- Verificare upload foto/file da smartphone.
- Preparare icone, splash screen e nome app.

### Step tecnici futuri

1. Rendere configurabile l'URL API tra sviluppo locale e produzione.
2. Aggiungere Capacitor al progetto.
3. Creare target Android e iOS.
4. Testare login, dashboard, rapporti, PDF e profilo su dispositivi reali.
5. Gestire tasto indietro Android e navigazione mobile.
6. Preparare build Android con Android Studio.
7. Preparare build iOS con Xcode.
8. Configurare firma, certificati e pubblicazione.
9. Pubblicare prima in test interno / TestFlight.
10. Valutare solo in seguito eventuali funzioni native avanzate, come notifiche
    push o offline.

### Alternative

Una PWA sarebbe più semplice e veloce, ma meno simile a una vera app pubblicata
sugli store.

Una riscrittura in React Native/Expo darebbe un'esperienza più nativa, ma
richiederebbe molto più lavoro e non è consigliata come primo passo.
