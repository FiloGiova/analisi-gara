import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fischiolab-report-structure-'));
process.env.STORAGE_DIR = tempDir;

const { setupTestDatabase, closeTestDatabase, insertId, dbGet } = await import('./helpers/testDatabase.js');
const { createReport, updateReport, getReport } = await import('../src/services/reportService.js');
const {
  EVALUATION_SECTIONS,
  EVALUATION_SECTIONS_V1,
  createEmptyReport
} = await import('../shared/reportTemplate.js');

await setupTestDatabase();

const adminId = await insertId(
  "INSERT INTO users (username, password_hash, display_name, role) VALUES ('admin', 'x', 'Amministratore', 'admin')"
);
const observerId = await insertId(
  "INSERT INTO users (username, password_hash, display_name, role) VALUES ('oss', 'x', 'Osservatore Test', 'observer')"
);
const firstRefereeId = await insertId("INSERT INTO referees (first_name, last_name) VALUES ('Mario', 'Rossi')");
const secondRefereeId = await insertId("INSERT INTO referees (first_name, last_name) VALUES ('Luca', 'Bianchi')");
const refereeUserId = await insertId(
  'INSERT INTO users (username, password_hash, display_name, role, referee_id) VALUES (?, ?, ?, ?, ?)',
  ['arb', 'x', 'Mario Rossi', 'referee', firstRefereeId]
);

const admin = { id: adminId, role: 'admin', displayName: 'Amministratore', username: 'admin' };
const referee = { id: refereeUserId, role: 'referee', refereeId: firstRefereeId, displayName: 'Mario Rossi' };

function filled(version = 2) {
  const payload = createEmptyReport(version);
  Object.assign(payload, {
    observerName: 'Osservatore Test',
    observerUserId: observerId,
    reportDate: '2026-10-18',
    matchNumber: '028451',
    competition: 'DR1',
    teamHome: 'CASA',
    teamAway: 'OSPITE',
    scoreHome: '74',
    scoreAway: '71',
    firstRefereeId,
    firstRefereeName: 'Rossi Mario',
    secondRefereeId,
    secondRefereeName: 'Bianchi Luca'
  });
  payload.matchCharacteristics.ratings.difficulty = version === 1 ? 'Normale' : 'Impegnativa';
  payload.matchCharacteristics.comment = 'Gara equilibrata.';

  const sections = version === 1 ? EVALUATION_SECTIONS_V1 : EVALUATION_SECTIONS;
  for (const role of ['first', 'second']) {
    const evaluation = payload.evaluations[role];
    for (const section of sections) {
      for (const group of section.groups) {
        evaluation.sections[section.id].ratings[group.id] = group.options.includes('Standard')
          ? 'Standard'
          : group.options[0];
      }
      if (section.commentLabel) evaluation.sections[section.id].comment = 'Note della sezione.';
    }
    if (version === 1) {
      evaluation.globalJudgement = 'Giudizio globale.';
    } else {
      evaluation.strengths = 'Personalità nei momenti caldi.';
      evaluation.improvements = 'Timing sul gioco senza palla.';
    }
    evaluation.potential = { level: 'Media', comment: 'Nota interna.' };
  }
  return payload;
}

test.after(async () => {
  await closeTestDatabase();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('un rapporto nuovo nasce con la struttura 2026/2027 e la fascia segue il voto', async () => {
  const payload = filled();
  payload.evaluations.first.vote = '8,0';
  payload.evaluations.first.band = 'Di qualità'; // incoerente di proposito: vince il voto
  payload.evaluations.second.band = 'Sopra lo standard'; // senza voto la fascia resta

  const report = await createReport({ payload, status: 'final', user: admin });

  assert.equal(report.data.templateVersion, 2);
  assert.equal(report.data.evaluations.first.vote, '8.0');
  assert.equal(report.data.evaluations.first.band, 'Standard', 'la fascia si deriva dal voto');
  assert.equal(report.data.evaluations.second.vote, '');
  assert.equal(report.data.evaluations.second.band, 'Sopra lo standard');
  assert.equal(report.status, 'final', 'il voto non è obbligatorio per il definitivo');

  const row = await dbGet('SELECT first_referee_vote, second_referee_vote FROM reports WHERE id = ?', [report.id]);
  assert.equal(row.first_referee_vote, '8.0', 'in colonna il voto ha il punto decimale');
  assert.equal(row.second_referee_vote, '');
});

test('un voto fuori griglia viene rifiutato', async () => {
  const payload = filled();
  payload.matchNumber = '028452';
  payload.evaluations.first.vote = '9,0';
  await assert.rejects(
    () => createReport({ payload, status: 'draft', user: admin }),
    (error) => error.statusCode === 400 && /griglia/.test(error.message)
  );
});

test('senza punti di forza e aree di miglioramento il rapporto non diventa definitivo', async () => {
  const payload = filled();
  payload.matchNumber = '028453';
  payload.evaluations.first.strengths = '';
  payload.evaluations.second.improvements = '';
  await assert.rejects(
    () => createReport({ payload, status: 'final', user: admin }),
    (error) => {
      assert.equal(error.statusCode, 422);
      assert.ok(error.details.some((message) => message.includes('Punti di forza da mantenere')));
      assert.ok(error.details.some((message) => message.includes('Aree di miglioramento')));
      return true;
    }
  );
});

test("l'arbitro vede fascia e voto del proprio rapporto, mai la potenzialità né il collega", async () => {
  const payload = filled();
  payload.matchNumber = '028454';
  payload.evaluations.first.vote = '8,6';
  const created = await createReport({ payload, status: 'final', user: admin });

  const seen = await getReport(created.id, referee);
  const mine = seen.data.evaluations.first;
  assert.equal(mine.vote, '8.6');
  assert.equal(mine.band, 'Di qualità');
  assert.deepEqual(mine.potential, { level: '', comment: '' });
  assert.equal(seen.data.evaluations.second, undefined, 'la scheda del collega non arriva al client');
  assert.equal(seen.secondRefereeName, '');
});

test('un rapporto della struttura precedente resta v1 anche dopo una modifica', async () => {
  const payload = filled(1);
  payload.matchNumber = '028455';
  payload.evaluations.first.vote = '68';
  const created = await createReport({ payload, status: 'final', user: admin });
  assert.equal(created.data.templateVersion, 1);
  assert.ok(created.data.evaluations.first.sections.administration, 'conserva le sezioni della v1');
  assert.equal(created.data.evaluations.first.vote, '68');

  // Anche se il client rimandasse la struttura nuova, la versione salvata comanda.
  const tampered = { ...created.data, templateVersion: 2 };
  const updated = await updateReport({ id: created.id, payload: tampered, status: 'final', user: admin });
  assert.equal(updated.data.templateVersion, 1);
  assert.equal(updated.data.evaluations.first.globalJudgement, 'Giudizio globale.');
  assert.ok(updated.data.evaluations.first.sections.mechanics.ratings.responsibilities);

  const seen = await getReport(created.id, referee);
  assert.equal(seen.data.evaluations.first.vote, '', 'sui rapporti vecchi il voto resta riservato');
});
