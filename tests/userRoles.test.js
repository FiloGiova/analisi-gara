import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fischiolab-user-roles-'));
process.env.STORAGE_DIR = tempDir;

const { setupTestDatabase, closeTestDatabase, insertId, dbAll, dbRun } = await import('./helpers/testDatabase.js');
const { createUser, updateUser, getUser, listUsers } = await import('../src/services/userService.js');
const { createReport } = await import('../src/services/reportService.js');
const { listAssignableObservers } = await import('../src/services/gameService.js');

await setupTestDatabase();
await dbRun("INSERT INTO competitions (value, label, sort_order) VALUES ('DR1', 'Divisione Regionale 1', 1) ON CONFLICT DO NOTHING");

const adminId = await insertId(
  "INSERT INTO users (username, password_hash, display_name, role) VALUES ('capo', 'x', 'Capo', 'admin')"
);
await dbRun("INSERT INTO user_roles (user_id, role) VALUES (?, 'admin') ON CONFLICT DO NOTHING", [adminId]);

test.after(async () => {
  await closeTestDatabase();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('un utente può avere più ruoli e i permessi si sommano', async () => {
  const user = await createUser({
    username: 'tecnico.osservatore',
    password: 'password-123',
    displayName: 'Tecnico Osservatore',
    roles: ['operator', 'observer']
  });

  assert.deepEqual(user.roles.sort(), ['observer', 'operator']);
  assert.equal(user.role, 'observer', 'il ruolo principale è quello più "alto" tra quelli posseduti');

  const stored = await dbAll('SELECT role FROM user_roles WHERE user_id = ? ORDER BY role', [user.id]);
  assert.deepEqual(stored.map((row) => row.role), ['observer', 'operator']);
});

test('l’operatore puro non può compilare rapporti', async () => {
  const operator = await createUser({
    username: 'solo.tecnico',
    password: 'password-123',
    displayName: 'Solo Tecnico',
    roles: ['operator']
  });
  assert.deepEqual(operator.roles, ['operator']);

  await assert.rejects(
    () => createReport({
      payload: { reportDate: '2026-10-04', matchNumber: '003001', competition: 'DR1' },
      status: 'draft',
      user: operator
    }),
    (err) => err.statusCode === 403 && /non può compilare rapporti/.test(err.message)
  );
});

test('operatore + osservatore compila i rapporti ed è assegnabile come osservatore', async () => {
  const user = await createUser({
    username: 'tecnico.duplice',
    password: 'password-123',
    displayName: 'Tecnico Duplice',
    roles: ['operator', 'observer']
  });

  const report = await createReport({
    payload: { reportDate: '2026-10-04', matchNumber: '003002', competition: 'DR1' },
    status: 'draft',
    user
  });
  assert.equal(report.observerId, user.id, 'il rapporto risulta suo');

  const assignable = await listAssignableObservers();
  assert.ok(assignable.some((item) => item.id === user.id), 'compare tra gli osservatori assegnabili');
});

test('l’arbitro resta esclusivo anche se si chiedono altri ruoli', async () => {
  const refereeId = await insertId("INSERT INTO referees (first_name, last_name) VALUES ('Gino', 'Fischietto')");
  const user = await createUser({
    username: 'arbitro.gino',
    password: 'password-123',
    displayName: 'Gino Fischietto',
    roles: ['referee', 'operator'],
    refereeId
  });

  assert.deepEqual(user.roles, ['referee']);
  assert.equal(user.refereeId, refereeId);

  const assignable = await listAssignableObservers();
  assert.equal(assignable.some((item) => item.id === user.id), false, 'un arbitro non è un osservatore');
});

test('i ruoli si aggiornano e l’ultimo admin attivo resta protetto', async () => {
  const user = await createUser({
    username: 'cambio.ruoli',
    password: 'password-123',
    displayName: 'Cambio Ruoli',
    roles: ['observer']
  });

  const updated = await updateUser({ id: user.id, roles: ['operator', 'observer'] });
  assert.deepEqual(updated.roles.sort(), ['observer', 'operator']);

  const reduced = await updateUser({ id: user.id, roles: ['operator'] });
  assert.deepEqual(reduced.roles, ['operator']);

  await assert.rejects(
    () => updateUser({ id: adminId, roles: ['operator'] }),
    (err) => err.statusCode === 400 && /ultimo amministratore/.test(err.message)
  );
});

test('gli utenti storici senza riga in user_roles restano coerenti', async () => {
  const legacyId = await insertId(
    "INSERT INTO users (username, password_hash, display_name, role, formatter_competition) VALUES ('storico', 'x', 'Formatore Storico', 'formatter', '[\"DR1\"]')"
  );
  const legacy = await getUser(legacyId);
  assert.deepEqual(legacy.roles, ['instructor'], 'il valore storico viene normalizzato al volo');

  const all = await listUsers();
  assert.ok(all.every((item) => Array.isArray(item.roles) && item.roles.length), 'ogni utente espone i suoi ruoli');
});
