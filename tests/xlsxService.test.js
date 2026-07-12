import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'analisigara-test-'));
process.env.STORAGE_DIR = tempDir;
process.env.DATABASE_PATH = path.join(tempDir, 'test.sqlite');

const { initializeDatabase, getDb, closeDatabase } = await import('../src/database/connection.js');
const {
  buildDesignationsTemplate,
  parseDesignationsWorkbook,
  previewDesignationsImport,
  applyDesignationsImport,
  normalizeMatchNumber
} = await import('../src/services/xlsxService.js');
const { createGame, setOfficial, getGame } = await import('../src/services/gameService.js');

initializeDatabase();

const SEASON = '2025/2026';
const db = getDb();

const rigonId = db.prepare('INSERT INTO referees (first_name, last_name) VALUES (?, ?)').run('Andrea', 'Rigon').lastInsertRowid;
db.prepare('INSERT INTO referees (first_name, last_name) VALUES (?, ?)').run('Giorgio', 'Molinari');
const tononId = db
  .prepare("INSERT INTO users (username, password_hash, display_name, role) VALUES ('tonon', 'x', 'Marco Tonon', 'observer')")
  .run().lastInsertRowid;

const game1 = createGame({
  data: { sportSeason: SEASON, matchNumber: '000311', matchday: 1, teamHome: 'CASA A', teamAway: 'OSPITE A', scheduledAt: '2025-12-17T21:15' },
  source: 'manual'
});
const game2 = createGame({
  data: { sportSeason: SEASON, matchNumber: '000308', matchday: 2, teamHome: 'CASA B', teamAway: 'OSPITE B', scheduledAt: '2025-12-20T18:00' },
  source: 'manual'
});

test.after(() => {
  closeDatabase();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('normalizeMatchNumber ripristina gli zeri iniziali persi da Excel', () => {
  assert.equal(normalizeMatchNumber(311), '000311');
  assert.equal(normalizeMatchNumber('311'), '000311');
  assert.equal(normalizeMatchNumber('000311'), '000311');
  assert.equal(normalizeMatchNumber(''), '');
});

test('il template ha un foglio per giornata e conserva i numeri gara come testo', async () => {
  const workbook = buildDesignationsTemplate(SEASON);
  const names = workbook.worksheets.map((s) => s.name);
  assert.deepEqual(names, ['Istruzioni', 'Giornata 1', 'Giornata 2']);

  const sheet = workbook.getWorksheet('Giornata 1');
  assert.equal(sheet.getRow(1).getCell(1).text, 'Numero gara');
  assert.equal(sheet.getRow(2).getCell(1).text, '000311');
  assert.equal(sheet.getRow(2).getCell(4).text, 'CASA A');

  // Round-trip: il template stesso è importabile (celle arbitri vuote → nessuna modifica).
  const buffer = await workbook.xlsx.writeBuffer();
  const rows = await parseDesignationsWorkbook(buffer);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.matchNumber).sort(), ['000308', '000311']);
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
  const { rows: evaluated, summary } = previewDesignationsImport({ sportSeason: SEASON, rows });

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

  assert.equal(getGame(game1.id).officials.referee1, undefined, 'l\'anteprima non scrive nulla');
});

test('applicazione: transazionale, idempotente e con audit', async () => {
  const buffer = await fileWithDesignations([[311, 'Rigon Andrea', 'SCONOSCIUTO PINCO', 'Tonon']]);
  const rows = await parseDesignationsWorkbook(buffer);

  const first = applyDesignationsImport({ sportSeason: SEASON, rows });
  assert.equal(first.applied, 3);
  assert.equal(first.unresolved.length, 1);

  const after = getGame(game1.id);
  assert.equal(after.officials.referee1.refereeId, rigonId);
  assert.equal(after.officials.referee1.source, 'xlsx');
  assert.equal(after.officials.observer.userId, tononId);
  assert.equal(after.derivedState, 'designazione_completa');

  // Ricaricare lo stesso file non produce modifiche né audit aggiuntivo.
  const changesBefore = db.prepare('SELECT COUNT(*) n FROM game_changes').get().n;
  const second = applyDesignationsImport({ sportSeason: SEASON, rows });
  assert.equal(second.applied, 0);
  assert.equal(second.unchanged, 3);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM game_changes').get().n, changesBefore);
});

test('un valore bloccato o manuale non viene sovrascritto dal file', async () => {
  setOfficial(game2.id, { role: 'referee1', refereeId: rigonId, externalName: 'Rigon Andrea', source: 'manual', manualLock: true }, {});

  const buffer = await fileWithDesignations([[308, 'Molinari Giorgio', '', '']]);
  const rows = await parseDesignationsWorkbook(buffer);
  const result = applyDesignationsImport({ sportSeason: SEASON, rows });

  assert.equal(result.status, 'partial');
  assert.equal(result.conflicts.length, 1);
  assert.equal(getGame(game2.id).officials.referee1.refereeId, rigonId, 'il valore bloccato resta invariato');
});
