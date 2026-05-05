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
import { getDb } from '../database/connection.js';
import { HttpError } from '../utils/httpError.js';

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

function parseInstructorCompetitions(value) {
  if (Array.isArray(value)) {
    return value.map((item) => asText(item)).filter(Boolean);
  }
  const clean = asText(value);
  if (!clean) return [];
  if (clean.startsWith('[')) {
    try {
      const parsed = JSON.parse(clean);
      return Array.isArray(parsed) ? parsed.map((item) => asText(item)).filter(Boolean) : [];
    } catch (_) {
      return [];
    }
  }
  return clean.split('|').map((item) => item.trim()).filter(Boolean);
}

function instructorCompetitionsForUser(user) {
  if (user?.role !== 'instructor') return [];
  return parseInstructorCompetitions(
    user?.instructorCompetitions ||
    user?.instructorCompetition ||
    user?.formatterCompetitions ||
    user?.formatterCompetition ||
    user?.formatter_competition
  );
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
  const competitions = instructorCompetitionsForUser(user);
  if (isInstructor(user) && competitions.length) {
    clauses.push(`competition IN (${competitions.map(() => '?').join(', ')})`);
    params.push(...competitions);
    return;
  }
  clauses.push('created_by = ?');
  params.push(user.id);
}

function assertReportAccess(report, user) {
  if (!user || isAdmin(user)) return;
  if (isReferee(user)) {
    const myId = user.refereeId;
    if (myId && (report.firstRefereeId === myId || report.secondRefereeId === myId)) return;
    throw new HttpError(403, 'Non puoi accedere a questo rapporto.');
  }
  const competitions = instructorCompetitionsForUser(user);
  if (isInstructor(user) && competitions.includes(report.competition)) return;
  if (report.createdBy !== user.id) {
    throw new HttpError(403, 'Non puoi accedere a questo rapporto.');
  }
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

function assertReportMutationAccess(report, user) {
  if (isReferee(user)) {
    throw new HttpError(403, 'Gli arbitri hanno accesso in sola lettura.');
  }
  if (!user || isAdmin(user)) return;
  if (report.createdBy !== user.id) {
    throw new HttpError(403, 'Puoi modificare solo i rapporti creati da te.');
  }
}

function assertReportCreationAccess(user) {
  if (isReferee(user)) {
    throw new HttpError(403, 'Gli arbitri hanno accesso in sola lettura.');
  }
}

function applyUserReportRules(payload, user) {
  if (!isRestrictedUser(user)) return payload;
  const competitions = instructorCompetitionsForUser(user);
  const requestedCompetition = asText(payload.competition);
  if (isInstructor(user) && !competitions.length) {
    throw new HttpError(403, 'Nessun campionato assegnato a questa utenza formatore.');
  }
  if (isInstructor(user) && competitions.length > 1 && !competitions.includes(requestedCompetition)) {
    throw new HttpError(403, 'Puoi creare rapporti solo per i campionati assegnati alla tua utenza.');
  }
  return {
    ...payload,
    observerName: observerNameForUser(user),
    ...(isInstructor(user) && competitions.length === 1 ? { competition: competitions[0] } : {})
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
      observerName
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

function rowToReport(row) {
  if (!row) return null;
  const data = normalizeReportPayload(JSON.parse(row.payload_json));
  const dataWithDbLinks = {
    ...data,
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
    data: { ...dataWithDbLinks, observerName: row.observer_name, status: row.status },
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    finalizedAt: row.finalized_at,
    firstRefereeSentAt: row.first_referee_sent_at || null,
    secondRefereeSentAt: row.second_referee_sent_at || null
  };
}

export function listReports({ search = '', status = '', season = '', observer = '', user = null } = {}) {
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
      `(match_number LIKE ?
        OR competition LIKE ?
        OR team_home LIKE ?
        OR team_away LIKE ?
        OR observer_name LIKE ?
        OR first_referee_name LIKE ?
        OR second_referee_name LIKE ?)`
    );
    const like = `%${search}%`;
    params.push(like, like, like, like, like, like, like);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return getDb()
    .prepare(
      `SELECT id,
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
              created_at,
              updated_at,
              finalized_at
         FROM reports
         ${where}
        ORDER BY updated_at DESC, id DESC`
    )
    .all(...params)
    .map((row) => {
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
        firstRefereeId: row.first_referee_id || null,
        secondRefereeName: row.second_referee_name,
        secondRefereeId: row.second_referee_id || null,
        firstRefereeVote: row.first_referee_vote || '',
        secondRefereeVote: row.second_referee_vote || '',
        createdBy: row.created_by,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        finalizedAt: row.finalized_at
      };
      return stripListRowForReferee(base, user);
    });
}

export function listObservers({ season = '', user = null } = {}) {
  if (isReferee(user)) return [];
  const clauses = ["observer_name IS NOT NULL", "observer_name != ''"];
  const params = [];

  appendUserVisibilityClause(clauses, params, user);

  if (season) {
    clauses.push('sport_season = ?');
    params.push(season);
  }

  return getDb()
    .prepare(
      `SELECT DISTINCT observer_name AS name
         FROM reports
        WHERE ${clauses.join(' AND ')}
        ORDER BY observer_name`
    )
    .all(...params)
    .map((row) => row.name);
}

export function getReport(id, user = null) {
  const row = getDb().prepare('SELECT * FROM reports WHERE id = ?').get(id);
  const report = rowToReport(row);
  if (!report) throw new HttpError(404, 'Rapporto non trovato.');
  assertReportAccess(report, user);
  const viewed = applyUserViewRules(report, user);
  return stripSensitiveForReferee(viewed, user);
}

export function createReport({ payload, status = 'draft', user }) {
  assertReportCreationAccess(user);
  const normalizedStatus = status === 'final' ? 'final' : 'draft';
  const normalizedPayload = applyUserReportRules(normalizeReportPayload(payload), user);
  assertIsoDate(normalizedPayload.reportDate, 'Data');
  const validationErrors = normalizedStatus === 'final' ? collectFinalValidationErrors(normalizedPayload) : [];
  if (validationErrors.length) {
    throw new HttpError(422, 'Completa i campi obbligatori prima del salvataggio definitivo.', validationErrors);
  }

  const sportSeason = deriveSeason(normalizedPayload.reportDate);
  const result = getDb()
    .prepare(
      `INSERT INTO reports (
         status, observer_name, report_date, match_number, competition,
         team_home, team_away, score_home, score_away,
         first_referee_id, first_referee_name, second_referee_id, second_referee_name,
         first_referee_vote, second_referee_vote, payload_json, created_by, sport_season, finalized_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 'final' THEN CURRENT_TIMESTAMP ELSE NULL END)`
    )
    .run(
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
      normalizedStatus
    );

  return getReport(result.lastInsertRowid, user);
}

export function updateReport({ id, payload, status = 'draft', user }) {
  const existingReport = getReport(id, user);
  assertReportMutationAccess(existingReport, user);
  const requestedStatus = status === 'final' ? 'final' : 'draft';
  const normalizedStatus = existingReport.status === 'final' ? 'final' : requestedStatus;
  const normalizedPayload = applyUserReportRules(normalizeReportPayload(payload), user);
  assertIsoDate(normalizedPayload.reportDate, 'Data');
  const validationErrors = normalizedStatus === 'final' ? collectFinalValidationErrors(normalizedPayload) : [];
  if (validationErrors.length) {
    throw new HttpError(422, 'Completa i campi obbligatori prima del salvataggio definitivo.', validationErrors);
  }

  const sportSeason = deriveSeason(normalizedPayload.reportDate);
  getDb()
    .prepare(
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
              updated_at = CURRENT_TIMESTAMP,
              finalized_at = CASE
                WHEN ? = 'final' AND finalized_at IS NULL THEN CURRENT_TIMESTAMP
                WHEN ? = 'draft' THEN NULL
                ELSE finalized_at
              END
        WHERE id = ?`
    )
    .run(
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
      normalizedStatus,
      normalizedStatus,
      id
    );

  return getReport(id, user);
}

export function getStats(user = null, { season = '' } = {}) {
  const db = getDb();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const sportSeason = season || currentSportSeason();
  const clauses = ['sport_season = ?'];
  const userParams = [sportSeason];
  appendUserVisibilityClause(clauses, userParams, user);
  const userClause = `WHERE ${clauses.join(' AND ')}`;

  const counts = db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) AS draft,
         SUM(CASE WHEN status = 'final' THEN 1 ELSE 0 END) AS final,
         SUM(CASE WHEN updated_at >= ? THEN 1 ELSE 0 END) AS last_month
       FROM reports
       ${userClause}`
    )
    .get(thirtyDaysAgo, ...userParams);

  const seasonClauses = ['sport_season IS NOT NULL'];
  const seasonsParams = [];
  appendUserVisibilityClause(seasonClauses, seasonsParams, user);
  const seasons = db
    .prepare(
      `SELECT DISTINCT sport_season
       FROM reports
       WHERE ${seasonClauses.join(' AND ')}
       ORDER BY sport_season DESC`
    )
    .all(...seasonsParams)
    .map((r) => r.sport_season);

  if (isReferee(user)) {
    return { total: counts.total || 0 };
  }

  return { ...counts, seasons };
}

export function listRefereeNames(user) {
  if (isReferee(user)) return [];
  const clauses = [];
  const clauseParams = [];
  appendUserVisibilityClause(clauses, clauseParams, user);
  const userClause = clauses.length ? `AND ${clauses.join(' AND ')}` : '';
  const params = [...clauseParams, ...clauseParams];
  const rows = getDb()
    .prepare(
      `SELECT first_referee_name AS name FROM reports WHERE first_referee_name != '' ${userClause}
       UNION
       SELECT second_referee_name AS name FROM reports WHERE second_referee_name != '' ${userClause}
       ORDER BY name`
    )
    .all(...params);
  return rows.map((r) => r.name);
}

export function deleteReport(id, user = null) {
  const report = getReport(id, user);
  assertReportMutationAccess(report, user);
  getDb().prepare('DELETE FROM reports WHERE id = ?').run(id);
  const exportDir = path.join(config.outputDir, `report-${id}`);
  fs.rmSync(exportDir, { recursive: true, force: true });
  const season = report.sportSeason || deriveSeason(report.data?.reportDate || report.reportDate);
  const seasonExportDir = path.join(config.outputDir, safeSeasonSegment(season), `report-${id}`);
  fs.rmSync(seasonExportDir, { recursive: true, force: true });
}
