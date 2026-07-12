// Applica src/database/schema.postgres.sql al database Postgres in DATABASE_URL.
// Idempotente (tutte CREATE ... IF NOT EXISTS). Uso:  node scripts/apply-postgres-schema.js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../src/config.js';
import { getPool, closePool } from '../src/database/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.join(__dirname, '..', 'src', 'database', 'schema.postgres.sql');

async function main() {
  if (!config.databaseUrl) throw new Error('DATABASE_URL non configurato.');
  const pool = getPool();

  const info = await pool.query('SELECT version(), current_database(), current_user');
  console.log('Connesso a:', info.rows[0].current_database, '—', info.rows[0].version.split(' ').slice(0, 2).join(' '));

  const schema = fs.readFileSync(schemaPath, 'utf8');
  await pool.query(schema);
  console.log('Schema applicato.');

  const tables = await pool.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`
  );
  console.log('Tabelle nel database (%d):', tables.rowCount);
  console.log(tables.rows.map((r) => '  - ' + r.table_name).join('\n'));

  await closePool();
}

main().catch(async (err) => {
  console.error('ERRORE:', err.message);
  await closePool();
  process.exit(1);
});
