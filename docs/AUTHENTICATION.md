# Inviti personali, password e Google

Implementazione del 18–20 settembre 2026, pubblicata su Render il 21 settembre
con commit `514a7a5`. Migrazione auth applicata all’avvio e controllata in sola
lettura dopo il backup. Google risulta abilitato nell’app di produzione; la
configurazione delle console è stata riferita dall’utente. Il ciclo completo
con un vero account Google e la consegna delle email restano da provare.

Il 21 settembre l’utente ha riferito di avere riportato il progetto OAuth in
**Testing**, sospendendo per ora la verifica branding. Ricontrollata la login
pubblica `https://fischiolab.onrender.com/app`: “Continua con Google” visibile
su desktop e mobile, con funzionalità abilitata dal server. La home `/` rimanda
alla login tramite “Accedi a FischioLab”. Per un account già attivo, il primo
collegamento avviene da **Account → Metodi di accesso → Collega Google** dopo
l’accesso con username/password; successivamente si può entrare con Google.
Per i limiti ed eccezioni di Testing vedere “Google Cloud e Supabase” più sotto.

## Flusso operativo

1. **Admin → Utenti → Crea utente**: scegli username, nome, ruoli e gli eventuali
   campionati/stagioni del formatore. Nessuna password o email da chiedere.
2. Si apre **Inviti e accesso**. Puoi lasciare il profilo soltanto anagrafico
   (per esempio un osservatore che usa un’altra piattaforma), oppure generare
   l’invito e copiarlo. La consegna è manuale: l’app non invia inviti a terzi.
3. Il destinatario apre `/#/activate?token=…`: vede il proprio nome e username,
   sceglie password e conferma, senza obbligo di email; se Google è abilitato
   può attivare direttamente con Google senza scegliere una password.
4. Gli accessi successivi usano username/password oppure Google già collegato.
   Non esiste una registrazione libera a FischioLab.
5. **Account → Metodi di accesso** permette di collegare Google (con conferma
   della password), scollegarlo quando esiste una password, aggiungere o
   rimuovere un’email. Un utente entrato solo con Google può creare una password
   entro 10 minuti dall’accesso; trascorso il tempo deve uscire e rientrare.
6. **Recupero**: l’admin genera un link da “Inviti e accesso”, anche senza email.
   Al consumo viene scelta una nuova password e ogni sessione precedente è
   revocata. L’admin può indicare anche la rimozione del collegamento Google.
   La sola generazione non cambia le credenziali e non interrompe le sessioni.

Gli inviti durano **72 ore**; i link di recupero **1 ora**; quelli di verifica
email **24 ore**. Sono monouso. La rigenerazione invalida il precedente link
dello stesso tipo; la revoca esplicita invalida i link pendenti dell’utente.
Disattivare il profilo revoca sessioni, link e flussi OAuth pendenti, conservando
lo storico e le associazioni. Il link completo appare solo al momento della
generazione; non è ricostruibile dal database. Consegna ogni link solo al titolare.

## Configurazione dell’app

| Variabile | Valore / uso |
| --- | --- |
| `APP_BASE_URL` | `https://fischiolab.onrender.com` in produzione, senza slash finale. Su Render può derivare da `RENDER_EXTERNAL_URL`. |
| `COOKIE_SECURE` | `true` con HTTPS in produzione. `false` solo nello sviluppo HTTP locale. |
| `TRUST_PROXY_HOPS` | `1` su Render, `0` in locale senza reverse proxy. Serve per l’IP corretto nei limiti dei tentativi. |
| `ENABLE_GOOGLE_AUTH` | `true` per mostrare e attivare Google; assente/`false` mantiene inviti e password funzionanti. |
| `SUPABASE_URL` | Radice del progetto: `https://tiqhpteppvdnhatzjjdj.supabase.co`, senza `/rest/v1`. Usata sia da Auth sia da Storage. L’app rimuove anche il suffisso REST se è stato copiato dalla dashboard. |
| `SUPABASE_PUBLISHABLE_KEY` | Chiave publishable della dashboard Supabase; è ammesso anche il fallback legacy `SUPABASE_ANON_KEY`. Non usare la service key. |
| `DATABASE_URL` | Connessione PostgreSQL proprietaria dell’app, non il ruolo `anon`/`authenticated`. Deve poter gestire lo schema e superare RLS come proprietario o con `BYPASSRLS`. |

