import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fischiolab-stats-'));
process.env.STORAGE_DIR = tempDir;

const { setupTestDatabase, closeTestDatabase, insertId } = await import('./helpers/testDatabase.js');
const { getCoverage, getMatrix, getMatrixDetail, getObserverSuggestions, getEmployment } = await import('../src/services/statsService.js');
const { buildStatsWorkbook } = await import('../src/services/statsExportService.js');
const { createGame, setOfficial } = await import('../src/services/gameService.js');

await setupTestDatabase();

const SEASON = '2025/2026';
const addReferee = (first, last) => insertId('INSERT INTO referees (first_name, last_name) VALUES (?, ?)', [first, last]);
const addUser = (username, name) => insertId(
  "INSERT INTO users (username, password_hash, display_name, role) VALUES (?, 'x', ?, 'observer')",
  [username, name]
);
const addReport = ({ status, date, observerId, observerName, ref1, ref2, gameId = null }) => insertId(
  `INSERT INTO reports (status, observer_name, report_date, sport_season, first_referee_id, second_referee_id, observer_id, game_id, payload_json, match_number)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}', '000000')`,
  [status, observerName, date, SEASON, ref1, ref2, observerId, gameId]
);

const refA = await addReferee('Aldo', 'Alfa');
const refB = await addReferee('Bruno', 'Beta');
const refC = await addReferee('Carlo', 'Gamma');
const obs1 = await addUser('obs1', 'Primo Osservatore');
const obs2 = await addUser('obs2', 'Secondo Osservatore');
const obs3 = await addUser('obs3', 'Terzo Osservatore');

const g2 = await createGame({
  data: { sportSeason: SEASON, matchNumber: '000202', matchday: 2, teamHome: 'X', teamAway: 'Y', scheduledAt: '2026-01-10T21:00' },
  source: 'manual'
});
await setOfficial(g2.id, { role: 'referee1', refereeId: refA, externalName: 'Alfa Aldo', source: 'manual' }, {});
await setOfficial(g2.id, { role: 'referee2', refereeId: refB, externalName: 'Beta Bruno', source: 'manual' }, {});
await setOfficial(g2.id, { role: 'observer', userId: obs1, source: 'manual' }, {});

await addReport({ status: 'final', date: '2025-10-05', observerId: obs1, observerName: 'Primo Osservatore', ref1: refA, ref2: refB });
await addReport({ status: 'final', date: '2025-11-02', observerId: obs2, observerName: 'Secondo Osservatore', ref1: refA, ref2: refC });
await addReport({ status: 'draft', date: '2025-11-20', observerId: obs3, observerName: 'Terzo Osservatore', ref1: refA, ref2: refB });

