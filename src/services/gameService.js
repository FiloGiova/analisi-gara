import { dbGet, dbAll, dbRun, dbTx } from '../database/db.js';
import { HttpError } from '../utils/httpError.js';

export const OFFICIAL_ROLES = ['referee1', 'referee2', 'referee3', 'observer'];
export const GAME_SOURCES = ['fip_public', 'xlsx', 'federation_pdf', 'manual'];
export const GAME_STATUSES = ['scheduled', 'played', 'postponed', 'cancelled'];

function asText(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function asNullableInteger(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// Audit: ogni modifica a una gara lascia una riga ricostruibile in game_changes.
export async function recordGameChange({ gameId, field, oldValue, newValue, source = 'manual', changedBy = null, syncRunId = null, reason = null }) {
  await dbRun(
    `INSERT INTO game_changes (game_id, field, old_value, new_value, source, changed_by, sync_run_id, reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [gameId, field, asText(oldValue) || null, asText(newValue) || null, source, changedBy, syncRunId, reason]
  );
}

function officialLabel(official) {
  if (!official) return '';
  return official.refereeName || official.userName || official.externalName || '';
}

function rowToOfficial(row) {
  if (!row) return null;
  return {
    role: row.role,
    refereeId: row.referee_id || null,
    refereeName: row.referee_last_name ? `${row.referee_last_name} ${row.referee_first_name}`.trim() : '',
    userId: row.user_id || null,
    userName: row.user_display_name || '',
    externalName: row.external_name || '',
    source: row.source,
    status: row.status,
    manualLock: Boolean(row.manual_lock)
  };
}

async function loadOfficialsByGame(gameIds) {
  if (!gameIds.length) return new Map();
  const placeholders = gameIds.map(() => '?').join(', ');
  const rows = await dbAll(
    `SELECT go.*, r.first_name AS referee_first_name, r.last_name AS referee_last_name, u.display_name AS user_display_name
       FROM game_officials go
       LEFT JOIN referees r ON r.id = go.referee_id
       LEFT JOIN users u ON u.id = go.user_id
      WHERE go.game_id IN (${placeholders})`,
    gameIds
  );
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.game_id)) map.set(row.game_id, {});
    map.get(row.game_id)[row.role] = rowToOfficial(row);
  }
  return map;
}

async function loadReportsByGame(gameIds) {
  if (!gameIds.length) return new Map();
  const placeholders = gameIds.map(() => '?').join(', ');
  const rows = await dbAll(`SELECT id, game_id, status FROM reports WHERE game_id IN (${placeholders})`, gameIds);
  const map = new Map();
  for (const row of rows) {
    // In caso di più rapporti per gara prevale il definitivo.
    const existing = map.get(row.game_id);
    if (!existing || row.status === 'final') map.set(row.game_id, row);
  }
  return map;
}

// Stato derivato mostrato in elenco: mai mantenuto a mano.
export function deriveGameState(game, officials, report) {
  if (game.status === 'postponed') return 'rinviata';
  if (game.status === 'cancelled') return 'annullata';
  if (report?.status === 'final') return 'rapporto_definitivo';
  if (report?.status === 'draft') return 'rapporto_bozza';
  const hasReferees = Boolean(officials?.referee1) && Boolean(officials?.referee2);
  const hasObserver = Boolean(officials?.observer);
  if (!hasReferees && !hasObserver) return 'calendario';
  if (!hasReferees) return 'arbitri_mancanti';
  if (!hasObserver) return 'senza_osservatore';
  return 'designazione_completa';
}

function needsAlias(officials) {
  return ['referee1', 'referee2', 'referee3'].some((role) => {
    const official = officials?.[role];
    return official && !official.refereeId && official.externalName;
  });
}

function rowToGame(row, officials = {}, report = null) {
  return {
    id: row.id,
    sportSeason: row.sport_season,
    competitionSourceId: row.competition_source_id || null,
    sourceName: row.source_name || '',
    externalSource: row.external_source,
    matchNumber: row.match_number,
    competition: row.competition || '',
    phase: row.phase || '',
    girone: row.girone || '',
    matchday: row.matchday ?? null,
    leg: row.leg || null,
    scheduledAt: row.scheduled_at || null,
    teamHome: row.team_home,
    teamAway: row.team_away,
    venue: row.venue || '',
    status: row.status,
    scoreHome: row.score_home || '',
    scoreAway: row.score_away || '',
    notes: row.notes || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastSyncedAt: row.last_synced_at || null,
    officials,
    reportId: report?.id || null,
    reportStatus: report?.status || null,
    derivedState: deriveGameState(row, officials, report),
    needsAlias: needsAlias(officials)
  };
}

export async function listGames({
  season = '',
  matchday = '',
  status = '',
  search = '',
  refereeId = null,
  observerUserId = null,
  uncoveredOnly = false,
  sourceId = null,
  competitions = []
} = {}) {
  const clauses = [];
  const params = [];

  if (season) {
    clauses.push('g.sport_season = ?');
    params.push(season);
  }
  // Scoping per campionato (es. formatore ristretto ai suoi campionati).
  if (competitions.length) {
    clauses.push(`g.competition IN (${competitions.map(() => '?').join(', ')})`);
    params.push(...competitions);
  }
  if (matchday) {
    clauses.push('g.matchday = ?');
    params.push(Number(matchday));
  }
  if (status && GAME_STATUSES.includes(status)) {
    clauses.push('g.status = ?');
    params.push(status);
  }
  if (sourceId) {
    clauses.push('g.competition_source_id = ?');
    params.push(Number(sourceId));
  }
  if (refereeId) {
    clauses.push(
      `EXISTS (SELECT 1 FROM game_officials go WHERE go.game_id = g.id AND go.role IN ('referee1','referee2','referee3') AND go.referee_id = ?)`
    );
    params.push(Number(refereeId));
  }
  if (observerUserId) {
    clauses.push(`EXISTS (SELECT 1 FROM game_officials go WHERE go.game_id = g.id AND go.role = 'observer' AND go.user_id = ?)`);
    params.push(Number(observerUserId));
  }
  if (uncoveredOnly) {
    clauses.push(`NOT EXISTS (SELECT 1 FROM game_officials go WHERE go.game_id = g.id AND go.role = 'observer')`);
  }
  if (search) {
    clauses.push('(g.match_number ILIKE ? OR g.team_home ILIKE ? OR g.team_away ILIKE ?)');
    const like = `%${search}%`;
    params.push(like, like, like);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = await dbAll(
    `SELECT g.*, cs.name AS source_name
       FROM games g
       LEFT JOIN competition_sources cs ON cs.id = g.competition_source_id
       ${where}
      ORDER BY g.matchday ASC, g.scheduled_at ASC, g.match_number ASC`,
    params
  );

  const gameIds = rows.map((row) => row.id);
  const officialsByGame = await loadOfficialsByGame(gameIds);
  const reportsByGame = await loadReportsByGame(gameIds);

  return rows.map((row) => rowToGame(row, officialsByGame.get(row.id) || {}, reportsByGame.get(row.id) || null));
}

export async function listGameSeasons() {
  const rows = await dbAll('SELECT DISTINCT sport_season FROM games ORDER BY sport_season DESC');
  return rows.map((row) => row.sport_season);
}

// Scoping per singola gara: con una lista di campionati (es. formatore) verifica
// che la gara appartenga a uno di essi. Lista vuota = nessuna restrizione (admin).
export async function assertGameCompetitionAccess(gameId, competitions = []) {
  if (!competitions.length) return;
  const row = await dbGet('SELECT competition FROM games WHERE id = ?', [gameId]);
  if (!row) throw new HttpError(404, 'Gara non trovata.');
  if (!competitions.includes(row.competition || '')) {
    throw new HttpError(403, 'Gara fuori dai campionati assegnati alla tua utenza.');
  }
}

export async function getGame(id) {
  const row = await dbGet(
    `SELECT g.*, cs.name AS source_name
       FROM games g
       LEFT JOIN competition_sources cs ON cs.id = g.competition_source_id
      WHERE g.id = ?`,
    [id]
  );
  if (!row) throw new HttpError(404, 'Gara non trovata.');
  const officials = (await loadOfficialsByGame([row.id])).get(row.id) || {};
  const report = (await loadReportsByGame([row.id])).get(row.id) || null;
  const changeRows = await dbAll(
    `SELECT gc.*, u.display_name AS changed_by_name
       FROM game_changes gc
       LEFT JOIN users u ON u.id = gc.changed_by
      WHERE gc.game_id = ?
      ORDER BY gc.id DESC
      LIMIT 100`,
    [id]
  );
  const changes = changeRows.map((change) => ({
    id: change.id,
    field: change.field,
    oldValue: change.old_value || '',
    newValue: change.new_value || '',
    source: change.source,
    changedByName: change.changed_by_name || '',
    reason: change.reason || '',
    createdAt: change.created_at
  }));
  return { ...rowToGame(row, officials, report), changes };
}

function normalizeGameInput(input = {}) {
  const status = asText(input.status) || 'scheduled';
  if (!GAME_STATUSES.includes(status)) {
    throw new HttpError(400, 'Stato gara non valido.');
  }
  const leg = asText(input.leg);
  if (leg && !['andata', 'ritorno'].includes(leg)) {
    throw new HttpError(400, 'Turno non valido: usare "andata" o "ritorno".');
  }
  return {
    sportSeason: asText(input.sportSeason),
    matchNumber: asText(input.matchNumber),
    competition: asText(input.competition),
    phase: asText(input.phase),
    girone: asText(input.girone),
    matchday: asNullableInteger(input.matchday),
    leg: leg || null,
    scheduledAt: asText(input.scheduledAt) || null,
    teamHome: asText(input.teamHome),
    teamAway: asText(input.teamAway),
    venue: asText(input.venue),
    status,
    scoreHome: asText(input.scoreHome),
    scoreAway: asText(input.scoreAway),
    notes: asText(input.notes)
  };
}

export async function createGame({ data, user, source = 'manual', competitionSourceId = null, syncRunId = null }) {
  const game = normalizeGameInput(data);
  if (!game.sportSeason) throw new HttpError(400, 'Stagione sportiva obbligatoria.');
  if (!game.matchNumber) throw new HttpError(400, 'Numero gara obbligatorio.');

  const existing = await dbGet('SELECT id FROM games WHERE sport_season = ? AND match_number = ?', [
    game.sportSeason,
    game.matchNumber
  ]);
  if (existing) {
    throw new HttpError(409, `Esiste già la gara ${game.matchNumber} nella stagione ${game.sportSeason}.`);
  }

  const result = await dbRun(
    `INSERT INTO games (
       sport_season, competition_source_id, external_source, match_number, competition, phase, girone,
       matchday, leg, scheduled_at, team_home, team_away, venue, status, score_home, score_away, notes,
       last_synced_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 'manual' THEN NULL ELSE iso_now() END)
     RETURNING id`,
    [
      game.sportSeason,
      competitionSourceId,
      source,
      game.matchNumber,
      game.competition || null,
      game.phase || null,
      game.girone || null,
      game.matchday,
      game.leg,
      game.scheduledAt,
      game.teamHome,
      game.teamAway,
      game.venue || null,
      game.status,
      game.scoreHome || null,
      game.scoreAway || null,
      game.notes || null,
      source
    ]
  );

  const newId = result.rows[0].id;
  await recordGameChange({
    gameId: newId,
    field: 'gara',
    oldValue: '',
    newValue: `creata (${game.matchNumber})`,
    source,
    changedBy: user?.id || null,
    syncRunId
  });

  return getGame(newId);
}

// Campi aggiornabili con relativa colonna: usati sia dall'update manuale sia dal sync.
const UPDATABLE_FIELDS = {
  competition: 'competition',
  phase: 'phase',
  girone: 'girone',
  matchday: 'matchday',
  leg: 'leg',
  scheduledAt: 'scheduled_at',
  teamHome: 'team_home',
  teamAway: 'team_away',
  venue: 'venue',
  status: 'status',
  scoreHome: 'score_home',
  scoreAway: 'score_away',
  notes: 'notes'
};

export async function updateGame(id, data, { user = null, source = 'manual', syncRunId = null, reason = null, force = false } = {}) {
  const row = await dbGet('SELECT * FROM games WHERE id = ?', [id]);
  if (!row) throw new HttpError(404, 'Gara non trovata.');

  const normalized = normalizeGameInput({ ...data, sportSeason: row.sport_season, matchNumber: row.match_number });
  const report = (await loadReportsByGame([id])).get(id);

  const changes = [];
  for (const [key, column] of Object.entries(UPDATABLE_FIELDS)) {
    if (data[key] === undefined) continue;
    const newValue = normalized[key];
    const oldValue = row[column];
    const oldText = oldValue === null || oldValue === undefined ? '' : String(oldValue);
    const newText = newValue === null || newValue === undefined ? '' : String(newValue);
    if (oldText === newText) continue;
    changes.push({ key, column, oldValue: oldText, newValue: newText });
  }

  if (!changes.length) return getGame(id);

  // Una gara con rapporto definitivo non va alterata silenziosamente: serve
  // conferma esplicita (force) e la motivazione finisce nell'audit.
  const sensitiveKeys = new Set(['teamHome', 'teamAway', 'scheduledAt', 'competition']);
  if (report?.status === 'final' && changes.some((change) => sensitiveKeys.has(change.key)) && !force) {
    throw new HttpError(409, 'La gara è collegata a un rapporto definitivo: conferma esplicitamente la modifica.', {
      requiresConfirmation: true
    });
  }

  const NON_NULL_COLUMNS = new Set(['team_home', 'team_away', 'status']);
  await dbTx(async (client) => {
    for (const change of changes) {
      await client.run(`UPDATE games SET ${change.column} = ?, updated_at = iso_now() WHERE id = ?`, [
        change.newValue === '' && !NON_NULL_COLUMNS.has(change.column) ? null : change.newValue,
        id
      ]);
      await client.run(
        `INSERT INTO game_changes (game_id, field, old_value, new_value, source, changed_by, sync_run_id, reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, change.key, asText(change.oldValue) || null, asText(change.newValue) || null, source, user?.id || null, syncRunId, reason]
      );
    }
    if (source !== 'manual') {
      await client.run(`UPDATE games SET last_synced_at = iso_now() WHERE id = ?`, [id]);
    }
  });

  return getGame(id);
}

