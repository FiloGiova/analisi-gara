# FischioLab

FischioLab è una webapp per gestire gare, designazioni e rapporti arbitrali di
basket. Permette di importare i calendari FIP, assegnare gli osservatori,
compilare i rapporti, generare i PDF e consultare statistiche stagionali.

Produzione: [https://fischiolab.onrender.com](https://fischiolab.onrender.com)

## Funzioni principali

- import e sincronizzazione delle sorgenti pubbliche FIP;
- gestione gare, arbitri e osservatori, con export XLSX della vista filtrata;
- designazione osservatori singola o in blocco;
- rapporti in bozza/definitivi e PDF separato per ciascun arbitro;
- import deterministico dei rapporti PDF federali, con abbinamento da numero
  gara e campo `ARBITRO` interno al documento;
- anagrafica e classifica arbitri per stagione e campionato, esportabili in XLSX;
- statistiche Copertura, Matrice incroci e Impiego arbitri, esportabili in XLSX
  con i filtri della vista corrente e collegate ai rapporti di origine;
- template XLSX per il designatore, esportabile per una o più fasi di campionato;
- ruoli `admin`, `instructor`, `observer` e `referee`;
- helper AI opzionale per il giudizio globale;
- invio PDF via email opzionale.

La sezione “Potenzialità” resta una nota interna: compare nel riepilogo web del
rapporto per i ruoli autorizzati, non viene esportata nei PDF e non viene
mostrata agli utenti arbitro.

## Architettura

```text
Browser
   │
   ▼
Render — singolo Web Service Node/Express
   ├── frontend React/Vite
   ├── API e autenticazione
   ├── sincronizzazione FIP e import XLSX
   └── generazione PDF
         │
         ├── Supabase PostgreSQL
         └── Supabase Storage
```

Il frontend viene compilato in `dist/client` e servito dallo stesso processo
Express. Database e sessioni sono su PostgreSQL; PDF e foto sono su Supabase
Storage. Il filesystem di Render è considerato effimero.

## Requisiti

- Node.js 20–24 (in produzione viene usato Node 22);
- npm;
- un database PostgreSQL;
- facoltativo: progetto Supabase per lo storage di PDF e foto.

## Configurazione locale

```bash
npm install
cp .env.example .env
```

Impostare almeno:

```env
DATABASE_URL=postgres://...
DATABASE_SSL=false
SESSION_SECRET=una-stringa-casuale-lunga
COOKIE_SECURE=false
```

Con un database Supabase usare normalmente `DATABASE_SSL=true`.

Per usare Supabase Storage:

```env
SUPABASE_URL=https://PROJECT.supabase.co
SUPABASE_SERVICE_KEY=...
STORAGE_BUCKET=rapporti
```

Se le variabili Supabase non sono presenti, in sviluppo PDF e foto vengono
salvati sotto `STORAGE_DIR`.

### Inizializzazione

```bash
ADMIN_USERNAME=admin \
ADMIN_PASSWORD='scegli-una-password-robusta' \
npm run setup
```

Per creare o aggiornare successivamente l’admin:

```bash
ADMIN_PASSWORD='nuova-password' npm run seed:admin
```

## Sviluppo

Avvio API e frontend Vite:

```bash
npm run dev
```

- frontend: [http://localhost:5173](http://localhost:5173)
- API: [http://localhost:3000](http://localhost:3000)

Comandi separati:

```bash
npm run dev:api
npm run dev:web
```

Build e avvio equivalente alla produzione:

```bash
npm run build
npm start
```

## Test PostgreSQL

La suite non usa mai il database indicato da `DATABASE_URL`. Richiede
`TEST_DATABASE_URL`, verifica che sia diverso dalla produzione e accetta
normalmente soltanto database il cui nome contiene `test`.

Esempio con PostgreSQL locale via Docker:

```bash
docker run --name fischiolab-test-postgres \
  -e POSTGRES_PASSWORD=fischiolab_test \
  -e POSTGRES_DB=fischiolab_test \
  -p 127.0.0.1:55432:5432 \
  -d postgres:17-alpine

TEST_DATABASE_URL=postgres://postgres:fischiolab_test@127.0.0.1:55432/fischiolab_test \
TEST_DATABASE_SSL=false \
npm test
```

Il database di test viene svuotato prima di ciascun file. GitHub Actions crea
automaticamente un PostgreSQL effimero ed esegue test e build a ogni push.

I test puri dei parser FIP e dei rapporti PDF, che non richiedono database, possono essere eseguiti
con:

```bash
npm run test:unit
```

## Deploy su Render

Il file `render.yaml` descrive il Web Service:

- branch: `cloud-migration`;
- build: `npm install --include=dev && npm run build`;
- start: `npm start`;
- health check: `/api/health`.

Le variabili segrete vengono inserite dalla dashboard Render e non devono essere
committate:

- `DATABASE_URL`;
- `SUPABASE_URL`;
- `SUPABASE_SERVICE_KEY`;
- `SESSION_SECRET`;
- eventuali credenziali SMTP e AI.

Dopo un push su `cloud-migration`, Render esegue automaticamente build e
deploy. Verificare:

```bash
curl -i https://fischiolab.onrender.com/api/health
```

La risposta attesa è `200 {"ok":true}`: il controllo esegue anche una query
PostgreSQL.

### Keep-alive

Il piano gratuito Render sospende il servizio dopo 15 minuti senza traffico.
Un monitor HTTP esterno chiama `/api/health` ogni 5 minuti, mantenendo attivi
sia il processo Render sia il database Supabase.

Il workspace deve mantenere un solo Web Service gratuito: un servizio sempre
attivo usa quasi tutte le ore mensili incluse.

## Sincronizzazione FIP automatica

Il processo web sincronizza ogni giorno tutte le sorgenti attive. Non è
necessario creare un secondo Cron Job Render.

```env
ENABLE_SCHEDULED_SYNC=true
SCHEDULED_SYNC_TIME=13:15
SCHEDULED_SYNC_TIMEZONE=Europe/Rome
SCHEDULED_SYNC_SOURCE_DELAY_MS=2000
SCHEDULED_SYNC_ALERT_EMAIL=admin@example.com
```

Lo stato dell’esecuzione è salvato in PostgreSQL:

- un riavvio o deploy non causa una seconda esecuzione nello stesso giorno;
- se il processo si riavvia dopo l’orario previsto, recupera l’esecuzione;
- le sorgenti vengono elaborate in sequenza;
- esito e contatori sono visibili nella pagina **Admin → Sorgenti gare**.

Se SMTP e `SCHEDULED_SYNC_ALERT_EMAIL` sono configurati, gli esiti con avvisi o
errori generano anche una notifica email.

La sincronizzazione FIP aggiorna gare e arbitri, ma non modifica mai gli
osservatori interni né i valori bloccati manualmente.

## Importazione rapporti PDF federali

Admin e formatori possono caricare fino a 20 PDF digitali dalla pagina
**Rapporti** oppure dai dettagli di una gara o di un rapporto. L'anteprima
abbina gara, arbitri e osservatore usando il contenuto del documento; il nome
del file non partecipa mai al riconoscimento.

L'importazione aggiorna le designazioni confermate e registra le variazioni
nello storico gara. Un solo PDF produce una bozza, mentre una coppia completa e
valida produce un rapporto definitivo. I PDF originali vengono elaborati in
memoria e non sono archiviati.

Il comando locale usa lo stesso parser:

```bash
npm run import:legacy-pdfs -- --dry-run rapporto1.pdf rapporto2.pdf
```

## PDF e storage

Per ogni rapporto vengono generati due PDF. Il nome segue il formato:

```text
numeroGara_Cognome.pdf
```

In produzione la chiave Storage è:

```text
output/<stagione>/report-<id>/<nome-file>.pdf
```

La Service Key Supabase deve restare esclusivamente lato server.

## Ruoli e sicurezza

- **Admin:** accesso completo.
- **Formatore:** gare, arbitri e statistiche dei campionati assegnati; modifica
  dei rapporti secondo la designazione.
- **Osservatore:** vede e compila soltanto i propri rapporti/gare assegnate.
- **Arbitro:** sola lettura dei propri rapporti, senza voto numerico e
  Potenzialità.

Non esiste registrazione pubblica. Le password sono hashate e le sessioni sono
token casuali memorizzati nel database. In produzione HTTPS deve usare
`COOKIE_SECURE=true`.

## Roadmap e storico

- [NEXT_STEPS.md](NEXT_STEPS.md): attività ancora aperte e priorità.
- [CHANGELOG.md](CHANGELOG.md): decisioni e modifiche già consegnate.
