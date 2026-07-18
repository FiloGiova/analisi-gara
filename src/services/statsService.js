import { dbGet, dbAll } from '../database/db.js';
import { HttpError } from '../utils/httpError.js';
import { availabilityByObserverOnDate, availabilityPeriodLabel } from './observerAvailabilityService.js';

// Visionamenti derivati da rapporti e designazioni: mai registrati a mano.
// - completato: rapporto DEFINITIVO (una riga per ciascuno dei due arbitri);
// - bozza: rapporto non ancora definitivo;
// - programmato: gara con osservatore e arbitri designati, senza rapporto;
// - le gare annullate non contano.

function observerKeyOf(observerId, observerName) {
  return observerId ? `u${observerId}` : `n:${String(observerName || '').trim().toLowerCase()}`;
}

async function loadReportEvaluations(status, type, season, competitions = [], phaseIds = []) {
  const clauses = ['r.status = ?', 'r.sport_season = ?'];
  const params = [status, season];
  // Filtrando per campionato/i si tiene solo ciò che è collegato a una gara di
  // quelle competizioni (i rapporti storici senza gara restano fuori).
  if (competitions.length) {
    clauses.push(`g.competition IN (${competitions.map(() => '?').join(', ')})`);
    params.push(...competitions);
  }
  if (phaseIds.length) {
    clauses.push(`g.competition_source_id IN (${phaseIds.map(() => '?').join(', ')})`);
    params.push(...phaseIds);
  }
  const reports = await dbAll(
    `SELECT r.id AS report_id, r.game_id, r.report_date, r.match_number, r.team_home, r.team_away,
            r.observer_id, r.observer_name, COALESCE(u.display_name, r.observer_name) AS observer_label,
            g.matchday, r.first_referee_id, r.second_referee_id,
            r.first_referee_vote, r.second_referee_vote
       FROM reports r
       LEFT JOIN users u ON u.id = r.observer_id
       LEFT JOIN games g ON g.id = r.game_id
      WHERE ${clauses.join(' AND ')}`,
    params
  );

  const rows = [];
  for (const report of reports) {
    const evaluations = [
      { refereeId: report.first_referee_id, vote: report.first_referee_vote },
      { refereeId: report.second_referee_id, vote: report.second_referee_vote }
    ];
    for (const { refereeId, vote } of evaluations) {
      if (!refereeId) continue;
      rows.push({
        type,
        reportId: report.report_id,
        gameId: report.game_id,
        date: report.report_date,
        matchNumber: report.match_number,
        teams: `${report.team_home} - ${report.team_away}`.trim(),
        matchday: report.matchday ?? null,
        refereeId,
        observerId: report.observer_id,
        observerKey: observerKeyOf(report.observer_id, report.observer_name),
        observerLabel: report.observer_label || report.observer_name,
        vote: vote || ''
      });
    }
  }
  return rows;
}

function loadCompleted(season, competitions = [], phaseIds = []) {
  return loadReportEvaluations('final', 'completed', season, competitions, phaseIds);
}

function loadDrafts(season, competitions = [], phaseIds = []) {
  return loadReportEvaluations('draft', 'draft', season, competitions, phaseIds);
}

async function loadScheduled(season, competitions = [], phaseIds = []) {
  const clauses = ['g.sport_season = ?', "g.status != 'cancelled'"];
  const params = [season];
  if (competitions.length) {
    clauses.push(`g.competition IN (${competitions.map(() => '?').join(', ')})`);
    params.push(...competitions);
  }
  if (phaseIds.length) {
    clauses.push(`g.competition_source_id IN (${phaseIds.map(() => '?').join(', ')})`);
    params.push(...phaseIds);
  }
  const rows = await dbAll(
    `SELECT g.id AS game_id, g.matchday, g.scheduled_at, g.match_number, g.team_home, g.team_away,
            obs.user_id AS observer_id, u.display_name AS observer_label, ref.referee_id
       FROM games g
       JOIN game_officials obs ON obs.game_id = g.id AND obs.role = 'observer' AND obs.user_id IS NOT NULL
       JOIN game_officials ref ON ref.game_id = g.id AND ref.role IN ('referee1','referee2','referee3') AND ref.referee_id IS NOT NULL
       JOIN users u ON u.id = obs.user_id
      WHERE ${clauses.join(' AND ')}
        AND NOT EXISTS (SELECT 1 FROM reports r WHERE r.game_id = g.id)`,
    params
  );
  return rows.map((row) => ({
    type: 'scheduled',
    reportId: null,
    gameId: row.game_id,
    date: row.scheduled_at ? row.scheduled_at.slice(0, 10) : '',
    matchNumber: row.match_number,
    teams: `${row.team_home} - ${row.team_away}`.trim(),
    matchday: row.matchday ?? null,
    refereeId: row.referee_id,
    observerId: row.observer_id,
    observerKey: observerKeyOf(row.observer_id, row.observer_label),
    observerLabel: row.observer_label
  }));
}

