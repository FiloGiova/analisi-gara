import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'analisigara-test-'));
process.env.STORAGE_DIR = tempDir;
process.env.DATABASE_PATH = path.join(tempDir, 'test.sqlite');

const { initializeDatabase, getDb, closeDatabase } = await import('../src/database/connection.js');
const { getCoverage, getMatrix, getMatrixDetail, getObserverSuggestions, getEmployment } = await import('../src/services/statsService.js');
const { createGame, setOfficial } = await import('../src/services/gameService.js');

initializeDatabase();

const SEASON = '2025/2026';
const db = getDb();

function addReferee(first, last) {
  return db.prepare('INSERT INTO referees (first_name, last_name) VALUES (?, ?)').run(first, last).lastInsertRowid;
}
function addUser(username, name) {
  return db
    .prepare("INSERT INTO users (username, password_hash, display_name, role) VALUES (?, 'x', ?, 'observer')")
    .run(username, name).lastInsertRowid;
}
function addReport({ status, date, observerId, observerName, ref1, ref2, gameId = null }) {
  return db
    .prepare(
      `INSERT INTO reports (status, observer_name, report_date, sport_season, first_referee_id, second_referee_id, observer_id, game_id, payload_json, match_number)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}', '000000')`
    )
    .run(status, observerName, date, SEASON, ref1, ref2, observerId, gameId).lastInsertRowid;
}

const refA = addReferee('Aldo', 'Alfa');
const refB = addReferee('Bruno', 'Beta');
const refC = addReferee('Carlo', 'Gamma');
const obs1 = addUser('obs1', 'Primo Osservatore');
const obs2 = addUser('obs2', 'Secondo Osservatore');
const obs3 = addUser('obs3', 'Terzo Osservatore');

// Gara futura con osservatore assegnato: visionamenti PROGRAMMATI su A e B.
const g2 = createGame({ data: { sportSeason: SEASON, matchNumber: '000202', matchday: 2, teamHome: 'X', teamAway: 'Y', scheduledAt: '2026-01-10T21:00' }, source: 'manual' });
setOfficial(g2.id, { role: 'referee1', refereeId: refA, externalName: 'Alfa Aldo', source: 'manual' }, {});
setOfficial(g2.id, { role: 'referee2', refereeId: refB, externalName: 'Beta Bruno', source: 'manual' }, {});
setOfficial(g2.id, { role: 'observer', userId: obs1, source: 'manual' }, {});

// Rapporto DEFINITIVO di obs1 su A+B (visionamenti completati).
addReport({ status: 'final', date: '2025-10-05', observerId: obs1, observerName: 'Primo Osservatore', ref1: refA, ref2: refB });
// Rapporto storico definitivo di obs2 su A+C, senza gara collegata.
addReport({ status: 'final', date: '2025-11-02', observerId: obs2, observerName: 'Secondo Osservatore', ref1: refA, ref2: refC });
// Bozza: NON deve contare come completato.
addReport({ status: 'draft', date: '2025-11-20', observerId: obs3, observerName: 'Terzo Osservatore', ref1: refA, ref2: refB });

