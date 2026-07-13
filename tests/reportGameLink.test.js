import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fischiolab-report-game-'));
process.env.STORAGE_DIR = tempDir;

const { setupTestDatabase, closeTestDatabase, insertId, dbGet, dbRun } = await import('./helpers/testDatabase.js');
const { initializeDatabase } = await import('../src/database/connection.js');
const { createReport } = await import('../src/services/reportService.js');
const { createGame, getGame } = await import('../src/services/gameService.js');

await setupTestDatabase();

const observerUserId = await insertId(
  "INSERT INTO users (username, password_hash, display_name, role) VALUES ('oss', 'x', 'Osservatore Test', 'observer')"
);
const otherUserId = await insertId(
  "INSERT INTO users (username, password_hash, display_name, role) VALUES ('admin', 'x', 'Amministratore', 'admin')"
);
const observerUser = { id: observerUserId, role: 'observer', displayName: 'Osservatore Test', username: 'oss' };

const game = await createGame({
  data: {
    sportSeason: '2025/2026',
    matchNumber: '000311',
    teamHome: 'CASA A',
    teamAway: 'OSPITE A',
    scheduledAt: '2025-12-17T21:15'
  },
  user: null,
  source: 'manual'
});

test.after(async () => {
  await closeTestDatabase();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('un rapporto creato dalla gara resta collegato e valorizza observer_id', async () => {
  const report = await createReport({
    payload: { gameId: game.id, reportDate: '2025-12-17', matchNumber: '000311' },
    status: 'draft',
    user: observerUser
  });

  assert.equal(report.gameId, game.id);
  assert.equal(report.observerId, observerUser.id);
  assert.equal(report.observerName, 'Osservatore Test');

  const linked = await getGame(game.id);
  assert.equal(linked.reportId, report.id);
  assert.equal(linked.derivedState, 'rapporto_bozza');
});

test('un secondo rapporto per la stessa gara richiede conferma esplicita', async () => {
  await assert.rejects(
    () => createReport({ payload: { gameId: game.id, reportDate: '2025-12-17' }, status: 'draft', user: observerUser }),
    (error) => error.statusCode === 409 && error.details?.requiresConfirmation === true
  );

  const confirmed = await createReport({
    payload: { gameId: game.id, reportDate: '2025-12-17' },
    status: 'draft',
    user: observerUser,
    allowDuplicate: true
  });
  assert.ok(confirmed.id);
  await dbRun('DELETE FROM reports WHERE id = ?', [confirmed.id]);
});

test('i rapporti senza gara continuano a funzionare come prima', async () => {
  const report = await createReport({
    payload: { reportDate: '2025-11-02', matchNumber: '999999' },
    status: 'draft',
    user: observerUser
  });
  assert.equal(report.gameId, null);
  assert.equal(report.sportSeason, '2025/2026');
});

test('il backfill valorizza observer_id solo quando il nome coincide con il creatore', async () => {
  const certain = await insertId(
    `INSERT INTO reports (status, observer_name, report_date, payload_json, created_by)
     VALUES ('final', 'Osservatore Test', '2024-10-05', '{}', ?)`,
    [observerUserId]
  );
  const uncertain = await insertId(
    `INSERT INTO reports (status, observer_name, report_date, payload_json, created_by)
     VALUES ('final', 'Persona Esterna', '2024-10-05', '{}', ?)`,
    [otherUserId]
  );

  await initializeDatabase();

  assert.equal((await dbGet('SELECT observer_id FROM reports WHERE id = ?', [certain])).observer_id, observerUserId);
  assert.equal((await dbGet('SELECT observer_id FROM reports WHERE id = ?', [uncertain])).observer_id, null);
});
