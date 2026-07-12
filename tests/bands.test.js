import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'analisigara-bands-'));
process.env.STORAGE_DIR = tempDir;
process.env.DATABASE_PATH = path.join(tempDir, 'test.sqlite');

const { initializeDatabase, getDb, closeDatabase } = await import('../src/database/connection.js');
const { listBandMembers, addBandMember, removeBandMember, getBandRow } = await import('../src/services/refereeService.js');
const { getCoverage } = await import('../src/services/statsService.js');

initializeDatabase();
const db = getDb();
const SEASON = '2025/2026';

const refA = db.prepare("INSERT INTO referees (first_name, last_name, license_number) VALUES ('Aldo', 'Alfa', '111')").run().lastInsertRowid;
const refB = db.prepare("INSERT INTO referees (first_name, last_name, license_number) VALUES ('Bea', 'Beta', '222')").run().lastInsertRowid;
db.prepare("INSERT INTO referee_season_categories (referee_id, sport_season, category, active) VALUES (?, ?, 'DR1', 1)").run(refA, SEASON);
db.prepare("INSERT INTO referee_season_categories (referee_id, sport_season, category, active) VALUES (?, ?, 'DR1', 1)").run(refB, SEASON);

test.after(() => {
  closeDatabase();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('aggiunta e elenco membri di una fascia (per campionato+stagione)', () => {
  addBandMember({ refereeId: refA, competition: 'DR1', sportSeason: SEASON, band: 'playoff' });
  addBandMember({ refereeId: refB, competition: 'DR1', sportSeason: SEASON, band: 'esordiente' });

  const playoff = listBandMembers({ competition: 'DR1', season: SEASON, band: 'playoff' });
  assert.equal(playoff.length, 1);
  assert.equal(playoff[0].refereeId, refA);
  assert.equal(playoff[0].licenseNumber, '111');

  const all = listBandMembers({ competition: 'DR1', season: SEASON });
  assert.equal(all.length, 2, 'entrambe le fasce elencate senza filtro band');
});

test('fascia non valida rifiutata; idempotente su doppio inserimento', () => {
  assert.throws(() => addBandMember({ refereeId: refA, competition: 'DR1', sportSeason: SEASON, band: 'xxx' }), /Fascia non valida/);
  addBandMember({ refereeId: refA, competition: 'DR1', sportSeason: SEASON, band: 'playoff' });
  assert.equal(listBandMembers({ competition: 'DR1', season: SEASON, band: 'playoff' }).length, 1, 'nessun duplicato');
});

test('getCoverage filtra per fascia ed espone il numero tessera', () => {
  const playoff = getCoverage({ season: SEASON, competitions: ['DR1'], band: 'playoff' });
  const names = playoff.referees.map((r) => r.fullName);
  assert.ok(names.includes('Alfa Aldo'), 'Alfa (playoff) presente');
  assert.ok(!names.includes('Beta Bea'), 'Beta (solo esordiente) escluso dal playoff');

  const alfa = playoff.referees.find((r) => r.fullName === 'Alfa Aldo');
  assert.equal(alfa.license, '111', 'tessera esposta nelle statistiche per la ricerca');
});

test('rimozione membro fascia', () => {
  const [member] = listBandMembers({ competition: 'DR1', season: SEASON, band: 'esordiente' });
  assert.equal(getBandRow(member.bandId).competition, 'DR1');
  removeBandMember(member.bandId);
  assert.equal(listBandMembers({ competition: 'DR1', season: SEASON, band: 'esordiente' }).length, 0);
});