export async function getOfficialRow(gameId, role) {
  return dbGet('SELECT * FROM game_officials WHERE game_id = ? AND role = ?', [gameId, role]);
}

// Assegna/sostituisce un ufficiale di gara. L'osservatore è opzionale by
// design: la sua assenza ("gara scoperta") è uno stato normale.
export async function setOfficial(gameId, { role, refereeId = null, userId = null, externalName = '', source = 'manual', status = 'confirmed', manualLock = false }, { user = null, syncRunId = null, reason = null } = {}) {
  if (!OFFICIAL_ROLES.includes(role)) throw new HttpError(400, 'Ruolo ufficiale di gara non valido.');
  if (!GAME_SOURCES.includes(source)) throw new HttpError(400, 'Origine dato non valida.');

  const game = await dbGet('SELECT id FROM games WHERE id = ?', [gameId]);
  if (!game) throw new HttpError(404, 'Gara non trovata.');

  const cleanRefereeId = asNullableInteger(refereeId);
  const cleanUserId = asNullableInteger(userId);

  if (role === 'observer') {
    if (cleanRefereeId) throw new HttpError(400, "L'osservatore va scelto tra gli utenti, non dall'anagrafica arbitri.");
    if (cleanUserId) {
      const observer = await dbGet('SELECT id, role FROM users WHERE id = ?', [cleanUserId]);
      if (!observer) throw new HttpError(404, 'Utente osservatore non trovato.');
      if (observer.role === 'referee') throw new HttpError(400, 'Un utente arbitro non può essere assegnato come osservatore.');
    }
  } else if (cleanRefereeId) {
    const referee = await dbGet('SELECT id FROM referees WHERE id = ?', [cleanRefereeId]);
    if (!referee) throw new HttpError(404, 'Arbitro non trovato in anagrafica.');
  }

  if (!cleanRefereeId && !cleanUserId && !asText(externalName)) {
    return removeOfficial(gameId, role, { user, syncRunId, reason });
  }

  const existing = await getOfficialRow(gameId, role);
  const oldOfficial = (await loadOfficialsByGame([gameId])).get(gameId)?.[role] || null;
  const oldLabel = officialLabel(oldOfficial);

  await dbRun(
    `INSERT INTO game_officials (game_id, role, referee_id, user_id, external_name, source, status, manual_lock)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (game_id, role) DO UPDATE SET
       referee_id = excluded.referee_id,
       user_id = excluded.user_id,
       external_name = excluded.external_name,
       source = excluded.source,
       status = excluded.status,
       manual_lock = excluded.manual_lock,
       updated_at = iso_now()`,
    [gameId, role, cleanRefereeId, cleanUserId, asText(externalName), source, status === 'provisional' ? 'provisional' : 'confirmed', manualLock ? 1 : 0]
  );

  const updated = (await loadOfficialsByGame([gameId])).get(gameId)?.[role] || null;
  const newLabel = officialLabel(updated);
  const identityChanged =
    !existing ||
    (existing.referee_id || null) !== cleanRefereeId ||
    (existing.user_id || null) !== cleanUserId ||
    (existing.external_name || '') !== asText(externalName);
  if (identityChanged && oldLabel !== newLabel) {
    await recordGameChange({
      gameId,
      field: `ufficiale:${role}`,
      oldValue: oldLabel,
      newValue: newLabel,
      source,
      changedBy: user?.id || null,
      syncRunId,
      reason
    });
  }

  await dbRun(`UPDATE games SET updated_at = iso_now() WHERE id = ?`, [gameId]);
  return getGame(gameId);
}

