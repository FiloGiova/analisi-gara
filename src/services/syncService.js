import { dbGet, dbAll, dbRun } from '../database/db.js';
import { HttpError } from '../utils/httpError.js';
import { parseFipUrl, fetchAllGiornate, discoverGironi } from './fip/fipAdapter.js';
import { resolveRefereeName, normalizedNameKey } from './nameMatching.js';
import { createGame, updateGame, setOfficial, getOfficialRow } from './gameService.js';

// Guard anti doppio-click: una sola sincronizzazione per sorgente alla volta
// (processo Node singolo, basta un Set in memoria).
const syncInFlight = new Set();

function asText(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function rowToSource(row) {
  if (!row) return null;
  let params = null;
  try {
    params = row.params_json ? JSON.parse(row.params_json) : null;
  } catch (_) {
    params = null;
  }
  return {
    id: row.id,
    sportSeason: row.sport_season,
    name: row.name,
    sourceType: row.source_type,
    url: row.url,
    params,
    competition: row.competition || '',
    active: Boolean(row.active),
    lastSyncedAt: row.last_synced_at || null,
    lastSyncStatus: row.last_sync_status || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function listSources({ season = '' } = {}) {
  const clauses = [];
  const params = [];
  if (season) {
    clauses.push('sport_season = ?');
    params.push(season);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = await dbAll(`SELECT * FROM competition_sources ${where} ORDER BY sport_season DESC, name`, params);
  return rows.map(rowToSource);
}

export async function getSource(id) {
  const source = rowToSource(await dbGet('SELECT * FROM competition_sources WHERE id = ?', [id]));
  if (!source) throw new HttpError(404, 'Sorgente non trovata.');
  return source;
}

// Crea le sorgenti da un link FIP. Se il link non contiene il girone (il sito
// non lo mette nell'URL finché non si usa il menu a tendina), i gironi vengono
// scoperti dalla pagina e viene creata UNA SORGENTE PER OGNUNO: vanno importati
// tutti comunque. I gironi già configurati per la stagione vengono saltati.
export async function createSource({ sportSeason, name, url, competition = '', codiceGirone = '' }, { fetchImpl = fetch } = {}) {
  const season = asText(sportSeason);
  if (!season) throw new HttpError(400, 'Stagione sportiva obbligatoria.');
  const baseParams = parseFipUrl(url);
  if (asText(codiceGirone)) baseParams.codice_girone = asText(codiceGirone);

  let gironi;
  if (baseParams.codice_girone) {
    gironi = [{ codice: baseParams.codice_girone, label: '' }];
  } else {
    gironi = await discoverGironi(baseParams, { fetchImpl });
    if (!gironi.length) {
      throw new HttpError(400, 'Nessun girone trovato in questa pagina FIP: verificare campionato e fase selezionati.');
    }
  }

  const alreadyConfigured = new Set(
    (await listSources({ season }))
      .map((existing) => existing.params?.codice_girone)
      .filter(Boolean)
  );

  const sources = [];
  const skipped = [];
  for (const girone of gironi) {
    const label = girone.label || `Girone ${girone.codice}`;
    if (alreadyConfigured.has(girone.codice)) {
      skipped.push(label);
      continue;
    }
    const params = { ...baseParams, codice_girone: girone.codice };
    const canonicalUrl = new URL(asText(url));
    canonicalUrl.searchParams.set('codice_girone', girone.codice);
    const cleanName = asText(name) ? (gironi.length > 1 ? `${asText(name)} — ${label}` : asText(name)) : label;
    const result = await dbRun(
      `INSERT INTO competition_sources (sport_season, name, source_type, url, params_json, competition)
       VALUES (?, ?, 'fip_public', ?, ?, ?) RETURNING id`,
      [season, cleanName, canonicalUrl.toString(), JSON.stringify(params), asText(competition) || null]
    );
    sources.push(await getSource(result.rows[0].id));
  }

  if (!sources.length) {
    throw new HttpError(409, 'Tutti i gironi di questo link sono già configurati per questa stagione.');
  }

  return { sources, skipped };
}

export async function updateSource(id, { name, url, competition, active, sportSeason } = {}) {
  const source = await getSource(id);
  const nextUrl = url !== undefined ? asText(url) : source.url;
  const params = url !== undefined ? parseFipUrl(nextUrl) : source.params;
  // Un nuovo URL senza girone eredita quello già configurato.
  if (url !== undefined && params && !params.codice_girone && source.params?.codice_girone) {
    params.codice_girone = source.params.codice_girone;
  }
  if (url !== undefined && !params?.codice_girone) {
    throw new HttpError(400, 'Il nuovo link non contiene il girone: incollare il link del girone specifico.');
  }

  await dbRun(
    `UPDATE competition_sources
        SET name = ?, url = ?, params_json = ?, competition = ?, active = ?, sport_season = ?,
            updated_at = iso_now()
      WHERE id = ?`,
    [
      name !== undefined ? asText(name) || source.name : source.name,
      nextUrl,
      JSON.stringify(params),
      competition !== undefined ? asText(competition) || null : source.competition || null,
      active !== undefined ? (active ? 1 : 0) : source.active ? 1 : 0,
      sportSeason !== undefined ? asText(sportSeason) || source.sportSeason : source.sportSeason,
      id
    ]
  );

  return getSource(id);
}

export async function deleteSource(id) {
  await getSource(id);
  await dbRun('DELETE FROM competition_sources WHERE id = ?', [id]);
}

export async function listSyncRuns(sourceId, { limit = 20 } = {}) {
  const rows = await dbAll(
    `SELECT sr.*, u.display_name AS started_by_name
       FROM sync_runs sr
       LEFT JOIN users u ON u.id = sr.started_by
      WHERE sr.competition_source_id = ?
      ORDER BY sr.id DESC
      LIMIT ?`,
    [sourceId, limit]
  );
  return rows.map((row) => {
    let summary = null;
    try {
      summary = row.summary_json ? JSON.parse(row.summary_json) : null;
    } catch (_) {
      summary = null;
    }
    return {
      id: row.id,
      type: row.type,
      startedByName: row.started_by_name || '',
      startedAt: row.started_at,
      finishedAt: row.finished_at || null,
      status: row.status,
      createdCount: row.created_count,
      updatedCount: row.updated_count,
      conflictCount: row.conflict_count,
      errorCount: row.error_count,
      summary
    };
  });
}

async function manuallyTouchedFields(gameId) {
  const rows = await dbAll(`SELECT DISTINCT field FROM game_changes WHERE game_id = ? AND source = 'manual'`, [gameId]);
  return new Set(rows.map((row) => row.field));
}

const REFEREE_ROLES = ['referee1', 'referee2', 'referee3'];

// Applica alla singola gara i dati FIP di una giornata. Idempotente: nessuna
// modifica se i dati coincidono. Non tocca mai l'osservatore.
async function applyFipGame({ fipGame, giornata, leg = null, source, syncRunId, user, summary, counters }) {
  const existing = await dbGet('SELECT * FROM games WHERE sport_season = ? AND match_number = ?', [
    source.sportSeason,
    fipGame.matchNumber
  ]);

  const incoming = {
    matchday: giornata,
    leg: leg || null,
    scheduledAt: fipGame.scheduledAt || '',
    teamHome: fipGame.teamHome,
    teamAway: fipGame.teamAway,
    venue: fipGame.venue,
    status: fipGame.status,
    scoreHome: fipGame.scoreHome,
    scoreAway: fipGame.scoreAway
  };

  let gameId;
  if (!existing) {
    const created = await createGame({
      data: {
        sportSeason: source.sportSeason,
        matchNumber: fipGame.matchNumber,
        competition: source.competition,
        ...incoming
      },
      user,
      source: 'fip_public',
      competitionSourceId: source.id,
      syncRunId
    });
    gameId = created.id;
    counters.created += 1;
  } else {
    gameId = existing.id;
    const touched = await manuallyTouchedFields(gameId);
    const columnByField = {
      matchday: 'matchday',
      leg: 'leg',
      scheduledAt: 'scheduled_at',
      teamHome: 'team_home',
      teamAway: 'team_away',
      venue: 'venue',
      status: 'status',
      scoreHome: 'score_home',
      scoreAway: 'score_away'
    };

    const updates = {};
    for (const [field, column] of Object.entries(columnByField)) {
      const currentValue = existing[column] === null || existing[column] === undefined ? '' : String(existing[column]);
      const incomingValue = incoming[field] === null || incoming[field] === undefined ? '' : String(incoming[field]);
      if (currentValue === incomingValue) continue;
      if (!incomingValue && field !== 'status') continue; // dato FIP assente: non cancellare
      if (touched.has(field)) {
        summary.conflicts.push({
          matchNumber: fipGame.matchNumber,
          field,
          currentValue,
          incomingValue,
          currentSource: 'manual',
          incomingSource: 'fip_public',
          proposal: 'Verificare e aggiornare manualmente se corretto.'
        });
        counters.conflicts += 1;
        continue;
      }
      updates[field] = incoming[field];
    }

    if (Object.keys(updates).length) {
      try {
        await updateGame(gameId, updates, { user, source: 'fip_public', syncRunId });
        counters.updated += 1;
      } catch (err) {
        if (err instanceof HttpError && err.statusCode === 409) {
          summary.conflicts.push({
            matchNumber: fipGame.matchNumber,
            field: Object.keys(updates).join(', '),
            currentValue: 'gara con rapporto definitivo',
            incomingValue: JSON.stringify(updates),
            currentSource: 'report_final',
            incomingSource: 'fip_public',
            proposal: 'Richiede conferma amministrativa dal dettaglio gara.'
          });
          counters.conflicts += 1;
        } else {
          throw err;
        }
      }
    }
  }

  // Arbitri pubblicati dalla FIP. L'osservatore non è mai presente nei dati
  // FIP e non viene mai toccato dal sync.
  const incomingReferees = { referee1: fipGame.referee1, referee2: fipGame.referee2, referee3: fipGame.referee3 };
  for (const role of REFEREE_ROLES) {
    const externalName = asText(incomingReferees[role]);
    if (!externalName) continue; // designazione non (più) visibile: non cancellare

    const existingOfficial = await getOfficialRow(gameId, role);
    const incomingKey = normalizedNameKey(externalName);
    const existingKey = existingOfficial ? normalizedNameKey(existingOfficial.external_name || '') : '';

    if (existingOfficial && existingOfficial.manual_lock) {
      if (existingKey !== incomingKey) {
        summary.conflicts.push({
          matchNumber: fipGame.matchNumber,
          field: `ufficiale:${role}`,
          currentValue: existingOfficial.external_name,
          incomingValue: externalName,
          currentSource: `${existingOfficial.source} (bloccato)`,
          incomingSource: 'fip_public',
          proposal: 'Valore bloccato manualmente: sbloccare per accettare il dato FIP.'
        });
        counters.conflicts += 1;
      }
      continue;
    }

    if (existingOfficial && existingOfficial.source === 'manual' && existingKey !== incomingKey) {
      summary.conflicts.push({
        matchNumber: fipGame.matchNumber,
        field: `ufficiale:${role}`,
        currentValue: existingOfficial.external_name,
        incomingValue: externalName,
        currentSource: 'manual',
        incomingSource: 'fip_public',
        proposal: 'Confermare la designazione FIP dal dettaglio gara.'
      });
      counters.conflicts += 1;
      continue;
    }

    const resolution = await resolveRefereeName(externalName, { source: 'fip_public' });
    const sameIdentity =
      existingOfficial &&
      existingKey === incomingKey &&
      (existingOfficial.referee_id || null) === (resolution.refereeId || null);
    if (sameIdentity) continue;

    await setOfficial(
      gameId,
      {
        role,
        refereeId: resolution.refereeId,
        externalName,
        source: 'fip_public',
        status: 'confirmed'
      },
      { user, syncRunId }
    );
    counters.officials += 1;

    if (!resolution.refereeId) {
      summary.unresolved.push({
        matchNumber: fipGame.matchNumber,
        role,
        externalName,
        candidates: resolution.candidates
      });
    }
  }
}

export async function runFipSync(sourceId, { user = null, fetchImpl = fetch } = {}) {
  const source = await getSource(sourceId);
  if (source.sourceType !== 'fip_public') throw new HttpError(400, 'Tipo di sorgente non sincronizzabile.');
  if (!source.active) throw new HttpError(400, 'La sorgente è disattivata.');
  if (!source.params?.codice_girone) throw new HttpError(400, 'Parametri FIP mancanti: modifica la sorgente reinserendo il link del girone.');
  if (syncInFlight.has(source.id)) {
    throw new HttpError(409, 'Sincronizzazione già in corso per questa sorgente.');
  }

  syncInFlight.add(source.id);
  const runResult = await dbRun(
    `INSERT INTO sync_runs (type, competition_source_id, started_by) VALUES ('fip_sync', ?, ?) RETURNING id`,
    [source.id, user?.id || null]
  );
  const syncRunId = runResult.rows[0].id;

  const summary = { conflicts: [], unresolved: [], errors: [], giornate: 0 };
  const counters = { created: 0, updated: 0, conflicts: 0, officials: 0 };
  let status = 'success';

  try {
    const giornate = await fetchAllGiornate(source.params, { fetchImpl });
    summary.giornate = giornate.length;

    for (const { giornata, leg, games } of giornate) {
      for (const fipGame of games) {
        if (!fipGame.matchNumber) continue;
        try {
          await applyFipGame({ fipGame, giornata, leg, source, syncRunId, user, summary, counters });
        } catch (err) {
          summary.errors.push({ matchNumber: fipGame.matchNumber, giornata, message: err.message });
        }
      }
    }

    if (summary.errors.length || summary.conflicts.length) status = 'partial';
  } catch (err) {
    status = 'error';
    summary.errors.push({ message: err.message });
  } finally {
    await dbRun(
      `UPDATE sync_runs
          SET finished_at = iso_now(),
              status = ?, created_count = ?, updated_count = ?, conflict_count = ?, error_count = ?, summary_json = ?
        WHERE id = ?`,
      [status, counters.created, counters.updated, counters.conflicts, summary.errors.length, JSON.stringify(summary), syncRunId]
    );

    await dbRun(
      `UPDATE competition_sources
          SET last_synced_at = iso_now(), last_sync_status = ?, updated_at = iso_now()
        WHERE id = ?`,
      [status, source.id]
    );

    syncInFlight.delete(source.id);
  }

  if (status === 'error') {
    throw new HttpError(502, `Sincronizzazione fallita: ${summary.errors[0]?.message || 'errore sconosciuto'}`, { syncRunId });
  }

  return {
    syncRunId,
    status,
    created: counters.created,
    updated: counters.updated,
    officialsUpdated: counters.officials,
    conflicts: summary.conflicts,
    unresolved: summary.unresolved,
    errors: summary.errors,
    giornate: summary.giornate
  };
}
