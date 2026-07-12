// Migrazione dati dal DB SQLite del NAS al Postgres di Supabase.
//
//   node scripts/migrate-sqlite-to-postgres.js --sqlite /percorso/rapporti.sqlite            # dry-run (solo conteggi)
//   node scripts/migrate-sqlite-to-postgres.js --sqlite /percorso/rapporti.sqlite --commit    # esegue davvero
//
// Preserva gli ID (così i riferimenti restano validi), resetta le sequence,
// carica le foto profilo su Supabase Storage. NON migra:
//   - sessions  → tutti rifanno login al cutover (scelta concordata);
//   - exports   → i PDF si rigenerano on-demand dal payload.
// Richiede DATABASE_URL (+ SUPABASE_* per le foto) nell'ambiente.

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from '../src/config.js';
import { getPool, dbTx, closePool } from '../src/database/db.js';
import { putObject } from '../src/services/storageService.js';

// Ordine FK-safe: le tabelle referenziate prima di chi le referenzia.
const TABLES = [
  'users',
  'referees',
  'reports',
  'referee_rosters',
  'referee_season_categories',
  'referee_bands',
  'access_logs',
  'competition_sources',
  'games',
  'game_officials',
  'person_aliases',
  'sync_runs',
  'game_changes'
];

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const sqlitePath = arg('--sqlite') || config.databasePath;
const commit = process.argv.includes('--commit');

async function postgresColumns(table) {
  const rows = (await getPool().query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`,
    [table]
  )).rows;
  return new Set(rows.map((r) => r.column_name));
}

function quote(id) {
  return `"${id.replace(/"/g, '""')}"`;
}

async function main() {
  if (!config.databaseUrl) throw new Error('DATABASE_URL non configurato.');
  if (!fs.existsSync(sqlitePath)) throw new Error(`SQLite non trovato: ${sqlitePath}`);
  console.log(`Sorgente SQLite : ${sqlitePath}`);
  console.log(`Destinazione    : Postgres (${commit ? 'COMMIT' : 'DRY-RUN'})`);
  console.log('');

  const sqlite = new Database(sqlitePath, { readonly: true });
  const sqliteTables = new Set(
    sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name)
  );

  // Conteggi e (se --commit) copia effettiva in un'unica transazione Postgres.
  const plan = [];
  for (const table of TABLES) {
    if (!sqliteTables.has(table)) {
      plan.push({ table, count: 0, skip: true });
      continue;
    }
    const count = sqlite.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c;
    plan.push({ table, count });
  }
  for (const p of plan) {
    console.log(`  ${p.table.padEnd(28)} ${p.skip ? '(assente nello SQLite)' : p.count + ' righe'}`);
  }

  if (!commit) {
    console.log('\nDry-run: nessuna scrittura. Rilancia con --commit per eseguire.');
    sqlite.close();
    await closePool();
    return;
  }

  await dbTx(async (client) => {
    // Pulizia destinazione (CASCADE svuota anche sessions/exports).
    await client.run(`TRUNCATE ${TABLES.map(quote).join(', ')} RESTART IDENTITY CASCADE`);

    for (const { table, skip } of plan) {
      if (skip) continue;
      const pgCols = await postgresColumns(table);
      const rows = sqlite.prepare(`SELECT * FROM ${table}`).all();
      let inserted = 0;
      for (const row of rows) {
        const cols = Object.keys(row).filter((c) => pgCols.has(c));
        if (!cols.length) continue;
        const placeholders = cols.map(() => '?').join(', ');
        await client.run(
          `INSERT INTO ${quote(table)} (${cols.map(quote).join(', ')}) VALUES (${placeholders})`,
          cols.map((c) => row[c])
        );
        inserted += 1;
      }
      // Riallinea la sequence dell'id al massimo presente.
      await client.run(
        `SELECT setval(pg_get_serial_sequence(?, 'id'), (SELECT COALESCE(MAX(id), 1) FROM ${quote(table)}))`,
        [table]
      );
      console.log(`  copiata ${table}: ${inserted} righe`);
    }
  });

  // Foto profilo → Supabase Storage (best-effort: salta i file mancanti).
  let photos = 0;
  const photoRows = [
    ...sqlite.prepare(`SELECT photo_path FROM users WHERE photo_path IS NOT NULL AND photo_path != ''`).all(),
    ...sqlite.prepare(`SELECT photo_path FROM referees WHERE photo_path IS NOT NULL AND photo_path != ''`).all()
  ];
  for (const { photo_path: filename } of photoRows) {
    const local = path.join(config.profilePhotosDir, filename);
    if (!fs.existsSync(local)) {
      console.warn(`  foto mancante, saltata: ${filename}`);
      continue;
    }
    const ext = filename.split('.').pop().toLowerCase();
    const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
    await putObject(`uploads/profiles/${filename}`, fs.readFileSync(local), mime);
    photos += 1;
  }
  console.log(`  foto caricate su Storage: ${photos}`);

  sqlite.close();
  await closePool();
  console.log('\nMigrazione completata.');
}

main().catch(async (err) => {
  console.error('ERRORE migrazione:', err.message);
  await closePool();
  process.exit(1);
});
