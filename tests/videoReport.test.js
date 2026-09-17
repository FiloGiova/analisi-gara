import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fischiolab-video-report-'));
process.env.STORAGE_DIR = tempDir;

const { setupTestDatabase, closeTestDatabase, insertId } = await import('./helpers/testDatabase.js');
const { createReport, updateReport, getReport, listReports } = await import('../src/services/reportService.js');
const { getRefereeStats, listReportsForReferee, getRefereeProgress } = await import('../src/services/refereeService.js');
const { saveReportAttachment, deleteReportAttachment } = await import('../src/services/reportAttachmentService.js');
const { buildEmailPlan } = await import('../src/services/emailService.js');

await setupTestDatabase();

const adminId = await insertId(
  "INSERT INTO users (username, password_hash, display_name, role) VALUES ('admin', 'x', 'Amministratore', 'admin')"
);
const observerId = await insertId(
  "INSERT INTO users (username, password_hash, display_name, role) VALUES ('oss', 'x', 'Osservatore Test', 'observer')"
);
const firstRefereeId = await insertId(
  "INSERT INTO referees (first_name, last_name) VALUES ('Mario', 'Rossi')"
);
const secondRefereeId = await insertId(
  "INSERT INTO referees (first_name, last_name) VALUES ('Luca', 'Bianchi')"
);

const admin = { id: adminId, role: 'admin', displayName: 'Amministratore', username: 'admin' };
const observer = { id: observerId, role: 'observer', displayName: 'Osservatore Test', username: 'oss' };

function videoPayload(overrides = {}) {
  return {
    reportType: 'video',
    reportDate: '2026-10-04',
    matchNumber: '001245',
    competition: 'DR1',
    teamHome: 'CASA',
    teamAway: 'OSPITE',
    firstRefereeId,
    firstRefereeName: 'Rossi Mario',
    secondRefereeId,
    secondRefereeName: 'Bianchi Luca',
    observerUserId: observerId,
    observerName: 'Osservatore Test',
    judgements: { first: 'Molto bene', second: 'Malino' },
    notes: 'Visionatura del primo tempo.',
    ...overrides
  };
}

// Un PDF minimo e un XLSX minimo: basta la firma, il servizio riconosce il tipo.
const PDF_BYTES = Buffer.from('%PDF-1.4 test allegato');
const XLSX_BYTES = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00]);

