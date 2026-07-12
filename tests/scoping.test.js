import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'analisigara-scope-'));
process.env.STORAGE_DIR = tempDir;
process.env.DATABASE_PATH = path.join(tempDir, 'test.sqlite');

const { initializeDatabase, getDb, closeDatabase } = await import('../src/database/connection.js');
const { createGame, listGames, assertGameCompetitionAccess } = await import('../src/services/gameService.js');
const { getCoverage } = await import('../src/services/statsService.js');

initializeDatabase();
const db = getDb();
const SEASON = '2025/2026';
const adminId = db
  .prepare("INSERT INTO users (username, password_hash, display_name, role) VALUES ('admin', 'x', 'Admin', 'admin')")
  .run().lastInsertRowid;
const admin = { id: adminId, role: 'admin' };

const gameDr1 = createGame({ data: { sportSeason: SEASON, matchNumber: '000100', competition: 'DR1', teamHome: 'A', teamAway: 'B' }, user: admin, source: 'manual' });
const gameC = createGame({ data: { sportSeason: SEASON, matchNumber: '000200', competition: 'Serie C', teamHome: 'C', teamAway: 'D' }, user: admin, source: 'manual' });

// Arbitri con categoria di stagione in campionati diversi (per la copertura "a zero").
const refDr1 = db.prepare('INSERT INTO referees (first_name, last_name) VALUES (?, ?)').run('Aldo', 'Dierre').lastInsertRowid;
const refC = db.prepare('INSERT INTO referees (first_name, last_name) VALUES (?, ?)').run('Bea', 'Cielle').lastInsertRowid;
db.prepare('INSERT INTO referee_season_categories (referee_id, sport_season, category, active) VALUES (?, ?, ?, 1)').run(refDr1, SEASON, 'DR1');
db.prepare('INSERT INTO referee_season_categories (referee_id, sport_season, category, active) VALUES (?, ?, ?, 1)').run(refC, SEASON, 'Serie C');

test.after(() => {
  closeDatabase();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('listGames filtra per campionato/i (scoping formatore)', () => {
  const dr1 = listGames({ season: SEASON, competitions: ['DR1'] }).map((g) => g.matchNumber);
  assert.deepEqual(dr1.sort(), ['000100'], 'solo la gara DR1');
  const all = listGames({ season: SEASON, competitions: [] }).map((g) => g.matchNumber);
  assert.deepEqual(all.sort(), ['000100', '000200'], 'nessuna restrizione = tutte');
  const both = listGames({ season: SEASON, competitions: ['DR1', 'Serie C'] }).map((g) => g.matchNumber);
  assert.deepEqual(both.sort(), ['000100', '000200'], 'più campionati = unione');
});

test('assertGameCompetitionAccess: consente nel campionato, blocca fuori, no-op per admin', () => {
  assert.doesNotThrow(() => assertGameCompetitionAccess(gameDr1.id, ['DR1']), 'DR1 nel perimetro');
  assert.throws(() => assertGameCompetitionAccess(gameDr1.id, ['Serie C']), /fuori dai campionati/, 'DR1 fuori dal perimetro Serie C');
  assert.doesNotThrow(() => assertGameCompetitionAccess(gameC.id, []), 'lista vuota = admin, nessuna restrizione');
});

test('getCoverage per campionato mostra solo gli arbitri di quella categoria di stagione', () => {
  const names = getCoverage({ season: SEASON, competitions: ['DR1'] }).referees.map((r) => r.fullName);
  assert.ok(names.includes('Dierre Aldo'), 'arbitro categoria DR1 presente');
  assert.ok(!names.includes('Cielle Bea'), 'arbitro categoria Serie C assente');
});
