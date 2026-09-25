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

# start-of-season referee list import (idempotent, preview by default)
node scripts/import-referees.js "<lista.xlsx>" --competition=DR1 [--commit]
```

In production the database is Supabase PostgreSQL and persistent files use Supabase Storage. Without Supabase Storage credentials, local files live in `./storage` (gitignored).

## Architecture

**Request flow**: `server.js` (entry, mounts routers + auth middleware) → `src/routes/*.routes.js` (validation, HTTP) → `src/services/*.js` (business logic) → async helpers in `src/database/db.js`. PostgreSQL schema: `src/database/schema.postgres.sql`, applied idempotently at startup.

**Error handling**: throw `HttpError(statusCode, message)` from [src/utils/httpError.js](src/utils/httpError.js) anywhere; the central handler in `server.js` turns it into a JSON response. Async route handlers are wrapped with `asyncHandler` from the same file.

**Shared report template — the load-bearing file**: [shared/reportTemplate.js](shared/reportTemplate.js) is imported by *both* the server (validation, PDF layout, rating→number mapping) and the React client (form rendering, choice options). Any change to report structure, rating scales, or season derivation happens there once and affects both sides.

**The report structure is versioned**: `payload_json` carries `templateVersion`. v2 (federal guidelines 2026/2027) is the current one — five sections, fourteen ratings, a five-level scale (`RATING_SCALE`, plus `N.V.` on 4.3/4.4) and a closing made of `strengths` / `improvements` / `additionalNotes` / `technicalErrors` / `band` / `vote` / `potential`. v1 (up to 2025/2026, three-level scale, single `globalJudgement`) lives on in `EVALUATION_SECTIONS_V1` so archived reports keep rendering, validating and exporting the way they were written. Never read `EVALUATION_SECTIONS` directly when a payload is in hand: use `sectionsForPayload()` / `matchCharacteristicsForPayload()` (or `sectionsForVersion()` with `templateVersionOf()`). A report's version is fixed at creation — `updateReport` takes it from the stored row, not from the client.

**Fascia e voto**: the federal grid (7,2–8,8) lives in `VOTE_BANDS`. The vote is the source of truth and the band derives from it (`bandForVote`); a band can still be picked alone while there is no vote. Votes are stored as TEXT with a dot ("8.0") so SQL can `CAST(... AS NUMERIC)`, and are shown with a comma through `formatVote()` — which never adds decimals that aren't there, so legacy integer votes stay "68". The vote is not required to finalize a report. One control does the whole job on the client: `client/src/components/BandVoteSelect.jsx`.

**Competitions are data, not code**: the catalog lives in the `competitions` table (admin CRUD at `#/admin/competitions`, API `/api/competitions`, service [src/services/competitionService.js](src/services/competitionService.js)). `value` is the immutable join key stored as TEXT on reports/games/rosters/bands/assignments; renames touch only `label`; deactivation (`active=0`) hides it from pickers without invalidating historical data. Seeding + defensive backfill of legacy values happen in `seedCompetitions()` in [src/database/connection.js](src/database/connection.js). The client reads the list via `useCompetitions()` from [client/src/lib/competitions.jsx](client/src/lib/competitions.jsx) — never hardcode competition lists.

**Report emails**: `buildEmailPlan()` in [src/services/emailService.js](src/services/emailService.js) is the single resolver for recipient/subject/body/CC — both the preview endpoint and the actual send go through it. Sends require `status='final'` and a `confirmedRecipient` matching the freshly resolved address; every SMTP attempt (success or error) is logged in `report_email_log`. Per-competition CC and signature come from the `competitions` table; the body template is admin-editable (`app_settings` key `report_email_body_template`, pure render/validate functions in [src/services/emailTemplate.js](src/services/emailTemplate.js)). Delivery is SMTP-only (`SMTP_*` env vars); the nodemailer transporter is injectable in tests via `setTransportFactoryForTests()`. Note: Render's Free plan blocks outbound SMTP ports, so sending only works on paid instances (see NEXT_STEPS.md).

**Referee status**: a referee's state in a season is `status` — `attivo`, `aspettativa`, `dimissioni` — defined once in [shared/refereeStatus.js](shared/refereeStatus.js) and used by both sides. `active` (1/0) is kept in sync as the boolean copy (`attivo` → 1) that every historical query, stat and coverage check still filters on; write status through `updateReferee`, never the column directly. Because `referees.status` now exists, an unqualified `status` in any query that JOINs `referees` is ambiguous — always qualify it with the table.

**Game sources — public site vs FIP Analytics**: `competition_sources.source_type` is `fip_public` (the public fip.it results pages, scraped by [src/services/fip/fipAdapter.js](src/services/fip/fipAdapter.js)) or `fip_analytics` (the analytics.fip.it JSON API read with a designator's account, [src/services/fip/fipAnalyticsAdapter.js](src/services/fip/fipAnalyticsAdapter.js)); both go through `runSourceSync()` in [src/services/syncService.js](src/services/syncService.js) and share its rules (conflicts, `manual_lock`, `game_changes`, observer never touched). One source per girone for both types. FIP Analytics owns calendar and referees: a game it syncs moves to its source (`competition_source_id`), and while that source is active the public sync only updates `status`/scores on it. Referees are matched by licence first (`cod_tessera` without leading zeros vs `referees.license_number`); FIP states `temporanea` → `provisional` ("Temporanea" badge in the UI), `trasmessa`/`accettata` → `confirmed`, refusals and revocations free the slot. The account can also *write* designations: the adapter allows only the calls in `ALLOWED_CALLS` (login, `POST /gare/search`, `GET /gare/filtri`) and keeps only name, licence, role and state from responses that also carry tax code, phone and email. Credentials only via `FIP_ANALYTICS_USERNAME` / `FIP_ANALYTICS_PASSWORD`; the scheduler ([src/services/scheduledSyncService.js](src/services/scheduledSyncService.js)) runs the public job daily and the FIP Analytics job at `FIP_ANALYTICS_SYNC_TIMES` (default 11:00 and 21:00). Match numbers are stored six-digit zero-padded as the public site shows them ("000730" = FIP Analytics `num_gara` 730).

**Federation PDF import**: [src/services/federationPdfParser.js](src/services/federationPdfParser.js) reads the official form as it was up to 2025/2026, so it produces **v1** payloads (`createEmptyReport(1)`, `EVALUATION_SECTIONS_V1`); importing onto a report already written with the v2 structure is refused with a 409. Reading the 2026/2027 official PDF needs a filled sample first.

**Referee list import**: [scripts/import-referees.js](scripts/import-referees.js) loads a federation XLSX into a season+competition. It maps columns from the sheet's header row, matches existing referees by licence number then by name, and only touches columns the sheet actually provides — so re-running it is safe and never duplicates. Season membership is written to `referee_season_categories` (a referee leaves a competition simply by not appearing in the new list); `--esordienti-col`/`--esordienti-rows` also fill `referee_bands`. Licence numbers are stored without the leading zeros the FIP exports use. Old `.xls` files must be re-saved as `.xlsx` first.

**Reports data model**: a `reports` row holds a few indexed/searchable columns (match number, teams, referees, votes, status `draft`/`final`) plus the full form content as a `payload_json` blob. Each report evaluates two referees; export produces two PDFs named `numGara_Cognome.pdf`, stored under `output/<season>/report-<id>/` and tracked in `exports`.

**Report types**: `reports.report_type` is `full` or `video` and is fixed at creation (`shared/reportTemplate.js` holds `VIDEO_JUDGMENT_OPTIONS` and `createEmptyVideoReport`). A *rapporto a video* stores only the identifying fields, one judgement and optional `feedback.first` / `feedback.second` per referee; old shared `notes` are retained for staff only, plus a single PDF/XLSX attachment ([src/services/reportAttachmentService.js](src/services/reportAttachmentService.js), columns `attachment_*`). It counts as a visionatura everywhere reports are counted, but has no vote, no PDF export and no email send (both refuse it), and the attachment is never downloadable by role `referee`. Client form: [client/src/pages/ReportVideoFormPage.jsx](client/src/pages/ReportVideoFormPage.jsx), reached with `#/reports/new?type=video` and `#/reports/:id/edit?type=video`.

**Date period filter**: `shared/gamePeriod.js` defines the date-range rule (`isGameInPeriod`, presets, labels) used by the games list, the designation page and every XLSX export, so a sheet always contains exactly the rows the user was looking at. The games list defaults to "da oggi" so it opens on the current matchday.

**Auth, roles & capabilities**: cookie-based sessions; the token is hashed and stored server-side in the `sessions` table. `attachUser` sets `req.user` on every request. Personal activation/recovery links and optional Google through Supabase PKCE map to the same `users.id`; email and Google are optional, passwords stay local. See [docs/AUTHENTICATION.md](docs/AUTHENTICATION.md) for the mapping, configuration and security model. `src/database/auth.sql` is an idempotent startup migration; application tables have RLS and revoked Data API grants. Use a PostgreSQL owner/BYPASSRLS connection for Express. Never test against the production database or put invitation tokens/credentials in logs.

A user has **several roles** (`user_roles` table; `users.role` is kept as the primary role for display and legacy code) and **permissions add up**. Never compare `user.role` directly: [shared/permissions.js](shared/permissions.js) is the single table of who-can-do-what — `can(user, 'games:manage', { competition, season })`, `hasRole(user, 'admin')`, `rolesOf(user)` (which falls back to the legacy single field). A capability is granted either `global` or `scoped` (only on the instructor's competitions for that season), so combining roles never widens the instructor's perimeter. Roles: `admin`, `operator` (background work: sources, imports, competitions, games — never writes reports), `instructor` (scoped), `observer`, `referee` — `referee` is **exclusive** and restrictive (it hides votes and Potenzialità), so it never combines. Legacy values (`formatter`, `user`) are normalized on read.

Guards in [src/middleware/auth.js](src/middleware/auth.js): prefer `requireCapability('x')` / `requireAnyCapability(...)`; `requireAuth`, `requireAdmin`, `requireAdminOrInstructor`, `requireReferee`, `requireReportAuthors` remain for the admin-only areas. SQL that selects users by role must go through `hasAnyRoleSql()` / `lacksAllRolesSql()` in [src/database/userRoles.js](src/database/userRoles.js), which also covers rows not yet in `user_roles`.

**Report audit log**: every action on a report (created, updated, finalized, imported from federation PDF, attachment added/removed, PDF exported, email sent, deleted) is written to `report_events` by [src/services/reportEventService.js](src/services/reportEventService.js) and shown in the admin-only "Rapporti" tab of Log. The table has no FK to `reports` and copies the identifying data as text on purpose: the deletion event must survive the report. Logging never fails the action it records.

**Referee-facing privacy rules**: users with role `referee` only see their own reports. From the v2 structure they also see their **fascia and vote** in the report detail (the federal form makes both visible to the referee); on v1 reports the vote stays hidden, because back then it was not meant for them. List rows never carry votes for a referee. "Potenzialità" is never visible to the referee and must never appear in exported PDFs (enforced in `pdfService`).

**Client routing**: no react-router. Custom hash-based routing in [client/src/lib/navigation.js](client/src/lib/navigation.js) (`parseRoute`/`navigate`), dispatched in a plain conditional chain in [client/src/App.jsx](client/src/App.jsx). New pages need a route in both files. All API calls go through the fetch wrapper in [client/src/lib/api.js](client/src/lib/api.js).

**Observer unavailabilities**: date e periodi vivono in `observer_unavailabilities` e non sono associati a una stagione. Accesso e validazione sono centralizzati in [src/services/observerAvailabilityService.js](src/services/observerAvailabilityService.js): admin e formatori gestiscono qualsiasi osservatore, mentre osservatori e formatori gestiscono anche il proprio profilo. Ogni assegnazione manuale passa comunque dal controllo server in `setOfficial()`; il client usa gli stessi intervalli per disabilitare e marcare `INDISPONIBILE` nei selettori e nei suggerimenti.

**Product and design standards**: [PRODUCT.md](PRODUCT.md) definisce utenti, tono e principi di prodotto; [DESIGN.md](DESIGN.md) documenta token, componenti, responsive e accessibilità. Le modifiche frontend devono leggerli e riusare i token/componenti di `client/src/styles.css`.

**AI feature (optional)**: gated by `ENABLE_AI_FEATURES=true` + `ANTHROPIC_API_KEY` in `.env`. When off, `/api/ai/*` routes are not mounted and the client hides the helper (the flag reaches the client via `/api/me` → `features.aiEnabled`). [src/services/anthropicService.js](src/services/anthropicService.js) calls the Anthropic Messages API directly with `fetch` (no SDK); prompts are built in [src/services/judgmentPromptBuilder.js](src/services/judgmentPromptBuilder.js), which takes a `target` (`global` on v1 reports, `strengths` or `improvements` on v2) and serializes the sections of the payload's own template version. Model and API version are set in `src/config.js`.

## Deployment notes

- Render deploys `main` using `render.yaml`; the single Express process serves both API and SPA.
- Keep `COOKIE_SECURE=true` on Render HTTPS.
- The public `/api/health` endpoint also queries PostgreSQL and is pinged every 5 minutes by an external monitor.
- `ENABLE_SCHEDULED_SYNC=true` runs the daily FIP synchronization inside the web process; execution state is persisted in `scheduled_jobs`.
- Never run tests against `DATABASE_URL`: `TEST_DATABASE_URL` is mandatory, must be separate, and is truncated by the suite.
