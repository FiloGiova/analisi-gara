import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fischiolab-competitions-'));
process.env.STORAGE_DIR = tempDir;

const { setupTestDatabase, closeTestDatabase, insertId, dbGet, dbRun } = await import('./helpers/testDatabase.js');
const {
  listCompetitions,
  createCompetition,
  updateCompetition,
  getCompetitionByValue,
  allowedCompetitionValues
} = await import('../src/services/competitionService.js');
const { initializeDatabase } = await import('../src/database/connection.js');
const { createUser } = await import('../src/services/userService.js');
const { createReport } = await import('../src/services/reportService.js');

await setupTestDatabase();

const adminId = await insertId(
  'INSERT INTO users (username, password_hash, display_name, role) VALUES (?, ?, ?, ?)',
  ['admin', 'x', 'admin', 'admin']
);
const admin = { id: adminId, role: 'admin' };

test.after(async () => {
  await closeTestDatabase();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('il seed dei test espone DR1 e Serie C', async () => {
  const values = await allowedCompetitionValues();
  assert.ok(values.has('DR1'));
  assert.ok(values.has('Serie C'));
});

test('crea campionato: valori ripuliti e CC validati', async () => {
  const created = await createCompetition({
    value: ' DR2 ',
    label: 'Divisione Regionale 2',
    ccEmails: ' formatori.dr2@test.it , designatore@test.it ',
    emailSignature: 'Formatori DR2',
    sortOrder: 3
  });
  assert.equal(created.value, 'DR2');
  assert.equal(created.label, 'Divisione Regionale 2');
  assert.equal(created.ccEmails, 'formatori.dr2@test.it, designatore@test.it');
  assert.equal(created.active, true);

  await assert.rejects(() => createCompetition({ value: 'DR3', ccEmails: 'non-una-email' }), /CC non valido/);
  await assert.rejects(() => createCompetition({ value: '' }), /Codice campionato obbligatorio/);
});

test('codice duplicato: 409', async () => {
  await assert.rejects(
    () => createCompetition({ value: 'DR2', label: 'Doppione' }),
    (error) => {
      assert.equal(error.statusCode, 409);
      return true;
    }
  );
});

test('la rinomina cambia solo la label: i rapporti conservano il codice', async () => {
  const reportId = await insertId(
    `INSERT INTO reports (status, observer_name, report_date, match_number, competition, team_home, team_away, sport_season, payload_json, created_by)
     VALUES ('draft', 'oss', '2026-03-01', 'cmp-001', 'DR2', 'A', 'B', '2025/2026', '{}', ?)`,
    [adminId]
  );

  const dr2 = await getCompetitionByValue('DR2');
  const renamed = await updateCompetition(dr2.id, { label: 'Divisione Regionale 2 — nuova' });
  assert.equal(renamed.label, 'Divisione Regionale 2 — nuova');

  const row = await dbGet('SELECT competition FROM reports WHERE id = ?', [reportId]);
  assert.equal(row.competition, 'DR2');

  await assert.rejects(() => updateCompetition(dr2.id, { value: 'DR2X' }), /non è modificabile/);
});

test('disattivazione: sparisce dagli attivi ma resta un codice valido', async () => {
  const dr2 = await getCompetitionByValue('DR2');
  await updateCompetition(dr2.id, { active: false });

  const active = await listCompetitions({ activeOnly: true });
  assert.ok(!active.some((competition) => competition.value === 'DR2'));
  assert.ok((await listCompetitions()).some((competition) => competition.value === 'DR2'));
  assert.ok((await allowedCompetitionValues()).has('DR2'));
});

test('formatore: campionato ignoto rifiutato, disattivato accettato', async () => {
  await assert.rejects(
    () =>
      createUser({
        username: 'instr.x',
        password: 'password1',
        displayName: 'Instr X',
        role: 'instructor',
        instructorAssignments: [{ sportSeason: '2025/2026', competitions: ['Sconosciuto'] }]
      }),
    /Campionato formatore non valido/
  );

  await assert.doesNotReject(() =>
    createUser({
      username: 'instr.y',
      password: 'password1',
      displayName: 'Instr Y',
      role: 'instructor',
      instructorAssignments: [{ sportSeason: '2025/2026', competitions: ['DR2'] }]
    })
  );
});

test('rapporto con campionato fuori catalogo: 400', async () => {
  await assert.rejects(
    () =>
      createReport({
        payload: { reportDate: '2026-03-05', matchNumber: 'cmp-002', competition: 'Fantasma' },
        status: 'draft',
        user: admin
      }),
    /Campionato non valido/
  );
});

test('il seed difensivo registra i valori orfani già presenti nei dati', async () => {
  await dbRun(
    `INSERT INTO reports (status, observer_name, report_date, match_number, competition, team_home, team_away, sport_season, payload_json, created_by)
     VALUES ('draft', 'oss', '2026-03-02', 'cmp-003', 'Coppa Vecchia', 'A', 'B', '2025/2026', '{}', ?)`,
    [adminId]
  );

  await initializeDatabase();

  const legacy = await getCompetitionByValue('Coppa Vecchia');
  assert.ok(legacy, 'il valore orfano viene censito nel catalogo');
  assert.equal(legacy.label, 'Coppa Vecchia');
});