test.after(() => {
  closeDatabase();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('la copertura conta i definitivi, esclude le bozze e distingue i programmati', () => {
  const { referees } = getCoverage({ season: SEASON });
  const alfa = referees.find((r) => r.refereeId === refA);
  assert.equal(alfa.completedCount, 2, 'due rapporti definitivi su Alfa');
  assert.equal(alfa.distinctObservers, 2);
  assert.equal(alfa.scheduledCount, 1, 'la gara futura è un programmato');
  assert.equal(alfa.lastCompletedDate, '2025-11-02');

  const beta = referees.find((r) => r.refereeId === refB);
  assert.equal(beta.completedCount, 1, 'la bozza di obs3 non conta');
  assert.equal(beta.scheduledCount, 1);
});

test('la matrice è calcolata e le celle riflettono completati e programmati', () => {
  const { observers, cells } = getMatrix({ season: SEASON });
  assert.ok(observers.length >= 2);

  const find = (obsId, refId) => cells.find((c) => c.observerKey === `u${obsId}` && c.refereeId === refId);
  assert.equal(find(obs1, refA).completed, 1);
  assert.equal(find(obs1, refA).scheduled, 1);
  assert.equal(find(obs2, refC).completed, 1);
  assert.equal(find(obs3, refA), undefined, 'le bozze non generano celle');
});

test('il dettaglio cella elenca gare e rapporti', () => {
  const detail = getMatrixDetail({ season: SEASON, observerKey: `u${obs1}`, refereeId: refA });
  assert.equal(detail.completed.length, 1);
  assert.equal(detail.scheduled.length, 1);
  assert.equal(detail.scheduled[0].matchNumber, '000202');
});

test('suggerimenti in diversificazione: chi non ha mai visto i due arbitri è in cima', () => {
  const suggestions = getObserverSuggestions({ gameId: g2.id, mode: 'diversify' });
  const byId = Object.fromEntries(suggestions.map((s) => [s.userId, s]));

  // obs3 non ha mai visto A né B (la bozza non conta) → primo.
  // obs2 ha visto solo A → secondo. obs1 li ha già visti entrambi → ultimo.
  assert.ok(byId[obs3].score > byId[obs2].score, 'mai visto batte visto-uno');
  assert.ok(byId[obs2].score > byId[obs1].score, 'visto-uno batte incrocio ripetuto');
  assert.equal(byId[obs1].seenRef1 >= 1 && byId[obs1].seenRef2 >= 1, true);
  assert.ok(byId[obs3].reasons.join(' ').includes('mai visto'), 'la motivazione è spiegata');
});

test("l'impiego conta le gare dirette dalle designazioni ed esclude le annullate", () => {
  // Gara annullata: non deve contare nell'impiego di Alfa.
  const cancelled = createGame({ data: { sportSeason: SEASON, matchNumber: '000299', matchday: 3, teamHome: 'Q', teamAway: 'Z', scheduledAt: '2026-02-01T18:00', status: 'cancelled' }, source: 'manual' });
  setOfficial(cancelled.id, { role: 'referee1', refereeId: refA, externalName: 'Alfa Aldo', source: 'manual' }, {});

  const { referees, matchdays } = getEmployment({ season: SEASON });
  const alfa = referees.find((r) => r.refereeId === refA);
  assert.equal(alfa.totalGames, 1, 'solo la gara g2: i rapporti storici senza gara e le annullate non contano');
  assert.equal(alfa.asReferee1, 1);
  assert.equal(alfa.lastDate, '2026-01-10');
  assert.equal(alfa.timeline['2'][0].matchNumber, '000202');
  assert.ok(matchdays.includes(2));
  assert.ok(!matchdays.includes(3), 'la giornata con la sola gara annullata non compare');

  const beta = referees.find((r) => r.refereeId === refB);
  assert.equal(beta.asReferee2, 1);
});

test('un impegno lo stesso giorno penalizza pesantemente il candidato', () => {
  // obs3 viene designato in un'altra gara lo stesso giorno di g2.
  const g3 = createGame({ data: { sportSeason: SEASON, matchNumber: '000203', matchday: 2, teamHome: 'K', teamAway: 'W', scheduledAt: '2026-01-10T18:00' }, source: 'manual' });
  setOfficial(g3.id, { role: 'referee1', refereeId: refC, externalName: 'Gamma Carlo', source: 'manual' }, {});
  setOfficial(g3.id, { role: 'observer', userId: obs3, source: 'manual' }, {});

  const suggestions = getObserverSuggestions({ gameId: g2.id, mode: 'diversify' });
  const byId = Object.fromEntries(suggestions.map((s) => [s.userId, s]));
  assert.equal(byId[obs3].sameDayCount, 1);
  assert.ok(byId[obs3].score < byId[obs2].score, 'la doppia assegnazione lo fa scendere');
  assert.ok(byId[obs3].reasons.join(' ').includes('stesso giorno'));
});