function daysBetween(isoDate, now = new Date()) {
  if (!isoDate) return null;
  const then = new Date(isoDate);
  if (Number.isNaN(then.getTime())) return null;
  return Math.floor((now - then) / 86400000);
}

// Arbitri "di base" mostrati anche a zero. Filtrando per campionato/i sono quelli
// la cui categoria di stagione (referee_season_categories) è quella competizione,
// coerente con listReferees; senza filtro tutti gli arbitri della stagione.
async function loadBaseReferees(season, competitions = []) {
  if (competitions.length) {
    const placeholders = competitions.map(() => '?').join(', ');
    return dbAll(
      `SELECT r.id, r.last_name, r.first_name, r.license_number, r.active,
              sc.active AS season_active, sc.category AS season_category
         FROM referees r
         JOIN referee_season_categories sc ON sc.referee_id = r.id AND sc.sport_season = ? AND sc.category IN (${placeholders})`,
      [season, ...competitions]
    );
  }
  return dbAll(
    `SELECT r.id, r.last_name, r.first_name, r.license_number, r.active,
            (SELECT rsc.active FROM referee_season_categories rsc WHERE rsc.referee_id = r.id AND rsc.sport_season = ?) AS season_active,
            (SELECT rsc.category FROM referee_season_categories rsc WHERE rsc.referee_id = r.id AND rsc.sport_season = ?) AS season_category
       FROM referees r`,
    [season, season]
  );
}

// Insieme degli id arbitro iscritti a una fascia (esordiente/playoff/playout)
// per il campionato/i e la stagione. null = nessun filtro fascia.
async function loadBandRefereeIds(season, competitions = [], band = '') {
  if (!band) return null;
  const clauses = ['sport_season = ?', 'band = ?'];
  const params = [season, band];
  if (competitions.length) {
    clauses.push(`competition IN (${competitions.map(() => '?').join(', ')})`);
    params.push(...competitions);
  }
  const rows = await dbAll(`SELECT DISTINCT referee_id FROM referee_bands WHERE ${clauses.join(' AND ')}`, params);
  return new Set(rows.map((r) => r.referee_id));
}

// Chi mostrare a zero: filtrando per campionato tutti gli iscritti al roster;
// senza filtro gli attivi nella stagione.
function shouldPadReferee(info, competitions = []) {
  if (competitions.length) return true;
  return info.season_active === 1 || (info.season_active === null && info.active === 1 && info.season_category);
}

// Le statistiche operative mostrano sempre e soltanto gli arbitri attivi,
// sia globalmente sia nella stagione selezionata.
function isStatsActiveReferee(info) {
  return Boolean(info?.active) && (info.season_active === null || info.season_active === undefined || Boolean(info.season_active));
}

// Le sorgenti FIP corrispondono alle singole fasi/gironi importati. Usiamo il
// loro id per filtrare, così nomi uguali in campionati diversi non si mescolano.
export async function listStatsPhases({ season, competitions = [] }) {
  const clauses = ['g.sport_season = ?', 'g.competition_source_id IS NOT NULL'];
  const params = [season];
  if (competitions.length) {
    clauses.push(`g.competition IN (${competitions.map(() => '?').join(', ')})`);
    params.push(...competitions);
  }
  const rows = await dbAll(
    `SELECT DISTINCT g.competition_source_id AS id, cs.name, g.competition
       FROM games g
       JOIN competition_sources cs ON cs.id = g.competition_source_id
      WHERE ${clauses.join(' AND ')}
      ORDER BY cs.name, g.competition`,
    params
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name || `Fase #${row.id}`,
    competition: row.competition || ''
  }));
}