Le chiavi Google Client ID/Client Secret rimangono nel provider Google della
dashboard Supabase. Non servono nel browser o nei file di FischioLab.
`SUPABASE_SERVICE_KEY` continua a servire soltanto allo Storage. Il codice
non riutilizza il client amministrativo Storage per autenticare gli utenti.

Se il pulsante Google mostra `No API key found in request`, controllare prima
il percorso di destinazione: deve essere `/auth/v1/authorize`, mai
`/rest/v1/auth/v1/authorize`. Il secondo è stato riprodotto online il 21
settembre: l’URL base conteneva il percorso della Data API. La normalizzazione
in `src/config.js` corregge insieme l’avvio OAuth, lo scambio del codice, la
lettura del profilo e Storage. In questo caso non occorre cambiare le chiavi
o aggiungerle al link di accesso; la richiesta all’endpoint Auth corretto
ha restituito un redirect 302 verso Google anche senza `apikey` nell’URL.
Correzione pubblicata su `main` nel commit `147510a`; il successivo controllo
online del pulsante ha raggiunto la schermata Google di scelta/accesso
all’account. Il consenso e il ritorno con un account reale restano da provare.

Con il normale `npm run dev` impostare `APP_BASE_URL=http://localhost:5173`:
Vite inoltra `/api` e `/auth/callback` al backend sulla porta 3000. Se si usa
`npm start` direttamente sulla porta 3000, impostare invece
`APP_BASE_URL=http://localhost:3000`. Usare sempre lo stesso hostname durante
il giro OAuth, perché il cookie deve tornare nello stesso browser/origine.

## Branding Google: informazioni e pagine pubbliche

Verifica del 19 settembre 2026, a partire dalla schermata condivisa dall’utente.
La pubblicazione OAuth nella pagina Audience e la verifica/pubblicazione del
branding sono stati distinti: il branding verificato consente di mostrare
nome e logo nella schermata Google. Il solo login usa scope non sensibili.

| Campo | Informazione / stato |
| --- | --- |
| Nome applicazione | `FischioLab` |
| Descrizione | FischioLab è una piattaforma ad accesso su invito per gestire gare, designazioni, rapporti arbitrali e attività di formazione. Google è un metodo facoltativo per accedere al proprio profilo. |
| Logo | `client/public/app-logo.png`: PNG quadrato 512 × 512, 125.256 byte, entro il limite di 1 MB. Google consiglia 120 × 120. Il file esistente non è stato modificato. |
| Home page | `https://fischiolab.onrender.com/`: home pubblica online, con presentazione, uso dei dati Google e collegamenti ai documenti. Verificata il 21 settembre 2026. |
| Privacy | `https://fischiolab.onrender.com/privacy`: testo del 20 settembre, pubblicato e verificato il 21 settembre 2026. |
| Termini di servizio | `https://fischiolab.onrender.com/termini`: condizioni di accesso e uso con i dati del gestore, online dal 21 settembre 2026. |
| Titolare e gestione | Filippo Giovagnini; gestione personale, come dichiarato dall’utente il 20 settembre 2026. |
| Assistenza e contatti privacy | `filo.giova98@gmail.com`, fornita dall’utente per la pubblicazione. |

La console Google ha segnalato tutti e tre i problemi: proprietà non
verificata, privacy insufficiente e home protetta dal login. Prima di questa
modifica `/privacy` ricadeva nel fallback della SPA. Ora Express serve i tre
percorsi pubblici prima della lettura della sessione, con contenuti nel corpo
HTML visibili anche senza JavaScript e senza interrogare il database.
L’app riservata si apre su `/app`; i link storici `/#/...`, compresi inviti e
callback OAuth, vengono trasferiti a `/app#/...` conservando il frammento nel
browser. Le API e i loro controlli di accesso restano protetti.

