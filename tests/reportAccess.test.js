import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'analisigara-access-'));
process.env.STORAGE_DIR = tempDir;
process.env.DATABASE_PATH = path.join(tempDir, 'test.sqlite');

const { initializeDatabase, getDb, closeDatabase } = await import('../src/database/connection.js');
const { listReports, getReport } = await import('../src/services/reportService.js');
const { createGame, setOfficial, listPendingAssignmentsForUser } = await import('../src/services/gameService.js');

initializeDatabase();
const db = getDb();

const SEASON = '2025/2026';
const mkUser = (username, role, formatterCompetition = null) =>
  db
    .prepare('INSERT INTO users (username, password_hash, display_name, role, formatter_competition) VALUES (?, ?, ?, ?, ?)')
    .run(username, 'x', username, role, formatterCompetition).lastInsertRowid;

const adminId = mkUser('admin', 'admin');
const obs1 = mkUser('obs1', 'observer');
const obs2 = mkUser('obs2', 'observer');
const instrId = mkUser('instr', 'instructor', 'DR1');
const U = (id, role, formatter_competition = null) => ({ id, role, formatter_competition });

// Gara DR1 con obs1 designato come osservatore, senza rapporto.
const game = createGame({
  data: { sportSeason: SEASON, matchNumber: '000900', competition: 'DR1', teamHome: 'A', teamAway: 'B', scheduledAt: '2026-01-10T18:00' },
  user: U(adminId, 'admin'),
  source: 'manual'
});
setOfficial(game.id, { role: 'observer', userId: obs1 }, { user: U(adminId, 'admin') });

test.after(() => {
  closeDatabase();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

const idsFor = (user) => listReports({ season: SEASON, user }).map((r) => r.id);

// I test di modulo girano in ordine sequenziale: la coda va verificata PRIMA di
// creare il rapporto, che viene quindi inserito nel test successivo.
let reportId = null;

test('coda "da compilare": solo le gare designate all\'utente e senza rapporto', () => {
  assert.ok(listPendingAssignmentsForUser(obs1, SEASON).some((x) => x.gameId === game.id), 'obs1 vede la sua gara designata');
  assert.ok(!listPendingAssignmentsForUser(obs2, SEASON).some((x) => x.gameId === game.id), 'obs2 non è designato: non la vede');
});

test('visibilità rapporti per ruolo (osservatore vede anche i rapporti creati per suo conto)', () => {
  // Rapporto DEFINITIVO creato dall'admin PER CONTO di obs1 (created_by=admin, observer_id=obs1).
  reportId = db
    .prepare(
      `INSERT INTO reports (status, observer_name, report_date, match_number, competition, team_home, team_away, sport_season, payload_json, created_by, game_id, observer_id, finalized_at)
       VALUES ('final', 'obs1', '2026-01-10', '000900', 'DR1', 'A', 'B', ?, '{}', ?, ?, ?, CURRENT_TIMESTAMP)`
    )
    .run(SEASON, adminId, game.id, obs1).lastInsertRowid;

  assert.ok(idsFor(U(obs1, 'observer')).includes(reportId), 'obs1 vede il rapporto di cui è osservatore designato');
  assert.ok(!idsFor(U(obs2, 'observer')).includes(reportId), 'obs2 non designato non lo vede');
  assert.ok(idsFor(U(instrId, 'instructor', 'DR1')).includes(reportId), 'il formatore vede i rapporti del suo campionato');
  assert.ok(idsFor(U(adminId, 'admin')).includes(reportId), 'admin vede tutto');
});

test('accesso al singolo rapporto: designazione o campionato, altrimenti 403', () => {
  assert.doesNotThrow(() => getReport(reportId, U(obs1, 'observer')), 'obs1 designato può aprirlo (e quindi modificarlo)');
  assert.throws(() => getReport(reportId, U(obs2, 'observer')), /Non puoi accedere/, 'obs2 non designato: 403');
  assert.doesNotThrow(() => getReport(reportId, U(instrId, 'instructor', 'DR1')), 'formatore del campionato può aprirlo');
});

test('la coda esclude la gara una volta che ha un rapporto, e listReports espone observerId', () => {
  assert.ok(!listPendingAssignmentsForUser(obs1, SEASON).some((x) => x.gameId === game.id), 'gara con rapporto fuori dalla coda');
  const row = listReports({ season: SEASON, user: U(obs1, 'observer') }).find((r) => r.id === reportId);
  assert.equal(row?.observerId, obs1, 'observerId esposto per il canManage lato UI');
});
