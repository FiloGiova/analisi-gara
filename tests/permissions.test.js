import test from 'node:test';
import assert from 'node:assert/strict';
import {
  can,
  capabilitiesOf,
  hasRole,
  normalizeRoles,
  primaryRole,
  rolesOf
} from '../shared/permissions.js';

const SEASON = '2026/2027';

function instructorOf(...competitions) {
  return { sportSeason: SEASON, competitions };
}

const admin = { roles: ['admin'] };
const operator = { roles: ['operator'] };
const observer = { roles: ['observer'] };
const instructorDr1 = { roles: ['instructor'], instructorAssignments: [instructorOf('DR1')] };
const operatorObserver = { roles: ['operator', 'observer'] };
const operatorInstructor = { roles: ['operator', 'instructor'], instructorAssignments: [instructorOf('DR1')] };

test('i ruoli si leggono anche dal vecchio campo singolo', () => {
  assert.deepEqual(rolesOf({ role: 'observer' }), ['observer']);
  assert.deepEqual(rolesOf({ role: 'formatter' }), ['instructor'], 'valore storico normalizzato');
  assert.deepEqual(rolesOf({ role: 'user' }), ['observer']);
  assert.deepEqual(rolesOf({ roles: ['operator', 'observer'] }), ['operator', 'observer']);
  assert.deepEqual(rolesOf(null), []);
  assert.equal(hasRole({ role: 'admin' }, 'admin'), true);
});

test('l’arbitro è esclusivo: sommato ad altri resta solo', () => {
  assert.deepEqual(normalizeRoles(['referee', 'operator', 'observer']), ['referee']);
  assert.deepEqual(normalizeRoles([]), ['observer'], 'senza ruoli si ricade su osservatore');
  assert.deepEqual(normalizeRoles(['operator', 'operator']), ['operator']);
});

test('il ruolo principale segue una priorità stabile', () => {
  assert.equal(primaryRole(['operator', 'admin']), 'admin');
  assert.equal(primaryRole(['operator', 'instructor']), 'instructor');
  assert.equal(primaryRole(['operator', 'observer']), 'observer');
  assert.equal(primaryRole(['operator']), 'operator');
});

test('l’operatore fa lavoro di servizio, non compila rapporti', () => {
  assert.equal(can(operator, 'sources:manage'), true);
  assert.equal(can(operator, 'designations:import'), true);
  assert.equal(can(operator, 'reports:import'), true);
  assert.equal(can(operator, 'competitions:manage'), true);
  assert.equal(can(operator, 'games:manage'), true);
  assert.equal(can(operator, 'games:delete'), true);
  assert.equal(can(operator, 'aliases:manage'), true);

  assert.equal(can(operator, 'reports:write'), false, 'non compila rapporti');
  assert.equal(can(operator, 'referees:inspect'), false, 'niente sezione arbitri, quindi niente classifiche');
  assert.equal(can(operator, 'users:manage'), false);
  assert.equal(can(operator, 'logs:view'), false);
  assert.equal(can(operator, 'designations:assign'), false);
});

test('il formatore resta dentro i propri campionati', () => {
  assert.equal(can(instructorDr1, 'games:manage', { competition: 'DR1', season: SEASON }), true);
  assert.equal(can(instructorDr1, 'games:manage', { competition: 'Serie C', season: SEASON }), false);
  assert.equal(can(instructorDr1, 'referees:inspect'), true, 'senza campionato: "può in generale?"');
  assert.equal(can(instructorDr1, 'games:manage', { competition: 'DR1', season: '2025/2026' }), false,
    'le assegnazioni valgono per stagione');
  assert.equal(can(instructorDr1, 'games:delete'), false);
  assert.equal(can(instructorDr1, 'sources:manage'), false);
});

test('i permessi di più ruoli si sommano, ma il perimetro non si allarga', () => {
  // L'operatore porta la gestione gare globale...
  assert.equal(can(operatorInstructor, 'games:manage', { competition: 'Serie C', season: SEASON }), true);
  // ...ma i rapporti restano visibili solo nei campionati del formatore.
  assert.equal(can(operatorInstructor, 'reports:read', { competition: 'DR1', season: SEASON }), true);
  assert.equal(can(operatorInstructor, 'reports:read', { competition: 'Serie C', season: SEASON }), false);
  // Nessuna combinazione regala i permessi dell'admin.
  assert.equal(can(operatorInstructor, 'users:manage'), false);
  assert.equal(can(operatorInstructor, 'logs:view'), false);
});

test('operatore + osservatore compila i rapporti e fa il lavoro di servizio', () => {
  assert.equal(can(operatorObserver, 'reports:write'), true);
  assert.equal(can(operatorObserver, 'sources:manage'), true);
  assert.equal(can(operatorObserver, 'referees:inspect'), false);
});

test('l’admin ha tutto, l’arbitro niente', () => {
  assert.equal(capabilitiesOf(admin).includes('users:manage'), true);
  assert.equal(capabilitiesOf(admin).includes('logs:view'), true);
  assert.deepEqual(capabilitiesOf({ roles: ['referee'] }), [], 'l’arbitro è di sola lettura sui propri rapporti');
  assert.deepEqual(capabilitiesOf(observer), ['reports:write']);
});
