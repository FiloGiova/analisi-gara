# Next steps FischioLab

Aggiornato al 15 luglio 2026. Le attività concluse sono depennate e restano
documentate nel [CHANGELOG.md](CHANGELOG.md); questa pagina contiene soltanto
la roadmap operativa corrente.

## Completato

- [x] ~~Migrazione cloud~~: Render per l'app Node/Express, Supabase PostgreSQL
  e Supabase Storage.
- [x] ~~Rebranding AnalisiGara → FischioLab~~, compreso URL Render.
- [x] ~~Health check e keep-alive~~: il ping verifica anche il database; monitor
  esterno configurato per mantenere attivi Render e Supabase.
- [x] ~~Stagioni multiple~~: stagione globale corrente/archivio e selezione
  temporanea distinta nella pagina Statistiche.
- [x] ~~Gare come homepage~~, navigazione attiva e numero gara senza zeri
  iniziali nella UI.
- [x] ~~Sorgenti FIP e sincronizzazione manuale~~: import calendario,
  designazioni arbitrali, gironi multipli, audit e gestione conflitti.
- [x] ~~Designazione osservatori in blocco~~ con filtri campionato, fase e
  giornata, suggerimenti e scoping per formatore.
- [x] ~~Permessi per ruolo~~: Gare, Statistiche, Arbitri e rapporti rispettano
  il perimetro dell'utente e dei campionati assegnati.
- [x] ~~Coda rapporti da compilare~~ e separazione fra visibilità e modifica in
  base alla designazione.
- [x] ~~Anagrafica arbitri per stagione e campionato~~, inclusi import DR1
  2025/2026, stato attivo e account arbitro.
- [x] ~~Fasce Esordienti/Playoff/Playout~~ con gestione multipla degli arbitri e
  filtro nelle statistiche.
- [x] ~~Statistiche Copertura, Matrice e Impiego~~ con ricerca, ordinamento,
  campionato, fase multipla, fascia, stagione e nomi delle squadre.
- [x] ~~PDF e file persistenti su Supabase Storage~~.
- [x] ~~Helper AI fase 1~~ per generare e rifinire il giudizio globale.
- [x] ~~Invio email dei rapporti completo~~ (16-17/07/2026): conferma con
  anteprima destinatario, blocco bozze/omonimi, log invii in area admin,
  campionati gestiti da interfaccia con CC e firma, template del corpo
  modificabile. Resta solo l'attivazione in produzione (v. priorità 1).
- [x] ~~Base tecnica per l'invio email dei PDF~~: servizio email, PDF distinti
  per arbitro e campi di tracciamento degli invii già presenti.
- [x] ~~Suite di test PostgreSQL~~: database separato e protetto, 53 test
  asincroni e GitHub Actions con PostgreSQL effimero.
- [x] ~~Sincronizzazione FIP automatica giornaliera~~: timer persistente nel
  processo Render, recupero dopo riavvio, esito in pagina ed email opzionale.
- [x] ~~README cloud~~ aggiornato per Render, Supabase, sviluppo, test e deploy.
- [x] ~~Template XLSX del designatore~~ con campionato, senza Arbitro 3, menu
  Arbitro 1/2 e selezione multipla delle fasi da consegnare.
- [x] ~~Export XLSX delle viste operative~~ per Statistiche, Gare e Anagrafica
  arbitri, coerenti con i filtri impostati.
- [x] ~~Export XLSX della classifica arbitri~~ con posizione, categoria, voti,
  numero di valutazioni e media, nel perimetro del campionato consentito.
- [x] ~~Potenzialità nel riepilogo del rapporto~~ per entrambi gli arbitri,
  riservate ai ruoli autorizzati e sempre escluse dai PDF.
- [x] ~~Colonna osservatori fissa nella Matrice incroci~~ durante lo scorrimento
  orizzontale.
- [x] ~~Colonna arbitri fissa nella Copertura~~ e collegamenti dai visionamenti
  ai rapporti con voto visibile al passaggio del mouse.
- [x] ~~Voti interattivi nella Classifica arbitri~~ con osservatore nel tooltip
  e collegamento diretto al rapporto.

## Priorità consigliate

### 1. Attivare l'invio email dei rapporti in produzione

La funzionalità è completa e collaudata (CHANGELOG 16-17/07/2026): conferma
esplicita con anteprima del destinatario, blocco bozze e omonimi, log invii
con esito in Admin → Log → Email, CC e firma per campionato, template del
corpo modificabile dall'admin. Manca solo il canale di uscita: **il piano
Free di Render blocca le porte SMTP (25/465/587)** e la via alternativa API
con mittente @gmail.com è stata scartata (Gmail cestina silenziosamente i
mittenti gmail.com spediti da server terzi — v. CHANGELOG 17/07).