// ---------------------------------------------------------------------------
// Copertura arbitri: l'equivalente calcolato del vecchio foglio "Visionamenti".
// ---------------------------------------------------------------------------
export async function getCoverage({ season, competitions = [], band = '', phaseIds = [] }) {
  const completed = await loadCompleted(season, competitions, phaseIds);
  const drafts = await loadDrafts(season, competitions, phaseIds);
  const scheduled = await loadScheduled(season, competitions, phaseIds);
  const bandIds = await loadBandRefereeIds(season, competitions, band);

  const referees = new Map();
  const baseReferees = await loadBaseReferees(season, competitions);
  const refereeInfo = new Map(baseReferees.map((r) => [r.id, r]));

  function entryFor(refereeId) {
    if (!referees.has(refereeId)) {
      const info = refereeInfo.get(refereeId);
      referees.set(refereeId, {
        refereeId,
        fullName: info ? `${info.last_name} ${info.first_name}`.trim() : `Arbitro #${refereeId}`,
        license: info?.license_number || '',
        category: info?.season_category || '',
        active: isStatsActiveReferee(info),
        completedCount: 0,
        draftCount: 0,
        distinctObservers: new Set(),
        lastCompletedDate: null,
        scheduledCount: 0,
        timeline: new Map()
      });
    }
    return referees.get(refereeId);
  }

  // Arbitri mostrati anche a zero visionamenti (categoria di stagione o roster),
  // eventualmente ristretti alla fascia selezionata.
  for (const info of baseReferees) {
    if (isStatsActiveReferee(info) && shouldPadReferee(info, competitions) && (!bandIds || bandIds.has(info.id))) entryFor(info.id);
  }

  const visibleRows = [...completed, ...drafts, ...scheduled].filter((row) => (
    isStatsActiveReferee(refereeInfo.get(row.refereeId)) && (!bandIds || bandIds.has(row.refereeId))
  ));
  for (const row of visibleRows) {
    const entry = entryFor(row.refereeId);
    if (row.type === 'completed') {
      entry.completedCount += 1;
      entry.distinctObservers.add(row.observerKey);
      if (!entry.lastCompletedDate || row.date > entry.lastCompletedDate) entry.lastCompletedDate = row.date;
    } else if (row.type === 'draft') {
      entry.draftCount += 1;
    } else {
      entry.scheduledCount += 1;
    }
    const matchdayKey = row.matchday ?? 'x';
    if (!entry.timeline.has(matchdayKey)) entry.timeline.set(matchdayKey, []);
    entry.timeline.get(matchdayKey).push({
      type: row.type,
      observerLabel: row.observerLabel,
      gameId: row.gameId,
      reportId: row.reportId,
      vote: row.vote || ''
    });
  }

  const matchdays = [...new Set(visibleRows.map((r) => r.matchday).filter((m) => m !== null))].sort(
    (a, b) => a - b
  );

  const result = [...referees.values()]
    .map((entry) => ({
      refereeId: entry.refereeId,
      fullName: entry.fullName,
      license: entry.license,
      category: entry.category,
      active: entry.active,
      completedCount: entry.completedCount,
      draftCount: entry.draftCount,
      totalCount: entry.completedCount + entry.draftCount + entry.scheduledCount,
      distinctObservers: entry.distinctObservers.size,
      lastCompletedDate: entry.lastCompletedDate,
      daysSinceLast: daysBetween(entry.lastCompletedDate),
      scheduledCount: entry.scheduledCount,
      timeline: Object.fromEntries(entry.timeline)
    }))
    .sort((a, b) => a.fullName.localeCompare(b.fullName));

  return { referees: result, matchdays };
}

