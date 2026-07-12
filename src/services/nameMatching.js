import { dbGet, dbAll, dbRun } from '../database/db.js';
import { HttpError } from '../utils/httpError.js';
import { recordGameChange } from './gameService.js';

// Normalizzazione e associazione prudente dei nominativi provenienti da fonti
// esterne (FIP, XLSX) verso l'anagrafica arbitri. Nessuna creazione automatica
// di persone: in assenza di un match certo si propongono candidati e la
// conferma dell'amministratore viene salvata in person_aliases.

// Le funzioni pure vivono in utils/personNames.js (usate anche dalle
// migrazioni all'avvio): qui vengono ri-esportate per i servizi.
import { cleanExternalName, nameTokens, normalizedNameKey } from '../utils/personNames.js';

export { cleanExternalName, normalizedNameKey };

function refereeKey(referee) {
  return normalizedNameKey(`${referee.first_name} ${referee.last_name}`);
}

function loadReferees() {
  return dbAll('SELECT id, first_name, last_name, active FROM referees');
}

export async function listRefereeCandidates(externalName, { limit = 5 } = {}) {
  const externalTokens = nameTokens(externalName);
  if (!externalTokens.length) return [];
  const externalSet = new Set(externalTokens);

  const candidates = [];
  for (const referee of await loadReferees()) {
    const tokens = nameTokens(`${referee.first_name} ${referee.last_name}`);
    if (!tokens.length) continue;
    const shared = tokens.filter((token) => externalSet.has(token)).length;
    if (!shared) continue;
    const score = (2 * shared) / (tokens.length + externalTokens.length);
    candidates.push({
      refereeId: referee.id,
      fullName: `${referee.last_name} ${referee.first_name}`.trim(),
      active: Boolean(referee.active),
      score: Math.round(score * 100) / 100
    });
  }

  return candidates
    .sort((a, b) => b.score - a.score || a.fullName.localeCompare(b.fullName))
    .slice(0, limit);
}

function isSubset(smaller, larger) {
  return smaller.every((token) => larger.includes(token));
}

// Match per inclusione di token, accettato solo se NON ambiguo: "Tonon" trova
// l'unico "Marco Tonon"; con due Rossi resta irrisolto.
function uniqueSubsetMatch(externalTokens, entries) {
  if (!externalTokens.length) return null;
  const matches = entries.filter(({ tokens }) => isSubset(externalTokens, tokens) || isSubset(tokens, externalTokens));
  return matches.length === 1 ? matches[0] : null;
}

// Risoluzione di un nominativo esterno: prima gli alias verificati, poi il
// match esatto (stessi identici token), poi il match per inclusione se unico.
// Tutto il resto è "da associare" e torna con i candidati più probabili.
export async function resolveRefereeName(externalName, { source }) {
  const key = normalizedNameKey(externalName);
  if (!key) return { refereeId: null, via: null, candidates: [] };

  const alias = await dbGet(
    'SELECT referee_id FROM person_aliases WHERE source = ? AND normalized_name = ? AND referee_id IS NOT NULL',
    [source, key]
  );
  if (alias) return { refereeId: alias.referee_id, via: 'alias', candidates: [] };

  const referees = await loadReferees();
  const exactMatches = referees.filter((referee) => refereeKey(referee) === key);
  if (exactMatches.length === 1) {
    return { refereeId: exactMatches[0].id, via: 'exact', candidates: [] };
  }
  if (!exactMatches.length) {
    const entries = referees.map((referee) => ({ id: referee.id, tokens: nameTokens(`${referee.first_name} ${referee.last_name}`) }));
    const unique = uniqueSubsetMatch(nameTokens(externalName), entries);
    if (unique) return { refereeId: unique.id, via: 'unique', candidates: [] };
  }

  return { refereeId: null, via: null, candidates: await listRefereeCandidates(externalName) };
}

function loadObserverUsers() {
  return dbAll(`SELECT id, display_name, active FROM users WHERE role != 'referee'`);
}

export async function listObserverCandidates(externalName, { limit = 5 } = {}) {
  const externalTokens = nameTokens(externalName);
  if (!externalTokens.length) return [];
  const externalSet = new Set(externalTokens);

  const candidates = [];
  for (const user of await loadObserverUsers()) {
    const tokens = nameTokens(user.display_name);
    if (!tokens.length) continue;
    const shared = tokens.filter((token) => externalSet.has(token)).length;
    if (!shared) continue;
    const score = (2 * shared) / (tokens.length + externalTokens.length);
    candidates.push({
      userId: user.id,
      displayName: user.display_name,
      active: Boolean(user.active),
      score: Math.round(score * 100) / 100
    });
  }

  return candidates
    .sort((a, b) => b.score - a.score || a.displayName.localeCompare(b.displayName))
    .slice(0, limit);
}

