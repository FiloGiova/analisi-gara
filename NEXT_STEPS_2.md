## Nuova architettura cloud: Supabase e Vercel

L’applicazione è attualmente pubblicata su un NAS UGREEN con:

- Node.js ed Express avviati tramite systemd;
- database SQLite tramite `better-sqlite3`;
- file persistenti salvati sotto `STORAGE_DIR`;
- PDF, upload, template e sessioni salvati localmente;
- accesso esterno tramite ngrok.

Voglio migrare l’ambiente di produzione verso:

- Vercel per frontend React/Vite e backend Express/Node;
- Supabase PostgreSQL come database;
- Supabase Storage per PDF, upload e altri file persistenti;
- GitHub come sorgente del deployment Vercel.

Il NAS deve essere considerato la sorgente dei dati esistenti e un possibile ambiente di rollback temporaneo, non il target finale della nuova architettura.

Prima di implementare la migrazione:

1. analizza accuratamente l’architettura esistente;
2. verifica la compatibilità dell’attuale server Express con Vercel;
3. individua tutte le dipendenze da SQLite e filesystem locale;
4. identifica tutti i percorsi sotto `STORAGE_DIR`;
5. individua come sono salvate sessioni, utenti, PDF, template e upload;
6. proponi un piano di migrazione senza perdita di dati;
7. segnalami eventuali decisioni funzionali che richiedono il mio intervento.

Hai libertà di riorganizzare il progetto se necessario, ma non riscrivere inutilmente parti che possono essere adattate in modo sicuro.

## Architettura desiderata

L’architettura di riferimento è:

```text
Browser
   │
   ▼
Vercel
- React/Vite
- Express/API Node.js
- generazione PDF
- import XLSX
- sincronizzazione FIP
   │
   ├── Supabase PostgreSQL
   │   - utenti
   │   - sessioni
   │   - arbitri
   │   - rapporti
   │   - gare
   │   - designazioni
   │   - visionamenti
   │
   └── Supabase Storage
       - PDF generati
       - PDF storici
       - upload temporanei o persistenti
       - eventuali template