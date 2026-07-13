import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'analisigara-test-'));
process.env.STORAGE_DIR = tempDir;

const { setupTestDatabase, closeTestDatabase, insertId, dbGet, dbRun } = await import('./helpers/testDatabase.js');
const {
  buildDesignationsTemplate,
  parseDesignationsWorkbook,
  previewDesignationsImport,
  applyDesignationsImport,
  normalizeMatchNumber
} = await import('../src/services/xlsxService.js');
const { createGame, setOfficial, getGame } = await import('../src/services/gameService.js');

await setupTestDatabase();

const SEASON = '2025/2026';

const rigonId = await insertId('INSERT INTO referees (first_name, last_name) VALUES (?, ?)', ['Andrea', 'Rigon']);
const molinariId = await insertId('INSERT INTO referees (first_name, last_name) VALUES (?, ?)', ['Giorgio', 'Molinari']);
await dbRun('INSERT INTO referee_season_categories (referee_id, sport_season, category, active) VALUES (?, ?, ?, 1)', [rigonId, SEASON, 'DR1']);
await dbRun('INSERT INTO referee_season_categories (referee_id, sport_season, category, active) VALUES (?, ?, ?, 1)', [molinariId, SEASON, 'DR1']);
const tononId = await insertId(
  "INSERT INTO users (username, password_hash, display_name, role) VALUES ('tonon', 'x', 'Marco Tonon', 'observer')"
);
const regularSeasonSourceId = await insertId(
  `INSERT INTO competition_sources (sport_season, name, url, competition)
   VALUES (?, 'Fase regolare', 'https://example.test/regolare', 'DR1')`,
  [SEASON]
);
const playoffSourceId = await insertId(
  `INSERT INTO competition_sources (sport_season, name, url, competition)
   VALUES (?, 'Playoff', 'https://example.test/playoff', 'DR1')`,
  [SEASON]
);

const game1 = await createGame({
  data: { sportSeason: SEASON, matchNumber: '000311', competition: 'DR1', matchday: 1, teamHome: 'CASA A', teamAway: 'OSPITE A', scheduledAt: '2025-12-17T21:15' },
  source: 'manual',
  competitionSourceId: regularSeasonSourceId
});
const game2 = await createGame({
  data: { sportSeason: SEASON, matchNumber: '000308', competition: 'DR1', matchday: 2, teamHome: 'CASA B', teamAway: 'OSPITE B', scheduledAt: '2025-12-20T18:00' },
  source: 'manual',
  competitionSourceId: playoffSourceId
});

test.after(async () => {
  await closeTestDatabase();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('normalizeMatchNumber ripristina gli zeri iniziali persi da Excel', () => {
  assert.equal(normalizeMatchNumber(311), '000311');
  assert.equal(normalizeMatchNumber('311'), '000311');
  assert.equal(normalizeMatchNumber('000311'), '000311');
  assert.equal(normalizeMatchNumber(''), '');
});

test('il template include campionato e tendine degli arbitri attivi', async () => {
  const workbook = await buildDesignationsTemplate(SEASON);
  const names = workbook.worksheets.map((s) => s.name);
  assert.deepEqual(names, ['Istruzioni', 'Liste arbitri', 'Giornata 1', 'Giornata 2']);
  assert.equal(workbook.getWorksheet('Liste arbitri').state, 'veryHidden');

  const sheet = workbook.getWorksheet('Giornata 1');
  assert.equal(sheet.getRow(1).getCell(1).text, 'Numero gara');
  assert.equal(sheet.getRow(1).getCell(2).text, 'Campionato');
  assert.ok(!sheet.getRow(1).values.includes('Arbitro 3'));
  assert.equal(sheet.getRow(2).getCell(1).text, '000311');
  assert.equal(sheet.getRow(2).getCell(2).text, 'DR1');
  assert.equal(sheet.getRow(2).getCell(5).text, 'CASA A');
  assert.equal(sheet.getCell('H2').dataValidation.type, 'list');
  assert.deepEqual(sheet.getCell('H2').dataValidation.formulae, ['Arbitri_1']);
  assert.equal(sheet.getCell('I2').dataValidation.type, 'list');

  // Round-trip: il template stesso è importabile (celle arbitri vuote → nessuna modifica).
  const buffer = await workbook.xlsx.writeBuffer();
  const reloaded = new ExcelJS.Workbook();
  await reloaded.xlsx.load(buffer);
  assert.equal(reloaded.getWorksheet('Liste arbitri').state, 'veryHidden');
  assert.equal(reloaded.getWorksheet('Giornata 1').getCell('H2').dataValidation.formulae[0], 'Arbitri_1');
  const rows = await parseDesignationsWorkbook(buffer);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.matchNumber).sort(), ['000308', '000311']);
});

