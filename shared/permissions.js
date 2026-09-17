import { instructorCompetitionsForSeason } from './instructorAssignments.js';

// Ruoli e permessi in un posto solo, letti sia dal server (guardie delle rotte)
// sia dal client (menu e pulsanti). Un utente può avere più ruoli e i permessi
// si sommano: chi decide "chi può fare cosa" è questa tabella, non i singoli
// `if (role === ...)` sparsi nelle pagine.

export const ROLES = ['admin', 'operator', 'instructor', 'observer', 'referee'];

export const ROLE_LABELS = {
  admin: 'Amministratore',
  operator: 'Operatore',
  instructor: 'Formatore',
  observer: 'Osservatore',
  referee: 'Arbitro'
};

export const ROLE_DESCRIPTIONS = {
  admin: 'Accesso completo, log e gestione utenti compresi.',
  operator: 'Lavoro di servizio: sorgenti gare, import, campionati e gare. Non compila rapporti.',
  instructor: 'Formatore sui campionati assegnati: designa, compila rapporti, vede arbitri e statistiche.',
  observer: 'Compila i rapporti delle gare in cui è designato.',
  referee: 'Vede solo i rapporti che lo riguardano. Non si combina con altri ruoli.'
};

// L'arbitro è un ruolo restrittivo, non additivo: è l'unico che nasconde voti e
// Potenzialità, quindi sommarlo ad altri romperebbe quella regola.
export const EXCLUSIVE_ROLES = ['referee'];

// Ruolo "principale" mostrato dove serve una parola sola (elenchi, log).
const PRIMARY_ORDER = ['admin', 'instructor', 'observer', 'operator', 'referee'];

export const CAPABILITIES = [
  'reports:write',        // compilare e modificare rapporti
  'reports:read',         // vedere i rapporti (oltre ai propri)
  'reports:import',       // importare i PDF federali
  'games:manage',         // creare e modificare gare
  'games:delete',
  'designations:assign',  // assegnare osservatori alle gare
  'designations:import',  // import designazioni da XLSX
  'aliases:manage',       // confermare i nomi da associare
  'sources:manage',       // sorgenti gare e sincronizzazioni FIP
  'competitions:manage',
  'referees:inspect',     // anagrafica arbitri, schede, classifiche
  'stats:view',
  'users:manage',
  'settings:manage',
  'logs:view'
];

// 'global' = su tutto; 'scoped' = solo sui campionati assegnati per la stagione.
const ROLE_CAPABILITIES = {
  admin: Object.fromEntries(CAPABILITIES.map((capability) => [capability, 'global'])),
  operator: {
    'sources:manage': 'global',
    'designations:import': 'global',
    'reports:import': 'global',
    'competitions:manage': 'global',
    'games:manage': 'global',
    'games:delete': 'global',
    'aliases:manage': 'global'
  },
  instructor: {
    'reports:write': 'global',
    'reports:read': 'scoped',
    'reports:import': 'scoped',
    'games:manage': 'scoped',
    'designations:assign': 'scoped',
    'referees:inspect': 'scoped',
    'stats:view': 'scoped'
  },
  observer: {
    'reports:write': 'global'
  },
  referee: {}
};

function normalizeRoleValue(value) {
  const clean = String(value || '').trim();
  if (ROLES.includes(clean)) return clean;
  // Valori storici mai migrati.
  if (clean === 'formatter' || clean === 'formatore') return 'instructor';
  if (clean === 'user') return 'observer';
  return '';
}

// Ruoli dell'utente. Accetta sia il nuovo elenco sia il vecchio campo singolo,
// così il codice non ancora convertito continua a funzionare.
export function rolesOf(user) {
  if (!user) return [];
  const list = Array.isArray(user.roles) && user.roles.length ? user.roles : [user.role];
  const normalized = list.map(normalizeRoleValue).filter(Boolean);
  return [...new Set(normalized)];
}

export function hasRole(user, role) {
  return rolesOf(user).includes(role);
}

export function primaryRole(roles) {
  const list = Array.isArray(roles) ? roles.map(normalizeRoleValue).filter(Boolean) : [];
  return PRIMARY_ORDER.find((role) => list.includes(role)) || 'observer';
}

// Un arbitro non può avere altri ruoli: se compare, vince e resta solo.
export function normalizeRoles(roles) {
  const list = (Array.isArray(roles) ? roles : [roles]).map(normalizeRoleValue).filter(Boolean);
  const unique = [...new Set(list)];
  if (unique.includes('referee')) return ['referee'];
  return unique.length ? unique : ['observer'];
}

/**
 * Il permesso c'è se almeno uno dei ruoli lo concede. I ruoli globali valgono
 * ovunque, quelli scoped solo sui campionati assegnati: così sommare i ruoli
 * non allarga mai per sbaglio il perimetro del formatore.
 *
 * - `can(user, 'games:manage')` → "può gestire gare da qualche parte?"
 * - `can(user, 'games:manage', { competition: 'DR1', season })` → "può gestire
 *   le gare di DR1?"
 */
export function can(user, capability, { competition = '', season = '' } = {}) {
  if (!user) return false;
  for (const role of rolesOf(user)) {
    const grant = ROLE_CAPABILITIES[role]?.[capability];
    if (!grant) continue;
    if (grant === 'global') return true;
    const competitions = instructorCompetitionsForSeason(user, season);
    if (!competitions.length) continue;
    if (!competition || competitions.includes(competition)) return true;
  }
  return false;
}

// Capability concessa solo con un perimetro (nessun ruolo globale la dà):
// serve al client per sapere se deve filtrare per campionato.
export function isScopedOnly(user, capability) {
  if (!user) return false;
  return rolesOf(user).every((role) => ROLE_CAPABILITIES[role]?.[capability] !== 'global');
}

export function capabilitiesOf(user) {
  return CAPABILITIES.filter((capability) => can(user, capability));
}
