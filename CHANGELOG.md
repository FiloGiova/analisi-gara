# Changelog

Registro delle modifiche al progetto, per poterle ricostruire in caso di errori.
Ogni consegna riporta: file toccati, migrazioni al database, dipendenze e decisioni.
Per richiesta dell'utente, aggiornare questo registro a ogni intervento, anche
per configurazioni esterne e decisioni: distinguere quanto implementato,
quanto riferito dall'utente e quanto ancora da verificare. Registrare gli esiti
dei controlli e gli eventuali passi di ripristino, senza includere credenziali,
token di invito o altri segreti.

Nota: oltre a questo file, ogni modifica ai **dati** delle gare (manuale o da
sincronizzazione) è tracciata nella tabella `game_changes` ed è visibile nella
sezione "Storico modifiche" del dettaglio gara.

## 2026-09-21 — Correzione del ramo di pubblicazione: main

**Conferma dell’utente.** Render è configurato per pubblicare da `main`, non
da `cloud-migration`. L’assistente aveva dedotto erroneamente il ramo corrente
dal campo `ref` e dall’ambiente dei deployment GitHub, senza leggere la
configurazione attuale della dashboard Render. `render.yaml` indicava già
correttamente `main` e non è stato modificato.

**Correzione.** README e manuale auth ora indicano il solo push su `main` per
i rilasci. Annotata la deduzione errata nella voce di preparazione, mantenendo
il registro delle operazioni effettivamente eseguite. Il rilascio applicativo
e l’aggiornamento documentale precedenti erano già stati pubblicati anche su
`main` (`514a7a5`, `1842587`); l’aggiornamento aggiuntivo di `cloud-migration`
non era necessario. Nessun ripristino o riscrittura della storia di quel ramo.

**Ambito e controlli.** Modifica esclusivamente documentale, verificata con
`git diff --check`; pubblicazione di questa correzione solo su `main`.
Nessuna modifica al codice applicativo, al database o alla configurazione
Render. Resta esclusa la cancellazione locale preesistente di `NEXT_STEPS_2.md`.

## 2026-09-21 — Pubblicazione su Render e controlli in produzione

