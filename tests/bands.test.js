import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'analisigara-bands-'));
process.env.STORAGE_DIR = tempDir;

const { setupTestDatabase, closeTestDatabase, insertId, dbRun } = await import('./helpers/testDatabase.js');
const { listBandMembers, addBandMember, removeBandMember, getBandRow } = await import('../src/services/refereeService.js');
const { getCoverage } = await import('../src/services/statsService.js');
const { buildRefereesWorkbook } = await import('../src/services/refereesExportService.js');

await setupTestDatabase();
const SEASON = '2025/2026';

const refA = await insertId("INSERT INTO referees (first_name, last_name, license_number) VALUES ('Aldo', 'Alfa', '111')");
const refB = await insertId("INSERT INTO referees (first_name, last_name, license_number) VALUES ('Bea', 'Beta', '222')");
const refC = await insertId("INSERT INTO referees (first_name, last_name, license_number) VALUES ('Carlo', 'Gamma', '333')");
await dbRun("INSERT INTO referee_season_categories (referee_id, sport_season, category, active) VALUES (?, ?, 'DR1', 1)", [refA, SEASON]);
await dbRun("INSERT INTO referee_season_categories (referee_id, sport_season, category, active) VALUES (?, ?, 'DR1', 1)", [refB, SEASON]);
await dbRun("INSERT INTO referee_season_categories (referee_id, sport_season, category, active) VALUES (?, ?, 'DR1', 1)", [refC, SEASON]);

test.after(async () => {
  await closeTestDatabase();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('aggiunta e elenco membri di una fascia (per campionato+stagione)', async () => {
  await addBandMember({ refereeId: refA, competition: 'DR1', sportSeason: SEASON, band: 'playoff' });
  await addBandMember({ refereeId: refB, competition: 'DR1', sportSeason: SEASON, band: 'esordiente' });

  const playoff = await listBandMembers({ competition: 'DR1', season: SEASON, band: 'playoff' });
  assert.equal(playoff.length, 1);
  assert.equal(playoff[0].refereeId, refA);
  assert.equal(playoff[0].licenseNumber, '111');

  const all = await listBandMembers({ competition: 'DR1', season: SEASON });
  assert.equal(all.length, 2, 'entrambe le fasce elencate senza filtro band');
});

test('fascia non valida rifiutata; idempotente su doppio inserimento', async () => {
  await assert.rejects(() => addBandMember({ refereeId: refA, competition: 'DR1', sportSeason: SEASON, band: 'xxx' }), /Fascia non valida/);
  await addBandMember({ refereeId: refA, competition: 'DR1', sportSeason: SEASON, band: 'playoff' });
  assert.equal((await listBandMembers({ competition: 'DR1', season: SEASON, band: 'playoff' })).length, 1, 'nessun duplicato');
});

test('l’export anagrafica replica i filtri e include la colonna Fascia', async () => {
  await addBandMember({ refereeId: refA, competition: 'DR1', sportSeason: SEASON, band: 'playoff' });
  const filteredWorkbook = await buildRefereesWorkbook({
    season: SEASON,
    competitions: ['DR1'],
    band: 'playoff',
    search: 'Alfa'
  });
  const filteredSheet = filteredWorkbook.getWorksheet('Anagrafica arbitri');
  assert.equal(filteredSheet.getCell('A6').text, '111');
  assert.equal(filteredSheet.getCell('B6').text, 'Alfa');
  assert.equal(filteredSheet.getCell('J5').text, 'Fascia');
  assert.equal(filteredSheet.getCell('J6').text, 'Playoff');
  assert.equal(filteredSheet.getCell('A7').text, '', 'gli arbitri fuori dai filtri non vengono esportati');

  const fullWorkbook = await buildRefereesWorkbook({ season: SEASON, competitions: ['DR1'] });
  const fullSheet = fullWorkbook.getWorksheet('Anagrafica arbitri');
  assert.equal(fullSheet.getCell('B8').text, 'Gamma');
  assert.equal(fullSheet.getCell('J8').text, '', 'la fascia resta vuota quando non è assegnata');
  assert.ok((await filteredWorkbook.xlsx.writeBuffer()).byteLength > 1000);
});

test('getCoverage filtra per fascia ed espone il numero tessera', async () => {
  const playoff = await getCoverage({ season: SEASON, competitions: ['DR1'], band: 'playoff' });
  const names = playoff.referees.map((r) => r.fullName);
  assert.ok(names.includes('Alfa Aldo'), 'Alfa (playoff) presente');
  assert.ok(!names.includes('Beta Bea'), 'Beta (solo esordiente) escluso dal playoff');

  const alfa = playoff.referees.find((r) => r.fullName === 'Alfa Aldo');
  assert.equal(alfa.license, '111', 'tessera esposta nelle statistiche per la ricerca');
});

test('rimozione membro fascia', async () => {
  const [member] = await listBandMembers({ competition: 'DR1', season: SEASON, band: 'esordiente' });
  assert.equal((await getBandRow(member.bandId)).competition, 'DR1');
  await removeBandMember(member.bandId);
  assert.equal((await listBandMembers({ competition: 'DR1', season: SEASON, band: 'esordiente' })).length, 0);
});
