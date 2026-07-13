# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

"FischioLab" — a webapp for basketball referee observers to write, archive, and export match evaluation reports. UI text, API error messages, and comments are in Italian; keep new user-facing strings in Italian.

Stack: Node 18+ ESM (`"type": "module"` everywhere), Express, React 18 + Vite, SQLite via `better-sqlite3` (synchronous API — no async DB calls), `pdfkit` for PDF export (no Chromium). No Docker. Deployed to a UGREEN NAS (Debian ARM64) via systemd service `analisi-gara`.

There are no tests and no linter configured.

## Commands

```bash
npm run dev        # API (Express, :3000) + frontend (Vite, :5173) together; open http://localhost:5173
npm run dev:api    # Express only, :3000
npm run dev:web    # Vite only, :5173 (proxies /api to :3000)
npm run build      # Vite build → dist/client (server serves this in production)
npm start          # production: node server.js, serves API + built SPA on :3000
npm run setup      # first-time init: creates DB, storage dirs, first admin (set ADMIN_USERNAME/ADMIN_PASSWORD)
npm run seed:admin # create/update an admin user
npm run import:legacy-pdfs -- --dry-run <files...>  # import historical PDF reports (--commit to apply)
./deploy-nas.sh    # build + rsync to NAS + restart service (excludes node_modules, .env, storage)
```

Local data lives in `./storage` (gitignored); on the NAS `STORAGE_DIR` points elsewhere. All paths (DB, output PDFs, uploads, templates) derive from `STORAGE_DIR` in [src/config.js](src/config.js).

## Architecture

**Request flow**: `server.js` (entry, mounts routers + auth middleware) → `src/routes/*.routes.js` (validation, HTTP) → `src/services/*.js` (business logic) → `src/database/connection.js` (better-sqlite3 singleton; schema in `src/database/schema.sql`, applied idempotently at startup).

**Error handling**: throw `HttpError(statusCode, message)` from [src/utils/httpError.js](src/utils/httpError.js) anywhere; the central handler in `server.js` turns it into a JSON response. Async route handlers are wrapped with `asyncHandler` from the same file.

**Shared report template — the load-bearing file**: [shared/reportTemplate.js](shared/reportTemplate.js) is imported by *both* the server (validation, PDF layout, rating→number mapping) and the React client (form rendering, choice options). Any change to report structure, competitions, rating scales, or season derivation happens there once and affects both sides.

**Reports data model**: a `reports` row holds a few indexed/searchable columns (match number, teams, referees, votes, status `draft`/`final`) plus the full form content as a `payload_json` blob. Each report evaluates two referees; export produces two PDFs (`numGara_arbitro1.pdf`, `numGara_arbitro2.pdf`) into `STORAGE_DIR/output/<season>/report-<id>/`, tracked in the `exports` table.

**Auth & roles**: cookie-based sessions; the token is hashed and stored server-side in the `sessions` table. `attachUser` sets `req.user` on every request; route guards (`requireAuth`, `requireAdmin`, `requireAdminOrInstructor`, `requireReferee`, `requireReportAuthors`) live in [src/middleware/auth.js](src/middleware/auth.js). Roles: `admin`, `instructor` (scoped to competitions), `observer`, `referee`. Legacy role values (`formatter`, `user`) are normalized in `publicUser()` — don't compare raw `users.role` directly.

**Referee-facing privacy rules**: users with role `referee` only see their own reports, and the server strips the numeric vote and the "Potenzialità" section from their web payload. "Potenzialità" is an internal note and must never appear in exported PDFs (enforced in `pdfService`).

**Client routing**: no react-router. Custom hash-based routing in [client/src/lib/navigation.js](client/src/lib/navigation.js) (`parseRoute`/`navigate`), dispatched in a plain conditional chain in [client/src/App.jsx](client/src/App.jsx). New pages need a route in both files. All API calls go through the fetch wrapper in [client/src/lib/api.js](client/src/lib/api.js).

**AI feature (optional)**: gated by `ENABLE_AI_FEATURES=true` + `ANTHROPIC_API_KEY` in `.env`. When off, `/api/ai/*` routes are not mounted and the client hides the helper (the flag reaches the client via `/api/me` → `features.aiEnabled`). [src/services/anthropicService.js](src/services/anthropicService.js) calls the Anthropic Messages API directly with `fetch` (no SDK); prompts are built in [src/services/judgmentPromptBuilder.js](src/services/judgmentPromptBuilder.js). Model and API version are set in `src/config.js`.

## Deployment notes

- `better-sqlite3` compiles a native module; on the NAS (ARM64) this needs `build-essential python3 make g++`.
- After adding npm dependencies, `deploy-nas.sh` is not enough — SSH to the NAS, `npm install --omit=dev`, then `sudo systemctl restart analisi-gara`.
- `COOKIE_SECURE=false` is intentional for LAN/HTTP use; set `true` only behind HTTPS.