Per attivare, quando si deciderà di farlo:

- [ ] upgrade dell'istanza Render a pagamento (dashboard → fischiolab →
  Settings → Instance Type → Starter): le porte SMTP si aprono da sole;
- [ ] verificare le variabili già sul dashboard: `SMTP_HOST=smtp.gmail.com`,
  `SMTP_PORT=465`, `SMTP_SECURE=true`, `SMTP_USER=formatoriciapiemonte@gmail.com`,
  `SMTP_PASS`=app password Google (richiede verifica in due passaggi),
  `SMTP_FROM=FischioLab <formatoriciapiemonte@gmail.com>`; eliminare le
  variabili residue `BREVO_API_KEY`/`EMAIL_FROM`/`EMAIL_DRIVER` se presenti;
- [ ] prova reale su una casella di test, controllando esito e dettagli in
  Admin → Log → Email, prima di inviare agli arbitri;
- opzione futura per un mittente professionale slegato dalla casella
  personale: dominio proprio autenticato (SPF/DKIM) su un provider
  transazionale.

### 2. Armonizzare filtri e search bar

Obiettivo: lo stesso tipo di filtro deve avere dimensioni e comportamento
coerenti in tutte le pagine, mantenendo varianti solo quando servono davvero.

- censire i filtri ricorrenti: stagione, campionato, fase, giornata, fascia,
  stato, arbitro, osservatore e ricerca testuale;
- definire varianti riutilizzabili con larghezze coerenti: campionato più largo
  della giornata, fase ancora più larga, controlli brevi per stato/fascia e una
  search bar standard e responsive;
- uniformare altezza, font, placeholder, caret, menu, checkbox, stato disabilitato
  e spaziature tra Gare, Statistiche, Fasce, Designazioni e pagine admin;
- riusare classi/componenti comuni invece di dimensioni inline diverse per ogni
  pagina; le eccezioni devono usare un modificatore locale esplicito;
- controllare resa e leggibilità sia desktop sia mobile, inclusi nomi lunghi di
  campionati, fasi e persone.

Completamento: ogni filtro equivalente usa la stessa variante grafica e gli
stessi breakpoint, senza regressioni nei menu a tendina o nelle tabelle.

### 3. Rivedere le pagine personali e la gestione utenze

Obiettivo: rendere coerenti e più chiare l'area personale dei diversi ruoli e la
pagina amministrativa con cui vengono creati e gestiti gli account.

- rivedere homepage personale, profilo/account, rapporti assegnati e viste
  specifiche di arbitro, osservatore e formatore;
- riorganizzare la pagina admin delle utenze: ricerca, ruolo, stato, campionati
  assegnati, collegamento all'arbitro, reset password e azioni principali;
- uniformare gerarchia visiva, card, form, badge, messaggi vuoti, caricamento,
  errori e conferme con il resto di FischioLab;
- verificare che ogni ruolo veda soltanto dati e azioni consentiti, soprattutto
  con più campionati e stagioni archiviate;
- controllare usabilità desktop/mobile e i flussi completi di creazione,
  modifica, disattivazione e recupero accesso.

### 4. Miglioramenti operativi piccoli

- banner admin per certificati in scadenza;
- mostrare le note private dell'arbitro durante la compilazione;
- rivedere gli errori frontend ancora silenziosi;
- valutare la paginazione arbitri solo quando ricerca e filtri non bastano;
- applicare il versionamento dell'URL favicon per forzarne l'aggiornamento nei
  browser che conservano a lungo la cache dell'icona.

### 5. Evoluzione dei rapporti

- helper AI fase 2 con 2-3 esempi few-shot scelti e approvati;
- ulteriore rifinitura visiva della coda rapporti per ruolo;
- rapporto da video con modello dati, validazione e PDF separati.

Queste attività richiedono prima decisioni funzionali o contenuti di esempio.

### 6. Export completo e reset dati di prova

Da fare per ultimo, quando lo schema è stabile:

- export XLSX multi-foglio di sorgenti, arbitri, gare, designazioni, rapporti e
  statistiche;
- download completato prima di consentire il reset;
- conferma esplicita e accesso solo admin;
- definizione precisa del perimetro di rapporti e PDF storici da conservare.

## Rimandato

- migrazione generale a TypeScript;
- app Android/iOS con Capacitor;
- funzioni native, notifiche push e modalità offline.

Sono investimenti sensati soltanto dopo la stabilizzazione della webapp e del
flusso operativo della stagione.
