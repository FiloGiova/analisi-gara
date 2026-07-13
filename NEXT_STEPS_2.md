# Migrazione cloud — completata

- [x] ~~SQLite locale~~ → Supabase PostgreSQL.
- [x] ~~Filesystem persistente locale~~ → Supabase Storage.
- [x] ~~Deploy NAS/ngrok~~ → Render con HTTPS e deploy da GitHub.
- [x] ~~Vercel come target~~ → escluso perché le sincronizzazioni FIP possono
  superare i limiti adatti a funzioni serverless.
- [x] ~~Migrazione di backend, sessioni, PDF, upload e dati~~.
- [x] ~~Health check applicazione + database e keep-alive esterno~~.

L'architettura in produzione è:

```text
Browser
   │
   ▼
Render
- React/Vite
- Express/Node
- PDF, import XLSX e sincronizzazione FIP
   │
   ├── Supabase PostgreSQL
   └── Supabase Storage
```

I dettagli tecnici della migrazione restano nel
[CHANGELOG.md](CHANGELOG.md). Le attività ancora aperte sono raccolte in
[NEXT_STEPS.md](NEXT_STEPS.md).