### Dati e testi dei documenti

I dati del titolare e i testi su basi giuridiche e conservazione sono versionati
in `src/publicInformation.js`; le sezioni della pagina sono in
`src/views/publicPages.js`. Non occorre impostare quattro nuove variabili su
Render. Le variabili seguenti restano disponibili come override facoltativi:

| Variabile Render | Contenuto sostitutivo |
| --- | --- |
| `PUBLIC_OPERATOR_NAME` | Nome completo della persona o dell’ente effettivamente titolare dei dati. |
| `PUBLIC_CONTACT_EMAIL` | Email pubblica monitorata per assistenza e richieste sui dati. |
| `PUBLIC_PRIVACY_LEGAL_BASIS` | Testo sulle basi giuridiche effettive dei trattamenti, definite dal titolare in relazione all’attività. |
| `PUBLIC_PRIVACY_RETENTION` | Periodi o criteri effettivi di conservazione per le categorie di dati, includendo storico, registri e backup. |

Variabili assenti o vuote usano i valori versionati. Controllare eventuali
override già presenti: hanno precedenza e potrebbero contenere vecchi testi.
I valori sono escapati come testo; non inserire HTML. La protezione 503/noindex
rimane per configurazioni risultanti incomplete o con email non valida.

**Scelte redazionali del 20 settembre.** Nome, email e gestione personale sono
stati dichiarati dal titolare. Per le basi giuridiche è stato redatto il testo
che distingue fornitura del servizio richiesto (art. 6.1.b) e legittimo interesse
a organizzazione, formazione e sicurezza (art. 6.1.f). Non sono stati verificati
contratti con enti sportivi né un bilanciamento documentato del legittimo
interesse: questa redazione non certifica la liceità di ogni importazione o
trattamento, che resta da valutare nel contesto effettivo del titolare.

La conservazione è descritta con criteri, senza inventare durate uniformi:
rapporto di utilizzo, stagione e continuità formativa, contestazioni concrete,
analisi di incidenti e cicli di backup. L’app non introduce cancellazione
automatica dello storico. Alla chiusura di account o stagioni e in caso di
richiesta, il gestore deve valutare i dati ancora necessari e gestire quelli
da eliminare o anonimizzare, inclusi file, registri, copie di sicurezza e
identità Supabase. Disattivazione, scollegamento Google e cancellazione sono
operazioni diverse. La pagina indica il contatto per avviare la richiesta.

I riferimenti ai fornitori descrivono i servizi effettivi e le loro condizioni
pubbliche. Regioni effettive, accordi applicabili all’account, cicli di backup
e fornitore SMTP non sono stati verificati nelle console; vanno mantenuti
coerenti con l’informativa nella gestione del servizio. Anthropic viene citata
solo con `ENABLE_AI_FEATURES=true`; durata cookie di sessione da `SESSION_DAYS`
(14 giorni per default), cookie OAuth 10 minuti.

### Verifica della proprietà e nuova richiesta Google

Il tag `google-site-verification` fornito dall’utente è incluso nella home.
È un token pubblico di verifica del sito, non una password né una chiave API.
Un eventuale `GOOGLE_SITE_VERIFICATION` può sostituirlo: inserire solo il
valore dell’attributo `content`, non l’intero tag HTML.

La pubblicazione è stata completata il 21 settembre: pagine HTTP 200 con i dati
reali e tag HTML presente. La sola presenza del tag non attesta l’approvazione
del dominio per OAuth. Per la verifica Google:

1. Controllare da una finestra anonima `/`, `/privacy` e `/termini`: devono
   mostrare i contenuti corretti con risposta HTTP 200 e senza login.
