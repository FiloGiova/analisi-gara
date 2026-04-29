import fs from 'node:fs';
import path from 'node:path';
import {
  COMMON_REQUIRED_FIELDS,
  COMMON_MATCH_CHARACTERISTICS,
  EVALUATION_SECTIONS,
  createEmptyReport
} from '../../shared/reportTemplate.js';
import { config } from '../config.js';
import { getDb } from '../database/connection.js';
import { HttpError } from '../utils/httpError.js';

const REPORT_ROLES = ['first', 'second'];

function asText(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function observerNameForUser(user) {
  return asText(user?.displayName || user?.username);
}

function isAdmin(user) {
  return user?.role === 'admin';
}

function isRestrictedUser(user) {
  return Boolean(user) && !isAdmin(user);
}

function assertReportAccess(report, user) {
  if (!user || isAdmin(user)) return;
  if (report.createdBy !== user.id) {
    throw new HttpError(403, 'Non puoi accedere a questo rapporto.');
  }
}

function applyUserReportRules(payload, user) {
  if (!isRestrictedUser(user)) return payload;
  return {
    ...payload,
    observerName: observerNameForUser(user)
  };
}

function applyUserViewRules(report, user) {
  if (!isRestrictedUser(user)) return report;
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
    firstRefereeName: asText(input.firstRefereeName),
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
    secondRefereeName: row.second_referee_name,
    data: { ...data, observerName: row.observer_name, status: row.status },
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    finalizedAt: row.finalized_at
  };
}

export function listReports({ search = '', status = '', user = null } = {}) {
  const clauses = [];
  const params = [];

  if (user && !isAdmin(user)) {
    clauses.push('created_by = ?');
    params.push(user.id);
  }

  if (status === 'draft' || status === 'final') {
    clauses.push('status = ?');
    params.push(status);
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
              first_referee_name,
              second_referee_name,
              created_by,
              created_at,
              updated_at,
              finalized_at
         FROM reports
         ${where}
        ORDER BY updated_at DESC, id DESC`
    )
    .all(...params)
    .map((row) => ({
      id: row.id,
      status: row.status,
      observerName: isAdmin(user) ? row.observer_name : observerNameForUser(user),
      reportDate: row.report_date,
      matchNumber: row.match_number,
      competition: row.competition,
      teams: `${row.team_home} - ${row.team_away}`.trim(),
      result: `${row.score_home} - ${row.score_away}`.trim(),
      firstRefereeName: row.first_referee_name,
      secondRefereeName: row.second_referee_name,
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      finalizedAt: row.finalized_at
    }));
}

export function getReport(id, user = null) {
  const row = getDb().prepare('SELECT * FROM reports WHERE id = ?').get(id);
  const report = rowToReport(row);
  if (!report) throw new HttpError(404, 'Rapporto non trovato.');
  assertReportAccess(report, user);
  return applyUserViewRules(report, user);
}

export function createReport({ payload, status = 'draft', user }) {
  const normalizedStatus = status === 'final' ? 'final' : 'draft';
  const normalizedPayload = applyUserReportRules(normalizeReportPayload(payload), user);
  const validationErrors = normalizedStatus === 'final' ? collectFinalValidationErrors(normalizedPayload) : [];
  if (validationErrors.length) {
    throw new HttpError(422, 'Completa i campi obbligatori prima del salvataggio definitivo.', validationErrors);
  }

  const result = getDb()
    .prepare(
      `INSERT INTO reports (
         status, observer_name, report_date, match_number, competition,
         team_home, team_away, score_home, score_away,
         first_referee_name, second_referee_name, payload_json, created_by, finalized_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 'final' THEN CURRENT_TIMESTAMP ELSE NULL END)`
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
      normalizedPayload.firstRefereeName,
      normalizedPayload.secondRefereeName,
      JSON.stringify({ ...normalizedPayload, status: normalizedStatus }),
      user?.id,
      normalizedStatus
    );

  return getReport(result.lastInsertRowid, user);
}

export function updateReport({ id, payload, status = 'draft', user }) {
  getReport(id, user);
  const normalizedStatus = status === 'final' ? 'final' : 'draft';
  const normalizedPayload = applyUserReportRules(normalizeReportPayload(payload), user);
  const validationErrors = normalizedStatus === 'final' ? collectFinalValidationErrors(normalizedPayload) : [];
  if (validationErrors.length) {
    throw new HttpError(422, 'Completa i campi obbligatori prima del salvataggio definitivo.', validationErrors);
  }

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
              first_referee_name = ?,
              second_referee_name = ?,
              payload_json = ?,
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
      normalizedPayload.firstRefereeName,
      normalizedPayload.secondRefereeName,
      JSON.stringify({ ...normalizedPayload, status: normalizedStatus }),
      normalizedStatus,
      normalizedStatus,
      id
    );

  return getReport(id, user);
}

export function listRefereeNames(user) {
  const userClause = (user && !isAdmin(user)) ? 'AND created_by = ?' : '';
  const params = (user && !isAdmin(user)) ? [user.id, user.id] : [];
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
  getReport(id, user);
  getDb().prepare('DELETE FROM reports WHERE id = ?').run(id);
  const exportDir = path.join(config.outputDir, `report-${id}`);
  fs.rmSync(exportDir, { recursive: true, force: true });
}