// ---------------------------------------------------------------------------
// Impiego arbitri: tutte le gare dirette nella stagione, dalle designazioni.
// Diverso dalla copertura: qui contano le direzioni, non i visionamenti.
// ---------------------------------------------------------------------------
export async function getEmployment({ season, competitions = [], band = '', phaseIds = [] }) {
  const bandIds = await loadBandRefereeIds(season, competitions, band);
  const clauses = [
    'g.sport_season = ?',
    "go.role IN ('referee1', 'referee2', 'referee3')",
    'go.referee_id IS NOT NULL',
    "g.status != 'cancelled'"
  ];
  const params = [season];
  if (competitions.length) {
    clauses.push(`g.competition IN (${competitions.map(() => '?').join(', ')})`);
    params.push(...competitions);
  }
  if (phaseIds.length) {
    clauses.push(`g.competition_source_id IN (${phaseIds.map(() => '?').join(', ')})`);
    params.push(...phaseIds);
  }
  const rows = await dbAll(
    `SELECT go.referee_id, go.role, g.id AS game_id, g.matchday, g.scheduled_at, g.match_number,
            g.team_home, g.team_away, g.status
       FROM game_officials go
       JOIN games g ON g.id = go.game_id
      WHERE ${clauses.join(' AND ')}`,
    params
  );

  const baseReferees = await loadBaseReferees(season, competitions);
  const refereeInfo = new Map(baseReferees.map((r) => [r.id, r]));

  const referees = new Map();
  function entryFor(refereeId) {
    if (!referees.has(refereeId)) {
      const info = refereeInfo.get(refereeId);
      referees.set(refereeId, {
        refereeId,
        fullName: info ? `${info.last_name} ${info.first_name}`.trim() : `Arbitro #${refereeId}`,
        license: info?.license_number || '',
        category: info?.season_category || '',
        active: isStatsActiveReferee(info),
        totalGames: 0,
        asReferee1: 0,
        asReferee2: 0,
        asReferee3: 0,
        lastDate: null,
        timeline: new Map()
      });
    }
    return referees.get(refereeId);
  }

  // Arbitri mostrati anche senza designazioni, eventualmente ristretti alla fascia.
  for (const info of baseReferees) {
    if (isStatsActiveReferee(info) && shouldPadReferee(info, competitions) && (!bandIds || bandIds.has(info.id))) entryFor(info.id);
  }

  const visibleRows = rows.filter((row) => (
    isStatsActiveReferee(refereeInfo.get(row.referee_id)) && (!bandIds || bandIds.has(row.referee_id))
  ));
  for (const row of visibleRows) {
    const entry = entryFor(row.referee_id);
    entry.totalGames += 1;
    if (row.role === 'referee1') entry.asReferee1 += 1;
    if (row.role === 'referee2') entry.asReferee2 += 1;
    if (row.role === 'referee3') entry.asReferee3 += 1;
    const date = row.scheduled_at ? row.scheduled_at.slice(0, 10) : '';
    if (date && (!entry.lastDate || date > entry.lastDate)) entry.lastDate = date;
    const matchdayKey = row.matchday ?? 'x';
    if (!entry.timeline.has(matchdayKey)) entry.timeline.set(matchdayKey, []);
    entry.timeline.get(matchdayKey).push({
      gameId: row.game_id,
      matchNumber: row.match_number,
      role: row.role,
      teamHome: row.team_home,
      teamAway: row.team_away,
      teams: `${row.team_home} - ${row.team_away}`.trim(),
      date,
      gameStatus: row.status
    });
  }

  const matchdays = [...new Set(visibleRows.map((r) => r.matchday).filter((m) => m !== null))].sort((a, b) => a - b);

  return {
    referees: [...referees.values()]
      .map((entry) => ({ ...entry, timeline: Object.fromEntries(entry.timeline) }))
      .sort((a, b) => a.fullName.localeCompare(b.fullName)),
    matchdays
  };
}

