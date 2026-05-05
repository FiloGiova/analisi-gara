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