**Rilascio.** Commit applicativo `514a7a5af9c4c6e5efd3e27a33e9e64a5717c911`,
push atomico su `main` e `cloud-migration`, entrambi aggiornati senza forzare
la storia. Render ha completato il deployment `dep-daofqrflk1mc7384fm0g`,
registrato da GitHub come `6565766973`, con stato `success` alle 09:49:21 UTC.
[Dettaglio del deploy](https://dashboard.render.com/web/srv-d9a9r3ecjfls739g5md0/deploys/dep-daofqrflk1mc7384fm0g).

**Verifica online.** Home, `/privacy`, `/termini` e `/app` rispondono 200 sul
dominio `https://fischiolab.onrender.com`. Titolare, email e tag Search Console
corrispondono ai dati forniti. `/api/health` restituisce `{"ok":true}`;
`/api/auth/me` espone Google abilitato e trasporto email configurato. `/api/users`
e `/api/reports` senza sessione restano protetti con 401. Presenza della
configurazione SMTP non equivale a consegna verificata delle email.
Chrome sul dominio pubblico: login a 390 e 1440 px con username/password e
bottone Google visibili, senza errori JavaScript o richieste fallite; home e
documenti leggibili senza JavaScript. Segnalibro `/#/account` trasferito a
`/app#/account`. Screenshot locali in `/tmp/fischiolab-release-online`.

**Database.** La migrazione è stata applicata dall’avvio di Render. Controllo
successivo esclusivamente in lettura: presenti le cinque nuove tabelle auth,
password facoltativa, tutte le 28 tabelle pubbliche con RLS; nessun privilegio
di tabella per i ruoli Data API `anon` e `authenticated`. Nessuna operazione
manuale su utenti, password, inviti o rapporti. Backup precedente descritto
nella voce di preparazione qui sotto.

**Documentazione e passi del titolare.** README e manuale auth aggiornati allo
stato pubblicato. Restano la conferma della proprietà in Search Console e la
richiesta branding Google, oltre alla prova completa di accesso con un account
Google reale. Non sono state modificate le console Google/Supabase né inviate
email a utenti. La cancellazione locale preesistente di `NEXT_STEPS_2.md` non
è stata inclusa nel rilascio.

## 2026-09-21 — Preparazione del rilascio completo autorizzato

**Autorizzazione e ambito.** L’utente ha chiesto di pubblicare tutto il lavoro:
autenticazione con inviti/password/Google, correzioni ai rapporti, home pubblica,
privacy e termini. Inclusi codice, migrazione auth, test e documentazione;
la cancellazione locale preesistente di `NEXT_STEPS_2.md` resta esclusa.

**Controlli prima del push.** `main` allineato a `origin/main` su `a9ce85e`.
Suite completa **186/186** su PostgreSQL locale dedicato; build Vite e controllo
diff superati. Produzione iniziale: home e `/api/health` rispondono 200,
`/api/auth/me` espone ancora soltanto la precedente funzione AI. Lettura preliminare del database:
PostgreSQL 17.6, 23 tabelle pubbliche, connessione `postgres` proprietaria con
`BYPASSRLS`; migrazione auth non ancora applicata. Nessun test eseguito sul DB
di produzione.

**Backup prima della migrazione.** Dump PostgreSQL dello schema `public`,
struttura e dati, creato fuori dal repository nella directory privata locale
`~/Library/Application Support/FischioLab/backups/`, file
`pre-auth-release-2026-09-21-1789983967503.dump` (252.809 byte, permessi 0600).
Archivio leggibile da `pg_restore --list`; il backup riguarda lo schema che
viene modificato, non i file Storage o gli schemi interni Supabase.

**Canale di pubblicazione — deduzione successivamente corretta.** I metadati
GitHub del deployment `4818a9b` del 18 settembre riportavano `cloud-migration`,
28 commit dietro `main` e senza divergenze. Da questo l’assistente ha dedotto
erroneamente che occorresse aggiornare entrambi i rami: il push è stato eseguito
senza forzare la storia. L’utente ha poi confermato che Render è configurato su
`main`; README e manuale sono stati corretti, come riportato nella voce sopra.

## 2026-09-21 — Finalizzazione locale di privacy e termini

**Dati forniti e richiesta.** Il 20 settembre l’utente ha indicato Filippo
Giovagnini come titolare e gestore personale di FischioLab e
`filo.giova98@gmail.com` come contatto pubblico, chiedendo di finalizzare la
privacy. Chiusura del lavoro ripresa il 21 settembre dopo l’interruzione.

**Implementazione.** Dati e testi versionati in `src/publicInformation.js`,
usati come default da `src/config.js`. Privacy e termini sono ora completi
senza impostare nuove variabili Render; `PUBLIC_*` resta un override
facoltativo. Eventuali vecchi override vanno controllati prima del deploy.
Resta la protezione 503/noindex per configurazioni risultanti incomplete o
con email non valida. Rimossi dal blueprint i quattro nuovi campi obbligatori.

**Contenuto.** Indicati titolare, contatto, gestione personale, fonti dei dati
e interessati anche senza account; distinti accesso necessario, email e Google
facoltativi. Aggiunti basi giuridiche, criteri di conservazione per categoria,
fornitori e riferimenti contrattuali per i trasferimenti, richieste di
cancellazione e durata dei cookie coerente con la configurazione. Chiarito
che disattivazione e scollegamento Google non cancellano rapporti, identità
Supabase o tutto lo storico. I documenti riportano il 20 settembre 2026,
data di redazione; layout e identità visiva invariati.

**Decisioni e limiti.** Nome, contatto e gestione sono dichiarazioni
dell’utente; basi giuridiche e conservazione sono una redazione per il servizio
descritto, non una certificazione legale o un esito di verifica Google. Nessuna
durata fissa inventata per rapporti e registri, né nuova cancellazione
automatica: valutazione della necessità e gestione delle richieste restano
al titolare. Assunzioni e verifiche operative su fornitori e trattamento sono
esplicitate in `docs/AUTHENTICATION.md`.

**File e controlli.** Aggiornati anche `src/views/publicPages.js`,
`tests/publicPages.test.js`, `.env.example`, `render.yaml`, README e manuale
auth. Test mirati **7/7**, build Vite e `git diff --check` superati. Chrome
senza JavaScript: `/privacy` e `/termini` restituiscono 200 con i dati reali
a 320, 390 e 1440 px, senza overflow orizzontale o richieste fallite. Verifica
locale con database indisponibile e nessuna inizializzazione DB. Server di
anteprima arrestato; screenshot in `/tmp/fischiolab-privacy-final`.
Revisione indipendente Impeccable: `ship` per leggibilità e coerenza del testo
con accesso Google facoltativo e cancellazione manuale; nessuna attestazione
di conformità legale o approvazione Google.
Controllo documentale Impeccable: nessuna nuova decisione di design da riportare
in PRODUCT.md o DESIGN.md; entrambi invariati.

**Stato esterno e ripristino.** Nessuna migrazione, dipendenza aggiunta,
modifica al database remoto, commit, push o deploy. Restano pubblicazione,
controllo delle pagine online, verifica della proprietà in Search Console e
nuova richiesta branding Google. Per ripristinare, annullare le sole modifiche
di questa voce e configurare i precedenti `PUBLIC_*`; nessun dato da migrare.

## 2026-09-20 — Verifica della visibilità delle designazioni sul sito pubblico FIP

**Richiesta.** Verificare l’affermazione riferita dallo sviluppatore federale:
le designazioni sarebbero già presenti nei dati della pagina ma nascoste fino
a cinque giorni prima della gara. Esaminata la pagina pubblica A2 maschile
indicata dall’utente, senza sessioni federali autenticate.

**Esito osservato.** Dieci gare con stato `designata-nonvisibile`. L’HTML
ricevuto contiene l’avviso di pubblicazione, non i nominativi degli arbitri
nei relativi blocchi. Per la gara 001359 del 26 settembre, pubblicazione
indicata il 21 settembre alle 12:00; per le altre nove gare del 27 settembre,
il 22 settembre alle 12:00. Il bundle JavaScript pubblico apre “Info” con
`toggleClass('active')`. Nel caricamento normale e dopo il clic non sono
state osservate richieste XHR/fetch verso domini FIP. Il parser esistente,
eseguito soltanto sull’HTML scaricato, restituisce tre campi arbitro vuoti
per ciascuna gara.

**Conclusione e limite.** Nessuna designazione anticipata estratta. La sola
ipotesi di nominativi nascosti nel browser non è confermata: i nomi sono già
omessi dalla risposta HTML osservata. Questo non descrive il database federale
né esclude un canale di integrazione distinto e autorizzato. Per valutarlo
servono documentazione dell’interfaccia e modalità di accesso dal gestore.

**Approfondimento Montecatini–Rimini.** Su richiesta successiva, ricontrollata
la gara 001356 del 27 settembre alle 18:00 con una nuova lettura della pagina:
nessun campo osservatore o nominativo associato, né attributi `data-*` nel
blocco gara. Nessun riferimento a osservatori/commissari nel relativo HTML;
l’unica occorrenza “commissari” nel bundle riguarda il template dei commissari
tecnici della nazionale. L’avviso del 22 settembre alle 12:00 si riferisce
agli arbitri: non dimostra quando o se venga pubblicato l’osservatore.

**Ambito.** Lettura della pagina e del suo script, controllo browser anonimo
e parser in memoria. Nessuna modifica al codice dell’app, sincronizzazione,
importazione, query al database del progetto, commit, push o deploy. Aggiornato
solo questo registro; `git diff --check` superato.
Fonte: [pagina risultati FIP esaminata](https://fip.it/risultati/?group=campionati-nazionali-maschili&sesso=M&comitato_codice=&codice_campionato=A2/M).

## 2026-09-19 — Home pubblica e preparazione alla verifica branding Google

**Richiesta ed evidenza.** La schermata condivisa dall’utente segnala proprietà
del sito non verificata, informativa privacy insufficiente e home protetta da
login. L’utente ha poi fornito il tag pubblico Search Console e chiesto di
riprendere il lavoro interrotto. Nessuna verifica esterna dichiarata superata.

**Implementazione locale.** Nuove route Express `/`, `/privacy`, `/termini`
con HTML leggibile senza JavaScript, prima del middleware di sessione e senza
query DB. Home con presentazione, accesso su invito, uso facoltativo di Google
e collegamenti ai documenti. Il tag di verifica fornito dall’utente è incluso
nel sorgente HTML; può essere sostituito con `GOOGLE_SITE_VERIFICATION`.
La webapp si apre su `/app`. Un piccolo script conserva inviti, callback e
segnalibri `/#/...` trasferendoli a `/app#/...`, senza inviare il frammento al
server. Il consumo dell’invito rimuove il token mantenendo il percorso corrente.
Login e attivazione includono i link pubblici. Proxy Vite aggiornato.

**Privacy da completare.** Predisposto testo coerente con i dati e i flussi
effettivi: autenticazione, rapporti, ruoli, fornitori, cookie, registri,
scollegamento Google e richieste di cancellazione; menzione Anthropic solo
quando la relativa funzione è abilitata. Richiesti nome del titolare e contatto.
Le variabili `PUBLIC_OPERATOR_NAME`, `PUBLIC_CONTACT_EMAIL`,
`PUBLIC_PRIVACY_LEGAL_BASIS`, `PUBLIC_PRIVACY_RETENTION` devono essere completate
con le informazioni effettive. Finché incomplete, privacy e termini mostrano
“Documento in preparazione” con 503/noindex, senza pubblicare nominativi,
durate o basi giuridiche inventate. Nessuna nuova cancellazione automatica.

**File.** `src/routes/public.routes.js`, `src/views/publicPages.js`,
`client/public/public-site.css`, `client/public/public-navigation.js`,
`src/config.js`, `server.js`, `AuthLayout.jsx`, `ActivationPage.jsx`, CSS,
`vite.config.js`, `.env.example`, `render.yaml`, README, manuale auth e registro.
Test in `tests/publicPages.test.js`. Nessuna migrazione o nuova dipendenza.

**Verifiche.** Build riuscita; suite completa **186/186** su PostgreSQL locale
dedicato. Sette nuovi test coprono pagine pubbliche con cookie e DB indisponibile,
documenti incompleti, contenuti HTML, escaping, metadati Google, funzionalità AI,
compatibilità link e protezione delle API. Chrome/Playwright: home senza JS a
320/390/1440 px, privacy desktop/mobile, termini, login mobile e flusso
segnalibro storico → creazione profilo → invito → attivazione senza email →
reload → logout/login, senza errori JavaScript. Documenti completi collaudati
solo con dati dimostrativi in ambiente locale separato. Detector Impeccable:
solo avvisi su Montserrat, mantenuto perché font del design esistente.
Proxy Vite verificato per home, documenti e `/app`; `git diff --check` riuscito.
Revisione indipendente Impeccable: corretta la scritta “Lab” da arancione a
teal, come nel login; verdetto `ship` sulla correzione, non sulla pubblicazione
o sulla validità legale dell’informativa. Controllo documentale del design:
estensione coerente, nessuna modifica a PRODUCT.md/DESIGN.md; formati e sidecar
preesistenti non aggiornati. Server di collaudo locale arrestato a fine verifica.

**Passi esterni ancora necessari.** Completare la privacy, pubblicare le
modifiche, premere Verifica in Search Console e richiedere la nuova verifica
branding solo dopo il controllo delle pagine online. Nessun push, deploy,
modifica alle console o al database di produzione eseguito in questo intervento.

**Ripristino di questa estensione.** Per tornare alla precedente home di login
rimuovere il montaggio delle route pubbliche e i relativi link, ripristinare
il proxy Vite e ricompilare. Nessun dato migrato; l’autenticazione implementata
nella voce precedente resta distinta da questa estensione.

## 2026-09-19 — Requisiti branding Google e pagine pubbliche mancanti

**Richiesta.** L’utente ha condiviso i campi logo, home, privacy e termini della
console Google per procedere alla pubblicazione. Consultate le fonti ufficiali
Google e verificati gli asset, la pagina iniziale e il routing locali.

**Esito.** Il logo `client/public/app-logo.png` è già disponibile: PNG 512 × 512
di 125.256 byte, sotto il limite di 1 MB. La pagina iniziale descrive brevemente
FischioLab ma mancano i documenti privacy e termini e i relativi collegamenti.
In `docs/AUTHENTICATION.md` registrati il mapping dei campi, i percorsi proposti
`/privacy` e `/termini` (non ancora implementati/pubblicati), la distinzione fra
pubblicazione OAuth e branding e il requisito di verifica dei domini.
Chiesti all’utente nome del gestore/titolare e contatto pubblico; nessun dato
inventato, nessuna verifica del dominio o del branding dichiarata completata.

**Ambito.** Modificati soltanto questo registro e `docs/AUTHENTICATION.md`.
Logo e codice invariati in questo intervento; nessuna dipendenza, migrazione,
modifica alle console, push o pubblicazione. Verifica: `git diff --check`.

## 2026-09-19 — Variabili Render e verifica audience Google

**Configurazione riferita dall’utente.** Completato il punto 1 della checklist
Render: `SUPABASE_PUBLISHABLE_KEY`, `ENABLE_GOOGLE_AUTH`, `APP_BASE_URL`,
`TRUST_PROXY_HOPS`; `COOKIE_SECURE` era già presente. Presenza e valori non
verificati direttamente nella console; resta da confermare che `COOKIE_SECURE`
sia `true` e da collaudare il flusso dopo il deploy. Nessuna chiave registrata
nel repository. Questa conferma aggiorna lo stato della configurazione esterna
descritto nella voce di implementazione sottostante.

**Precisazione Google.** Lo stato effettivo di Audience non è ancora stato
riferito. Per i destinatari con account personali o di organizzazioni diverse
è indicato External. Corretta in `docs/AUTHENTICATION.md` l’affermazione troppo
generale sull’obbligo di test users: Google prevede un’eccezione per il solo
accesso con nome, email e profilo, anche in Testing. Fonte:
[Manage App Audience](https://support.google.com/cloud/answer/15549945).
L’accesso all’app resta subordinato all’invito o al collegamento esistente.

**Ambito.** Aggiornata soltanto la documentazione; nessun codice, dato,
configurazione remota, commit, push o deploy modificato in questo intervento.
Controllo `git diff --check` superato.

## 2026-09-19 — Inviti personali, Google facoltativo e correzioni rapporti

**Stato: implementato e verificato in locale. Non pubblicato.** L’utente ha
chiesto di procedere con l’implementazione completa e tre correzioni sui
rapporti. Lavoro iniziato il 18 settembre e concluso il 19. Nessuna modifica al
database di produzione o alle console Google/Supabase/Render; nessun commit,
push o deploy eseguito in questa fase. Le configurazioni esterne descritte
nella voce precedente restano dichiarazioni dell’utente, da collaudare online.

**Flusso consegnato.** L’admin crea il profilo con username, nome, ruoli e
assegnazioni; non chiede email né sceglie la password del destinatario. Da
“Inviti e accesso” genera/copia un link personale da consegnare manualmente.
La landing riconosce il profilo e permette di scegliere una password senza
email, aggiungere facoltativamente un’email o attivare direttamente con Google
quando il provider è abilitato. Si possono mantenere profili solo anagrafici,
inclusi gli osservatori che lavorano sulla loro piattaforma. Il normale login
accetta username/password o Google già collegato; un’email può sostituire lo
username solo dopo verifica. Account sconosciuti non accedono liberamente.

**Account e recupero.** La pagina Account mostra i metodi di accesso, permette
il collegamento Google con conferma della password, lo scollegamento quando
esiste una password alternativa e la gestione del contatto email. Gli account
solo Google possono creare una password dopo un accesso recente (10 minuti).
Il recupero senza email usa un link amministrativo: al consumo cambia la
password e revoca tutte le sessioni; opzionalmente rimuove anche Google.
Inviti di attivazione 72 ore, recupero 1 ora, verifica email 24 ore. Scadenza,
revoca, rigenerazione e stato sono visibili all’admin. Lo storico degli eventi
auth è consultabile nello stesso pannello. Tolto il vecchio reset che faceva
scegliere la password di un altro utente all’amministratore; gli script di
bootstrap dell’admin continuano a funzionare.

**Decisioni di sicurezza e mapping.** Restano `users.id`, ruoli multipli,
campionati/stagioni del formatore, collegamenti arbitri, rapporti e designazioni.
Le password restano bcrypt e le sessioni cookie dell’app rimangono la fonte
unica di autenticazione delle API. Le identità Google sono collegate per
invito o dopo accesso locale, mai per omonimia/email. Token di invito casuali
conservati solo come hash, consumo atomico con lock utente e verifiche di
scadenza/revoca. OAuth PKCE S256 con stato in PostgreSQL e cookie HttpOnly,
monouso e legato al browser; il collegamento verifica anche la sessione locale.
Il backend verifica sia l’utente Supabase sia il soggetto effettivo presso
Google userinfo; nessun token OAuth è salvato nel browser o nel profilo.
Aggiunti limiti persistenti ai tentativi e controllo origine/header per le
scritture auth/amministrazione. Protetta anche la rimozione dell’ultimo admin
che può effettivamente accedere: un profilo soltanto invitato non lo sostituisce.

**Database.** `src/database/auth.sql`, richiamato automaticamente all’avvio,
rende nullable `users.password_hash`, aggiunge `email`, `email_verified_at`,
`activated_at`, `auth_version` e `sessions.auth_method`; crea
`user_google_identities`, `account_links`, `oauth_flows`, `auth_events`,
`auth_rate_limits`, relativi vincoli/indici. Migrazione idempotente, nessuna
rinumerazione o cancellazione di utenti. Le tabelle applicative ricevono RLS
e revoca dei grant `PUBLIC`, `anon`, `authenticated` per impedire accessi
paralleli via Data API. Migrazione auth e protezioni sono eseguite in una sola
query multi-statement atomica; Storage e schema Supabase Auth non vengono
modificati. La connessione Express deve usare il proprietario delle tabelle o
un ruolo con `BYPASSRLS`, come documentato.

**Tre correzioni richieste.**

- Modal di scelta rapporto: ripristinato lo spazio inferiore sotto “Rapporto a
  video” (32 px desktop, 20 px mobile). Il modal condiviso gestisce focus,
  tastiera, Escape e ritorno al controllo iniziale. Durante la verifica mobile
  corretto anche il restringimento della griglia che lasciava le tabelle
  allargare l’intera pagina dietro il modal.
- Giudizio video: MOLTO BENE verde acceso, BENE verde chiaro, MALINO giallo,
  MALE rosso, con testo leggibile e selezione riconoscibile anche senza colore.
  Stessa scala nel form, dettaglio rapporto e storico/andamento arbitro.
- Feedback video sotto ciascun arbitro, salvato in `feedback.first` e
  `feedback.second`. I vecchi `notes` comuni sono conservati senza attribuzioni
  arbitrarie e mostrati come storico agli operatori autorizzati; l’arbitro vede
  soltanto il proprio giudizio/feedback e non le note comuni o il collega.
  Nessuna migrazione distruttiva dei payload storici.

**File principali.** Backend: `src/services/accountService.js`,
`googleAuthService.js`, `userService.js`, `reportService.js`, route auth/utenti,
middleware auth/authSecurity, cookie/password utilities, configurazione e
schema/database connection, `server.js`. Frontend: `AuthLayout`, `ActivationPage`,
`AccountSecurity`, `UserAccessModal`, `JudgementBadge`, login/account/admin,
`App.jsx`, API e routing, modal/selettori, form/dettaglio video,
`RefereeDetailPage`, `RefereeProgressDashboard` e CSS; payload condiviso in
`shared/reportTemplate.js`. Configurazione/documentazione: `.env.example`,
`render.yaml`, `vite.config.js`, `README.md`, `CLAUDE.md`,
`docs/AUTHENTICATION.md`, questo registro. Test: `tests/accountAuth.test.js`,
`tests/videoReport.test.js` e helper database.

**Configurazione ancora necessaria sul servizio.** Documentata passo passo in
[docs/AUTHENTICATION.md](docs/AUTHENTICATION.md): `APP_BASE_URL`,
`TRUST_PROXY_HOPS`, `ENABLE_GOOGLE_AUTH=true` e `SUPABASE_PUBLISHABLE_KEY` (o
legacy anon key), oltre alle variabili DB/Storage esistenti. Nel `.env` locale
è presente l’URL Supabase ma non una chiave publishable/anon o il flag Google;
non sono stati stampati o copiati segreti. Per il primo accesso Google Supabase
deve consentire la creazione delle identità tecniche (“Allow new users to sign
up”); FischioLab continua a richiedere invito/mapping. Confermare URL callback,
audience/test users e stato di pubblicazione Google. Il manual linking nativo
Supabase, già attivato dall’utente, non è necessario al mapping locale.

**Email e costi.** Nessun nuovo servizio a pagamento o dipendenza npm del
progetto. Inviti manuali, password e Google non richiedono SMTP. Il contatto
email può essere salvato anche senza invio; verifica e recupero automatici
richiedono il trasporto SMTP già previsto dal progetto e una prova di consegna.
Errori di invio sono registrati senza segreti e non invalidano l’account.
SMTP non configurato né collaudato realmente in questa consegna.

**Verifiche.** Suite completa `npm test`: **179/179 passati**, con database
PostgreSQL 17 locale dedicato e separato dalla produzione. Comprende migrazioni
ripetute, inviti concorrenti/revocati/scaduti, ID e permessi invariati, account
Google sconosciuti/collisioni, PKCE e callback HTTP, cambio credenziali durante
OAuth, recupero e revoca sessioni, Google-only, verifica/unicità email con
trasporto simulato, CSRF/rate limit e privacy dei feedback. `npm run build` e
`git diff --check` riusciti. Google/Supabase e SMTP sono simulati nei test:
nessun login Google reale o email reale eseguiti. Verifica con Chrome/Playwright
su secondo DB locale dedicato: creazione profilo → invito → attivazione senza
email → logout/login, salvataggio feedback separati, modal e layout a
320/390/768/1280 px, senza errori JavaScript. Landing mobile compattata per
portare subito al modulo. Playwright installato solo in `/tmp`, fuori dal
progetto; nessuna modifica a `package.json` o lockfile.

**Strumenti.** Su richiesta esplicita dell’utente eseguito
`npx --yes impeccable update`: installazione copiata in `~/.agents` aggiornata
alla versione 4.3.1, con engine/hook; l’installazione collegata in `~/.claude`
richiede aggiornamento del checkout sorgente come segnalato dal comando.
L’aggiornamento vale per le sessioni successive, non cambia le istruzioni
seguite durante questa implementazione.

**Ripristino.** Prima del deploy effettuare backup e verifica del ruolo DB.
Per sospendere solo Google usare `ENABLE_GOOGLE_AUTH=false` e riavviare,
fornendo prima una password/link di recupero agli account solo Google. Conservare
le nuove tabelle e gli eventi. Il vecchio codice non gestisce hash password
nulli: un rollback completo richiede una revisione compatibile o un ripristino
controllato del backup, non la semplice cancellazione delle colonne. La
cancellazione preesistente di `NEXT_STEPS_2.md` è rimasta intatta.

## 2026-09-18 — Preparazione accessi Google e inviti personali

**Stato: analisi e configurazione esterna, implementazione non iniziata.**
La richiesta iniziale del 17 settembre era studiare autenticazione, requisiti,
mapping ed effort senza modificare il codice. Il 18 settembre l'utente ha
completato la preparazione Google/Supabase e chiesto di documentare stabilmente
attività e cambiamenti in questo file. Nella sola fase di preparazione era stato modificato
`CHANGELOG.md`, senza migrazioni, dipendenze, codice o deploy. L’implementazione
successiva è documentata nella voce del 19 settembre.

**Situazione rilevata nel repository.** Login locale con username/password,
bcrypt e sessioni server nella tabella `sessions`, con token casuale conservato
come hash e cookie HttpOnly. Supabase è usato dal codice per PostgreSQL e
Storage; non è ancora integrato come provider di autenticazione. `users` non
ha un campo email; `referees.email` è un contatto anagrafico facoltativo e non
costituisce un'identità di accesso verificata. Il controllo dei permessi resta
in Express e nei servizi, con regole condivise in `shared/permissions.js`.

**Requisiti espressi dall'utente, che sostituiscono l'ipotesi iniziale di
registrazione pubblica con approvazione successiva:**

- L'admin crea nell'app la persona/utenza, sceglie username, ruoli e collegamenti
  applicativi e genera un link personale da copiare e consegnare direttamente.
- L'admin **non deve conoscere né inserire l'email** del destinatario. L'utente
  sceglie eventualmente la propria email o collega Google durante l'attivazione.
- L'invito deve identificare già l'utenza predisposta. Niente riconoscimento
  automatico basato soltanto su nome/cognome e niente nuovi duplicati di persona.
- Conservare `users.id`, i ruoli multipli, il collegamento `referee_id`, i
  campionati/stagioni del formatore e tutti i riferimenti di rapporti,
  designazioni, indisponibilità, alias e storico.
- Gli accessi previsti sono principalmente per formatori e operatori. Gli
  osservatori usano un'altra piattaforma e possono restare censiti per il
  lavoro applicativo senza attivare credenziali. Questo requisito non elimina
  il ruolo observer, le anagrafiche o le assegnazioni esistenti.
- L'utente ha confermato esplicitamente che **email e Google devono essere
  facoltativi**: l'invito deve consentire l'attivazione con il solo username
  scelto dall'admin e una password scelta dal destinatario.

**Configurazioni esterne dichiarate completate dall'utente.** Sono confermate
in conversazione, ma non sono state ispezionate direttamente nelle dashboard
né verificate con un login completo:

- Google Cloud: progetto predisposto e configurazione iniziale di Google Auth
  Platform completata; raggiunta la panoramica OAuth.
- Client OAuth web: procedura con nome suggerito `FischioLab Web`, origine
  JavaScript `https://fischiolab.onrender.com` e URI di reindirizzamento copiato
  dal provider Google del progetto Supabase (`https://<project-ref>.supabase.co/auth/v1/callback`).
- Supabase: provider Google abilitato con Client ID e Client secret inseriti
  direttamente in dashboard; nessuna credenziale acquisita o salvata nel repo.
- Supabase Authentication / URL Configuration: Site URL
  `https://fischiolab.onrender.com`; redirect autorizzato
  `https://fischiolab.onrender.com/auth/callback`.
- Supabase Authentication: `Allow manual linking` abilitato secondo la procedura.
  La necessità di usarlo nel codice dipenderà dall'architettura scelta.

Il callback Google verso Supabase e il callback Supabase verso FischioLab sono
due URL distinti. Il gestore applicativo `/auth/callback` **è ancora da
implementare**. Il valore effettivo di `Allow new users to sign up` non è stato
verificato: va coordinato con gli inviti personalizzati, senza applicare
automaticamente la precedente indicazione di disabilitarlo per gli inviti
standard con email precompilata. Anche pubblico OAuth, scope, eventuali utenti
di test e stato di pubblicazione Google restano da verificare.

**Architettura prevista in conseguenza della scelta confermata.** Conservare
username/password locali e le sessioni applicative; aggiungere Google via
Supabase come identità facoltativa collegata allo stesso `users.id`. Il solo
accesso locale non richiede un account in Supabase Auth né un'email fittizia.
Questo sostituisce la proposta iniziale di trasferire anche tutte le password
su Supabase Auth, che richiederebbe un identificatore email o telefono.
Si tratta di una scelta progettuale: il codice non è ancora stato modificato.

L'invito nasce nell'app ed è collegato a `users.id`: token casuale monouso,
conservato come hash, con scadenza, revoca, rigenerazione e consumo atomico.
L'apertura della pagina non deve consumarlo. Gli inviti standard Supabase
richiedono già un'email e non coprono direttamente il requisito concordato.
Entrambi i metodi di accesso devono produrre la stessa sessione FischioLab e
gli stessi permessi; il collegamento Google è consentito da un invito valido
o dal profilo di un utente già autenticato, mai dal solo nome o dall'email
anagrafica. Per chi non ha email, il recupero passa dall'admin: si propone un
link personale di reimpostazione, consegnato manualmente come l'invito.

**Prossimi passi di sviluppo previsti:**

1. Definire schema e modello di attivazione con email facoltativa, mantenendo
   utilizzabili gli account esistenti e distinguendo stato dell'anagrafica,
   abilitazione al login e stato dell'invito.
2. Implementare gestione inviti nell'area Utenti e pagina pubblica di
   attivazione: username assegnato, password scelta dal destinatario e/o Google.
3. Implementare callback OAuth, verifica server dell'identità e associazione
   univoca all'utente interno; conservare il controllo di ruoli e accesso in
   Express. L'eventuale creazione di un'identità Supabase senza invito non deve
   concedere accesso a FischioLab.
4. Verificare esposizione delle tabelle tramite Supabase Data API, grants/RLS
   e accesso Storage prima del rilascio: i controlli Express non proteggono
   automaticamente le API dirette di Supabase. Stato remoto non ancora auditato.
5. Gestire cambio password, collegamento/scollegamento Google, disattivazione
   e revoca sessioni in modo coerente; tracciare inviti e modifiche degli accessi
   senza registrare token o password. Definire il recupero per chi non ha email.
6. Collaudare inviti scaduti/revocati/riutilizzati, callback ripetuti, identità
   già collegate, accessi senza invito, utenti disattivati, ruoli multipli,
   perimetri per stagione/campionato e continuità degli account esistenti.
   Preparare prova pilota e ripristino prima del rilascio in produzione.

**Email e costi.** La consegna manuale del link non richiede invio automatico.
Conferma email e recupero autonomo, se previsti, richiedono invece un canale
email configurato; nessun SMTP Auth è stato confermato operativo in questa
sessione. La verifica dei listini ha rilevato Google Sign-In e Supabase Auth
utilizzabili senza un upgrade obbligatorio, entro i limiti dei piani gratuiti.
La precedente stima di 8–12 giornate riguardava inviti con email già nota:
va rivalutata sul flusso senza email preventiva, mantenendo le password locali
e integrando Google come opzione. Il primo blocco utile è l'attivazione con
invito e password locale; il secondo è l'accesso/collegamento Google.

Riferimenti ufficiali consultati:
[Google OAuth con Supabase](https://supabase.com/docs/guides/auth/social-login/auth-google),
[redirect](https://supabase.com/docs/guides/auth/redirect-urls),
[inviti standard](https://supabase.com/docs/reference/javascript/auth-admin-generatelink),
[sicurezza Data API](https://supabase.com/docs/guides/api/securing-your-api),
[prezzi Supabase](https://supabase.com/pricing).

Verifica di questa consegna: revisione del diff e `git diff --check`;
test applicativi non eseguiti perché la modifica è solo documentale.

## 2026-09-17 — I modali restano dentro lo schermo

Con la selezione multipla dei ruoli la finestra "Modifica utente" diventava più
alta dello schermo e il pulsante Salva finiva fuori, irraggiungibile. Ora ogni
modale è alto al massimo quanto la finestra: il titolo resta fermo in alto, il
contenuto scorre e la riga delle azioni resta appoggiata in fondo, sempre
visibile. Su schermo stretto margini e padding si riducono per guadagnare spazio.
L'importatore di PDF federali continua a scorrere come prima (lì scorre
l'overlay, non il riquadro).

## 2026-09-17 — Ruoli multipli, ruolo Operatore e log dei rapporti

**Log delle azioni sui rapporti.** Nuova tabella `report_events` e terza tab
"Rapporti" nei Log (solo admin): creazione, modifica, passaggio a definitivo,
import da PDF federale, allegato caricato/eliminato, PDF generato, invio email
e cancellazione, ciascuno con autore, ruolo e dati della gara. La tabella non
ha FK verso `reports` e copia i dati identificativi come testo: l'evento più
interessante — la cancellazione — deve sopravvivere al rapporto che descrive.
Il registro è laterale: se la sua scrittura fallisce viene annotata in console
ma l'azione dell'osservatore non fallisce. Parte dalle azioni successive al
rilascio, senza ricostruzione dello storico.

**Ruoli multipli.** Un utente può avere più ruoli e i permessi si sommano
(`user_roles`; `users.role` resta il ruolo principale per il codice storico e
per le etichette). La tabella di chi-può-cosa vive in
[shared/permissions.js](shared/permissions.js), letta sia dal server sia dal
client: `can(user, 'capability', { competition, season })` invece dei confronti
sparsi su `role`. Una capability è concessa `global` oppure `scoped` (solo sui
campionati assegnati al formatore per quella stagione), così sommare i ruoli non
allarga mai il perimetro del formatore: tecnico + formatore DR1 gestisce le gare
di tutti i campionati ma vede i rapporti solo di DR1.

- Guardie: `requireCapability` / `requireAnyCapability` in
  [src/middleware/auth.js](src/middleware/auth.js); le query che selezionano
  utenti per ruolo passano da `hasAnyRoleSql()` in
  [src/database/userRoles.js](src/database/userRoles.js), che copre anche le
  righe non ancora migrate.
- **L'arbitro resta esclusivo**: è l'unico ruolo restrittivo (nasconde voti e
  Potenzialità), quindi non si combina con gli altri.
- Schermata Utenti: i ruoli si spuntano da un elenco con la descrizione di
  ciascuno, al posto della tendina a scelta singola.
- Migrazione idempotente: ogni utente esistente riceve la riga in `user_roles`
  ricavata dal vecchio campo, valori storici (`formatter`, `user`) compresi.

**Nuovo ruolo Operatore.** Utenza di servizio per il lavoro di background:
sorgenti gare e sincronizzazioni, import designazioni XLSX, import dei PDF dei
rapporti, sezione Campionati, conferma dei nomi da associare, creazione,
modifica e cancellazione gare. **Non** compila rapporti, **non** vede la sezione
Arbitri (quindi nemmeno le classifiche), **non** gestisce utenti e **non** vede
i log. Se è anche osservatore compila i rapporti delle gare in cui è designato;
se è anche formatore ottiene il perimetro del formatore sui suoi campionati.

- Chi importa un rapporto non ne diventa l'autore: la modifica richiede la
  capability "compila rapporti", quindi un operatore può importare i PDF senza
  poter poi metterci mano (valeva anche per il formatore).
- Aggiunto il pulsante "Cancella gara" nel dettaglio gara: l'API esisteva già
  ma non era raggiungibile da nessuna schermata.

Test: `tests/permissions.test.js` (8 casi puri) e `tests/userRoles.test.js`
(6 casi su database), più `tests/reportEvents.test.js` (4 casi). Suite: 158 test.

## 2026-09-17 — Filtri gare: campionato al posto dello stato

- **Elenco gare**: rimosso il filtro "Stato"; al suo posto, in testa alla barra,
  il filtro **Campionato**, visibile solo a chi ha davvero una scelta (admin o
  formatore con più di un campionato assegnato). Fasi, giornate, arbitri e
  giorni con gare del calendario si restringono al campionato scelto.
- L'export XLSX delle gare riceve il campionato selezionato (prima rispettava
  solo lo scoping del formatore) e non parla più di stati.
- **Export designazioni**: una gara senza osservatore mostra "—" come nel resto
  dell'app, al posto di "SCOPERTA" in rosso: una gara non visionata è normale
  amministrazione, non un errore da segnalare al designatore.

## 2026-09-17 — Rapporto a video, export designazioni e filtro periodo

**Rapporto a video.** Nuovo tipo di rapporto per le visionature da video: solo
osservatore/formatore/admin, un giudizio per arbitro su scala a quattro valori
(Molto bene / Bene / Malino / Male) e un allegato PDF o XLSX. Conta come
visionatura ovunque si contino i rapporti, ma non ha voto, non produce PDF e
non si invia per email.

- Database: `reports.report_type` (`full`/`video`, default `full`) e colonne
  `attachment_path/name/type/size/uploaded_at`. Migrazione idempotente in
  `ensureReportTypeColumns()` ([src/database/connection.js](src/database/connection.js)):
  i rapporti esistenti restano completi.
- [shared/reportTemplate.js](shared/reportTemplate.js): `VIDEO_JUDGMENT_OPTIONS`,
  `VIDEO_REQUIRED_FIELDS`, `createEmptyVideoReport()`, `normalizeReportType()`.
  Il tipo si sceglie alla creazione e non cambia più con una modifica.
- [src/services/reportAttachmentService.js](src/services/reportAttachmentService.js):
  un allegato per rapporto, sostituibile, max 10 MB, tipo riconosciuto dalla
  firma del file e non dall'estensione. Rotte `POST/DELETE /api/reports/:id/attachment`
  e `GET /api/reports/:id/attachment/download`, che nega il ruolo `referee`:
  l'allegato è un documento interno e non è filtrabile come il payload web.
- Client: nuova pagina [ReportVideoFormPage](client/src/pages/ReportVideoFormPage.jsx)
  (una schermata, niente barra di avanzamento), bivio `NewReportChoice` su
  "Nuovo rapporto" e "Compila rapporto", dettaglio rapporto in versione corta,
  card allegato riusabile.
- Marcatore: badge testuale **VIDEO** negli elenchi (rapporti, gare,
  designazioni, scheda arbitro) invece di una sigla accanto al nome. Nella
  scheda arbitro la metrica "Rapporti" mostra "di cui N a video", la colonna
  Voto porta il giudizio e le curve dell'andamento non si bucano: le
  visionature a video sono elencate come tacche sopra i grafici.
- Classifica arbitri: nuova colonna "A video" (le medie restano costruite sui
  soli voti; senza quella colonna un arbitro seguito via video sembrerebbe meno
  visionato).

**Bug corretto (preesistente).** `getRefereeStats` contava `Number('')` come
voto 0: un rapporto senza voto (bozza o, da oggi, a video) abbassava la media
dell'arbitro. Ora si contano solo i voti davvero inseriti, come già faceva la
query della classifica.

**Export XLSX delle designazioni osservatori.** Pulsante "Esporta vista XLSX"
nella pagina Designa osservatori, con lo stesso vocabolario degli altri export.
Esporta esattamente le gare filtrate (campionato, fase, giornate, periodo),
con l'intestazione che dichiara i filtri, il conteggio delle scoperte e un nome
file parlante (`designazioni_DR1_03-10-2026_04-10-2026_2026-2027.xlsx`). Spunta
"solo gare con osservatore"; le scoperte restano in elenco marcate in rosso.
Nuovo [src/services/designationsExportService.js](src/services/designationsExportService.js)
e rotta `GET /api/games/designations/export`.

**Filtro periodo (data inizio / data fine).** Nuovo componente `PeriodFilter`:
trigger in stile `Select`, preset (oggi, weekend, prossimi 7 giorni, da oggi,
mese, tutta la stagione), calendario disegnato con i token dell'app — niente
`input type="date"` — con i giorni che hanno gare segnati da un pallino, più i
due campi `DateInput` per chi preferisce digitare.

- Elenco gare: il periodo predefinito è **"da oggi"**, quindi la pagina si apre
  sulla giornata in corso invece che sulla prima di ottobre; l'ultimo periodo
  resta in `sessionStorage` per la sessione. Righe-separatore sticky per
  giornata, ordine cronologico quando c'è un periodo attivo (le rinviate
  compaiono dove sono giocate davvero) e, se i filtri non trovano nulla,
  l'empty state offre "Cerca in tutta la stagione (N)".
- Designa osservatori: il periodo è un filtro di primo livello e da solo basta
  a mostrare l'elenco; sopra la tabella un riepilogo leggibile dei filtri.
- La regola vive in [shared/gamePeriod.js](shared/gamePeriod.js), condivisa tra
  client ed export, così l'XLSX contiene sempre ciò che si stava guardando.

Test: `tests/videoReport.test.js` (11 casi) e `tests/gamePeriod.test.js` (7 casi,
puro, aggiunto a `npm run test:unit`). Suite completa: 140 test verdi.

## 2026-09-17 — Sorgenti gare: la fase FIP fa parte dei parametri

**Bug.** Le sorgenti create incollando il link della pagina Risultati senza aver
scelto la fase salvavano `codice_girone` ma non `codice_fase`. Il sito FIP, con
il girone e senza la fase, risponde **200 con una pagina vuota**: zero gare e
zero giornate. La sincronizzazione finiva quindi "riuscita" con 0 gare create e
il calendario restava vuoto senza alcun segnale.

- `src/services/fip/fipAdapter.js`: nuova `parseFasiOptions()` (menu "fasi"),
  `discoverGironi()` ora restituisce `{ gironi, codiceFase }` e nuova
  `resolveFase()`, che individua la fase di un girone noto cercandolo tra i
  gironi di ciascuna fase (la fase selezionata per prima: di norma una sola
  richiesta).
- `src/services/syncService.js`: `createSource()` salva sempre `codice_fase` nei
  parametri e nell'URL canonico; `updateSource()` lo eredita come già faceva col
  girone; `runFipSync()` recupera e salva la fase mancante delle sorgenti
  esistenti alla prima sincronizzazione (nessuna sorgente da ricreare a mano) e
  segnala come avviso una sincronizzazione che non trova nessuna gara.
- Test: `tests/fipAdapter.test.js` (fasi, `discoverGironi`, `resolveFase`) e
  `tests/syncService.test.js` (recupero della fase, avviso a zero gare).

Nessuna migrazione al database: i parametri vivono in `competition_sources.params_json`.

## 2026-09-14 — Stagione 2026/2027: import liste arbitri e stato a tre valori

**Import liste arbitri.** Nuovo `scripts/import-referees.js`, che sostituisce
`scripts/seed-referees.js` (lista DR1 2025/2026 incollata nel codice, con i dati
personali di 48 arbitri versionati nel repo). Legge un XLSX mappando le colonne
dalla riga di intestazione, quindi funziona sia sull'export FIP sia sulle liste
compilate a mano; abbina per tessera (normalizzata senza zeri iniziali) e poi
per nominativo, aggiorna senza duplicare e non sovrascrive con NULL le colonne
assenti dal foglio. Anteprima per default, scrittura solo con `--commit` e in
transazione; `--esordienti-col` / `--esordienti-rows` iscrivono anche alla
fascia. Le liste federali stanno in `.docs/`, ora ignorato da git.

Importate le liste 2026/2027: 53 arbitri DR1 (8 esordienti) e 38 Serie C
(28 piemontesi + 10 liguri, 6 esordienti). Corretta la scheda NICOLETTI, che
teneva la tessera di Dennis sul nome di Alex; eliminato l'arbitro di prova
"Pasticcio Ciccio".

**Stato dell'arbitro a tre valori.** Il booleano attivo/inattivo è diventato
`status`: `attivo`, `aspettativa`, `dimissioni`.

- Migrazione: colonna `status` su `referees` e `referee_season_categories`
  (default `attivo`, CHECK sui tre valori), creata e allineata al vecchio flag
  da `ensureRefereeStatusColumns()` in `src/database/connection.js`. `active`
  resta la copia booleana (`attivo` → 1) su cui poggiano statistiche, coperture
  e query storiche, quindi nessuna query esistente cambia semantica.
- `shared/refereeStatus.js` è la fonte unica di valori, etichette e toni, usata
  da server e client. `updateReferee` accetta ancora il vecchio `active`.
- Attenzione: `referees.status` rende ambiguo un `status` non qualificato in
  ogni query che fa JOIN su `referees`. `listReports()` è stata corretta; per
  le prossime query, qualificare sempre la colonna con la tabella.

**Elenco arbitri.** Rimossa la colonna Azioni: si modifica aprendo la scheda
dell'arbitro, dove il form di modifica ha ora il selettore di stato. La "E"
degli esordienti compare in una corsia fissa a sinistra della tessera, che
resta allineata. I filtri mostrano il proprio nome quando non sono applicati
(Categoria, Fascia, Stato) grazie alla prop `placeholderOnEmpty` di `Select`.
Nuovo `ColumnsMenu` in coda alla barra filtri per scegliere le colonne
visibili; "Cognome, Nome" non è nascondibile e non compare in elenco. La scelta
è ricordata in `localStorage`.

**Filtri: stessa grammatica in tutta l'app.** Ogni filtro di elenco mostra il
proprio nome quando non è applicato e il valore scelto quando lo è, su
Dashboard (Campionato, Osservatore), Gare (Fase, Giornata, Arbitro, Stato),
Designazioni (Campionato, Fase, Giornata), Copertura (Campionato, Fase, Fascia)
e Arbitri (Categoria, Fascia, Stato). Sui `Select` serve la prop
`placeholderOnEmpty`, sui `MultiSelect` basta `allLabel`. Resta "Tutte le fasi"
solo nel selettore del template designazioni in Importazioni, che non è un
filtro: descrive cosa finirà nel file.

**Test**: nuova suite `refereeStatus.test.js` (6 test); suite completa a 116
test e build Vite verificate senza errori.

## 2026-07-18 — Indisponibilità osservatori e standard frontend

- Nuova tabella `observer_unavailabilities`: giorni e periodi di calendario,
  intenzionalmente indipendenti dalla stagione, con nota facoltativa, autore e
  data di inserimento.
- Ogni osservatore o formatore può gestire le proprie indisponibilità dal
  profilo; admin e formatori possono aprire la nuova anagrafica Osservatori e
  gestire qualsiasi profilo, incluso lo storico trascorso.
- Nei selettori del dettaglio gara e della designazione massiva le persone
  indisponibili restano visibili in rosso con etichetta `INDISPONIBILE`, ma non
  sono selezionabili. Nel suggeritore finiscono in fondo, senza punteggio né
  azione di assegnazione.
- Il blocco è applicato anche lato server da `setOfficial()`: una chiamata
  diretta non può aggirare l'indisponibilità. Le designazioni già esistenti
  vengono evidenziate se un periodo viene aggiunto in seguito.
- Aggiunti `PRODUCT.md` e `DESIGN.md` per fissare tono, principi, token,
  componenti, responsive e accessibilità del frontend armonizzato.
- Test: nuova suite `observerAvailability.test.js`; suite completa a 110 test
  e build Vite verificate senza errori.

## 2026-07-17 — Rimosso il driver Brevo: si invierà via SMTP con istanza Render a pagamento

Il driver Brevo introdotto il 16/07 è stato rimosso dopo il collaudo reale:
con mittente `@gmail.com` spedito da server terzi, Gmail accettava il
messaggio ("consegnata" su Brevo) ma lo scartava silenziosamente senza
recapitarlo — né inbox né spam. Le alternative erano un dominio proprio
autenticato oppure l'invio via SMTP autenticato Gmail, possibile su Render
solo con istanza a pagamento (il piano Free blocca le porte SMTP in uscita).

**Decisione**: quando si vorrà attivare l'invio, si farà l'upgrade
dell'istanza Render e si spedirà via SMTP Gmail (i dettagli operativi sono in
NEXT_STEPS.md, priorità 1). Il codice resta SMTP-only, con la stessa pipeline
(anteprima, conferma destinatario, log invii) e i timeout stretti del 16/07.

- Rimossi `src/services/brevoTransport.js`, `tests/emailBrevo.test.js`, le
  env `BREVO_API_KEY`/`EMAIL_FROM`/`EMAIL_DRIVER` (config, render.yaml,
  .env.example) e il ramo di selezione driver in `emailService.js`.
- Nessuna migrazione: il driver non toccava il database.
- Da fare a mano sul dashboard Render: eliminare le variabili
  `BREVO_API_KEY`, `EMAIL_FROM` ed eventuale `EMAIL_DRIVER`; su Brevo,
  revocare la API key generata (account non più usato).

## 2026-07-16 — Invio rapporti via email completo, campionati gestibili, driver Brevo

Invio email agli arbitri portato a livello di produzione, con campionati
amministrabili da interfaccia e invio compatibile con Render Free.

**Invio email blindato** (`src/services/emailService.js`):
- Il server rifiuta l'invio dei rapporti in bozza (409); prima era la sola UI
  a nascondere il bottone.
- Omonimi in anagrafica senza collegamento esplicito → errore chiaro invece
  della scelta silenziosa del primo risultato (`LIMIT 1` rimosso).
- Nuovo `buildEmailPlan()`: unico resolver di destinatario/oggetto/corpo/CC,
  condiviso da anteprima e invio reale, così non possono divergere.
- Conferma esplicita: `GET /api/reports/:id/send-email/:role/preview` mostra i
  dati senza inviare; la POST richiede `confirmedRecipient` e risponde 409 se
  l'indirizzo risolto nel frattempo è cambiato. Il client apre un dialog di
  conferma con destinatario, gara, CC ed eventuale ultimo invio.
- Timeout SMTP stretti (15s connessione/greeting): il default di nodemailer
  (2 minuti) superava il limite HTTP di Render (100s) mascherando l'errore.

**Log invii** (migrazione: nuova tabella `report_email_log`):
- Ogni tentativo è registrato, anche fallito: gara e campionato denormalizzati
  (l'audit sopravvive alla cancellazione del rapporto), destinatario, CC,
  oggetto, chi ha inviato, esito, messaggio d'errore SMTP.
- La pagina admin `#/admin/logs` ora ha i tab Accessi | Email; il dettaglio
  rapporto mostra lo "Storico invii" per ciascun arbitro (escluso ai referee,
  che vedrebbero i destinatari dell'altro arbitro).

**Campionati come dati** (migrazione: nuova tabella `competitions`; rimosso
l'export `COMPETITIONS` da `shared/reportTemplate.js`):
- CRUD admin in `#/admin/competitions`: creazione, rinomina, ordinamento,
  disattivazione soft. Il codice (`value`) è immutabile perché è la chiave
  salvata come testo su rapporti, gare, rose, fasce e assegnazioni formatore:
  rinominare tocca solo l'etichetta, zero cascade.
- Seed idempotente all'avvio (`seedCompetitions()` in
  `src/database/connection.js`): DR1 e Serie C alla prima esecuzione, più
  backfill difensivo di ogni valore già presente nei dati storici — la nuova
  validazione non può rifiutare dati esistenti.
- Server: formatori e rapporti validati contro il catalogo (inattivi inclusi
  in lettura e sulle bozze); client: nuovo contesto `useCompetitions()`
  (`client/src/lib/competitions.jsx`), rimappate le 10 pagine che importavano
  la lista hardcoded.

**CC, firma e corpo per campionato** (migrazione: nuova tabella `app_settings`):
- Per ogni campionato l'admin configura da UI i CC (validati) e la firma
  dell'email; fallback sicuro se assenti ("Formatori <nome>").
- Corpo dell'email modificabile dall'admin (card "Modello email" nella pagina
  Campionati) con segnaposto validati al salvataggio ({{nomeArbitro}},
  {{numeroGara}}, {{campionato}}, {{dataGara}}, {{squadre}}, {{ruolo}},
  {{firma}}), anteprima live e ripristino del default. Salvato in
  `app_settings`, chiave `report_email_body_template`; render/validazione in
  `src/services/emailTemplate.js` (funzioni pure).
- Oggetto: `FischioLab — Rapporto gara N · Campionato · Cognome`.
- Il corpo non contiene mai dati dell'altro arbitro (per costruzione: nessun
  segnaposto lo espone; coperto da test).

**Driver Brevo** (`src/services/brevoTransport.js`):
- Render Free blocca le porte SMTP in uscita (25/465/587) da settembre 2025:
  l'invio via Gmail SMTP andava in connection timeout. Nuovo driver che invia
  tramite l'API HTTPS di Brevo (porta 443, non bloccata), stessa interfaccia
  `sendMail` del transporter nodemailer: anteprima, conferma e log invii sono
  identici con entrambi i driver.
- Nuove env: `BREVO_API_KEY`, `EMAIL_FROM` (mittente unico per entrambi i
  driver, da verificare come mittente su Brevo), `EMAIL_DRIVER` opzionale
  (brevo|smtp; senza, vale Brevo se c'è la key). Dichiarate in `render.yaml`
  e documentate in `.env.example`. Le variabili `SMTP_*` restano supportate
  per istanze a pagamento o altri host.

**Dipendenze**: nessuna nuova (Brevo via `fetch` nativo, niente SDK).

**Test**: nuovi `tests/emailService.test.js`, `tests/emailServiceUnconfigured.test.js`,
`tests/emailBrevo.test.js`, `tests/emailTemplate.test.js` (unit, aggiunto a
`test:unit`), `tests/competitionService.test.js`. Il transporter è iniettabile
(`setTransportFactoryForTests`, `setBrevoFetchForTests`). Il helper dei test
ora ripopola il catalogo campionati dopo la TRUNCATE.

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
- Aggiornato `pdf-parse` alla versione 2.4.5: ogni documento usa un'istanza
  isolata del parser, evitando contaminazioni tra file nei batch su Node 22.
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