// ---------------------------------------------------------------------------
// Matrice osservatore-arbitro: calcolata, mai salvata.
// ---------------------------------------------------------------------------
export async function getMatrix({ season, competitions = [], band = '', phaseIds = [] }) {
  const completed = await loadCompleted(season, competitions, phaseIds);
  const drafts = await loadDrafts(season, competitions, phaseIds);
  const scheduled = await loadScheduled(season, competitions, phaseIds);
  const bandIds = await loadBandRefereeIds(season, competitions, band);

  const observers = new Map();
  const referees = new Map();
  const cells = new Map();

  const refereeRows = (await loadBaseReferees(season, competitions)).filter(isStatsActiveReferee);
  const refereeInfo = new Map(
    refereeRows.map((r) => [r.id, { fullName: `${r.last_name} ${r.first_name}`.trim(), license: r.license_number || '' }])
  );

  for (const row of [...completed, ...drafts, ...scheduled]) {
    if (!refereeInfo.has(row.refereeId)) continue;
    if (bandIds && !bandIds.has(row.refereeId)) continue;
    if (!observers.has(row.observerKey)) {
      observers.set(row.observerKey, {
        key: row.observerKey,
        label: row.observerLabel || '(senza nome)',
        userId: row.observerId || null,
        historical: !row.observerId
      });
    }
    if (!referees.has(row.refereeId)) {
      const info = refereeInfo.get(row.refereeId);
      referees.set(row.refereeId, { refereeId: row.refereeId, fullName: info?.fullName || `#${row.refereeId}`, license: info?.license || '' });
    }
    const cellKey = `${row.observerKey}|${row.refereeId}`;
    if (!cells.has(cellKey)) cells.set(cellKey, { observerKey: row.observerKey, refereeId: row.refereeId, completed: 0, scheduled: 0 });
    cells.get(cellKey)[row.type === 'completed' ? 'completed' : 'scheduled'] += 1;
  }

  return {
    observers: [...observers.values()].sort((a, b) => a.label.localeCompare(b.label)),
    referees: [...referees.values()].sort((a, b) => a.fullName.localeCompare(b.fullName)),
    cells: [...cells.values()]
  };
}

export async function getMatrixDetail({ season, competitions = [], phaseIds = [], observerKey, refereeId }) {
  const activeRefereeIds = new Set(
    (await loadBaseReferees(season, competitions)).filter(isStatsActiveReferee).map((row) => row.id)
  );
  if (!activeRefereeIds.has(refereeId)) return { completed: [], scheduled: [] };
  const completed = (await loadCompleted(season, competitions, phaseIds)).filter((r) => r.observerKey === observerKey && r.refereeId === refereeId);
  const pending = [
    ...(await loadDrafts(season, competitions, phaseIds)),
    ...(await loadScheduled(season, competitions, phaseIds))
  ].filter((r) => r.observerKey === observerKey && r.refereeId === refereeId);
  return {
    completed: completed.map(({ reportId, gameId, date, matchNumber, teams }) => ({ reportId, gameId, date, matchNumber, teams })),
    scheduled: pending.map(({ type, reportId, gameId, date, matchNumber, teams }) => ({ type, reportId, gameId, date, matchNumber, teams }))
  };
}

// ---------------------------------------------------------------------------
// Suggerimento osservatore: graduatoria deterministica e spiegabile.
// Tutti i pesi vivono qui: modificarli non richiede di toccare la logica.
// ---------------------------------------------------------------------------
export const SUGGESTION_WEIGHTS = {
  BASE: 50,
  NEVER_SEEN_BOTH: 30, // diversificazione: mai visto nessuno dei due
  SEEN_ONLY_ONE: 12, // diversificazione: ne ha visto solo uno
  PER_CROSS: -12, // diversificazione: penalità per ogni incrocio già avvenuto
  PER_COMPLETED_LOAD: -3, // carico stagionale
  STALE_BONUS: 10, // ultimo incrocio più vecchio di STALE_DAYS
  STALE_DAYS: 90,
  SAME_DAY: -100 // già impegnato lo stesso giorno
};