// Risoluzione osservatore: gli osservatori sono utenti interni. Il designatore
// spesso scrive solo il cognome ("Tonon"): il match per inclusione univoca
// copre questo caso senza indovinare in presenza di omonimi.
export async function resolveObserverName(externalName, { source }) {
  const key = normalizedNameKey(externalName);
  if (!key) return { userId: null, via: null, candidates: [] };

  const alias = await dbGet(
    'SELECT user_id FROM person_aliases WHERE source = ? AND normalized_name = ? AND user_id IS NOT NULL',
    [source, key]
  );
  if (alias) return { userId: alias.user_id, via: 'alias', candidates: [] };

  const users = await loadObserverUsers();
  const exact = users.filter((user) => normalizedNameKey(user.display_name) === key);
  if (exact.length === 1) return { userId: exact[0].id, via: 'exact', candidates: [] };
  if (!exact.length) {
    const entries = users.map((user) => ({ id: user.id, tokens: nameTokens(user.display_name) }));
    const unique = uniqueSubsetMatch(nameTokens(externalName), entries);
    if (unique) return { userId: unique.id, via: 'unique', candidates: [] };
  }

  return { userId: null, via: null, candidates: await listObserverCandidates(externalName) };
}

export async function saveObserverAlias({ source, externalName, userId, verifiedBy = null }) {
  const key = normalizedNameKey(externalName);
  if (!key) throw new HttpError(400, 'Nominativo esterno non valido.');
  const user = await dbGet(`SELECT id FROM users WHERE id = ? AND role != 'referee'`, [userId]);
  if (!user) throw new HttpError(404, 'Utente osservatore non trovato.');

  await dbRun(
    `INSERT INTO person_aliases (source, external_name, normalized_name, user_id, verified_by, verified_at)
     VALUES (?, ?, ?, ?, ?, iso_now())
     ON CONFLICT (source, normalized_name) DO UPDATE SET
       external_name = excluded.external_name,
       user_id = excluded.user_id,
       referee_id = NULL,
       verified_by = excluded.verified_by,
       verified_at = excluded.verified_at`,
    [source, cleanExternalName(externalName), key, userId, verifiedBy]
  );

  return { source, externalName: cleanExternalName(externalName), normalizedName: key, userId };
}

export async function saveRefereeAlias({ source, externalName, refereeId, verifiedBy = null }) {
  const key = normalizedNameKey(externalName);
  if (!key) throw new HttpError(400, 'Nominativo esterno non valido.');
  const referee = await dbGet('SELECT id FROM referees WHERE id = ?', [refereeId]);
  if (!referee) throw new HttpError(404, 'Arbitro non trovato in anagrafica.');

  await dbRun(
    `INSERT INTO person_aliases (source, external_name, normalized_name, referee_id, verified_by, verified_at)
     VALUES (?, ?, ?, ?, ?, iso_now())
     ON CONFLICT (source, normalized_name) DO UPDATE SET
       external_name = excluded.external_name,
       referee_id = excluded.referee_id,
       user_id = NULL,
       verified_by = excluded.verified_by,
       verified_at = excluded.verified_at`,
    [source, cleanExternalName(externalName), key, refereeId, verifiedBy]
  );

  return { source, externalName: cleanExternalName(externalName), normalizedName: key, refereeId };
}

// Dopo la verifica di un alias osservatore, aggancia l'utente a tutte le
// designazioni osservatore ancora non risolte con lo stesso nominativo.
export async function applyObserverAliasToOfficials({ source, externalName, userId, user = null }) {
  const key = normalizedNameKey(externalName);
  const observer = await dbGet('SELECT display_name FROM users WHERE id = ?', [userId]);

  const rows = await dbAll(
    `SELECT id, game_id, external_name
       FROM game_officials
      WHERE role = 'observer' AND user_id IS NULL AND source = ? AND external_name != ''`,
    [source]
  );

  let updated = 0;
  for (const row of rows) {
    if (normalizedNameKey(row.external_name) !== key) continue;
    await dbRun(`UPDATE game_officials SET user_id = ?, updated_at = iso_now() WHERE id = ?`, [userId, row.id]);
    await recordGameChange({
      gameId: row.game_id,
      field: 'ufficiale:observer',
      oldValue: row.external_name,
      newValue: observer?.display_name || row.external_name,
      source,
      changedBy: user?.id || null,
      reason: 'Alias verificato'
    });
    updated += 1;
  }
  return updated;
}

// Dopo la verifica di un alias, aggancia l'arbitro a tutti gli ufficiali di
// gara ancora non risolti che portano lo stesso nominativo esterno.
export async function applyRefereeAliasToOfficials({ source, externalName, refereeId, user = null }) {
  const key = normalizedNameKey(externalName);
  const referee = await dbGet('SELECT first_name, last_name FROM referees WHERE id = ?', [refereeId]);
  const refereeName = referee ? `${referee.last_name} ${referee.first_name}`.trim() : '';

  const rows = await dbAll(
    `SELECT id, game_id, role, external_name
       FROM game_officials
      WHERE referee_id IS NULL AND source = ? AND external_name != ''`,
    [source]
  );

  let updated = 0;
  for (const row of rows) {
    if (normalizedNameKey(row.external_name) !== key) continue;
    await dbRun(`UPDATE game_officials SET referee_id = ?, updated_at = iso_now() WHERE id = ?`, [refereeId, row.id]);
    await recordGameChange({
      gameId: row.game_id,
      field: `ufficiale:${row.role}`,
      oldValue: row.external_name,
      newValue: refereeName || row.external_name,
      source,
      changedBy: user?.id || null,
      reason: 'Alias verificato'
    });
    updated += 1;
  }
  return updated;
}
