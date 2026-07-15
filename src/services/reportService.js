import fs from 'node:fs';
import path from 'node:path';
import {
  COMMON_REQUIRED_FIELDS,
  COMMON_MATCH_CHARACTERISTICS,
  EVALUATION_SECTIONS,
  createEmptyReport,
  currentSportSeason,
  deriveSeason
} from '../../shared/reportTemplate.js';
import { config } from '../config.js';
import { dbGet, dbAll, dbRun } from '../database/db.js';
import { HttpError } from '../utils/httpError.js';
import {
  instructorAssignmentsForUser,
  instructorCompetitionsForSeason
} from '../../shared/instructorAssignments.js';

const REPORT_ROLES = ['first', 'second'];

function safeSeasonSegment(season) {
  const raw = String(season || '').replace('/', '-');
  const cleaned = raw.replace(/[^a-zA-Z0-9-]/g, '');
  return cleaned || 'no-season';
}

function asText(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function assertIsoDate(value, label) {
  const clean = asText(value);
  const match = clean.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new HttpError(400, `${label} non valida: usa un anno di 4 cifre.`);

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1900 || year > 2050 || month < 1 || month > 12 || day < 1) {
    throw new HttpError(400, `${label} non valida.`);
  }

  const maxDay = new Date(year, month, 0).getDate();
  if (day > maxDay) throw new HttpError(400, `${label} non valida.`);
}

