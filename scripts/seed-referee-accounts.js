/**
 * Crea utenze referee collegate agli arbitri di una stagione.
 *
 * Uso:
 *   node scripts/seed-referee-accounts.js --season 2025/2026 --output-csv storage/seeds/referees-2025-2026.csv --dry-run
 *
 * Il CSV contiene password in chiaro: consegnarlo offline e cancellarlo dopo l'uso.
 */
import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { initializeDatabase, getDb, closeDatabase } from '../src/database/connection.js';
import { currentSportSeason } from '../shared/reportTemplate.js';
import { hashPassword } from '../src/utils/passwords.js';

function argValue(name, fallback = '') {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] || fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function normalizeUsernamePart(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9._-]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 40);
}

function usernameFor(referee) {
  const emailLocal = normalizeUsernamePart(String(referee.email || '').split('@')[0]);
  if (emailLocal.length >= 3) return emailLocal;
  const fallback = normalizeUsernamePart(`${referee.first_name}.${referee.last_name}`);
  return fallback.length >= 3 ? fallback : `referee${referee.id}`;
}

function randomPassword() {
  return crypto.randomBytes(12).toString('base64url').slice(0, 16);
}

function csvCell(value) {
  const text = String(value ?? '');
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function writeCsv(filePath, rows) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const header = ['referee_id', 'full_name', 'email', 'username', 'plain_password'];
  const lines = [
    header.join(','),
    ...rows.map((row) => header.map((key) => csvCell(row[key])).join(','))
  ];
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`, { mode: 0o600 });
}

const season = argValue('--season', currentSportSeason());
const outputCsv = argValue('--output-csv', '');
const dryRun = hasFlag('--dry-run');

if (!outputCsv) {
  console.error('Parametro obbligatorio: --output-csv path.csv');
  process.exit(1);
}

initializeDatabase();
const db = getDb();

const referees = db
  .prepare(
    `SELECT r.id, r.first_name, r.last_name, r.email
       FROM referees r
       JOIN referee_season_categories sc ON sc.referee_id = r.id
      WHERE sc.sport_season = ?
        AND sc.active = 1
        AND r.active = 1
        AND r.email IS NOT NULL
        AND TRIM(r.email) != ''
      ORDER BY r.last_name, r.first_name`
  )
  .all(season);

const existingByReferee = db.prepare("SELECT id FROM users WHERE role = 'referee' AND referee_id = ?");
const existingByUsername = db.prepare('SELECT id FROM users WHERE username = ?');
const insertUser = db.prepare(
  `INSERT INTO users (username, password_hash, display_name, role, referee_id, active)
   VALUES (?, ?, ?, 'referee', ?, 1)`
);

const createdRows = [];
const skipped = [];

const createAccounts = db.transaction((items) => {
  for (const referee of items) {
    const username = usernameFor(referee);
    const fullName = `${referee.first_name} ${referee.last_name}`.trim();
    if (existingByReferee.get(referee.id)) {
      skipped.push({ referee, reason: 'referee_id gia collegato' });
      continue;
    }
    if (existingByUsername.get(username)) {
      skipped.push({ referee, reason: `username gia presente: ${username}` });
      continue;
    }

    const plainPassword = randomPassword();
    if (!dryRun) {
      insertUser.run(username, hashPassword(plainPassword), fullName, referee.id);
    }
    createdRows.push({
      referee_id: referee.id,
      full_name: fullName,
      email: referee.email,
      username,
      plain_password: plainPassword
    });
  }
});

createAccounts(referees);
writeCsv(outputCsv, createdRows);
closeDatabase();

console.log(`${dryRun ? 'Dry-run: ' : ''}utenze referee preparate: ${createdRows.length}`);
console.log(`Arbitri saltati: ${skipped.length}`);
console.log(`CSV scritto: ${outputCsv}`);
for (const item of skipped) {
  console.log(`- ${item.referee.id} ${item.referee.last_name} ${item.referee.first_name}: ${item.reason}`);
}