test.after(async () => {
  await closeTestDatabase();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('il rapporto a video si salva senza voti e conserva i giudizi', async () => {
  const report = await createReport({ payload: videoPayload(), status: 'final', user: admin });

  assert.equal(report.reportType, 'video');
  assert.equal(report.status, 'final');
  assert.equal(report.data.judgements.first, 'Molto bene');
  assert.equal(report.data.judgements.second, 'Malino');
  assert.equal(report.data.notes, 'Visionatura del primo tempo.');
  assert.equal(report.data.evaluations, undefined, 'niente sezioni di valutazione');

  const row = await listReports({ user: admin });
  const listed = row.find((item) => item.id === report.id);
  assert.equal(listed.reportType, 'video');
  assert.equal(listed.firstRefereeVote, '', 'nessun voto numerico');
});

test('senza giudizio il rapporto a video non diventa definitivo', async () => {
  await assert.rejects(
    () => createReport({
      payload: videoPayload({ judgements: { first: '', second: '' }, matchNumber: '001246' }),
      status: 'final',
      user: admin
    }),
    (err) => err.statusCode === 422 && err.details.some((detail) => /manca il giudizio/i.test(detail))
  );

  // In bozza invece si salva: si compila in due tempi come gli altri rapporti.
  const draft = await createReport({
    payload: videoPayload({ judgements: { first: '', second: '' }, matchNumber: '001246' }),
    status: 'draft',
    user: admin
  });
  assert.equal(draft.status, 'draft');
  assert.equal(draft.reportType, 'video');
});

test('un giudizio fuori scala viene scartato', async () => {
  const report = await createReport({
    payload: videoPayload({ matchNumber: '001247', judgements: { first: 'Eccezionale', second: 'Bene' } }),
    status: 'draft',
    user: admin
  });
  assert.equal(report.data.judgements.first, '', 'solo i quattro valori previsti');
  assert.equal(report.data.judgements.second, 'Bene');
});

test('il tipo non cambia con una modifica', async () => {
  const report = await createReport({
    payload: videoPayload({ matchNumber: '001248' }),
    status: 'draft',
    user: admin
  });
  const updated = await updateReport({
    id: report.id,
    payload: { ...videoPayload({ matchNumber: '001248' }), reportType: 'full' },
    status: 'draft',
    user: admin
  });
  assert.equal(updated.reportType, 'video', 'un rapporto a video non diventa completo');
});

test('conta come visionatura dell’arbitro, senza voto né media', async () => {
  const stats = await getRefereeStats(firstRefereeId, { season: '2026/2027' });
  assert.ok(stats.reportsCount >= 1, 'il rapporto a video conta tra i rapporti');
  assert.equal(stats.videoReportsCount, stats.reportsCount, 'in questa stagione ci sono solo rapporti a video');
  assert.equal(stats.votesCount, 0, 'nessun voto');
  assert.equal(stats.averageVote, null, 'nessuna media');

  const reports = await listReportsForReferee(firstRefereeId, { season: '2026/2027' });
  const videoReport = reports.find((item) => item.reportType === 'video' && item.matchNumber === '001245');
  assert.ok(videoReport, 'compare nei rapporti ricevuti');
  assert.equal(videoReport.vote, '');
  assert.equal(videoReport.judgement, 'Molto bene', 'al posto del voto resta il giudizio');
});

test('non entra nelle curve dell’andamento ma viene elencato a parte', async () => {
  const progress = await getRefereeProgress(firstRefereeId, { season: '2026/2027' });
  assert.equal(progress.matches.length, 0, 'nessun punto senza valutazioni per sezione');
  assert.equal(progress.videoMatches.length, 1);
  assert.equal(progress.videoMatches[0].judgement, 'Molto bene');
});

test('non produce PDF e non si invia per email', async () => {
  const [report] = (await listReports({ user: admin })).filter((item) => item.matchNumber === '001245');
  await assert.rejects(
    () => buildEmailPlan(report.id, 'first', admin),
    (err) => err.statusCode === 400 && /non si invia per email/.test(err.message)
  );
});

test('allegato: accetta PDF e XLSX, rifiuta il resto e si può sostituire', async () => {
  const report = await createReport({
    payload: videoPayload({ matchNumber: '001249' }),
    status: 'draft',
    user: admin
  });

  const saved = await saveReportAttachment(report.id, { buffer: PDF_BYTES, originalName: 'referto' });
  assert.equal(saved.label, 'PDF');
  assert.equal(saved.name, 'referto.pdf', 'estensione aggiunta se manca');

  const withAttachment = await getReport(report.id, admin);
  assert.equal(withAttachment.attachment.name, 'referto.pdf');
  assert.equal(withAttachment.attachment.size, PDF_BYTES.length);

  const replaced = await saveReportAttachment(report.id, { buffer: XLSX_BYTES, originalName: 'sintesi.xlsx' });
  assert.equal(replaced.label, 'XLSX');

  await assert.rejects(
    () => saveReportAttachment(report.id, { buffer: Buffer.from('non un pdf'), originalName: 'note.txt' }),
    (err) => err.statusCode === 400 && /Formato non riconosciuto/.test(err.message)
  );

  await deleteReportAttachment(report.id);
  const cleaned = await getReport(report.id, admin);
  assert.equal(cleaned.attachment, null);
});

test('l’allegato non si carica su un rapporto completo', async () => {
  const full = await createReport({
    payload: { reportDate: '2026-10-05', matchNumber: '001250', competition: 'DR1' },
    status: 'draft',
    user: admin
  });
  await assert.rejects(
    () => saveReportAttachment(full.id, { buffer: PDF_BYTES, originalName: 'referto.pdf' }),
    (err) => err.statusCode === 400 && /solo sui rapporti a video/.test(err.message)
  );
});

test('l’arbitro vede il proprio giudizio ma non quello del collega', async () => {
  const [listed] = (await listReports({ user: admin })).filter((item) => item.matchNumber === '001245');
  const refereeUser = { id: 999, role: 'referee', refereeId: firstRefereeId, displayName: 'Mario Rossi' };
  const seen = await getReport(listed.id, refereeUser);

  assert.equal(seen.data.judgements.first, 'Molto bene');
  assert.equal(seen.data.judgements.second, undefined, 'il giudizio del collega resta riservato');
  assert.equal(seen.secondRefereeName, '');
});

test('anche l’osservatore designato può compilarlo', async () => {
  const report = await createReport({
    payload: videoPayload({ matchNumber: '001251' }),
    status: 'draft',
    user: observer
  });
  assert.equal(report.observerId, observer.id);
  assert.equal(report.observerName, 'Osservatore Test');
});
