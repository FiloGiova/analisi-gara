import dotenv from 'dotenv';

dotenv.config();

const productionUrl = String(process.env.DATABASE_URL || '').trim();
const testUrl = String(process.env.TEST_DATABASE_URL || '').trim();

if (!testUrl) {
  throw new Error(
    'TEST_DATABASE_URL non configurato. I test con dati richiedono un database PostgreSQL separato.'
  );
}

if (productionUrl && productionUrl === testUrl) {
  throw new Error('TEST_DATABASE_URL coincide con DATABASE_URL: reset del database di produzione bloccato.');
}

let databaseName = '';
try {
  databaseName = decodeURIComponent(new URL(testUrl).pathname.replace(/^\//, ''));
} catch {
  throw new Error('TEST_DATABASE_URL non è un URL PostgreSQL valido.');
}

if (!/test/i.test(databaseName) && process.env.ALLOW_TEST_DATABASE_RESET !== 'true') {
  throw new Error(
    `Il database "${databaseName || '(senza nome)'}" non sembra di test. ` +
      'Usa un database col nome contenente "test" oppure imposta esplicitamente ALLOW_TEST_DATABASE_RESET=true.'
  );
}

process.env.DATABASE_URL = testUrl;
process.env.DATABASE_SSL = process.env.TEST_DATABASE_SSL || 'false';
process.env.SUPABASE_URL = '';
process.env.SUPABASE_SERVICE_KEY = '';

const { initializeDatabase, closeDatabase } = await import('../../src/database/connection.js');
const { dbAll, dbGet, dbRun } = await import('../../src/database/db.js');

const DATA_TABLES = [
  'access_logs',
  'exports',
  'game_changes',
  'sync_runs',
  'scheduled_jobs',
  'person_aliases',
  'game_officials',
  'reports',
  'games',
  'competition_sources',
  'referee_bands',
  'referee_rosters',
  'referee_season_categories',
  'sessions',
  'instructor_competition_assignments',
  'users',
  'referees'
];

export async function setupTestDatabase() {
  await initializeDatabase();
  await dbRun(`TRUNCATE TABLE ${DATA_TABLES.join(', ')} RESTART IDENTITY CASCADE`);
}

export async function insertId(sql, params = []) {
  const result = await dbRun(`${sql} RETURNING id`, params);
  return result.rows[0].id;
}

export { dbAll, dbGet, dbRun };

export async function closeTestDatabase() {
  await closeDatabase();
}
