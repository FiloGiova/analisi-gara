import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fischiolab-report-events-'));
process.env.STORAGE_DIR = tempDir;

const { setupTestDatabase, closeTestDatabase, insertId } = await import('./helpers/testDatabase.js');
const { createReport, updateReport, deleteReport } = await import('../src/services/reportService.js');
const { listReportEvents } = await import('../src/services/reportEventService.js');
const { saveReportAttachment } = await import('../src/services/reportAttachmentService.js');

await setupTestDatabase();

const adminId = await insertId(
  "INSERT INTO users (username, password_hash, display_name, role) VALUES ('admin', 'x', 'Amministratore', 'admin')"
);
const observerId = await insertId(
  "INSERT INTO users (username, password_hash, display_name, role) VALUES ('oss', 'x', 'Osservatore Test', 'observer')"
);
const firstRefereeId = await insertId("INSERT INTO referees (first_name, last_name) VALUES ('Mario', 'Rossi')");
const secondRefereeId = await insertId("INSERT INTO referees (first_name, last_name) VALUES ('Luca', 'Bianchi')");
const admin = { id: adminId, role: 'admin', displayName: 'Amministratore', username: 'admin' };

function videoPayload(matchNumber) {
  return {
    reportType: 'video',
    reportDate: '2026-10-04',
    matchNumber,
    competition: 'DR1',
    teamHome: 'CASA',
    teamAway: 'OSPITE',
    firstRefereeId,
    firstRefereeName: 'Rossi Mario',
    secondRefereeId,
    secondRefereeName: 'Bianchi Luca',
    observerUserId: observerId,
    observerName: 'Osservatore Test',
    judgements: { first: 'Bene', second: 'Bene' }
  };
}

async function eventsFor(matchNumber) {
  const { events } = await listReportEvents({ limit: 500 });
  return events.filter((event) => event.matchNumber === matchNumber);
}

test.after(async () => {
  await closeTestDatabase();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('creazione, modifica e passaggio a definitivo finiscono nel log', async () => {
  const report = await createReport({ payload: videoPayload('002001'), status: 'draft', user: admin });
  await updateReport({ id: report.id, payload: videoPayload('002001'), status: 'draft', user: admin });
  await updateReport({ id: report.id, payload: videoPayload('002001'), status: 'final', user: admin });

  const events = await eventsFor('002001');
  assert.deepEqual(events.map((event) => event.event).reverse(), ['created', 'updated', 'finalized']);

  const [finalized] = events;
  assert.equal(finalized.actorName, 'Amministratore', 'il log dice chi ha agito');
  assert.equal(finalized.actorRole, 'admin');
  assert.equal(finalized.teams, 'CASA - OSPITE', 'i dati identificativi sono copiati nella riga');
  assert.equal(finalized.referees, 'Rossi Mario, Bianchi Luca');
  assert.equal(finalized.reportType, 'video');
});

test('l’allegato del rapporto a video lascia traccia con il nome del file', async () => {
  const report = await createReport({ payload: videoPayload('002002'), status: 'draft', user: admin });
  await saveReportAttachment(report.id, { buffer: Buffer.from('%PDF-1.4 referto'), originalName: 'referto.pdf' }, admin);

  const events = await eventsFor('002002');
  const attachment = events.find((event) => event.event === 'attachment_added');
  assert.ok(attachment, 'evento allegato registrato');
  assert.equal(attachment.details, 'referto.pdf');
  assert.equal(attachment.actorUserId, adminId);
});

test('la cancellazione resta nel log anche se il rapporto non esiste più', async () => {
  const report = await createReport({ payload: videoPayload('002003'), status: 'draft', user: admin });
  await deleteReport(report.id, admin);

  const events = await eventsFor('002003');
  const deleted = events.find((event) => event.event === 'deleted');
  assert.ok(deleted, 'la cancellazione è proprio ciò che si vuole poter ricostruire');
  assert.equal(deleted.reportId, report.id, 'l’id resta leggibile anche senza il rapporto');
  assert.equal(deleted.teams, 'CASA - OSPITE');
  assert.equal(deleted.observerName, 'Osservatore Test');
});

test('il log è in ordine cronologico inverso e conta il totale', async () => {
  const { events, total } = await listReportEvents({ limit: 3 });
  assert.equal(events.length, 3, 'la pagina rispetta il limite');
  assert.ok(total > 3, 'il totale conta tutte le righe, non solo la pagina');
  assert.ok(events[0].id > events[1].id, 'prima le azioni più recenti');
});
