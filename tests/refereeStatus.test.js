import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'analisigara-status-'));
process.env.STORAGE_DIR = tempDir;

const { setupTestDatabase, closeTestDatabase, dbGet } = await import('./helpers/testDatabase.js');
const { createReferee, updateReferee, listReferees, getReferee } = await import('../src/services/refereeService.js');
const { buildRefereesWorkbook, filterRefereesForExport } = await import('../src/services/refereesExportService.js');
const { currentSportSeason } = await import('../shared/reportTemplate.js');

await setupTestDatabase();
const SEASON = currentSportSeason();

test.after(async () => {
  await closeTestDatabase();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('un arbitro nasce attivo e lo stato è esposto per la stagione', async () => {
  const created = await createReferee({
    firstName: 'Anna',
    lastName: 'Attiva',
    category: 'DR1',
    sportSeason: SEASON
  });
  assert.equal(created.status, 'attivo');
  assert.equal(created.seasonStatus, 'attivo');
  assert.equal(created.active, true);
});

test('aspettativa e dimissioni tolgono l’arbitro dagli attivi mantenendo lo stato', async () => {
  const referee = await createReferee({
    firstName: 'Bruno',
    lastName: 'Pausa',
    category: 'DR1',
    sportSeason: SEASON
  });

  const paused = await updateReferee(referee.id, { status: 'aspettativa', sportSeason: SEASON });
  assert.equal(paused.status, 'aspettativa');
  assert.equal(paused.active, false, 'chi è in aspettativa non è designabile');

  // Il flag booleano resta la copia su cui poggiano le query storiche.
  const row = await dbGet('SELECT active, status FROM referee_season_categories WHERE referee_id = ? AND sport_season = ?', [
    referee.id,
    SEASON
  ]);
  assert.equal(row.status, 'aspettativa');
  assert.equal(Number(row.active), 0);

  const resigned = await updateReferee(referee.id, { status: 'dimissioni', sportSeason: SEASON });
  assert.equal(resigned.status, 'dimissioni');
  assert.equal(resigned.active, false);

  const back = await updateReferee(referee.id, { status: 'attivo', sportSeason: SEASON });
  assert.equal(back.status, 'attivo');
  assert.equal(back.active, true);

  const onlyActive = await listReferees({ season: SEASON, activeOnly: true });
  assert.ok(onlyActive.some((item) => item.id === referee.id));
});

test('uno stato sconosciuto viene rifiutato', async () => {
  const referee = await createReferee({ firstName: 'Carla', lastName: 'Errata', sportSeason: SEASON });
  await assert.rejects(
    () => updateReferee(referee.id, { status: 'sospeso', sportSeason: SEASON }),
    /Stato arbitro non valido/
  );
  await assert.rejects(
    () => createReferee({ firstName: 'Dino', lastName: 'Errato', status: 'boh', sportSeason: SEASON }),
    /Stato arbitro non valido/
  );
});

test('il vecchio booleano active continua a essere accettato', async () => {
  const referee = await createReferee({ firstName: 'Elsa', lastName: 'Legacy', category: 'DR1', sportSeason: SEASON });
  const off = await updateReferee(referee.id, { active: false, sportSeason: SEASON });
  assert.equal(off.status, 'dimissioni');
  assert.equal(off.active, false);

  const on = await updateReferee(referee.id, { active: true, sportSeason: SEASON });
  assert.equal(on.status, 'attivo');
});

test('modificare un altro campo non azzera lo stato della stagione', async () => {
  const referee = await createReferee({ firstName: 'Furio', lastName: 'Fermo', category: 'DR1', sportSeason: SEASON });
  await updateReferee(referee.id, { status: 'aspettativa', sportSeason: SEASON });
  const renamed = await updateReferee(referee.id, { phone: '3330000000', sportSeason: SEASON });
  assert.equal(renamed.status, 'aspettativa');
  assert.equal(renamed.phone, '3330000000');
});

test('l’export filtra per stato e ne stampa l’etichetta', async () => {
  const active = await getReferee(
    (await createReferee({ firstName: 'Gina', lastName: 'Giusta', category: 'DR1', sportSeason: SEASON })).id,
    { season: SEASON }
  );
  const paused = await createReferee({ firstName: 'Ivo', lastName: 'Inattivo', category: 'DR1', sportSeason: SEASON });
  await updateReferee(paused.id, { status: 'aspettativa', sportSeason: SEASON });

  const referees = await listReferees({ season: SEASON, competitions: ['DR1'] });
  const onlyPaused = filterRefereesForExport(referees, new Map(), { season: SEASON, statusFilter: 'aspettativa' });
  assert.ok(onlyPaused.every((item) => item.status === 'aspettativa'));
  assert.ok(onlyPaused.some((item) => item.id === paused.id));
  assert.ok(!onlyPaused.some((item) => item.id === active.id));

  const workbook = await buildRefereesWorkbook({ season: SEASON, competitions: ['DR1'], statusFilter: 'aspettativa' });
  const sheet = workbook.getWorksheet('Anagrafica arbitri');
  const labels = [];
  sheet.eachRow((row) => labels.push(row.values.map((value) => String(value ?? ''))));
  assert.ok(labels.some((row) => row.includes('Aspettativa')), 'lo stato compare come etichetta nel foglio');
});
