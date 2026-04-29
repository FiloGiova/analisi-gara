# Rapporti Arbitrali

Webapp leggera per compilare rapporti arbitrali basati sul modello Excel `12799.xlsx`, con dashboard, login locale, bozze, salvataggio definitivo, archivio e generazione di due PDF separati:

- `numGara_arbitro1.pdf`
- `numGara_arbitro2.pdf`

La sezione `Potenzialità` resta disponibile nell'app come nota interna, ma non viene mai esportata nei PDF.

## Stack

- Backend: Node.js 18 + Express
- Frontend: React + Vite
- Database: SQLite tramite `better-sqlite3`
- PDF: `pdfkit`, senza Chromium/Puppeteer
- Auth: utenti locali, password hashate con bcrypt, sessioni server-side salvate in SQLite
- Docker: non usato

## Struttura

```text
.
├── server.js
├── src/
│   ├── database/
│   ├── middleware/
│   ├── routes/
│   ├── services/
│   └── utils/
├── shared/
│   └── reportTemplate.js
├── client/
│   ├── public/
│   └── src/
├── scripts/
├── systemd/
└── README.md
```

## Installazione Locale

```bash
npm install
cp .env.example .env
npm run setup
npm run build
npm start
```

Poi apri:

```text
http://localhost:3000
```

Se `npm run setup` crea il primo admin senza `ADMIN_PASSWORD`, stampa una password casuale una sola volta. In alternativa imposta prima:

```bash
ADMIN_USERNAME=admin ADMIN_PASSWORD='scegli-una-password' npm run setup
```

Per aggiornare o creare un admin:

```bash
ADMIN_PASSWORD='nuova-password' npm run seed:admin
```

## Sviluppo

Terminale 1:

```bash
npm run dev:api
```

Terminale 2:

```bash
npm run dev:web
```

Apri:

```text
http://localhost:5173
```

Vite inoltra le chiamate `/api` a Express su porta `3000`.

## Deploy Sul NAS UGREEN

Directory previste:

```text
/volume1/webapps/rapporti-arbitrali
/volume1/rapporti-arbitrali/data
/volume1/rapporti-arbitrali/output
/volume1/rapporti-arbitrali/templates
/volume1/rapporti-arbitrali/uploads
```

Se `/volume1` non esiste sul NAS, scegli un percorso equivalente e modifica `STORAGE_DIR` nel file `.env` e nel servizio systemd.

### 1. Copia il progetto

```bash
mkdir -p /volume1/webapps
cp -R rapporti-arbitrali /volume1/webapps/rapporti-arbitrali
cd /volume1/webapps/rapporti-arbitrali
```

### 2. Installa dipendenze

```bash
npm install
```

Su Debian ARM64, se `better-sqlite3` deve compilare il modulo nativo e mancano gli strumenti di build:

```bash
apt update
apt install -y build-essential python3 make g++
npm install
```

### 3. Configura ambiente

```bash
cp .env.example .env
```

Verifica almeno:

```env
PORT=3000
HOST=0.0.0.0
STORAGE_DIR=/volume1/rapporti-arbitrali
NODE_ENV=production
COOKIE_SECURE=false
```

### 4. Setup iniziale

```bash
ADMIN_USERNAME=admin ADMIN_PASSWORD='scegli-una-password-robusta' npm run setup
npm run build
```

### 5. Avvio manuale di prova

```bash
npm start
```

Apri da rete locale:

```text
http://IP_DEL_NAS:3000
```

## Servizio systemd

Copia il servizio:

```bash
cp systemd/rapporti-arbitrali.service /etc/systemd/system/rapporti-arbitrali.service
```

Poi:

```bash
systemctl daemon-reload
systemctl enable rapporti-arbitrali
systemctl start rapporti-arbitrali
systemctl status rapporti-arbitrali
journalctl -u rapporti-arbitrali -f
```

Il servizio incluso usa:

```ini
WorkingDirectory=/volume1/webapps/rapporti-arbitrali
ExecStart=/usr/bin/node /volume1/webapps/rapporti-arbitrali/server.js
Environment=PORT=3000
Environment=STORAGE_DIR=/volume1/rapporti-arbitrali
Environment=NODE_ENV=production
```

Se Node non si trova in `/usr/bin/node`, verifica con:

```bash
which node
```

e aggiorna `ExecStart`.

## Export PDF

Dal dettaglio rapporto puoi generare due PDF. I file vengono salvati in:

```text
STORAGE_DIR/output/report-ID/
```

con nomi:

```text
numGara_arbitro1.pdf
numGara_arbitro2.pdf
```

Il PDF contiene intestazione gara, arbitro valutato, valutazioni e commenti. La sezione `Potenzialità` è esclusa.

## Aggiornamento dell'App sul NAS

Quando apporti modifiche sul Mac e vuoi pubblicarle sul NAS, esegui lo script di deploy dalla radice del progetto:

```bash
./deploy-nas.sh
```

Lo script fa in automatico:
1. Builda il frontend (`npm run build`)
2. Trasferisce i file modificati sul NAS (esclude `node_modules`, `.env`, `storage`)
3. Riavvia il server

### Se hai aggiunto nuove dipendenze npm

Dopo il deploy, collegati via SSH ed esegui:

```bash
ssh Filippo@192.168.1.93
cd ~/AnalisiGara
npm install --omit=dev
sudo systemctl restart analisi-gara
```

### Comandi utili sul NAS

```bash
# Stato del server
sudo systemctl status analisi-gara

# Log in tempo reale
journalctl -u analisi-gara -f

# Riavvio manuale
sudo systemctl restart analisi-gara

# Stato tunnel ngrok
sudo systemctl status ngrok-analisi
```

### URL di accesso

| Contesto | URL |
|---|---|
| Rete locale | `http://192.168.1.93:3000` |
| Internet | `https://encircle-outsmart-exploring.ngrok-free.dev` |

## Note Sicurezza

- Non esiste registrazione pubblica.
- Le password sono hashate, non salvate in chiaro.
- Le sessioni sono token casuali salvati lato server in SQLite.
- In rete locale `COOKIE_SECURE=false` va bene; quando passerai a HTTPS imposta `COOKIE_SECURE=true`.