export async function removeOfficial(gameId, role, { user = null, syncRunId = null, reason = null } = {}) {
  if (!OFFICIAL_ROLES.includes(role)) throw new HttpError(400, 'Ruolo ufficiale di gara non valido.');
  const existing = await getOfficialRow(gameId, role);
  if (existing) {
    const label = (await loadOfficialsByGame([gameId])).get(gameId)?.[role];
    await dbRun('DELETE FROM game_officials WHERE game_id = ? AND role = ?', [gameId, role]);
    await recordGameChange({
      gameId,
      field: `ufficiale:${role}`,
      oldValue: officialLabel(label) || existing.external_name || '',
      newValue: '',
      source: 'manual',
      changedBy: user?.id || null,
      syncRunId,
      reason
    });
  }
  return getGame(gameId);
}

export async function deleteGame(id, { user = null } = {}) {
  const row = await dbGet('SELECT id FROM games WHERE id = ?', [id]);
  if (!row) throw new HttpError(404, 'Gara non trovata.');
  const report = (await loadReportsByGame([id])).get(id);
  if (report) {
    throw new HttpError(409, 'La gara è collegata a un rapporto: scollegare o eliminare prima il rapporto.');
  }
  await dbRun('DELETE FROM games WHERE id = ?', [id]);
}

