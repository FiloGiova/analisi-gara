# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

"FischioLab" — a webapp for basketball referee observers to write, archive, and export match evaluation reports. UI text, API error messages, and comments are in Italian; keep new user-facing strings in Italian.

Stack: Node 20+ ESM (`"type": "module"` everywhere), Express, React 18 + Vite, PostgreSQL via `pg` (API asincrone), Supabase Storage e `pdfkit` per i PDF (senza Chromium). Deploy su Render dal branch `main`.

The test suite uses a separate PostgreSQL database through `TEST_DATABASE_URL`; there is no linter configured.

## Commands

```bash
npm run dev        # API (Express, :3000) + frontend (Vite, :5173) together; open http://localhost:5173
npm run dev:api    # Express only, :3000
npm run dev:web    # Vite only, :5173 (proxies /api to :3000)
npm run build      # Vite build → dist/client (server serves this in production)
npm start          # production: node server.js, serves API + built SPA on :3000
npm run setup      # first-time init: creates DB, storage dirs, first admin (set ADMIN_USERNAME/ADMIN_PASSWORD)
npm run seed:admin # create/update an admin user
npm test           # PostgreSQL suite; requires a dedicated TEST_DATABASE_URL
npm run test:unit  # pure FIP parser tests, no database required
```

In production the database is Supabase PostgreSQL and persistent files use Supabase Storage. Without Supabase Storage credentials, local files live in `./storage` (gitignored).

## Architecture

**Request flow**: `server.js` (entry, mounts routers + auth middleware) → `src/routes/*.routes.js` (validation, HTTP) → `src/services/*.js` (business logic) → async helpers in `src/database/db.js`. PostgreSQL schema: `src/database/schema.postgres.sql`, applied idempotently at startup.

**Error handling**: throw `HttpError(statusCode, message)` from [src/utils/httpError.js](src/utils/httpError.js) anywhere; the central handler in `server.js` turns it into a JSON response. Async route handlers are wrapped with `asyncHandler` from the same file.

**Shared report template — the load-bearing file**: [shared/reportTemplate.js](shared/reportTemplate.js) is imported by *both* the server (validation, PDF layout, rating→number mapping) and the React client (form rendering, choice options). Any change to report structure, rating scales, or season derivation happens there once and affects both sides.

**Competitions are data, not code**: the catalog lives in the `competitions` table (admin CRUD at `#/admin/competitions`, API `/api/competitions`, service [src/services/competitionService.js](src/services/competitionService.js)). `value` is the immutable join key stored as TEXT on reports/games/rosters/bands/assignments; renames touch only `label`; deactivation (`active=0`) hides it from pickers without invalidating historical data. Seeding + defensive backfill of legacy values happen in `seedCompetitions()` in [src/database/connection.js](src/database/connection.js). The client reads the list via `useCompetitions()` from [client/src/lib/competitions.jsx](client/src/lib/competitions.jsx) — never hardcode competition lists.

**Report emails**: `buildEmailPlan()` in [src/services/emailService.js](src/services/emailService.js) is the single resolver for recipient/subject/body/CC — both the preview endpoint and the actual send go through it. Sends require `status='final'` and a `confirmedRecipient` matching the freshly resolved address; every SMTP attempt (success or error) is logged in `report_email_log`. Per-competition CC and signature come from the `competitions` table; the body template is admin-editable (`app_settings` key `report_email_body_template`, pure render/validate functions in [src/services/emailTemplate.js](src/services/emailTemplate.js)). The nodemailer transporter is injectable in tests via `setTransportFactoryForTests()`.

**Reports data model**: a `reports` row holds a few indexed/searchable columns (match number, teams, referees, votes, status `draft`/`final`) plus the full form content as a `payload_json` blob. Each report evaluates two referees; export produces two PDFs named `numGara_Cognome.pdf`, stored under `output/<season>/report-<id>/` and tracked in `exports`.

**Auth & roles**: cookie-based sessions; the token is hashed and stored server-side in the `sessions` table. `attachUser` sets `req.user` on every request; route guards (`requireAuth`, `requireAdmin`, `requireAdminOrInstructor`, `requireReferee`, `requireReportAuthors`) live in [src/middleware/auth.js](src/middleware/auth.js). Roles: `admin`, `instructor` (scoped to competitions), `observer`, `referee`. Legacy role values (`formatter`, `user`) are normalized in `publicUser()` — don't compare raw `users.role` directly.

**Referee-facing privacy rules**: users with role `referee` only see their own reports, and the server strips the numeric vote and the "Potenzialità" section from their web payload. "Potenzialità" is an internal note and must never appear in exported PDFs (enforced in `pdfService`).

**Client routing**: no react-router. Custom hash-based routing in [client/src/lib/navigation.js](client/src/lib/navigation.js) (`parseRoute`/`navigate`), dispatched in a plain conditional chain in [client/src/App.jsx](client/src/App.jsx). New pages need a route in both files. All API calls go through the fetch wrapper in [client/src/lib/api.js](client/src/lib/api.js).

**AI feature (optional)**: gated by `ENABLE_AI_FEATURES=true` + `ANTHROPIC_API_KEY` in `.env`. When off, `/api/ai/*` routes are not mounted and the client hides the helper (the flag reaches the client via `/api/me` → `features.aiEnabled`). [src/services/anthropicService.js](src/services/anthropicService.js) calls the Anthropic Messages API directly with `fetch` (no SDK); prompts are built in [src/services/judgmentPromptBuilder.js](src/services/judgmentPromptBuilder.js). Model and API version are set in `src/config.js`.

## Deployment notes

- Render deploys `main` using `render.yaml`; the single Express process serves both API and SPA.
- Keep `COOKIE_SECURE=true` on Render HTTPS.
- The public `/api/health` endpoint also queries PostgreSQL and is pinged every 5 minutes by an external monitor.
- `ENABLE_SCHEDULED_SYNC=true` runs the daily FIP synchronization inside the web process; execution state is persisted in `scheduled_jobs`.
- Never run tests against `DATABASE_URL`: `TEST_DATABASE_URL` is mandatory, must be separate, and is truncated by the suite.