function asNullableInteger(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function normalizeVote(value) {
  const clean = asText(value);
  if (!clean) return '';
  if (!/^\d{1,2}$/.test(clean)) {
    throw new HttpError(400, 'Il voto deve essere un numero intero di massimo 2 cifre.');
  }
  return clean;
}

function observerNameForUser(user) {
  return asText(user?.displayName || user?.username);
}

function isAdmin(user) {
  return user?.role === 'admin';
}

function isInstructor(user) {
  return Boolean(user) && user.role === 'instructor';
}

function isReferee(user) {
  return Boolean(user) && user.role === 'referee';
}

function isRestrictedUser(user) {
  return Boolean(user) && !isAdmin(user);
}

// L'osservatore "designato" del rapporto: chi può vederlo/modificarlo perché è
// l'osservatore della gara, anche se il rapporto è stato creato per suo conto
// (es. da un admin). Vale sia via observer_id sia via designazione sulla gara.
async function isDesignatedObserver(report, user) {
  if (!user || !report) return false;
  if (report.observerId && report.observerId === user.id) return true;
  if (report.gameId) {
    const row = await dbGet(
      `SELECT 1 FROM game_officials WHERE game_id = ? AND role = 'observer' AND user_id = ?`,
      [report.gameId, user.id]
    );
    if (row) return true;
  }
  return false;
}

function appendUserVisibilityClause(clauses, params, user) {
  if (!user || isAdmin(user)) return;
  if (isReferee(user)) {
    if (!user.refereeId) {
      clauses.push('1=0');
      return;
    }
    clauses.push('(first_referee_id = ? OR second_referee_id = ?)');
    params.push(user.refereeId, user.refereeId);
    return;
  }
  if (isInstructor(user)) {
    const assignments = instructorAssignmentsForUser(user);
    let scopeClause = '1=0';
    const scopeParams = [];
    if (Array.isArray(user.instructorAssignments)) {
      if (assignments.length) {
        scopeClause = `(${assignments.map((assignment) => (
          `(sport_season = ? AND competition IN (${assignment.competitions.map(() => '?').join(', ')}))`
        )).join(' OR ')})`;
        for (const assignment of assignments) scopeParams.push(assignment.sportSeason, ...assignment.competitions);
      }
    } else {
      const competitions = instructorCompetitionsForSeason(user);
      if (competitions.length) {
        scopeClause = `competition IN (${competitions.map(() => '?').join(', ')})`;
        scopeParams.push(...competitions);
      }
    }
    clauses.push(
      `(${scopeClause} OR created_by = ? OR observer_id = ? OR EXISTS (
          SELECT 1 FROM game_officials go
           WHERE go.game_id = reports.game_id AND go.role = 'observer' AND go.user_id = ?
        ))`
    );
    params.push(...scopeParams, user.id, user.id, user.id);
    return;
  }
  // Osservatore: i rapporti creati da lui + quelli di cui è l'osservatore
  // designato (via observer_id o designazione sulla gara collegata).
  clauses.push(
    `(created_by = ? OR observer_id = ? OR EXISTS (
        SELECT 1 FROM game_officials go
         WHERE go.game_id = reports.game_id AND go.role = 'observer' AND go.user_id = ?
      ))`
  );
  params.push(user.id, user.id, user.id);
}

async function assertReportAccess(report, user) {
  if (!user || isAdmin(user)) return;
  if (isReferee(user)) {
    const myId = user.refereeId;
    if (myId && (report.firstRefereeId === myId || report.secondRefereeId === myId)) return;
    throw new HttpError(403, 'Non puoi accedere a questo rapporto.');
  }
  const competitions = instructorCompetitionsForSeason(user, report.sportSeason);
  if (isInstructor(user)) {
    if (competitions.includes(report.competition)) return;
    if (report.createdBy === user.id || await isDesignatedObserver(report, user)) return;
    throw new HttpError(403, 'Rapporto fuori dai campionati assegnati per questa stagione.');
  }
  if (report.createdBy === user.id) return;
  if (await isDesignatedObserver(report, user)) return;
  throw new HttpError(403, 'Non puoi accedere a questo rapporto.');
}

function stripSensitiveForReferee(report, user) {
  if (!isReferee(user) || !report) return report;
  const myId = user.refereeId;
  const myRole = report.firstRefereeId === myId ? 'first'
    : report.secondRefereeId === myId ? 'second'
    : null;
  if (!myRole) return report;
  const otherRole = myRole === 'first' ? 'second' : 'first';

  const data = report.data || {};
  const evaluations = data.evaluations || {};
  const myEvaluation = evaluations[myRole] || {};

  const sanitizedEvaluation = {
    ...myEvaluation,
    vote: '',
    potential: { level: '', comment: '' }
  };

  const sanitizedData = {
    ...data,
    evaluations: { [myRole]: sanitizedEvaluation }
  };

  const sanitizedReport = { ...report };
  delete sanitizedReport.firstRefereeVote;
  delete sanitizedReport.secondRefereeVote;

  if (myRole === 'first') {
    return {
      ...sanitizedReport,
      secondRefereeId: null,
      secondRefereeName: '',
      data: { ...sanitizedData, secondRefereeId: null, secondRefereeName: '' }
    };
  }
  return {
    ...sanitizedReport,
    firstRefereeId: null,
    firstRefereeName: '',
    data: { ...sanitizedData, firstRefereeId: null, firstRefereeName: '' }
  };
}

function stripListRowForReferee(row, user) {
  if (!isReferee(user) || !row) return row;
  const cleaned = { ...row };
  delete cleaned.firstRefereeVote;
  delete cleaned.secondRefereeVote;
  return cleaned;
}

async function assertReportMutationAccess(report, user) {
  if (isReferee(user)) {
    throw new HttpError(403, 'Gli arbitri hanno accesso in sola lettura.');
  }
  if (!user || isAdmin(user)) return;
  // Osservatori e formatori possono modificare i rapporti che hanno creato o
  // quelli di cui sono l'osservatore designato della gara.
  if (report.createdBy === user.id) return;
  if (await isDesignatedObserver(report, user)) return;
  throw new HttpError(403, 'Puoi modificare solo i rapporti di cui sei l\'osservatore designato.');
}

function assertReportCreationAccess(user) {
  if (isReferee(user)) {
    throw new HttpError(403, 'Gli arbitri hanno accesso in sola lettura.');
  }
}

async function applyUserReportRules(payload, user) {
  if (!isRestrictedUser(user)) return payload;
  const competitions = instructorCompetitionsForSeason(user, deriveSeason(payload.reportDate));
  const requestedCompetition = asText(payload.competition);
  let designatedOutsideScope = false;
  if (isInstructor(user) && !competitions.includes(requestedCompetition) && payload.gameId) {
    designatedOutsideScope = Boolean(await dbGet(
      `SELECT 1
         FROM game_officials
        WHERE game_id = ? AND role = 'observer' AND user_id = ?`,
      [payload.gameId, user.id]
    ));
  }
  if (isInstructor(user) && !competitions.length && !designatedOutsideScope) {
    throw new HttpError(403, 'Nessun campionato assegnato a questa utenza formatore.');
  }
  if (isInstructor(user) && !designatedOutsideScope && competitions.length > 1 && !competitions.includes(requestedCompetition)) {
    throw new HttpError(403, 'Puoi creare rapporti solo per i campionati assegnati alla tua utenza.');
  }
  return {
    ...payload,
    ...(!isInstructor(user) ? {
      observerName: observerNameForUser(user),
      observerUserId: user?.id || null
    } : {}),
    ...(isInstructor(user) && !designatedOutsideScope && competitions.length === 1 ? { competition: competitions[0] } : {})
  };
}

function applyUserViewRules(report, user) {
  if (!isRestrictedUser(user) || isInstructor(user)) return report;
  const observerName = observerNameForUser(user);
  return {
    ...report,
    observerName,
    data: {
      ...report.data,
      observerName,
      observerUserId: user?.id || null
    }
  };
}

function normalizeSection(sectionTemplate, input = {}) {
  const ratings = {};
  for (const group of sectionTemplate.groups) {
    const rawValue = input.ratings?.[group.id] ?? '';
    ratings[group.id] = group.options.includes(rawValue) ? rawValue : '';
  }

  const normalized = { ratings };
  if (sectionTemplate.commentLabel) {
    normalized.comment = asText(input.comment);
  }
  return normalized;
}

export function normalizeEvaluation(input = {}) {
  const normalized = {
    sections: {},
    globalJudgement: asText(input.globalJudgement),
    technicalErrors: asText(input.technicalErrors) || 'NO',
    vote: normalizeVote(input.vote),
    potential: {
      level: '',
      comment: asText(input.potential?.comment)
    }
  };

  for (const section of EVALUATION_SECTIONS) {
    normalized.sections[section.id] = normalizeSection(section, input.sections?.[section.id]);
  }

  const potentialLevel = asText(input.potential?.level);
  normalized.potential.level = ['Nessuna', 'Bassa', 'Media', 'Alta'].includes(potentialLevel) ? potentialLevel : '';

  return normalized;
}

function normalizeMatchCharacteristics(input = {}) {
  return normalizeSection(COMMON_MATCH_CHARACTERISTICS, input);
}

export function normalizeReportPayload(input = {}) {
  const empty = createEmptyReport();
  const legacyMatchCharacteristics =
    input.matchCharacteristics ||
    input.evaluations?.first?.sections?.matchCharacteristics ||
    input.evaluations?.second?.sections?.matchCharacteristics ||
    empty.matchCharacteristics;
  const payload = {
    ...empty,
    gameId: asNullableInteger(input.gameId),
    observerUserId: asNullableInteger(input.observerUserId),
    observerName: asText(input.observerName),
    reportDate: asText(input.reportDate) || empty.reportDate,
    matchNumber: asText(input.matchNumber),
    competition: asText(input.competition),
    teamHome: asText(input.teamHome),
    teamAway: asText(input.teamAway),
    scoreHome: asText(input.scoreHome),
    scoreAway: asText(input.scoreAway),
    firstRefereeId: asNullableInteger(input.firstRefereeId),
    firstRefereeName: asText(input.firstRefereeName),
    secondRefereeId: asNullableInteger(input.secondRefereeId),
    secondRefereeName: asText(input.secondRefereeName),
    matchCharacteristics: normalizeMatchCharacteristics(legacyMatchCharacteristics),
    evaluations: {
      first: normalizeEvaluation(input.evaluations?.first),
      second: normalizeEvaluation(input.evaluations?.second)
    }
  };

  return payload;
}

export function collectFinalValidationErrors(payload) {
  const errors = [];

  for (const [field, label] of COMMON_REQUIRED_FIELDS) {
    if (!asText(payload[field])) errors.push(`${label} è obbligatorio.`);
  }

  const matchData = payload.matchCharacteristics;
  for (const group of COMMON_MATCH_CHARACTERISTICS.groups) {
    if (!asText(matchData?.ratings?.[group.id])) {
      errors.push(`Caratteristiche della gara: manca la valutazione "${group.label}".`);
    }
  }
  if (COMMON_MATCH_CHARACTERISTICS.requiredCommentForFinal && !asText(matchData?.comment)) {
    errors.push(`Caratteristiche della gara: manca il commento "${COMMON_MATCH_CHARACTERISTICS.commentLabel}".`);
  }

  for (const role of REPORT_ROLES) {
    const label = role === 'first' ? '1° arbitro' : '2° arbitro';
    const evaluation = payload.evaluations?.[role];
    const refereeId = role === 'first' ? payload.firstRefereeId : payload.secondRefereeId;

    if (!refereeId) {
      errors.push(`${label}: seleziona l'arbitro dall'anagrafica.`);
    }

    for (const section of EVALUATION_SECTIONS) {
      const sectionData = evaluation?.sections?.[section.id];
      for (const group of section.groups) {
        if (!asText(sectionData?.ratings?.[group.id])) {
          errors.push(`${label}: manca la valutazione "${group.label}".`);
        }
      }
      if (section.requiredCommentForFinal && !asText(sectionData?.comment)) {
        errors.push(`${label}: manca il commento "${section.commentLabel}".`);
      }
    }

    if (!asText(evaluation?.globalJudgement)) {
      errors.push(`${label}: manca il giudizio globale.`);
    }
  }

  return errors;
}

// observer_id: chi ha osservato la gara (distinto da created_by, chi ha
// inserito il rapporto). Per gli utenti osservatori coincide con l'autore;
// admin e formatori lo scelgono dall'elenco degli utenti abilitati.
async function resolveObserver(payload, user) {
  if (isRestrictedUser(user) && !isInstructor(user)) {
    return { id: user?.id || null, name: observerNameForUser(user) };
  }
  const explicit = asNullableInteger(payload.observerUserId);
  if (explicit) {
    const selected = await dbGet(
      `SELECT id, display_name
         FROM users
        WHERE id = ? AND active = 1 AND role IN ('observer', 'instructor')`,
      [explicit]
    );
    if (!selected) throw new HttpError(400, 'L’osservatore selezionato non è più disponibile.');
    return { id: selected.id, name: selected.display_name };
  }
  const name = asText(payload.observerName);
  if (!name) return { id: null, name: '' };
  const matches = await dbAll(
    `SELECT id, display_name
       FROM users
      WHERE active = 1
        AND role IN ('observer', 'instructor')
        AND LOWER(TRIM(display_name)) = LOWER(TRIM(?))`,
    [name]
  );
  if (matches.length === 1) return { id: matches[0].id, name: matches[0].display_name };
  throw new HttpError(400, 'Seleziona l’osservatore dall’elenco degli utenti disponibili.');
}

async function assertGameLink(payload, { existingReportId = null, allowDuplicate = false } = {}) {
  if (!payload.gameId) return;
  const game = await dbGet('SELECT id FROM games WHERE id = ?', [payload.gameId]);
  if (!game) throw new HttpError(400, 'La gara collegata non esiste più.');
  const other = await dbGet('SELECT id, status FROM reports WHERE game_id = ? AND id != COALESCE(?, -1)', [
    payload.gameId,
    existingReportId
  ]);
  if (other && !allowDuplicate) {
    throw new HttpError(409, 'Esiste già un rapporto per questa gara.', {
      existingReportId: other.id,
      existingReportStatus: other.status,
      requiresConfirmation: true
    });
  }
}

function rowToReport(row) {
  if (!row) return null;
  const data = normalizeReportPayload(JSON.parse(row.payload_json));
  const dataWithDbLinks = {
    ...data,
    gameId: row.game_id || data.gameId || null,
    observerUserId: row.observer_id || data.observerUserId || null,
    firstRefereeId: row.first_referee_id || data.firstRefereeId || null,
    secondRefereeId: row.second_referee_id || data.secondRefereeId || null,
    evaluations: {
      first: {
        ...data.evaluations.first,
        vote: row.first_referee_vote || data.evaluations.first.vote || ''
      },
      second: {
        ...data.evaluations.second,
        vote: row.second_referee_vote || data.evaluations.second.vote || ''
      }
    }
  };
  return {
    id: row.id,
    status: row.status,
    observerName: row.observer_name,
    reportDate: row.report_date,
    matchNumber: row.match_number,
    competition: row.competition,
    teamHome: row.team_home,
    teamAway: row.team_away,
    scoreHome: row.score_home,
    scoreAway: row.score_away,
    firstRefereeName: row.first_referee_name,
    firstRefereeId: row.first_referee_id || null,
    secondRefereeName: row.second_referee_name,
    secondRefereeId: row.second_referee_id || null,
    sportSeason: row.sport_season || null,
    gameId: row.game_id || null,
    observerId: row.observer_id || null,
    data: { ...dataWithDbLinks, observerName: row.observer_name, status: row.status },
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    finalizedAt: row.finalized_at,
    firstRefereeSentAt: row.first_referee_sent_at || null,
    secondRefereeSentAt: row.second_referee_sent_at || null
  };
}

export async function listReports({ search = '', status = '', season = '', observer = '', user = null } = {}) {
  const clauses = [];
  const params = [];

  appendUserVisibilityClause(clauses, params, user);

  if (status === 'draft' || status === 'final') {
    clauses.push('status = ?');
    params.push(status);
  }

  if (season) {
    clauses.push('sport_season = ?');
    params.push(season);
  }

  if (observer) {
    clauses.push('observer_name = ?');
    params.push(observer);
  }

  if (search) {
    clauses.push(
      `(match_number ILIKE ?
        OR competition ILIKE ?
        OR team_home ILIKE ?
        OR team_away ILIKE ?
        OR observer_name ILIKE ?
        OR first_referee_name ILIKE ?
        OR second_referee_name ILIKE ?)`
    );
    const like = `%${search}%`;
    params.push(like, like, like, like, like, like, like);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = await dbAll(
    `SELECT reports.id,
            status,
            observer_name,
            report_date,
            match_number,
            competition,
            team_home,
            team_away,
            score_home,
            score_away,
            first_referee_id,
            first_referee_name,
            second_referee_id,
            second_referee_name,
            first_referee_vote,
            second_referee_vote,
            created_by,
            observer_id,
            game_id,
            reports.created_at,
            reports.updated_at,
            finalized_at,
            first_referee.last_name AS first_referee_surname,
            second_referee.last_name AS second_referee_surname
       FROM reports
       LEFT JOIN referees first_referee ON first_referee.id = reports.first_referee_id
       LEFT JOIN referees second_referee ON second_referee.id = reports.second_referee_id
       ${where}
      ORDER BY reports.updated_at DESC, reports.id DESC`,
    params
  );
  return rows.map((row) => {
      const base = {
        id: row.id,
        status: row.status,
        observerName: !user || isAdmin(user) || isInstructor(user) ? row.observer_name : observerNameForUser(user),
        reportDate: row.report_date,
        matchNumber: row.match_number,
        competition: row.competition,
        teams: `${row.team_home} - ${row.team_away}`.trim(),
        result: `${row.score_home} - ${row.score_away}`.trim(),
        firstRefereeName: row.first_referee_name,
        firstRefereeSurname: row.first_referee_surname || '',
        firstRefereeId: row.first_referee_id || null,
        secondRefereeName: row.second_referee_name,
        secondRefereeSurname: row.second_referee_surname || '',
        secondRefereeId: row.second_referee_id || null,
        firstRefereeVote: row.first_referee_vote || '',
        secondRefereeVote: row.second_referee_vote || '',
        createdBy: row.created_by,
        observerId: isReferee(user) ? null : (row.observer_id || null),
        gameId: row.game_id || null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        finalizedAt: row.finalized_at
      };
      return stripListRowForReferee(base, user);
    });
}

export async function listObservers({ season = '', user = null } = {}) {
  if (isReferee(user)) return [];
  const clauses = ["observer_name IS NOT NULL", "observer_name != ''"];
  const params = [];

  appendUserVisibilityClause(clauses, params, user);

  if (season) {
    clauses.push('sport_season = ?');
    params.push(season);
  }

  const rows = await dbAll(
    `SELECT DISTINCT observer_name AS name
       FROM reports
      WHERE ${clauses.join(' AND ')}
      ORDER BY observer_name`,
    params
  );
  return rows.map((row) => row.name);
}

export async function getReport(id, user = null) {
  const row = await dbGet('SELECT * FROM reports WHERE id = ?', [id]);
  const report = rowToReport(row);
  if (!report) throw new HttpError(404, 'Rapporto non trovato.');
  await assertReportAccess(report, user);
  const viewed = applyUserViewRules(report, user);
  return stripSensitiveForReferee(viewed, user);
}

export async function createReport({ payload, status = 'draft', user, allowDuplicate = false }) {
  assertReportCreationAccess(user);
  const normalizedStatus = status === 'final' ? 'final' : 'draft';
  const normalizedPayload = await applyUserReportRules(normalizeReportPayload(payload), user);
  assertIsoDate(normalizedPayload.reportDate, 'Data');
  await assertGameLink(normalizedPayload, { allowDuplicate });
  const observer = await resolveObserver(normalizedPayload, user);
  normalizedPayload.observerUserId = observer.id;
  normalizedPayload.observerName = observer.name;
  const validationErrors = normalizedStatus === 'final' ? collectFinalValidationErrors(normalizedPayload) : [];
  if (validationErrors.length) {
    throw new HttpError(422, 'Completa i campi obbligatori prima del salvataggio definitivo.', validationErrors);
  }

  const sportSeason = deriveSeason(normalizedPayload.reportDate);
  const observerId = observer.id;
  const result = await dbRun(
    `INSERT INTO reports (
       status, observer_name, report_date, match_number, competition,
       team_home, team_away, score_home, score_away,
       first_referee_id, first_referee_name, second_referee_id, second_referee_name,
       first_referee_vote, second_referee_vote, payload_json, created_by, sport_season,
       game_id, observer_id, finalized_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 'final' THEN ts_now() ELSE NULL END)
     RETURNING id`,
    [
      normalizedStatus,
      normalizedPayload.observerName,
      normalizedPayload.reportDate,
      normalizedPayload.matchNumber,
      normalizedPayload.competition,
      normalizedPayload.teamHome,
      normalizedPayload.teamAway,
      normalizedPayload.scoreHome,
      normalizedPayload.scoreAway,
      normalizedPayload.firstRefereeId,
      normalizedPayload.firstRefereeName,
      normalizedPayload.secondRefereeId,
      normalizedPayload.secondRefereeName,
      normalizedPayload.evaluations.first.vote,
      normalizedPayload.evaluations.second.vote,
      JSON.stringify({ ...normalizedPayload, status: normalizedStatus }),
      user?.id,
      sportSeason,
      normalizedPayload.gameId,
      observerId,
      normalizedStatus
    ]
  );

  return getReport(result.rows[0].id, user);
}

export async function updateReport({ id, payload, status = 'draft', user }) {
  const existingReport = await getReport(id, user);
  await assertReportMutationAccess(existingReport, user);
  const requestedStatus = status === 'final' ? 'final' : 'draft';
  const normalizedStatus = existingReport.status === 'final' ? 'final' : requestedStatus;
  const normalizedPayload = await applyUserReportRules(normalizeReportPayload(payload), user);
  // Il collegamento alla gara non si cambia in modifica: resta quello esistente.
  normalizedPayload.gameId = existingReport.gameId || normalizedPayload.gameId;
  assertIsoDate(normalizedPayload.reportDate, 'Data');
  await assertGameLink(normalizedPayload, { existingReportId: id, allowDuplicate: true });
  const observer = await resolveObserver(normalizedPayload, user);
  normalizedPayload.observerUserId = observer.id;
  normalizedPayload.observerName = observer.name;
  const validationErrors = normalizedStatus === 'final' ? collectFinalValidationErrors(normalizedPayload) : [];
  if (validationErrors.length) {
    throw new HttpError(422, 'Completa i campi obbligatori prima del salvataggio definitivo.', validationErrors);
  }

  const sportSeason = deriveSeason(normalizedPayload.reportDate);
  const observerId = observer.id;
  await dbRun(
    `UPDATE reports
        SET status = ?,
            observer_name = ?,
            report_date = ?,
            match_number = ?,
            competition = ?,
            team_home = ?,
            team_away = ?,
            score_home = ?,
            score_away = ?,
            first_referee_id = ?,
            first_referee_name = ?,
            second_referee_id = ?,
            second_referee_name = ?,
            first_referee_vote = ?,
            second_referee_vote = ?,
            payload_json = ?,
            sport_season = ?,
            game_id = ?,
            observer_id = ?,
            updated_at = ts_now(),
            finalized_at = CASE
              WHEN ? = 'final' AND finalized_at IS NULL THEN ts_now()
              WHEN ? = 'draft' THEN NULL
              ELSE finalized_at
            END
      WHERE id = ?`,
    [
      normalizedStatus,
      normalizedPayload.observerName,
      normalizedPayload.reportDate,
      normalizedPayload.matchNumber,
      normalizedPayload.competition,
      normalizedPayload.teamHome,
      normalizedPayload.teamAway,
      normalizedPayload.scoreHome,
      normalizedPayload.scoreAway,
      normalizedPayload.firstRefereeId,
      normalizedPayload.firstRefereeName,
      normalizedPayload.secondRefereeId,
      normalizedPayload.secondRefereeName,
      normalizedPayload.evaluations.first.vote,
      normalizedPayload.evaluations.second.vote,
      JSON.stringify({ ...normalizedPayload, status: normalizedStatus }),
      sportSeason,
      normalizedPayload.gameId,
      observerId,
      normalizedStatus,
      normalizedStatus,
      id
    ]
  );

  return getReport(id, user);
}

export async function getStats(user = null, { season = '' } = {}) {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const sportSeason = season || currentSportSeason();
  const clauses = ['sport_season = ?'];
  const userParams = [sportSeason];
  appendUserVisibilityClause(clauses, userParams, user);
  const userClause = `WHERE ${clauses.join(' AND ')}`;

  const counts = await dbGet(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) AS draft,
       SUM(CASE WHEN status = 'final' THEN 1 ELSE 0 END) AS final,
       SUM(CASE WHEN updated_at >= ? THEN 1 ELSE 0 END) AS last_month
     FROM reports
     ${userClause}`,
    [thirtyDaysAgo, ...userParams]
  );

  const seasonClauses = ['sport_season IS NOT NULL'];
  const seasonsParams = [];
  appendUserVisibilityClause(seasonClauses, seasonsParams, user);
  const seasonRows = await dbAll(
    `SELECT DISTINCT sport_season
     FROM reports
     WHERE ${seasonClauses.join(' AND ')}
     ORDER BY sport_season DESC`,
    seasonsParams
  );
  const seasons = seasonRows.map((r) => r.sport_season);

  if (isReferee(user)) {
    return { total: counts.total || 0 };
  }

  return { ...counts, seasons };
}

export async function listRefereeNames(user) {
  if (isReferee(user)) return [];
  const clauses = [];
  const clauseParams = [];
  appendUserVisibilityClause(clauses, clauseParams, user);
  const userClause = clauses.length ? `AND ${clauses.join(' AND ')}` : '';
  const params = [...clauseParams, ...clauseParams];
  const rows = await dbAll(
    `SELECT first_referee_name AS name FROM reports WHERE first_referee_name != '' ${userClause}
     UNION
     SELECT second_referee_name AS name FROM reports WHERE second_referee_name != '' ${userClause}
     ORDER BY name`,
    params
  );
  return rows.map((r) => r.name);
}

export async function deleteReport(id, user = null) {
  const report = await getReport(id, user);
  await assertReportMutationAccess(report, user);
  await dbRun('DELETE FROM reports WHERE id = ?', [id]);
  // Pulizia PDF: solo col driver locale (in cloud i PDF si rigenerano dal payload,
  // gli eventuali orfani su Storage sono innocui).
  if (config.storageDriver === 'local') {
    const exportDir = path.join(config.outputDir, `report-${id}`);
    fs.rmSync(exportDir, { recursive: true, force: true });
    const season = report.sportSeason || deriveSeason(report.data?.reportDate || report.reportDate);
    const seasonExportDir = path.join(config.outputDir, safeSeasonSegment(season), `report-${id}`);
    fs.rmSync(seasonExportDir, { recursive: true, force: true });
  }
}
