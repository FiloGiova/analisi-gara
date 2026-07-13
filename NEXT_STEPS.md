# Next steps FischioLab

Aggiornato al 13 luglio 2026. Le attività concluse sono depennate e restano
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
- [x] ~~Invio email del PDF~~ a livello applicativo; resta da configurare il
  mittente SMTP di produzione.
- [x] ~~Suite di test PostgreSQL~~: database separato e protetto, 53 test
  asincroni e GitHub Actions con PostgreSQL effimero.
- [x] ~~Sincronizzazione FIP automatica giornaliera~~: timer persistente nel
  processo Render, recupero dopo riavvio, esito in pagina ed email opzionale.
- [x] ~~README cloud~~ aggiornato per Render, Supabase, sviluppo, test e deploy.
- [x] ~~Template XLSX del designatore~~ con campionato, senza Arbitro 3, menu
  Arbitro 1/2 e selezione multipla delle fasi da consegnare.

## Priorità consigliate

### 1. Miglioramenti operativi piccoli

- banner admin per certificati in scadenza;
- esportazione CSV dell'anagrafica arbitri;
- mostrare le note private dell'arbitro durante la compilazione;
- rivedere gli errori frontend ancora silenziosi;
- valutare la paginazione arbitri solo quando ricerca e filtri non bastano;
- configurare il mittente SMTP di produzione.

### 2. Evoluzione dei rapporti

- helper AI fase 2 con 2-3 esempi few-shot scelti e approvati;
- ulteriore rifinitura visiva della coda rapporti per ruolo;
- rapporto da video con modello dati, validazione e PDF separati.

Queste attività richiedono prima decisioni funzionali o contenuti di esempio.

### 3. Export completo e reset dati di prova

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
