import { config } from '../config.js';
import { dbGet, dbAll, dbRun } from '../database/db.js';
import { HttpError } from '../utils/httpError.js';
import { parseFipUrl, fetchAllGiornate, discoverGironi, resolveFase } from './fip/fipAdapter.js';
import {
  analyticsSeasonCode,
  createAnalyticsClient,
  fetchAnalyticsCampionati,
  fetchAnalyticsGames,
  listGironi
} from './fip/fipAnalyticsAdapter.js';
import { resolveRefereeName, normalizedNameKey } from './nameMatching.js';
import { createGame, updateGame, setOfficial, getOfficialRow, removeOfficial, recordGameChange } from './gameService.js';

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
    const discovered = await discoverGironi(baseParams, { fetchImpl });
    gironi = discovered.gironi;
    if (!gironi.length) {
      throw new HttpError(400, 'Nessun girone trovato in questa pagina FIP: verificare campionato e fase selezionati.');
    }
    if (!baseParams.codice_fase && discovered.codiceFase) baseParams.codice_fase = discovered.codiceFase;
  }

  // Senza codice_fase il sito FIP restituisce una pagina vuota quando è presente
  // il girone: va ricavato adesso, altrimenti la sorgente nascerebbe muta.
  if (!baseParams.codice_fase) {
    const codiceFase = await resolveFase(baseParams, { fetchImpl });
    if (codiceFase) baseParams.codice_fase = codiceFase;
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
    if (params.codice_fase) canonicalUrl.searchParams.set('codice_fase', params.codice_fase);
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
  if (source.sourceType === 'fip_analytics' && url !== undefined) {
    throw new HttpError(400, 'Una sorgente FIP Analytics non ha un link da modificare: eliminarla e crearne una nuova.');
  }
  const nextUrl = url !== undefined ? asText(url) : source.url;
  const params = url !== undefined ? parseFipUrl(nextUrl) : source.params;
  // Un nuovo URL senza girone eredita quello già configurato.
  if (url !== undefined && params && !params.codice_girone && source.params?.codice_girone) {
    params.codice_girone = source.params.codice_girone;
  }
  // Idem per la fase: senza, il sito FIP risponde con una pagina vuota.
  if (url !== undefined && params && !params.codice_fase && source.params?.codice_fase) {
    params.codice_fase = source.params.codice_fase;
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
const RESULT_FIELDS = new Set(['status', 'scoreHome', 'scoreAway']);

// Salva la fase ricavata al volo, sulla sorgente e nel link mostrato in elenco,
// così le sincronizzazioni successive partono già complete.
async function saveSourceFase(source, codiceFase) {
  const params = { ...source.params, codice_fase: codiceFase };
  let url = source.url;
  try {
    const parsed = new URL(source.url);
    parsed.searchParams.set('codice_fase', codiceFase);
    url = parsed.toString();
  } catch (_) {
    // URL non parsabile: si aggiornano comunque i parametri.
  }
  await dbRun(
    `UPDATE competition_sources SET params_json = ?, url = ?, updated_at = iso_now() WHERE id = ?`,
    [JSON.stringify(params), url, source.id]
  );
}

// Applica alla singola gara i dati FIP di una giornata. Idempotente: nessuna
// modifica se i dati coincidono. Non tocca mai l'osservatore.
async function applyFipGame({ fipGame, giornata, leg = null, source, syncRunId, user, summary, counters }) {
  const existing = await dbGet(
    `SELECT g.*, cs.source_type AS owner_source_type, cs.active AS owner_active
       FROM games g
       LEFT JOIN competition_sources cs ON cs.id = g.competition_source_id
      WHERE g.sport_season = ? AND g.match_number = ?`,
    [source.sportSeason, fipGame.matchNumber]
  );
  // Gara passata a una sorgente FIP Analytics attiva: calendario e arbitri
  // arrivano da lì, il sito pubblico aggiorna solo risultato e stato.
  const analyticsOwned = Boolean(existing && existing.owner_source_type === 'fip_analytics' && existing.owner_active);

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
      if (analyticsOwned && !RESULT_FIELDS.has(field)) continue;
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

  if (analyticsOwned) return;

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
  if (source.sourceType !== 'fip_public') throw new HttpError(400, 'Questa sorgente non è del sito FIP pubblico.');
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
    // Sorgenti salvate senza codice_fase: il sito FIP risponderebbe con una
    // pagina vuota. La fase viene ricavata una volta sola e salvata.
    let params = source.params;
    if (!params.codice_fase) {
      const codiceFase = await resolveFase(params, { fetchImpl });
      if (!codiceFase) {
        throw new HttpError(502, 'Fase FIP non individuata: aprire la pagina Risultati, selezionare fase e girone e reincollare il link nella sorgente.');
      }
      params = { ...params, codice_fase: codiceFase };
      await saveSourceFase(source, codiceFase);
      summary.faseRecovered = codiceFase;
    }

    const giornate = await fetchAllGiornate(params, { fetchImpl });
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

    // Una pagina FIP valida ma senza gare non è un successo silenzioso: di solito
    // il calendario del girone non è ancora pubblicato.
    if (!giornate.some((entry) => entry.games.length)) {
      summary.errors.push({
        message: 'Nessuna gara trovata sulla pagina FIP: il calendario di questo girone potrebbe non essere ancora pubblicato.'
      });
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

// ---------------------------------------------------------------------------
// FIP Analytics (analytics.fip.it)
//
// Stessa pipeline del sito pubblico (conflitti, blocchi manuali, game_changes),
// con due differenze: gli arbitri si riconoscono dalla tessera e le
// designazioni arrivano appena il designatore le carica. Una gara sincronizzata
// da qui passa alla sorgente FIP Analytics: da quel momento il sito pubblico
// aggiorna solo risultato e stato (vedi applyFipGame).
// ---------------------------------------------------------------------------

const ANALYTICS_URL = 'https://analytics.fip.it';
const CAMPIONATO_CODE = /^[A-Za-z0-9/_-]{1,16}$/;
const CALENDAR_FIELDS = {
  matchday: 'matchday',
  leg: 'leg',
  scheduledAt: 'scheduled_at',
  teamHome: 'team_home',
  teamAway: 'team_away',
  venue: 'venue',
  phase: 'phase',
  girone: 'girone'
};
// Origini che FIP Analytics può sostituire o liberare. Manuale e PDF federale
// restano: se diversi, diventano un conflitto da verificare.
const ANALYTICS_REPLACEABLE_ORIGINS = new Set(['fip_public', 'fip_analytics', 'xlsx']);
const SOURCE_TYPE_LABELS = { fip_public: 'Sito FIP', fip_analytics: 'FIP Analytics' };

function analyticsCredentials() {
  return { username: config.fipAnalytics.username, password: config.fipAnalytics.password };
}

export function isFipAnalyticsConfigured(credentials = analyticsCredentials()) {
  return Boolean(credentials.username && credentials.password);
}

export async function listAnalyticsCampionati({ sportSeason }, { fetchImpl = fetch, credentials = analyticsCredentials() } = {}) {
  analyticsSeasonCode(sportSeason);
  const client = createAnalyticsClient({ ...credentials, fetchImpl });
  return fetchAnalyticsCampionati({ client, season: sportSeason });
}

// Crea una sorgente per ogni girone (e fase) del campionato FIP, come fa il
// sito pubblico: l'elenco gare resta raggruppato per girone. I gironi già
// configurati per la stagione vengono saltati, così la stessa operazione fatta
// più avanti aggiunge solo le fasi nuove (play-off, play-out).
export async function createAnalyticsSources(
  { sportSeason, name = '', competition = '', codCampionato = '' },
  { fetchImpl = fetch, credentials = analyticsCredentials() } = {}
) {
  const season = asText(sportSeason);
  analyticsSeasonCode(season);
  const code = asText(codCampionato);
  if (!CAMPIONATO_CODE.test(code)) throw new HttpError(400, 'Campionato FIP non valido: sceglierlo dall’elenco.');
  const cleanCompetition = asText(competition);
  if (!cleanCompetition) {
    throw new HttpError(400, 'Scegli il campionato della web app a cui collegare le gare.');
  }
  const competitionRow = await dbGet('SELECT label FROM competitions WHERE value = ?', [cleanCompetition]);
  if (!competitionRow) throw new HttpError(400, 'Campionato della web app non trovato.');

  const client = createAnalyticsClient({ ...credentials, fetchImpl });
  const games = (await fetchAnalyticsGames({ client, season, codCampionato: code })).filter((game) => !game.deleted);
  const gironi = listGironi(games);
  if (!gironi.length) {
    throw new HttpError(400, `Nessuna gara del campionato ${code} su FIP Analytics per la stagione ${season}.`);
  }

  const configured = new Set(
    (await listSources({ season }))
      .filter((existing) => existing.sourceType === 'fip_analytics' && existing.params?.cod_campionato === code)
      .map((existing) => `${existing.params.fase || ''}|${existing.params.girone || ''}`)
  );
  const multiplePhases = new Set(gironi.map((girone) => girone.phase)).size > 1;
  const baseName = asText(name) || competitionRow.label || code;

  const sources = [];
  const skipped = [];
  for (const girone of gironi) {
    const label = [multiplePhases ? girone.phase : '', girone.girone].filter(Boolean).join(' ') || girone.phase || code;
    if (configured.has(`${girone.phase}|${girone.girone}`)) {
      skipped.push(label);
      continue;
    }
    const params = { cod_campionato: code, fase: girone.phase, girone: girone.girone };
    const result = await dbRun(
      `INSERT INTO competition_sources (sport_season, name, source_type, url, params_json, competition)
       VALUES (?, ?, 'fip_analytics', ?, ?, ?) RETURNING id`,
      [season, gironi.length > 1 ? `${baseName} — ${label}` : baseName, ANALYTICS_URL, JSON.stringify(params), cleanCompetition]
    );
    sources.push(await getSource(result.rows[0].id));
  }

  if (!sources.length) {
    throw new HttpError(409, 'Tutti i gironi di questo campionato sono già configurati per questa stagione.');
  }
  return { sources, skipped };
}

async function findGameByNumber(season, matchNumber) {
  // Gare inserite a mano possono avere il numero senza zeri iniziali.
  return dbGet(
    `SELECT g.*, cs.name AS owner_name, cs.source_type AS owner_source_type
       FROM games g
       LEFT JOIN competition_sources cs ON cs.id = g.competition_source_id
      WHERE g.sport_season = ? AND (g.match_number = ? OR ltrim(g.match_number, '0') = ltrim(?, '0'))
      ORDER BY (g.match_number = ?) DESC
      LIMIT 1`,
    [season, matchNumber, matchNumber, matchNumber]
  );
}

// Prima la tessera (dato certo), poi gli alias e il nome come per il sito
// pubblico. Gli alias confermati sul sito FIP valgono anche qui: stesso formato.
async function resolveAnalyticsReferee({ externalName, license }) {
  if (license) {
    const rows = await dbAll(`SELECT id FROM referees WHERE ltrim(license_number, '0') = ?`, [license]);
    if (rows.length === 1) return { refereeId: rows[0].id, via: 'license', candidates: [] };
  }
  const resolution = await resolveRefereeName(externalName, { source: 'fip_analytics' });
  if (resolution.refereeId) return resolution;
  const publicAlias = await dbGet(
    `SELECT referee_id FROM person_aliases WHERE source = 'fip_public' AND normalized_name = ? AND referee_id IS NOT NULL`,
    [normalizedNameKey(externalName)]
  );
  return publicAlias ? { refereeId: publicAlias.referee_id, via: 'alias', candidates: [] } : resolution;
}

function sourceLabel(type, name) {
  return [SOURCE_TYPE_LABELS[type] || '', name || ''].filter(Boolean).join(' · ');
}

async function applyAnalyticsCalendar({ game, existing, source, syncRunId, user, summary, counters }) {
  const touched = await manuallyTouchedFields(existing.id);
  const updates = {};
  for (const [field, column] of Object.entries(CALENDAR_FIELDS)) {
    const currentValue = existing[column] === null || existing[column] === undefined ? '' : String(existing[column]);
    const incomingValue = game[field] === null || game[field] === undefined ? '' : String(game[field]);
    if (currentValue === incomingValue || !incomingValue) continue; // dato assente: non cancellare
    if (touched.has(field)) {
      summary.conflicts.push({
        matchNumber: game.matchNumber,
        field,
        currentValue,
        incomingValue,
        currentSource: 'manual',
        incomingSource: 'fip_analytics',
        proposal: 'Verificare e aggiornare manualmente se corretto.'
      });
      counters.conflicts += 1;
      continue;
    }
    updates[field] = game[field];
  }
  if (!Object.keys(updates).length) return;

  try {
    await updateGame(existing.id, updates, { user, source: 'fip_analytics', syncRunId });
    counters.updated += 1;
  } catch (err) {
    if (!(err instanceof HttpError && err.statusCode === 409)) throw err;
    summary.conflicts.push({
      matchNumber: game.matchNumber,
      field: Object.keys(updates).join(', '),
      currentValue: 'gara con rapporto definitivo',
      incomingValue: JSON.stringify(updates),
      currentSource: 'report_final',
      incomingSource: 'fip_analytics',
      proposal: 'Richiede conferma amministrativa dal dettaglio gara.'
    });
    counters.conflicts += 1;
  }
}

async function applyAnalyticsReferees({ game, gameId, syncRunId, user, summary, counters }) {
  for (const role of REFEREE_ROLES) {
    const incoming = game.referees[role];
    const existingOfficial = await getOfficialRow(gameId, role);

    // Posto vuoto su FIP Analytics (mai designato, rifiutato o revocato):
    // si libera solo se l'arbitro era arrivato da una sorgente esterna.
    if (!incoming) {
      if (existingOfficial && !existingOfficial.manual_lock && ANALYTICS_REPLACEABLE_ORIGINS.has(existingOfficial.source)) {
        await removeOfficial(gameId, role, {
          user,
          syncRunId,
          source: 'fip_analytics',
          reason: 'Designazione non più attiva su FIP Analytics'
        });
        counters.officials += 1;
      }
      continue;
    }

    const incomingKey = normalizedNameKey(incoming.externalName);
    const existingKey = existingOfficial ? normalizedNameKey(existingOfficial.external_name || '') : '';
    const protectedOfficial = existingOfficial && (existingOfficial.manual_lock || !ANALYTICS_REPLACEABLE_ORIGINS.has(existingOfficial.source));
    if (protectedOfficial) {
      if (existingKey !== incomingKey) {
        summary.conflicts.push({
          matchNumber: game.matchNumber,
          field: `ufficiale:${role}`,
          currentValue: existingOfficial.external_name,
          incomingValue: incoming.externalName,
          currentSource: existingOfficial.manual_lock ? `${existingOfficial.source} (bloccato)` : existingOfficial.source,
          incomingSource: 'fip_analytics',
          proposal: existingOfficial.manual_lock
            ? 'Valore bloccato manualmente: sbloccare per accettare la designazione FIP.'
            : 'Confermare la designazione FIP dal dettaglio gara.'
        });
        counters.conflicts += 1;
      }
      continue;
    }

    const resolution = await resolveAnalyticsReferee(incoming);
    const sameIdentity =
      Boolean(existingOfficial) &&
      existingKey === incomingKey &&
      (existingOfficial.referee_id || null) === (resolution.refereeId || null);
    const sameStatus = existingOfficial?.status === incoming.status;
    if (sameIdentity && sameStatus && existingOfficial.source === 'fip_analytics') continue;

    await setOfficial(
      gameId,
      {
        role,
        refereeId: resolution.refereeId,
        externalName: incoming.externalName,
        source: 'fip_analytics',
        status: incoming.status
      },
      { user, syncRunId }
    );
    if (!sameIdentity || !sameStatus) counters.officials += 1;

    if (!resolution.refereeId) {
      summary.unresolved.push({
        matchNumber: game.matchNumber,
        role,
        externalName: incoming.externalName,
        candidates: resolution.candidates || []
      });
    }
  }
}

async function applyAnalyticsGame({ game, source, syncRunId, user, summary, counters }) {
  const existing = await findGameByNumber(source.sportSeason, game.matchNumber);

  if (game.deleted) {
    // Lo stato della gara lo decide il sito pubblico: qui si segnala e basta.
    if (existing && existing.status !== 'cancelled') {
      summary.conflicts.push({
        matchNumber: game.matchNumber,
        field: 'gara',
        currentValue: 'in calendario',
        incomingValue: 'eliminata su FIP Analytics',
        currentSource: existing.external_source,
        incomingSource: 'fip_analytics',
        proposal: 'Verificare e, se confermato, annullare la gara dal dettaglio.'
      });
      counters.conflicts += 1;
    }
    return;
  }

  let gameId;
  if (!existing) {
    const created = await createGame({
      data: {
        sportSeason: source.sportSeason,
        matchNumber: game.matchNumber,
        competition: source.competition,
        phase: game.phase,
        girone: game.girone,
        matchday: game.matchday,
        leg: game.leg,
        scheduledAt: game.scheduledAt,
        teamHome: game.teamHome,
        teamAway: game.teamAway,
        venue: game.venue
      },
      user,
      source: 'fip_analytics',
      competitionSourceId: source.id,
      syncRunId
    });
    gameId = created.id;
    counters.created += 1;
  } else {
    gameId = existing.id;
    if (existing.competition_source_id !== source.id) {
      await dbRun('UPDATE games SET competition_source_id = ?, updated_at = iso_now() WHERE id = ?', [source.id, gameId]);
      await recordGameChange({
        gameId,
        field: 'sorgente',
        oldValue: sourceLabel(existing.owner_source_type, existing.owner_name),
        newValue: sourceLabel('fip_analytics', source.name),
        source: 'fip_analytics',
        changedBy: user?.id || null,
        syncRunId,
        reason: 'Calendario e arbitri da FIP Analytics; risultato dal sito FIP'
      });
    }
    await applyAnalyticsCalendar({ game, existing, source, syncRunId, user, summary, counters });
  }

  await applyAnalyticsReferees({ game, gameId, syncRunId, user, summary, counters });
}

// `cache` (facoltativa) evita di riscaricare lo stesso campionato quando più
// sorgenti-girone vengono sincronizzate nello stesso giro automatico.
export async function runAnalyticsSync(
  sourceId,
  { user = null, fetchImpl = fetch, credentials = analyticsCredentials(), cache = null } = {}
) {
  const source = await getSource(sourceId);
  if (source.sourceType !== 'fip_analytics') throw new HttpError(400, 'Questa sorgente non è di FIP Analytics.');
  if (!source.active) throw new HttpError(400, 'La sorgente è disattivata.');
  if (!source.params?.cod_campionato) throw new HttpError(400, 'Campionato FIP mancante: eliminare la sorgente e ricrearla.');
  if (!isFipAnalyticsConfigured(credentials)) {
    throw new HttpError(400, 'Credenziali FIP Analytics non configurate: impostare FIP_ANALYTICS_USERNAME e FIP_ANALYTICS_PASSWORD.');
  }
  if (syncInFlight.has(source.id)) {
    throw new HttpError(409, 'Sincronizzazione già in corso per questa sorgente.');
  }

  syncInFlight.add(source.id);
  const runResult = await dbRun(
    `INSERT INTO sync_runs (type, competition_source_id, started_by) VALUES ('fip_sync', ?, ?) RETURNING id`,
    [source.id, user?.id || null]
  );
  const syncRunId = runResult.rows[0].id;

  const summary = { conflicts: [], unresolved: [], errors: [], giornate: 0, gamesRead: 0 };
  const counters = { created: 0, updated: 0, conflicts: 0, officials: 0 };
  let status = 'success';

  try {
    const cacheKey = `${source.sportSeason}|${source.params.cod_campionato}`;
    let pending = cache?.get(cacheKey);
    if (!pending) {
      const client = createAnalyticsClient({ ...credentials, fetchImpl });
      pending = fetchAnalyticsGames({ client, season: source.sportSeason, codCampionato: source.params.cod_campionato });
      cache?.set(cacheKey, pending);
    }
    const games = (await pending).filter(
      (game) =>
        (!source.params.fase || game.phase === source.params.fase) &&
        (!source.params.girone || game.girone === source.params.girone)
    );
    summary.gamesRead = games.length;
    summary.giornate = new Set(games.map((game) => game.matchday).filter(Boolean)).size;

    for (const game of games) {
      try {
        await applyAnalyticsGame({ game, source, syncRunId, user, summary, counters });
      } catch (err) {
        summary.errors.push({ matchNumber: game.matchNumber, message: err.message });
      }
    }

    if (!games.length) {
      summary.errors.push({
        message: 'Nessuna gara trovata su FIP Analytics per questo girone: verificare che il calendario sia già caricato.'
      });
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
    sourceType: 'fip_analytics',
    created: counters.created,
    updated: counters.updated,
    officialsUpdated: counters.officials,
    conflicts: summary.conflicts,
    unresolved: summary.unresolved,
    errors: summary.errors,
    giornate: summary.giornate,
    gamesRead: summary.gamesRead
  };
}

// Punto d'ingresso unico per pulsante "Sincronizza" e job automatici.
export async function runSourceSync(sourceId, options = {}) {
  const source = await getSource(sourceId);
  if (source.sourceType === 'fip_analytics') return runAnalyticsSync(sourceId, options);
  return runFipSync(sourceId, options);
}