// Utenti assegnabili come osservatori (tutti i ruoli interni tranne gli arbitri).
export async function listAssignableObservers() {
  const rows = await dbAll(
    `SELECT id, display_name, role
       FROM users
      WHERE active = 1 AND role IN ('observer', 'instructor')
      ORDER BY display_name`
  );
  return rows.map((row) => ({ id: row.id, displayName: row.display_name, role: row.role }));
}

// Coda "da compilare": gare in cui l'utente è l'osservatore designato e non
// esiste ancora un rapporto collegato. Alimenta la dashboard rapporti per ruolo.
export async function listPendingAssignmentsForUser(userId, season = '') {
  const cleanId = asNullableInteger(userId);
  if (!cleanId) return [];
  const games = await listGames({ observerUserId: cleanId, season });
  return games
    .filter((game) => !game.reportId && game.status !== 'cancelled')
    .map((game) => ({
      gameId: game.id,
      matchNumber: game.matchNumber,
      competition: game.competition,
      matchday: game.matchday,
      scheduledAt: game.scheduledAt,
      teamHome: game.teamHome,
      teamAway: game.teamAway,
      referee1: officialLabel(game.officials.referee1),
      referee2: officialLabel(game.officials.referee2),
      derivedState: game.derivedState
    }));
}

// Dati per precompilare un rapporto a partire dalla gara.
export async function gameForReportPrefill(id) {
  const game = await getGame(id);
  const observer = game.officials.observer || null;
  const referee1 = game.officials.referee1 || null;
  const referee2 = game.officials.referee2 || null;
  return {
    gameId: game.id,
    matchNumber: game.matchNumber,
    reportDate: game.scheduledAt ? game.scheduledAt.slice(0, 10) : '',
    competition: game.competition,
    teamHome: game.teamHome,
    teamAway: game.teamAway,
    scoreHome: game.scoreHome,
    scoreAway: game.scoreAway,
    firstRefereeId: referee1?.refereeId || null,
    firstRefereeName: referee1?.refereeName || referee1?.externalName || '',
    secondRefereeId: referee2?.refereeId || null,
    secondRefereeName: referee2?.refereeName || referee2?.externalName || '',
    observerUserId: observer?.userId || null,
    observerName: observer?.userName || observer?.externalName || '',
    existingReportId: game.reportId,
    existingReportStatus: game.reportStatus
  };
}
