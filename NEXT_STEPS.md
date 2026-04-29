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
- Rendere la card intera cliccabile (non solo il link testuale)
- Aggiungere statistiche in cima: numero totale rapporti, bozze vs definitivi, rapporti dell'ultimo mese
- Migliorare il filtro/ricerca (filtrare per anno sportivo, per arbitro, per campionato)

### Divisione per anni sportivi
- Aggiungere il concetto di "anno sportivo" (es. 2024/2025) ai rapporti
- Filtrare la dashboard per anno sportivo
- Visualizzare le statistiche aggregate per anno

---

## Funzionalità nuove

### Anagrafica arbitri
- Creare un DB degli arbitri con: nome, cognome, data di nascita, email, categoria
- Pannello admin per gestire l'anagrafica
- Associare ogni rapporto a un arbitro del DB invece di digitare il nome a mano

### Liste arbitri per campionato e anno sportivo
- Creare liste (roster) degli arbitri per campionato (es. DR1, Serie C, Serie D…) e anno sportivo
- Quando si compila un rapporto, scegliere l'arbitro da una lista invece di digitare il nome
- Sostituisce/integra l'attuale autocomplete sui nomi

### Invio rapporto via email
- Aggiungere pulsante "Invia PDF all'arbitro" nella pagina di dettaglio rapporto
- Recuperare l'email dall'anagrafica arbitri
- Inviare i PDF generati come allegati (SMTP configurabile nel `.env`)
- Registrare la data di invio nel rapporto
