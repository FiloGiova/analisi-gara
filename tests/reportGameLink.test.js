import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'analisigara-test-'));
process.env.STORAGE_DIR = tempDir;
process.env.DATABASE_PATH = path.join(tempDir, 'test.sqlite');

const { initializeDatabase, getDb, closeDatabase } = await import('../src/database/connection.js');
const { createReport } = await import('../src/services/reportService.js');
const { createGame, getGame } = await import('../src/services/gameService.js');

initializeDatabase();

const observerUserId = getDb()
  .prepare("INSERT INTO users (username, password_hash, display_name, role) VALUES ('oss', 'x', 'Osservatore Test', 'observer')")
  .run().lastInsertRowid;
const otherUserId = getDb()
  .prepare("INSERT INTO users (username, password_hash, display_name, role) VALUES ('admin', 'x', 'Amministratore', 'admin')")
  .run().lastInsertRowid;

const observerUser = { id: Number(observerUserId), role: 'observer', displayName: 'Osservatore Test', username: 'oss' };

const game = createGame({
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

test.after(() => {
  closeDatabase();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('un rapporto creato dalla gara resta collegato e valorizza observer_id', () => {
  const report = createReport({
    payload: { gameId: game.id, reportDate: '2025-12-17', matchNumber: '000311' },
    status: 'draft',
    user: observerUser
  });

  assert.equal(report.gameId, game.id);
  assert.equal(report.observerId, observerUser.id, "per un osservatore l'observer_id coincide con l'autore");
  assert.equal(report.observerName, 'Osservatore Test');

  const linked = getGame(game.id);
  assert.equal(linked.reportId, report.id);
  assert.equal(linked.derivedState, 'rapporto_bozza');
});

test('un secondo rapporto per la stessa gara richiede conferma esplicita', () => {
  assert.throws(
    () =>
      createReport({
        payload: { gameId: game.id, reportDate: '2025-12-17' },
        status: 'draft',
        user: observerUser
      }),
    (err) => err.statusCode === 409 && err.details?.requiresConfirmation === true
  );

  const confirmed = createReport({
    payload: { gameId: game.id, reportDate: '2025-12-17' },
    status: 'draft',
    user: observerUser,
    allowDuplicate: true
  });
  assert.ok(confirmed.id, 'con conferma esplicita il duplicato è consentito');
  getDb().prepare('DELETE FROM reports WHERE id = ?').run(confirmed.id);
});

test('i rapporti senza gara continuano a funzionare come prima', () => {
  const report = createReport({
    payload: { reportDate: '2025-11-02', matchNumber: '999999' },
    status: 'draft',
    user: observerUser
  });
  assert.equal(report.gameId, null);
  assert.equal(report.sportSeason, '2025/2026');
});

test('il backfill valorizza observer_id solo quando il nome coincide con il creatore', () => {
  const db = getDb();
  const certain = db
    .prepare(
      `INSERT INTO reports (status, observer_name, report_date, payload_json, created_by)
       VALUES ('final', 'Osservatore Test', '2024-10-05', '{}', ?)`
    )
    .run(observerUserId).lastInsertRowid;
  const uncertain = db
    .prepare(
      `INSERT INTO reports (status, observer_name, report_date, payload_json, created_by)
       VALUES ('final', 'Persona Esterna', '2024-10-05', '{}', ?)`
    )
    .run(otherUserId).lastInsertRowid;

  // Il backfill gira a ogni avvio: rieseguire l'inizializzazione lo applica.
  initializeDatabase();

  assert.equal(
    db.prepare('SELECT observer_id FROM reports WHERE id = ?').get(certain).observer_id,
    Number(observerUserId),
    'nome coincidente con il display_name del creatore: backfill applicato'
  );
  assert.equal(
    db.prepare('SELECT observer_id FROM reports WHERE id = ?').get(uncertain).observer_id,
    null,
    'semantica incerta: nessun backfill'
  );
});