test.after(async () => {
  await closeTestDatabase();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('la copertura conta i definitivi, esclude le bozze e distingue i programmati', async () => {
  const { referees } = await getCoverage({ season: SEASON });
  const alfa = referees.find((referee) => referee.refereeId === refA);
  assert.equal(alfa.completedCount, 2);
  assert.equal(alfa.distinctObservers, 2);
  assert.equal(alfa.scheduledCount, 1);
  assert.equal(alfa.lastCompletedDate, '2025-11-02');

  const beta = referees.find((referee) => referee.refereeId === refB);
  assert.equal(beta.completedCount, 1);
  assert.equal(beta.scheduledCount, 1);
});

test('la matrice è calcolata e le celle riflettono completati e programmati', async () => {
  const { observers, cells } = await getMatrix({ season: SEASON });
  assert.ok(observers.length >= 2);
  const find = (observerId, refereeId) => cells.find(
    (cell) => cell.observerKey === `u${observerId}` && cell.refereeId === refereeId
  );
  assert.equal(find(obs1, refA).completed, 1);
  assert.equal(find(obs1, refA).scheduled, 1);
  assert.equal(find(obs2, refC).completed, 1);
  assert.equal(find(obs3, refA), undefined);
});

test('il dettaglio cella elenca gare e rapporti', async () => {
  const detail = await getMatrixDetail({ season: SEASON, observerKey: `u${obs1}`, refereeId: refA });
  assert.equal(detail.completed.length, 1);
  assert.equal(detail.scheduled.length, 1);
  assert.equal(detail.scheduled[0].matchNumber, '000202');
});

test('suggerimenti in diversificazione: chi non ha mai visto i due arbitri è in cima', async () => {
  const suggestions = await getObserverSuggestions({ gameId: g2.id, mode: 'diversify' });
  const byId = Object.fromEntries(suggestions.map((suggestion) => [suggestion.userId, suggestion]));
  assert.ok(byId[obs3].score > byId[obs2].score);
  assert.ok(byId[obs2].score > byId[obs1].score);
  assert.equal(byId[obs1].seenRef1 >= 1 && byId[obs1].seenRef2 >= 1, true);
  assert.ok(byId[obs3].reasons.join(' ').includes('mai visto'));
});

test("l'impiego conta le gare dirette dalle designazioni ed esclude le annullate", async () => {
  const cancelled = await createGame({
    data: { sportSeason: SEASON, matchNumber: '000299', matchday: 3, teamHome: 'Q', teamAway: 'Z', scheduledAt: '2026-02-01T18:00', status: 'cancelled' },
    source: 'manual'
  });
  await setOfficial(cancelled.id, { role: 'referee1', refereeId: refA, externalName: 'Alfa Aldo', source: 'manual' }, {});

  const { referees, matchdays } = await getEmployment({ season: SEASON });
  const alfa = referees.find((referee) => referee.refereeId === refA);
  assert.equal(alfa.totalGames, 1);
  assert.equal(alfa.asReferee1, 1);
  assert.equal(alfa.lastDate, '2026-01-10');
  assert.equal(alfa.timeline['2'][0].matchNumber, '000202');
  assert.ok(matchdays.includes(2));
  assert.ok(!matchdays.includes(3));
  assert.equal(referees.find((referee) => referee.refereeId === refB).asReferee2, 1);
});

test('l’export XLSX replica vista, ricerca e ordinamento delle statistiche', async () => {
  const workbook = await buildStatsWorkbook({
    view: 'employment',
    season: SEASON,
    search: 'Alfa',
    sortKey: 'games',
    sortDirection: 'desc'
  });
  const sheet = workbook.getWorksheet('Impiego arbitri');
  assert.deepEqual(sheet.getRow(5).values.slice(1), ['Arbitro', 'Gare', 'Ultima', 'G2']);
  assert.equal(sheet.getCell('A6').text, 'Alfa Aldo');
  assert.equal(sheet.getCell('B6').value, 1);
  assert.match(sheet.getCell('D6').text, /X - Y \(1°\)/);
  assert.equal(sheet.getCell('A7').text, '', 'la ricerca esclude gli altri arbitri');

  const buffer = await workbook.xlsx.writeBuffer();
  assert.ok(buffer.byteLength > 1000, 'il file XLSX è stato serializzato');
});

test('un impegno lo stesso giorno penalizza pesantemente il candidato', async () => {
  const g3 = await createGame({
    data: { sportSeason: SEASON, matchNumber: '000203', matchday: 2, teamHome: 'K', teamAway: 'W', scheduledAt: '2026-01-10T18:00' },
    source: 'manual'
  });
  await setOfficial(g3.id, { role: 'referee1', refereeId: refC, externalName: 'Gamma Carlo', source: 'manual' }, {});
  await setOfficial(g3.id, { role: 'observer', userId: obs3, source: 'manual' }, {});

  const suggestions = await getObserverSuggestions({ gameId: g2.id, mode: 'diversify' });
  const byId = Object.fromEntries(suggestions.map((suggestion) => [suggestion.userId, suggestion]));
  assert.equal(byId[obs3].sameDayCount, 1);
  assert.ok(byId[obs3].score < byId[obs2].score);
  assert.ok(byId[obs3].reasons.join(' ').includes('stesso giorno'));
});
