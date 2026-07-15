import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import { federationReportText } from './fixtures/federationReportText.js';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fischiolab-pdf-import-'));
process.env.STORAGE_DIR = tempDir;

const { setupTestDatabase, closeTestDatabase, insertId, dbAll, dbGet, dbRun } = await import('./helpers/testDatabase.js');
const {
  applyFederationPdfImport,
  previewFederationPdfImport
} = await import('../src/services/federationPdfImportService.js');

await setupTestDatabase();

function pdfBuffer(text) {
  return new Promise((resolve) => {
    const document = new PDFDocument();
    const chunks = [];
    document.on('data', (chunk) => chunks.push(chunk));
    document.on('end', () => resolve(Buffer.concat(chunks)));
    document.fontSize(7).text(text);
    document.end();
  });
}

async function pdfFile(name, options) {
  return {
    originalname: name,
    mimetype: 'application/pdf',
    buffer: await pdfBuffer(federationReportText(options))
  };
}

const adminId = await insertId(
  "INSERT INTO users (username, password_hash, display_name, role) VALUES ('admin-pdf', 'x', 'Admin PDF', 'admin')"
);
const observerId = await insertId(
  "INSERT INTO users (username, password_hash, display_name, role) VALUES ('verdi', 'x', 'Verdi Luca', 'observer')"
);
const firstRefereeId = await insertId(
  "INSERT INTO referees (first_name, last_name, category) VALUES ('Mario', 'Rossi', 'DR1')"
);
const secondRefereeId = await insertId(
  "INSERT INTO referees (first_name, last_name, category) VALUES ('Anna', 'Bianchi', 'DR1')"
);
const game341 = await insertId(
  `INSERT INTO games (
     sport_season, external_source, match_number, competition, scheduled_at,
     team_home, team_away, status, score_home, score_away
   ) VALUES ('2025/2026', 'manual', '341', 'DR1', '2025-11-17T20:30',
     'SQUADRA CASA', 'SQUADRA OSPITE', 'played', '76', '65')`
);
const game342 = await insertId(
  `INSERT INTO games (
     sport_season, external_source, match_number, competition, scheduled_at,
     team_home, team_away, status, score_home, score_away
   ) VALUES ('2025/2026', 'manual', '342', 'DR1', '2025-11-19T20:30',
     'SQUADRA CASA', 'SQUADRA OSPITE', 'played', '76', '65')`
);
const admin = { id: adminId, role: 'admin', displayName: 'Admin PDF' };

test.after(async () => {
  await closeTestDatabase();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function decisionFor(group, overrides = {}) {
  return {
    groupKey: group.groupKey,
    fileHashes: group.files.map((file) => file.hash),
    gameId: group.automaticGameId,
    reportId: group.automaticReportId,
    firstRefereeId: group.people.first.refereeId,
    secondRefereeId: group.people.second.refereeId,
    observerUserId: group.people.observer.userId,
    sharedSourceRole: group.presentRoles.includes('first') ? 'first' : group.presentRoles[0],
    replaceExisting: Boolean(group.automaticReportId),
    ...overrides
  };
}

test('anteprima e import completo creano un rapporto definitivo e aggiornano gli ufficiali', async () => {
  const files = [
    await pdfFile('nome-casuale-a.pdf', { target: 'ROSSI MARIO', vote: '68' }),
    await pdfFile('altro-nome.pdf', { target: 'BIANCHI ANNA', vote: '66', potential: 'Media' })
  ];
  const { groups, fileErrors } = await previewFederationPdfImport({ files, user: admin });
  assert.equal(fileErrors.length, 0);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].automaticGameId, game341);
  assert.equal(groups[0].ready, true, JSON.stringify({
    duplicateRoles: groups[0].duplicateRoles,
    sharedDifferences: groups[0].sharedDifferences,
    people: groups[0].people,
    reportCandidates: groups[0].reportCandidates
  }));
  assert.equal(groups[0].files.find((file) => file.role === 'first').originalName, 'nome-casuale-a.pdf');

  const result = await applyFederationPdfImport({ files, decisions: [decisionFor(groups[0])], user: admin });
  assert.equal(result.status, 'success');
  assert.equal(result.created, 1);
  assert.equal(result.results[0].status, 'final');

  const report = await dbGet('SELECT * FROM reports WHERE id = ?', [result.results[0].reportId]);
  assert.equal(report.game_id, game341);
  assert.equal(report.observer_id, observerId);
  assert.equal(report.first_referee_id, firstRefereeId);
  assert.equal(report.second_referee_id, secondRefereeId);
  assert.equal(report.first_referee_vote, '68');
  assert.equal(report.second_referee_vote, '66');
  const payload = JSON.parse(report.payload_json);
  assert.equal(payload.evaluations.second.potential.level, 'Media');

  const officials = await dbAll('SELECT * FROM game_officials WHERE game_id = ? ORDER BY role', [game341]);
  assert.deepEqual(officials.map((row) => row.role), ['observer', 'referee1', 'referee2']);
  assert.ok(officials.every((row) => row.source === 'federation_pdf' && row.manual_lock === 1));
  assert.equal((await dbGet("SELECT COUNT(*) AS count FROM person_aliases WHERE source = 'federation_pdf'")).count, 3);
});