test('il template può contenere soltanto le fasi selezionate', async () => {
  const workbook = await buildDesignationsTemplate(SEASON, { phaseIds: [playoffSourceId] });
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), [
    'Istruzioni',
    'Liste arbitri',
    'Giornata 2'
  ]);
  assert.match(workbook.getWorksheet('Istruzioni').getCell('A4').text, /Playoff/);
  assert.equal(workbook.getWorksheet('Giornata 2').getCell('A2').text, '000308');

  const rows = await parseDesignationsWorkbook(await workbook.xlsx.writeBuffer());
  assert.deepEqual(rows.map((row) => row.matchNumber), ['000308']);
});

async function fileWithDesignations(entries) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Giornata 1');
  sheet.addRow(['Numero gara', 'Arbitro 1', 'Arbitro 2', 'Osservatore']);
  for (const entry of entries) sheet.addRow(entry);
  return workbook.xlsx.writeBuffer();
}

test('anteprima: risolve i nomi, individua le gare e non tocca il database', async () => {
  const buffer = await fileWithDesignations([
    [311, 'Rigon Andrea', 'SCONOSCIUTO PINCO', 'Tonon'],
    ['999999', 'Qualcuno', '', '']
  ]);
  const rows = await parseDesignationsWorkbook(buffer);
  const { rows: evaluated, summary } = await previewDesignationsImport({ sportSeason: SEASON, rows });

  assert.equal(summary.totalRows, 2);
  assert.equal(summary.notFound, 1, 'la gara 999999 non esiste');
  assert.equal(summary.toCreate, 3);

  const row = evaluated.find((r) => r.matchNumber === '000311');
  const ref1 = row.items.find((i) => i.role === 'referee1');
  assert.equal(ref1.resolvedId, rigonId, '"Rigon Andrea" risolto in anagrafica');
  const ref2 = row.items.find((i) => i.role === 'referee2');
  assert.equal(ref2.resolvedId, null, 'nome sconosciuto resta da associare');
  const obs = row.items.find((i) => i.role === 'observer');
  assert.equal(obs.resolvedId, tononId, 'il solo cognome "Tonon" trova l\'unico utente compatibile');

  assert.equal((await getGame(game1.id)).officials.referee1, undefined, 'l\'anteprima non scrive nulla');
});

test('applicazione: transazionale, idempotente e con audit', async () => {
  const buffer = await fileWithDesignations([[311, 'Rigon Andrea', 'SCONOSCIUTO PINCO', 'Tonon']]);
  const rows = await parseDesignationsWorkbook(buffer);

  const first = await applyDesignationsImport({ sportSeason: SEASON, rows });
  assert.equal(first.applied, 3);
  assert.equal(first.unresolved.length, 1);

  const after = await getGame(game1.id);
  assert.equal(after.officials.referee1.refereeId, rigonId);
  assert.equal(after.officials.referee1.source, 'xlsx');
  assert.equal(after.officials.observer.userId, tononId);
  assert.equal(after.derivedState, 'designazione_completa');

  // Ricaricare lo stesso file non produce modifiche né audit aggiuntivo.
  const changesBefore = (await dbGet('SELECT COUNT(*) AS n FROM game_changes')).n;
  const second = await applyDesignationsImport({ sportSeason: SEASON, rows });
  assert.equal(second.applied, 0);
  assert.equal(second.unchanged, 3);
  assert.equal((await dbGet('SELECT COUNT(*) AS n FROM game_changes')).n, changesBefore);
});

test('un valore bloccato o manuale non viene sovrascritto dal file', async () => {
  await setOfficial(game2.id, { role: 'referee1', refereeId: rigonId, externalName: 'Rigon Andrea', source: 'manual', manualLock: true }, {});

  const buffer = await fileWithDesignations([[308, 'Molinari Giorgio', '', '']]);
  const rows = await parseDesignationsWorkbook(buffer);
  const result = await applyDesignationsImport({ sportSeason: SEASON, rows });

  assert.equal(result.status, 'partial');
  assert.equal(result.conflicts.length, 1);
  assert.equal((await getGame(game2.id)).officials.referee1.refereeId, rigonId, 'il valore bloccato resta invariato');
});
