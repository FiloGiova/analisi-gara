import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Database temporaneo isolato: va impostato PRIMA di importare config/connection.
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'analisigara-test-'));
process.env.STORAGE_DIR = tempDir;

const { setupTestDatabase, closeTestDatabase, insertId } = await import('./helpers/testDatabase.js');
const {
  cleanExternalName,
  normalizedNameKey,
  resolveRefereeName,
  saveRefereeAlias,
  listRefereeCandidates
} = await import('../src/services/nameMatching.js');

await setupTestDatabase();

async function insertReferee(firstName, lastName) {
  return insertId('INSERT INTO referees (first_name, last_name) VALUES (?, ?)', [firstName, lastName]);
}

const molinariId = await insertReferee('Giorgio', 'Molinari');
await insertReferee('Mario', 'Rossi');
await insertReferee('Luca', 'Rossi');

test.after(async () => {
  await closeTestDatabase();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('cleanExternalName rimuove il suffisso territoriale FIP', () => {
  assert.equal(cleanExternalName('VENTURI JACOPO di TORINO (TO)'), 'VENTURI JACOPO');
  assert.equal(cleanExternalName('FICILI SIMONE di SETTIMO TORINESE (TO)'), 'FICILI SIMONE');
  // "DI" maiuscolo nei cognomi non è un suffisso territoriale.
  assert.equal(cleanExternalName('DI STEFANO MARCO'), 'DI STEFANO MARCO');
});

test('normalizedNameKey è stabile per ordine, maiuscole, accenti e apostrofi', () => {
  assert.equal(normalizedNameKey('MOLINARI GIORGIO'), normalizedNameKey('Giorgio Molinari'));
  assert.equal(normalizedNameKey('MOLINARI  GIORGIO '), normalizedNameKey('molinari giorgio'));
  assert.equal(normalizedNameKey("D’ANGELO JOSÈ"), normalizedNameKey("D'Angelo Jose"));
  assert.equal(normalizedNameKey('MOLINARI GIORGIO di TORINO (TO)'), normalizedNameKey('Giorgio Molinari'));
});

test('resolveRefereeName trova il match esatto non ambiguo', async () => {
  const result = await resolveRefereeName('MOLINARI GIORGIO di TORINO (TO)', { source: 'fip_public' });
  assert.equal(result.refereeId, molinariId);
  assert.equal(result.via, 'exact');
});

test('resolveRefereeName non indovina in caso di ambiguità ma propone candidati', async () => {
  const result = await resolveRefereeName('ROSSI', { source: 'fip_public' });
  assert.equal(result.refereeId, null);
  assert.ok(result.candidates.length >= 2, 'entrambi i Rossi devono comparire tra i candidati');
});

test('un alias verificato viene riutilizzato nelle risoluzioni successive', async () => {
  const externalName = 'MOLINARI G.';
  const before = await resolveRefereeName(externalName, { source: 'xlsx' });
  assert.equal(before.refereeId, null, 'senza alias il nome abbreviato non deve risolversi');

  await saveRefereeAlias({ source: 'xlsx', externalName, refereeId: molinariId });
  const after = await resolveRefereeName(externalName, { source: 'xlsx' });
  assert.equal(after.refereeId, molinariId);
  assert.equal(after.via, 'alias');

  // L'alias vale solo per la sorgente in cui è stato verificato.
  const otherSource = await resolveRefereeName(externalName, { source: 'fip_public' });
  assert.equal(otherSource.refereeId, null);
});

test('listRefereeCandidates ordina per affinità', async () => {
  const candidates = await listRefereeCandidates('Molinari Giorgio');
  assert.ok(candidates.length >= 1);
  assert.equal(candidates[0].refereeId, molinariId);
  assert.equal(candidates[0].score, 1);
});
