import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fischiolab-access-'));
process.env.STORAGE_DIR = tempDir;

const { setupTestDatabase, closeTestDatabase, insertId } = await import('./helpers/testDatabase.js');
const { listReports, getReport } = await import('../src/services/reportService.js');
const { createGame, setOfficial, listPendingAssignmentsForUser } = await import('../src/services/gameService.js');

await setupTestDatabase();

const SEASON = '2025/2026';
const mkUser = (username, role, formatterCompetition = null) => insertId(
  'INSERT INTO users (username, password_hash, display_name, role, formatter_competition) VALUES (?, ?, ?, ?, ?)',
  [username, 'x', username, role, formatterCompetition]
);

const adminId = await mkUser('admin', 'admin');
const obs1 = await mkUser('obs1', 'observer');
const obs2 = await mkUser('obs2', 'observer');
const instrId = await mkUser('instr', 'instructor', 'DR1');
const U = (id, role, formatter_competition = null) => ({ id, role, formatter_competition });

const game = await createGame({
  data: { sportSeason: SEASON, matchNumber: '000900', competition: 'DR1', teamHome: 'A', teamAway: 'B', scheduledAt: '2026-01-10T18:00' },
  user: U(adminId, 'admin'),
  source: 'manual'
});
await setOfficial(game.id, { role: 'observer', userId: obs1 }, { user: U(adminId, 'admin') });

test.after(async () => {
  await closeTestDatabase();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

async function idsFor(user) {
  return (await listReports({ season: SEASON, user })).map((report) => report.id);
}

let reportId = null;

test('coda "da compilare": solo le gare designate all\'utente e senza rapporto', async () => {
  assert.ok((await listPendingAssignmentsForUser(obs1, SEASON)).some((item) => item.gameId === game.id));
  assert.ok(!(await listPendingAssignmentsForUser(obs2, SEASON)).some((item) => item.gameId === game.id));
});

test('visibilità rapporti per ruolo (osservatore vede anche i rapporti creati per suo conto)', async () => {
  reportId = await insertId(
    `INSERT INTO reports (status, observer_name, report_date, match_number, competition, team_home, team_away, sport_season, payload_json, created_by, game_id, observer_id, finalized_at)
     VALUES ('final', 'obs1', '2026-01-10', '000900', 'DR1', 'A', 'B', ?, '{}', ?, ?, ?, iso_now())`,
    [SEASON, adminId, game.id, obs1]
  );

  assert.ok((await idsFor(U(obs1, 'observer'))).includes(reportId));
  assert.ok(!(await idsFor(U(obs2, 'observer'))).includes(reportId));
  assert.ok((await idsFor(U(instrId, 'instructor', 'DR1'))).includes(reportId));
  assert.ok((await idsFor(U(adminId, 'admin'))).includes(reportId));
});

test('accesso al singolo rapporto: designazione o campionato, altrimenti 403', async () => {
  await assert.doesNotReject(() => getReport(reportId, U(obs1, 'observer')));
  await assert.rejects(() => getReport(reportId, U(obs2, 'observer')), /Non puoi accedere/);
  await assert.doesNotReject(() => getReport(reportId, U(instrId, 'instructor', 'DR1')));
});

test('la coda esclude la gara una volta che ha un rapporto, e listReports espone observerId', async () => {
  assert.ok(!(await listPendingAssignmentsForUser(obs1, SEASON)).some((item) => item.gameId === game.id));
  const row = (await listReports({ season: SEASON, user: U(obs1, 'observer') })).find((report) => report.id === reportId);
  assert.equal(row?.observerId, obs1);
});