// Graduatoria osservatori: unico criterio è la diversificazione (evitare che lo
// stesso osservatore riveda sempre gli stessi arbitri).
export async function getObserverSuggestions({ gameId }) {
  const game = await dbGet('SELECT * FROM games WHERE id = ?', [gameId]);
  if (!game) throw new HttpError(404, 'Gara non trovata.');

  const officials = await dbAll(
    `SELECT role, referee_id FROM game_officials WHERE game_id = ? AND role IN ('referee1','referee2')`,
    [gameId]
  );
  const ref1 = officials.find((o) => o.role === 'referee1')?.referee_id || null;
  const ref2 = officials.find((o) => o.role === 'referee2')?.referee_id || null;
  if (!ref1 && !ref2) {
    throw new HttpError(400, 'Associare prima gli arbitri all\'anagrafica per calcolare i suggerimenti.');
  }

  const season = game.sport_season;
  const gameDate = game.scheduled_at ? game.scheduled_at.slice(0, 10) : '';
  const rows = [
    ...(await loadCompleted(season)),
    ...(await loadDrafts(season)).filter((row) => row.gameId),
    ...(await loadScheduled(season))
  ];

  const candidates = await dbAll(
    `SELECT id, display_name, role
       FROM users
      WHERE active = 1 AND role IN ('observer', 'instructor')
      ORDER BY display_name`
  );
  const unavailableByObserver = await availabilityByObserverOnDate(candidates.map((candidate) => candidate.id), gameDate);

  const W = SUGGESTION_WEIGHTS;
  const suggestions = candidates.map((candidate) => {
    const unavailability = unavailableByObserver.get(candidate.id) || null;
    const mine = rows.filter((row) => row.observerId === candidate.id);
    const seenRef1 = ref1 ? mine.filter((row) => row.refereeId === ref1).length : 0;
    const seenRef2 = ref2 ? mine.filter((row) => row.refereeId === ref2).length : 0;
    const crosses = seenRef1 + seenRef2;
    const completedMine = mine.filter((row) => row.type === 'completed');
    // Carico e arbitri diversi contati per gara (ogni rapporto = 2 righe).
    const totalSeason = new Set(completedMine.map((row) => row.reportId)).size;
    const distinctReferees = new Set(completedMine.map((row) => row.refereeId)).size;
    const lastCrossDate = mine
      .filter((row) => row.refereeId === ref1 || row.refereeId === ref2)
      .reduce((max, row) => (row.date && row.date > max ? row.date : max), '');
    const sameDayCount = gameDate
      ? new Set(mine.filter((row) => row.date === gameDate && row.gameId !== gameId).map((row) => row.gameId ?? `r${row.reportId}`)).size
      : 0;

    let score = W.BASE + W.PER_COMPLETED_LOAD * totalSeason + W.SAME_DAY * sameDayCount;
    const reasons = [];

    score += W.PER_CROSS * crosses;
    if (crosses === 0) {
      score += W.NEVER_SEEN_BOTH;
      reasons.push('Non ha mai visto nessuno dei due arbitri.');
    } else if ((ref1 && seenRef1 === 0) || (ref2 && seenRef2 === 0)) {
      score += W.SEEN_ONLY_ONE;
      reasons.push('Ha già visto solo uno dei due arbitri.');
    } else {
      reasons.push(`Incrocio già ripetuto (${crosses} visionamenti sui due arbitri).`);
    }

    const staleDays = daysBetween(lastCrossDate);
    if (crosses > 0 && staleDays !== null && staleDays > W.STALE_DAYS) {
      score += W.STALE_BONUS;
      reasons.push(`Ultimo incrocio ${staleDays} giorni fa.`);
    }
    if (totalSeason > 0) reasons.push(`Carico stagionale: ${totalSeason} ${totalSeason === 1 ? 'visionamento' : 'visionamenti'}.`);
    else reasons.push('Nessun visionamento completato in stagione.');
    if (sameDayCount > 0) reasons.push(`Attenzione: già impegnato lo stesso giorno (${sameDayCount} gare).`);
    if (unavailability) {
      score = -10000;
      const period = availabilityPeriodLabel(unavailability);
      reasons.unshift(`Indisponibile per la data della gara (${period}).`);
    }

    return {
      userId: candidate.id,
      displayName: candidate.display_name,
      role: candidate.role,
      score: Math.round(score),
      seenRef1,
      seenRef2,
      totalSeason,
      distinctReferees,
      lastCrossDate: lastCrossDate || null,
      sameDayCount,
      unavailable: Boolean(unavailability),
      unavailability,
      reasons
    };
  });

  return suggestions.sort((a, b) => (
    Number(a.unavailable) - Number(b.unavailable) ||
    b.score - a.score ||
    a.displayName.localeCompare(b.displayName)
  ));
}