test('un solo PDF crea una bozza mantenendo il ruolo mancante vuoto', async () => {
  const files = [await pdfFile('qualsiasi.pdf', {
    target: 'ROSSI MARIO',
    matchNumber: '342',
    matchDate: '19/11/2025',
    evaluationDate: '20/11/2025'
  })];
  const preview = await previewFederationPdfImport({ files, user: admin });
  assert.equal(preview.groups[0].automaticGameId, game342);
  const result = await applyFederationPdfImport({ files, decisions: [decisionFor(preview.groups[0])], user: admin });
  assert.equal(result.results[0].status, 'draft');
  const report = await dbGet('SELECT payload_json FROM reports WHERE id = ?', [result.results[0].reportId]);
  assert.equal(JSON.parse(report.payload_json).evaluations.second.vote, '');
});

test('la sostituzione parziale preserva l’altro arbitro e azzera solo il relativo invio', async () => {
  const existing = await dbGet("SELECT * FROM reports WHERE game_id = ? AND status = 'final'", [game341]);
  await dbRun(
    "UPDATE reports SET first_referee_sent_at = '2026-01-01', second_referee_sent_at = '2026-01-02' WHERE id = ?",
    [existing.id]
  );
  const files = [await pdfFile('sostituzione.pdf', { target: 'ROSSI MARIO', vote: '69', potential: 'Bassa' })];
  const preview = await previewFederationPdfImport({ files, user: admin, contextGameId: game341, contextReportId: existing.id });
  const group = preview.groups[0];
  assert.equal(group.automaticReportId, existing.id);
  const result = await applyFederationPdfImport({
    files,
    decisions: [decisionFor(group, { reportId: existing.id, replaceExisting: true })],
    user: admin
  });
  assert.equal(result.updated, 1);
  const updated = await dbGet('SELECT * FROM reports WHERE id = ?', [existing.id]);
  assert.equal(updated.status, 'final');
  assert.equal(updated.first_referee_vote, '69');
  assert.equal(updated.second_referee_vote, '66');
  assert.equal(updated.first_referee_sent_at, null);
  assert.equal(updated.second_referee_sent_at, '2026-01-02');
});

test('un formatore non può importare PDF fuori dai campionati assegnati', async () => {
  const files = [await pdfFile('fuori-scope.pdf', { target: 'ROSSI MARIO' })];
  await assert.rejects(
    () => previewFederationPdfImport({
      files,
      user: { id: 999, role: 'instructor', instructorCompetitions: ['Serie C'] }
    }),
    (error) => error.statusCode === 403
  );
});
