import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { getPool, dbAll, dbGet, dbRun, dbTx, closePool } from './db.js';
import { currentSportSeason, deriveSeason } from '../../shared/reportTemplate.js';
import { cleanExternalName } from '../utils/personNames.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const schemaPath = path.join(__dirname, 'schema.postgres.sql');

// Directory locali: servono solo col driver storage 'local' (sviluppo).
// In cloud (Supabase Storage) non c'è filesystem persistente da preparare.
export function ensureStorageDirs() {
  if (config.storageDriver !== 'local') return;
  for (const dir of [
    config.storageDir,
    config.outputDir,
    config.templatesDir,
    config.uploadsDir,
    config.profilePhotosDir
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// Applica lo schema (idempotente: CREATE ... IF NOT EXISTS) ed esegue i backfill
// dei dati. Va chiamata una volta all'avvio del processo.
export async function initializeDatabase() {
  ensureStorageDirs();
  const schema = fs.readFileSync(schemaPath, 'utf8');
  await getPool().query(schema);
  await runBackfills();
}

async function runBackfills() {
  await ensureDefaultSeasonCategories();
  await backfillReportSeasons();
  await backfillReportVotes();
  await backfillReportObservers();
  await backfillOfficialExternalNames();
  await cleanupLegacyExportRows();
  await migrateUserRoles();
}

async function ensureDefaultSeasonCategories() {
  const row = await dbGet('SELECT COUNT(*) AS count FROM referee_season_categories');
  if (Number(row.count) === 0) {
    await dbRun(
      `INSERT INTO referee_season_categories (referee_id, sport_season, category, active)
       SELECT id, ?, category, active
       FROM referees
       WHERE category IS NOT NULL AND category != ''
       ON CONFLICT (referee_id, sport_season) DO NOTHING`,
      [currentSportSeason()]
    );
  }
}

// Normalizza i nominativi esterni già salvati: si conserva solo "Cognome Nome",
// senza la provenienza territoriale aggiunta dal sito FIP ("di TORINO (TO)").
async function backfillOfficialExternalNames() {
  const rows = await dbAll(`SELECT id, external_name FROM game_officials WHERE external_name != ''`);
  const updates = rows
    .map((row) => ({ id: row.id, cleaned: cleanExternalName(row.external_name), original: row.external_name }))
    .filter((row) => row.cleaned !== row.original);
  if (!updates.length) return;
  await dbTx(async (client) => {
    for (const row of updates) {
      await client.run('UPDATE game_officials SET external_name = ? WHERE id = ?', [row.cleaned, row.id]);
    }
  });
}

// Backfill prudente: observer_id = created_by solo quando il nome osservatore
// coincide col display_name del creatore (semantica certa).
async function backfillReportObservers() {
  await dbRun(
    `UPDATE reports
        SET observer_id = created_by
      WHERE observer_id IS NULL
        AND created_by IS NOT NULL
        AND TRIM(observer_name) != ''
        AND LOWER(TRIM(observer_name)) = (
          SELECT LOWER(TRIM(display_name)) FROM users WHERE users.id = reports.created_by
        )`
  );
}

async function cleanupLegacyExportRows() {
  await dbRun(`DELETE FROM exports WHERE file_path LIKE '%/output/report-%'`);
}

async function backfillReportSeasons() {
  const rows = await dbAll(
    "SELECT id, report_date, payload_json FROM reports WHERE sport_season IS NULL OR sport_season = ''"
  );
  if (!rows.length) return;

  await dbTx(async (client) => {
    for (const row of rows) {
      let reportDate = row.report_date;
      if (!reportDate && row.payload_json) {
        try {
          reportDate = JSON.parse(row.payload_json)?.reportDate || '';
        } catch (_) {
          reportDate = '';
        }
      }
      const season = deriveSeason(reportDate);
      if (season) await client.run('UPDATE reports SET sport_season = ? WHERE id = ?', [season, row.id]);
    }
  });
}

function normalizeStoredVote(value) {
  const clean = String(value || '').trim();
  return /^\d{1,2}$/.test(clean) ? clean : '';
}

async function backfillReportVotes() {
  const rows = await dbAll(
    `SELECT id, payload_json, first_referee_vote, second_referee_vote
       FROM reports
      WHERE (first_referee_vote IS NULL OR first_referee_vote = '')
         OR (second_referee_vote IS NULL OR second_referee_vote = '')`
  );
  if (!rows.length) return;

  await dbTx(async (client) => {
    for (const row of rows) {
      let payload;
      try {
        payload = JSON.parse(row.payload_json || '{}');
      } catch (_) {
        payload = {};
      }
      const firstVote = normalizeStoredVote(payload?.evaluations?.first?.vote);
      const secondVote = normalizeStoredVote(payload?.evaluations?.second?.vote);
      if (firstVote || secondVote) {
        await client.run(
          `UPDATE reports
              SET first_referee_vote = CASE WHEN first_referee_vote IS NULL OR first_referee_vote = '' THEN ? ELSE first_referee_vote END,
                  second_referee_vote = CASE WHEN second_referee_vote IS NULL OR second_referee_vote = '' THEN ? ELSE second_referee_vote END
            WHERE id = ?`,
          [firstVote, secondVote, row.id]
        );
      }
    }
  });
}

async function migrateUserRoles() {
  await dbRun(
    `UPDATE users
        SET role = CASE
          WHEN role IN ('formatter', 'formatore') THEN 'instructor'
          WHEN role = 'user' AND formatter_competition IS NOT NULL AND formatter_competition != '' THEN 'instructor'
          WHEN role = 'user' THEN 'observer'
          ELSE role
        END
      WHERE role IN ('user', 'formatter', 'formatore')`
  );
}

export async function closeDatabase() {
  await closePool();
}