2. Controllare la proprietà e il metodo di verifica in Search Console con
   l’account del progetto Cloud. Il tag pubblicato permette la verifica
   **Prefisso URL** `https://fischiolab.onrender.com/`, ma la guida specifica
   [Domain Verification](https://support.google.com/cloud/answer/13804266?hl=en)
   richiede una proprietà **Dominio**, verificata tramite record DNS, per i
   blocchi sui domini OAuth. Non considerare automaticamente sufficiente il
   solo esito positivo della proprietà Prefisso URL. Il tag va mantenuto.
3. In caso di rifiuto persistente, confrontare URL/stato della proprietà,
   account e ruolo IAM e domini autorizzati nel progetto OAuth effettivo.
   La verifica DNS richiede il controllo della relativa zona DNS; un tag HTML
   nel sito non consente di aggiungere record DNS al sottodominio Render.
   Valutare un dominio con DNS gestibili o un chiarimento nella revisione
   Google solo dopo aver identificato il requisito che blocca il progetto.
4. Solo dopo la conferma della proprietà richiesta e il controllo delle pagine, tornare
   a Google Auth Platform → Branding, scegliere **Ho risolto i problemi** e
   richiedere una nuova verifica. Non selezionare questa voce in anticipo.

Il deploy e i controlli delle pagine sono stati eseguiti dall’assistente.
Lo screenshot successivo fornito dall’utente conferma “Sei un proprietario
verificato” per la proprietà Prefisso URL `https://fischiolab.onrender.com/`.
Il rifiuto branding è però ancora segnalato: l’approvazione OAuth rimane da
ottenere. I domini autorizzati mostrati sono `fischiolab.onrender.com` e
`tiqhpteppvdnhatzjjdj.supabase.co`, coerenti con home e progetto Supabase.

Se Search Console conferma la proprietà ma il branding continua a segnalarla
come non verificata, controllare l’account proprietario del sito e la sua
presenza in Google Cloud → IAM con ruolo Owner o Editor nel progetto OAuth
corretto: la guida generale ammette entrambi, mentre la guida specifica sul
rifiuto dei domini indica Project Owner. L’email di contatto pubblica non dimostra né sostituisce questo
collegamento. Il tag è associato a un account: per verificare con un altro
account può servire aggiungere il suo tag, conservando quelli ancora in uso.
Se account e ruolo sono corretti e il controllo automatico continua a fallire,
usare la richiesta di revisione manuale prevista dalla schermata branding.
Allegare le evidenze e specificare il tipo di proprietà realmente verificato,
chiedendo se sia richiesta la verifica DNS per il sottodominio ospitato.
La revisione non garantisce che la verifica Prefisso URL venga accettata.

Fonti: [Branding Google](https://support.google.com/cloud/answer/15549049),
[verifica del brand](https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification),
[stati OAuth](https://developers.google.com/identity/protocols/oauth2/production-readiness/overview),
[verifica del sito](https://support.google.com/webmasters/answer/9008080).
Per i contenuti dell’informativa, riferimenti negli articoli 13 e 14 del
[Regolamento UE 2016/679](https://eur-lex.europa.eu/eli/reg/2016/679/2016-05-04?locale=it)
e nei [requisiti privacy di Google](https://support.google.com/cloud/answer/13806988?hl=en).
Condizioni infrastruttura: [Render DPA](https://render.com/dpa),
[Supabase DPA](https://supabase.com/legal/customer-resources/data-processing-addendum).

## Google Cloud e Supabase

1. Google Auth Platform, client **Web**: origine autorizzata
   `https://fischiolab.onrender.com`; redirect autorizzato
   `https://<project-ref>.supabase.co/auth/v1/callback` copiato dal provider.
2. Audience: **External** per account personali o di organizzazioni diverse;
   **Internal** limita l’accesso alla propria organizzazione Google Workspace.
   Controllare anche lo stato Testing/In production. Con i soli scope `openid`,
   email e profilo usati dall’app, Google prevede un’eccezione in Testing:
   non serve inserire ogni destinatario tra i test users e non si applica la
   scadenza delle autorizzazioni a 7 giorni. L’eccezione non vale richiedendo
   ulteriori scope. Non servono Drive/Gmail/Calendar. Vedi
   [Manage App Audience](https://support.google.com/cloud/answer/15549945).
3. Supabase **Authentication → Providers → Google**: abilitato con Client ID
   e Secret; mantenere le verifiche di email/nonce previste dal provider.
4. Supabase URL Configuration: Site URL `https://fischiolab.onrender.com`,
   Redirect URLs contiene esattamente
   `https://fischiolab.onrender.com/auth/callback`.
   Per prove locali aggiungere esplicitamente il callback locale corretto.
5. **Allow new users to sign up deve essere abilitato per il primo accesso
   Google**: crea l’identità tecnica Supabase. Questa impostazione NON autorizza
   l’accesso a FischioLab, che richiede un invito oppure un collegamento locale
   già esistente. Un eventuale account Supabase privo di mapping locale viene
   respinto. Non assegnare ruoli applicativi da `user_metadata` o dall’email.
6. “Allow manual linking”, già attivato dall’utente, non è richiesto da questo
   flusso: il collegamento è gestito dal backend di FischioLab. L’app non usa
   `linkIdentity` e non trasferisce le password locali in Supabase Auth.
7. Le tabelle dell’app non devono essere accessibili direttamente dalla Data
   API ai ruoli Supabase `anon` e `authenticated`. La migrazione abilita RLS e
   revoca i grant su tutte le tabelle definite dagli schemi applicativi; non
   modifica le policy di `storage` o le tabelle interne `auth` di Supabase.
   Se erano state aggiunte policy/grant manuali alle tabelle applicative,
   verificarli prima dell’attivazione del provider.

Riferimenti: [Supabase Google](https://supabase.com/docs/guides/auth/social-login/auth-google),
[PKCE](https://supabase.com/docs/guides/auth/sessions/pkce-flow),
[configurazione registrazioni](https://supabase.com/docs/guides/auth/general-configuration),
[protezione Data API](https://supabase.com/docs/guides/api/securing-your-api),
[Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect).

## Email facoltativa e costi

Username/password, inviti consegnati a mano e Google non richiedono l’invio
email. Non sono stati aggiunti servizi a pagamento o nuove dipendenze npm.
Restano applicabili i limiti/piani dei servizi già scelti.

L’email inserita dal titolare resta **non verificata** finché non conferma il
link ricevuto. Solo dopo la verifica può sostituire lo username nel login e
abilitare il recupero via email; la password è sempre la password locale.
L’indirizzo anagrafico in `referees.email` non viene usato per autenticare o
abbinare account. Anche l’email Google rimane distinta dal contatto facoltativo.

La verifica/il recupero automatici usano il trasporto SMTP già presente
(`SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`).
Il servizio non è obbligatorio: se assente o non raggiungibile, l’account rimane
valido e la UI indica di usare lo username e il recupero amministrativo.
Configurare SMTP solo in un ambiente che consenta realmente l’invio;
la presenza delle variabili non garantisce la consegna. I test usano un trasporto
simulato e non inviano email reali. Nessun SMTP è stato configurato in questa
consegna.

## Mapping e protezioni

- `users.id` resta l’identificativo applicativo. Rapporti, designazioni, arbitro
  collegato, ruoli multipli e assegnazioni formatore per stagione non cambiano.
- `users.password_hash` diventa nullable: un profilo non invitato può non avere
  credenziali; un account Google può non avere password. Le password esistenti
  restano bcrypt. Nuove password: almeno 8 caratteri, massimo 72 byte UTF-8.
- `users.email`, `email_verified_at`, `activated_at`, `auth_version` registrano
  contatto, stato e invalidazione dei flussi sensibili. Un’email verificata è
  univoca; un’email non verificata non prenota un’identità altrui.
- `user_google_identities`: mapping univoco tra utente locale, UUID Supabase e
  soggetto Google. Nessun abbinamento automatico per nome o email.
- `account_links`: hash SHA-256 del token casuale da 32 byte, destinatario,
  scopo, creatore, scadenza, revoca e consumo. Le operazioni acquisiscono il lock
  utente e consumano il link in transazione, anche con richieste concorrenti.
- `oauth_flows`: PKCE S256, scadenza 10 minuti e cookie HttpOnly SameSite=Lax
  legato al browser. Il collegamento richiede anche la stessa sessione locale.
  Il verifier vive solo nel database protetto; il callback viene consumato una
  sola volta. Cambi credenziali e disattivazioni invalidano il flusso.
- Lo scambio del codice, `Supabase /user` e `Google userinfo` sono eseguiti sul
  server. Si verificano soggetto Google ed email verificata anche presso
  Google, perché un’identità collegata al profilo Supabase da sola non prova
  quale provider sia stato usato. Access/refresh token non arrivano al browser
  e non vengono salvati; viene emesso soltanto il cookie di sessione locale.
- `sessions.auth_method` distingue password e Google; i permessi sono sempre
  letti dalle tabelle dell’app. Logout e disattivazione hanno gli stessi effetti
  per entrambi gli accessi. Un JWT Supabase da solo non autentica nessuna API.
- `auth_rate_limits` limita tentativi per IP e, al login, anche per identificativo;
  i contatori sopravvivono al riavvio e sono condivisi tra processi. Scritture
  auth/admin richiedono header `X-Requested-With: FischioLab` e origine ammessa.
- `auth_events` registra generazioni, revoche, attivazioni, collegamenti e
  recuperi senza token/password, consultabili in **Inviti e accesso**. Gli accessi
  riusciti continuano a popolare il registro accessi esistente.
- I link stanno nel fragment dell’URL e nel body API, non nelle query delle API;
  pagine sensibili usano `no-store` e `Referrer-Policy: no-referrer`.

## Migrazione, rilascio e ripristino

Il servizio Render pubblica dal ramo `main`, come confermato dall’utente il
21 settembre 2026 e indicato dal blueprint. Per rilasciare eseguire il push
su `main`. Non serve aggiornare `cloud-migration`: la precedente indicazione
era una deduzione errata dai metadati dei deployment GitHub, non una verifica
della configurazione corrente nella dashboard Render.

`initializeDatabase()` esegue lo schema corrente, `src/database/auth.sql`,
la protezione Data API e i backfill preesistenti. Le aggiunte sono idempotenti;
nessuna riga utente o relazione viene rinumerata/cancellata. La prima esecuzione
valorizza l’attivazione dei vecchi utenti con password. Fare prima un backup
PostgreSQL e verificare il ruolo della connessione: RLS protegge le API Supabase,
mentre Express deve continuare a operare come proprietario dello schema.

Prima del rilascio: eseguire la suite su DB separato, compilare il frontend,
impostare le variabili, pubblicare l’app e provare sul dominio pubblico:

- vecchio login; nuovo invito senza email; link usato/scaduto/revocato;
- invito con Google, logout/login Google, collegamento successivo da Account;
- collisione tra due profili, Google non invitato, utente disattivato;
- recupero senza email, eventuale scollegamento Google;
- formatori con più ruoli e campionati/stagioni; verifica email solo se SMTP
  effettivamente configurato e collaudato.

Per sospendere Google basta `ENABLE_GOOGLE_AUTH=false` e riavviare: password,
inviti e recupero amministrativo rimangono disponibili. Prima di spegnerlo,
fornire un recupero a chi ha soltanto Google. Non rimuovere le nuove tabelle per
fare rollback: contengono mapping, link e audit. Il vecchio codice non gestisce
`password_hash=NULL`; tornare a una revisione precedente richiede una revisione
compatibile o il ripristino controllato del backup, perdendo le modifiche fatte
dopo il backup. Non riaprire i grant Data API per risolvere errori di connessione.
