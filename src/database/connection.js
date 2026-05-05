import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { currentSportSeason, deriveSeason } from '../../shared/reportTemplate.js';

let db;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const schemaPath = path.join(__dirname, 'schema.sql');

export function ensureStorageDirs() {
  for (const dir of [
    config.storageDir,
    config.dataDir,
    config.outputDir,
    config.templatesDir,
    config.uploadsDir,
    config.profilePhotosDir
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function getDb() {
  if (!db) {
    ensureStorageDirs();
    db = new Database(config.databasePath);
    db.pragma('foreign_keys = ON');
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');
  }
  return db;
}

const MIGRATIONS = [
  'ALTER TABLE users ADD COLUMN formatter_competition TEXT',
  'ALTER TABLE reports ADD COLUMN sport_season TEXT',
  'ALTER TABLE reports ADD COLUMN first_referee_id INTEGER',
  'ALTER TABLE reports ADD COLUMN second_referee_id INTEGER',
  'ALTER TABLE reports ADD COLUMN first_referee_vote TEXT',
  'ALTER TABLE reports ADD COLUMN second_referee_vote TEXT',
  'ALTER TABLE reports ADD COLUMN first_referee_sent_at TEXT',
  'ALTER TABLE reports ADD COLUMN second_referee_sent_at TEXT',
  'ALTER TABLE referees ADD COLUMN license_number TEXT',
  'ALTER TABLE referees ADD COLUMN phone TEXT',
  'ALTER TABLE referees ADD COLUMN province TEXT',
  'ALTER TABLE referees ADD COLUMN certificate_expiry TEXT',
  'ALTER TABLE referees ADD COLUMN notes TEXT',
  'ALTER TABLE users ADD COLUMN photo_path TEXT',
  'ALTER TABLE users ADD COLUMN referee_id INTEGER',
  'ALTER TABLE referees ADD COLUMN photo_path TEXT'
];

const INDEXES = [
  'CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status)',
  'CREATE INDEX IF NOT EXISTS idx_reports_match_number ON reports(match_number)',
  'CREATE INDEX IF NOT EXISTS idx_reports_competition ON reports(competition)',
  'CREATE INDEX IF NOT EXISTS idx_reports_updated_at ON reports(updated_at)',
  'CREATE INDEX IF NOT EXISTS idx_reports_sport_season ON reports(sport_season)',
  'CREATE INDEX IF NOT EXISTS idx_reports_first_referee_id ON reports(first_referee_id)',
  'CREATE INDEX IF NOT EXISTS idx_reports_second_referee_id ON reports(second_referee_id)',
  'CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash)',
  'CREATE INDEX IF NOT EXISTS idx_exports_report_role ON exports(report_id, referee_role)',
  'CREATE INDEX IF NOT EXISTS idx_referee_season_categories_season ON referee_season_categories(sport_season)',
  'CREATE INDEX IF NOT EXISTS idx_access_logs_user_id ON access_logs(user_id)',
  'CREATE INDEX IF NOT EXISTS idx_access_logs_created_at ON access_logs(created_at)',
  'CREATE INDEX IF NOT EXISTS idx_users_referee_id ON users(referee_id)'
];

function runMigrations(database) {
  for (const sql of MIGRATIONS) {
    try {
      database.prepare(sql).run();
    } catch (_) {
      // colonna già presente — ignorato
    }
  }

  const seasonRows = database.prepare('SELECT COUNT(*) AS count FROM referee_season_categories').get();
  if (seasonRows.count === 0) {
    database
      .prepare(
        `INSERT OR IGNORE INTO referee_season_categories (referee_id, sport_season, category, active)
         SELECT id, ?, category, active
         FROM referees
         WHERE category IS NOT NULL AND category != ''`
      )
      .run(currentSportSeason());
  }

  backfillReportSeasons(database);
  backfillReportVotes(database);
  cleanupLegacyExportRows(database);
  migrateUserRoles(database);
}

function cleanupLegacyExportRows(database) {
  database
    .prepare(
      `DELETE FROM exports
        WHERE file_path LIKE '%/output/report-%'
           OR file_path LIKE '%\\output\\report-%'
           OR file_path LIKE 'storage/output/report-%'`
    )
    .run();
}

function backfillReportSeasons(database) {
  const rows = database
    .prepare("SELECT id, report_date, payload_json FROM reports WHERE sport_season IS NULL OR sport_season = ''")
    .all();
  if (!rows.length) return;

  const update = database.prepare('UPDATE reports SET sport_season = ? WHERE id = ?');
  const transaction = database.transaction((items) => {
    for (const row of items) {
      let reportDate = row.report_date;
      if (!reportDate && row.payload_json) {
        try {
          reportDate = JSON.parse(row.payload_json)?.reportDate || '';
        } catch (_) {
          reportDate = '';
        }
      }
      const season = deriveSeason(reportDate);
      if (season) update.run(season, row.id);
    }
  });
  transaction(rows);
}

function normalizeStoredVote(value) {
  const clean = String(value || '').trim();
  return /^\d{1,2}$/.test(clean) ? clean : '';
}

function backfillReportVotes(database) {
  const rows = database
    .prepare(
      `SELECT id, payload_json, first_referee_vote, second_referee_vote
       FROM reports
       WHERE (first_referee_vote IS NULL OR first_referee_vote = '')
          OR (second_referee_vote IS NULL OR second_referee_vote = '')`
    )
    .all();
  if (!rows.length) return;

  const update = database.prepare(
    `UPDATE reports
        SET first_referee_vote = CASE WHEN first_referee_vote IS NULL OR first_referee_vote = '' THEN ? ELSE first_referee_vote END,
            second_referee_vote = CASE WHEN second_referee_vote IS NULL OR second_referee_vote = '' THEN ? ELSE second_referee_vote END
      WHERE id = ?`
  );
  const transaction = database.transaction((items) => {
    for (const row of items) {
      let payload;
      try {
        payload = JSON.parse(row.payload_json || '{}');
      } catch (_) {
        payload = {};
      }
      const firstVote = normalizeStoredVote(payload?.evaluations?.first?.vote);
      const secondVote = normalizeStoredVote(payload?.evaluations?.second?.vote);
      if (firstVote || secondVote) update.run(firstVote, secondVote, row.id);
    }
  });
  transaction(rows);
}

function migrateUserRoles(database) {
  database
    .prepare(
      `UPDATE users
          SET role = CASE
            WHEN role IN ('formatter', 'formatore') THEN 'instructor'
            WHEN role = 'user' AND formatter_competition IS NOT NULL AND formatter_competition != '' THEN 'instructor'
            WHEN role = 'user' THEN 'observer'
            ELSE role
          END
        WHERE role IN ('user', 'formatter', 'formatore')`
    )
    .run();
}

function runIndexes(database) {
  for (const sql of INDEXES) {
    database.prepare(sql).run();
  }
}

export function initializeDatabase() {
  ensureStorageDirs();
  const database = getDb();
  database.exec(fs.readFileSync(schemaPath, 'utf8'));
  runMigrations(database);
  runIndexes(database);
  return database;
}

export function closeDatabase() {
  if (db) {
    db.close();
    db = undefined;
  }
}
