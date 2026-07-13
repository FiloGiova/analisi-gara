import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fischiolab-scope-'));
process.env.STORAGE_DIR = tempDir;

const { setupTestDatabase, closeTestDatabase, insertId, dbRun } = await import('./helpers/testDatabase.js');
const { createGame, listGames, assertGameCompetitionAccess } = await import('../src/services/gameService.js');
const { buildGamesWorkbook } = await import('../src/services/gamesExportService.js');
const { getCoverage } = await import('../src/services/statsService.js');

await setupTestDatabase();

const SEASON = '2025/2026';
const adminId = await insertId(
  "INSERT INTO users (username, password_hash, display_name, role) VALUES ('admin', 'x', 'Admin', 'admin')"
);
const admin = { id: adminId, role: 'admin' };

const gameDr1 = await createGame({
  data: { sportSeason: SEASON, matchNumber: '000100', competition: 'DR1', teamHome: 'A', teamAway: 'B' },
  user: admin,
  source: 'manual'
});
const gameC = await createGame({
  data: { sportSeason: SEASON, matchNumber: '000200', competition: 'Serie C', teamHome: 'C', teamAway: 'D' },
  user: admin,
  source: 'manual'
});
const regularSeasonSourceId = await insertId(
  `INSERT INTO competition_sources (sport_season, name, url, competition)
   VALUES (?, 'Fase regolare', 'https://example.test/regolare', 'DR1')`,
  [SEASON]
);
await dbRun('UPDATE games SET competition_source_id = ? WHERE id = ?', [regularSeasonSourceId, gameDr1.id]);

const refDr1 = await insertId('INSERT INTO referees (first_name, last_name) VALUES (?, ?)', ['Aldo', 'Dierre']);
const refC = await insertId('INSERT INTO referees (first_name, last_name) VALUES (?, ?)', ['Bea', 'Cielle']);
await dbRun('INSERT INTO referee_season_categories (referee_id, sport_season, category, active) VALUES (?, ?, ?, 1)', [refDr1, SEASON, 'DR1']);
await dbRun('INSERT INTO referee_season_categories (referee_id, sport_season, category, active) VALUES (?, ?, ?, 1)', [refC, SEASON, 'Serie C']);

test.after(async () => {
  await closeTestDatabase();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('listGames filtra per campionato/i (scoping formatore)', async () => {
  const dr1 = (await listGames({ season: SEASON, competitions: ['DR1'] })).map((game) => game.matchNumber);
  assert.deepEqual(dr1.sort(), ['000100']);
  const all = (await listGames({ season: SEASON, competitions: [] })).map((game) => game.matchNumber);
  assert.deepEqual(all.sort(), ['000100', '000200']);
  const both = (await listGames({ season: SEASON, competitions: ['DR1', 'Serie C'] })).map((game) => game.matchNumber);
  assert.deepEqual(both.sort(), ['000100', '000200']);
});

test('assertGameCompetitionAccess: consente nel campionato, blocca fuori, no-op per admin', async () => {
  await assert.doesNotReject(() => assertGameCompetitionAccess(gameDr1.id, ['DR1']));
  await assert.rejects(() => assertGameCompetitionAccess(gameDr1.id, ['Serie C']), /fuori dai campionati/);
  await assert.doesNotReject(() => assertGameCompetitionAccess(gameC.id, []));
});

test('l’export gare replica filtri e scoping della vista', async () => {
  const workbook = await buildGamesWorkbook({
    season: SEASON,
    competitions: ['DR1'],
    sourceNames: ['Fase regolare'],
    stateFilters: ['arbitri_mancanti'],
    search: 'A'
  });
  const sheet = workbook.getWorksheet('Gare');
  assert.deepEqual(sheet.getRow(5).values.slice(1), [
    'N. gara',
    'Giornata',
    'Data',
    'Fase',
    'Incontro',
    '1° arbitro',
    '2° arbitro',
    'Osservatore',
    'Stato'
  ]);
  assert.equal(sheet.getCell('A6').text, '100', 'il numero gara è esportato senza zeri iniziali');
  assert.equal(sheet.getCell('D6').text, 'Fase regolare');
  assert.equal(sheet.getCell('E6').text, 'A - B');
  assert.equal(sheet.getCell('I6').text, 'Solo calendario');
  assert.equal(sheet.getCell('A7').text, '', 'nessuna gara fuori dai filtri viene esportata');
  assert.ok((await workbook.xlsx.writeBuffer()).byteLength > 1000);
});

test('getCoverage per campionato mostra solo gli arbitri attivi di quella categoria', async () => {
  const names = (await getCoverage({ season: SEASON, competitions: ['DR1'] })).referees.map((referee) => referee.fullName);
  assert.ok(names.includes('Dierre Aldo'));
  assert.ok(!names.includes('Cielle Bea'));

  await dbRun('UPDATE referees SET active = 0 WHERE id = ?', [refDr1]);
  const afterDisable = (await getCoverage({ season: SEASON, competitions: ['DR1'] })).referees;
  assert.ok(!afterDisable.some((referee) => referee.refereeId === refDr1), 'un arbitro disattivato non compare');
});
