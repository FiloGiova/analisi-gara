import { currentSportSeason, EVALUATION_SECTIONS, ratingToNumber } from '../../shared/reportTemplate.js';
import { dbGet, dbAll, dbRun } from '../database/db.js';
import { HttpError } from '../utils/httpError.js';

function asText(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function normalizeSeason(value) {
  return asText(value) || currentSportSeason();
}

function normalizeCompetitions({ competition = '', competitions = [] } = {}) {
  const values = Array.isArray(competitions) ? competitions : [competitions];
  if (competition) values.push(competition);
  return values
    .flatMap((item) => String(item || '').split('|'))
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item, index, array) => array.indexOf(item) === index);
}

function inClause(column, values) {
  return `${column} IN (${values.map(() => '?').join(', ')})`;
}

function rowToReferee(row) {
  const displayName = `${row.last_name} ${row.first_name}`.trim();
  return {
    id: row.id,
    licenseNumber: row.license_number || null,
    firstName: row.first_name,
    lastName: row.last_name,
    fullName: displayName,
    birthDate: row.birth_date || null,
    email: row.email || null,
    phone: row.phone || null,
    province: row.province || null,
    certificateExpiry: row.certificate_expiry || null,
    category: row.season_category ?? row.category ?? null,
    season: row.sport_season || null,
    notes: row.notes || null,
    photoPath: row.photo_path || null,
    active: Boolean(row.active),
    seasonActive: row.season_active === undefined ? Boolean(row.active) : Boolean(row.season_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function normalizeOptionalIsoDate(value, label) {
  const clean = asText(value);
  if (!clean) return null;
  const match = clean.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new HttpError(400, `${label} non valida.`);

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1900 || year > 2050 || month < 1 || month > 12 || day < 1) {
    throw new HttpError(400, `${label} non valida.`);
  }

  const maxDay = new Date(year, month, 0).getDate();
  if (day > maxDay) throw new HttpError(400, `${label} non valida.`);
  return clean;
}

async function upsertSeasonCategory(refereeId, { sportSeason, category, active }) {
  const season = normalizeSeason(sportSeason);
  const cleanCategory = asText(category) || null;
  const seasonActive = active === undefined ? 1 : (active ? 1 : 0);

  await dbRun(
    `INSERT INTO referee_season_categories (referee_id, sport_season, category, active)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(referee_id, sport_season)
     DO UPDATE SET category = excluded.category,
                   active = excluded.active,
                   updated_at = iso_now()`,
    [refereeId, season, cleanCategory, seasonActive]
  );

  if (season === currentSportSeason()) {
    await dbRun('UPDATE referees SET category = ?, updated_at = iso_now() WHERE id = ?', [cleanCategory, refereeId]);
  }
}

export async function listSeasons({ competition = '', competitions = [] } = {}) {
  const cleanCompetitions = normalizeCompetitions({ competition, competitions });
  const seasons = new Set([currentSportSeason()]);
  if (cleanCompetitions.length) {
    for (const row of await dbAll(
      `SELECT DISTINCT sport_season FROM referee_season_categories WHERE ${inClause('category', cleanCompetitions)} ORDER BY sport_season DESC`,
      cleanCompetitions
    )) {
      if (row.sport_season) seasons.add(row.sport_season);
    }
    for (const row of await dbAll(
      `SELECT DISTINCT sport_season FROM reports WHERE sport_season IS NOT NULL AND ${inClause('competition', cleanCompetitions)} ORDER BY sport_season DESC`,
      cleanCompetitions
    )) {
      if (row.sport_season) seasons.add(row.sport_season);
    }
  } else {
    for (const row of await dbAll('SELECT DISTINCT sport_season FROM referee_season_categories ORDER BY sport_season DESC')) {
      if (row.sport_season) seasons.add(row.sport_season);
    }
    for (const row of await dbAll('SELECT DISTINCT sport_season FROM reports WHERE sport_season IS NOT NULL ORDER BY sport_season DESC')) {
      if (row.sport_season) seasons.add(row.sport_season);
    }
  }

  return [...seasons].sort((a, b) => b.localeCompare(a));
}

export async function listReferees({ competition = '', competitions = [], season = '', activeOnly = false } = {}) {
  const sportSeason = normalizeSeason(season);
  const cleanCompetitions = normalizeCompetitions({ competition, competitions });
  const clauses = ['sc.sport_season = ?'];
  const params = [sportSeason];

  if (cleanCompetitions.length) {
    clauses.push(inClause('sc.category', cleanCompetitions));
    params.push(...cleanCompetitions);
  }

  if (activeOnly) {
    clauses.push('r.active = 1');
    clauses.push('sc.active = 1');
  }

  const rows = await dbAll(
    `SELECT r.*,
            sc.category AS season_category,
            sc.sport_season,
            sc.active AS season_active
     FROM referees r
     JOIN referee_season_categories sc ON sc.referee_id = r.id
     WHERE ${clauses.join(' AND ')}
     ORDER BY r.last_name, r.first_name`,
    params
  );

  return rows.map(rowToReferee);
}

export async function getReferee(id, { season = '', competition = '', competitions = [] } = {}) {
  const sportSeason = normalizeSeason(season);
  const cleanCompetitions = normalizeCompetitions({ competition, competitions });
  const row = await dbGet(
    `SELECT r.*,
            sc.category AS season_category,
            sc.sport_season,
            sc.active AS season_active
     FROM referees r
     LEFT JOIN referee_season_categories sc
       ON sc.referee_id = r.id AND sc.sport_season = ?
     WHERE r.id = ?`,
    [sportSeason, id]
  );
  if (!row) throw new HttpError(404, 'Arbitro non trovato.');
  if (cleanCompetitions.length && !cleanCompetitions.includes(row.season_category)) {
    throw new HttpError(403, 'Arbitro fuori dal campionato assegnato.');
  }

  const allCategories = await listSeasonCategories(id);
  const categoryHistory = cleanCompetitions.length
    ? allCategories.filter((item) => cleanCompetitions.includes(item.category))
    : allCategories;

  return {
    ...rowToReferee(row),
    categoryHistory,
    reports: await listReportsForReferee(id, { season: sportSeason, competitions: cleanCompetitions }),
    stats: await getRefereeStats(id, { season: sportSeason, competitions: cleanCompetitions })
  };
}

export async function createReferee({
  licenseNumber,
  firstName,
  lastName,
  birthDate,
  email,
  phone,
  province,
  certificateExpiry,
  category,
  notes,
  sportSeason
}) {
  if (!asText(firstName)) throw new HttpError(400, 'Nome obbligatorio.');
  if (!asText(lastName)) throw new HttpError(400, 'Cognome obbligatorio.');

  const normalizedBirthDate = normalizeOptionalIsoDate(birthDate, 'Data di nascita');
  const normalizedCertificateExpiry = normalizeOptionalIsoDate(certificateExpiry, 'Scadenza certificato');
  const season = normalizeSeason(sportSeason);
  const result = await dbRun(
    `INSERT INTO referees
       (license_number, first_name, last_name, birth_date, email, phone, province, certificate_expiry, category, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    [
      licenseNumber || null,
      asText(firstName),
      asText(lastName),
      normalizedBirthDate,
      email || null,
      phone || null,
      province || null,
      normalizedCertificateExpiry,
      season === currentSportSeason() ? (asText(category) || null) : null,
      notes || null
    ]
  );

  const newId = result.rows[0].id;
  await upsertSeasonCategory(newId, { sportSeason: season, category, active: true });
  return getReferee(newId, { season });
}

export async function updateReferee(id, updates) {
  await getReferee(id, { season: updates.sportSeason });
  const fields = [];
  const params = [];

  const map = {
    licenseNumber: 'license_number',
    firstName: 'first_name',
    lastName: 'last_name',
    birthDate: 'birth_date',
    email: 'email',
    phone: 'phone',
    province: 'province',
    certificateExpiry: 'certificate_expiry',
    active: 'active',
    notes: 'notes'
  };

  for (const [jsKey, dbCol] of Object.entries(map)) {
    if (updates[jsKey] !== undefined) {
      fields.push(`${dbCol} = ?`);
      if (jsKey === 'active') {
        params.push(updates[jsKey] ? 1 : 0);
      } else if (jsKey === 'birthDate') {
        params.push(normalizeOptionalIsoDate(updates[jsKey], 'Data di nascita'));
      } else if (jsKey === 'certificateExpiry') {
        params.push(normalizeOptionalIsoDate(updates[jsKey], 'Scadenza certificato'));
      } else {
        params.push(updates[jsKey] || null);
      }
    }
  }

  if (fields.length) {
    fields.push('updated_at = iso_now()');
    params.push(id);
    await dbRun(`UPDATE referees SET ${fields.join(', ')} WHERE id = ?`, params);
  }

  if (updates.category !== undefined || updates.active !== undefined || updates.sportSeason !== undefined) {
    const current = await getReferee(id, { season: updates.sportSeason });
    await upsertSeasonCategory(id, {
      sportSeason: updates.sportSeason,
      category: updates.category !== undefined ? updates.category : current.category,
      active: updates.active !== undefined ? updates.active : current.seasonActive
    });
  }

  return getReferee(id, { season: updates.sportSeason });
}

export async function listSeasonCategories(refereeId) {
  const rows = await dbAll(
    `SELECT id, sport_season AS "sportSeason", category, active, created_at AS "createdAt", updated_at AS "updatedAt"
     FROM referee_season_categories
     WHERE referee_id = ?
     ORDER BY sport_season DESC`,
    [refereeId]
  );
  return rows.map((row) => ({ ...row, active: Boolean(row.active) }));
}

function rowToRefereeReport(row) {
  return {
    id: row.id,
    status: row.status,
    role: row.role,
    roleLabel: row.role === 'first' ? '1° arbitro' : '2° arbitro',
    reportDate: row.report_date,
    sportSeason: row.sport_season,
    matchNumber: row.match_number,
    competition: row.competition,
    teams: `${row.team_home} - ${row.team_away}`.trim(),
    result: `${row.score_home} - ${row.score_away}`.trim(),
    vote: row.vote || '',
    observerName: row.observer_name,
    updatedAt: row.updated_at
  };
}

export async function listReportsForReferee(refereeId, { season = '', competition = '', competitions = [] } = {}) {
  const sportSeason = normalizeSeason(season);
  const cleanCompetitions = normalizeCompetitions({ competition, competitions });
  const competitionClause = cleanCompetitions.length ? `AND ${inClause('competition', cleanCompetitions)}` : '';
  const params = cleanCompetitions.length
    ? [refereeId, sportSeason, ...cleanCompetitions, refereeId, sportSeason, ...cleanCompetitions]
    : [refereeId, sportSeason, refereeId, sportSeason];
  const rows = await dbAll(
    `SELECT id, status, 'first' AS role, report_date, sport_season, match_number, competition,
            team_home, team_away, score_home, score_away, first_referee_vote AS vote,
            observer_name, updated_at
     FROM reports
     WHERE first_referee_id = ? AND sport_season = ? ${competitionClause}
     UNION ALL
    SELECT id, status, 'second' AS role, report_date, sport_season, match_number, competition,
            team_home, team_away, score_home, score_away, second_referee_vote AS vote,
            observer_name, updated_at
     FROM reports
     WHERE second_referee_id = ? AND sport_season = ? ${competitionClause}
     ORDER BY report_date DESC, id DESC`,
    params
  );
  return rows.map(rowToRefereeReport);
}

export async function getRefereeStats(refereeId, { season = '', competition = '', competitions = [] } = {}) {
  const reports = await listReportsForReferee(refereeId, { season, competition, competitions });
  const votes = reports.map((report) => Number(report.vote)).filter((vote) => Number.isInteger(vote));
  const average = votes.length ? votes.reduce((sum, vote) => sum + vote, 0) / votes.length : null;
  return {
    reportsCount: reports.length,
    votes,
    votesCount: votes.length,
    averageVote: average === null ? null : Number(average.toFixed(1))
  };
}

export async function getRefereeProgress(refereeId, { season = '' } = {}) {
  const sportSeason = normalizeSeason(season);
  const rows = await dbAll(
    `SELECT id, status, report_date, sport_season, match_number, competition,
            first_referee_id, second_referee_id, first_referee_vote, second_referee_vote,
            payload_json
     FROM reports
     WHERE (first_referee_id = ? OR second_referee_id = ?)
       AND sport_season = ?
       AND status = 'final'
     ORDER BY report_date ASC, id ASC`,
    [refereeId, refereeId, sportSeason]
  );

  const matches = [];
  const votes = [];
  for (const row of rows) {
    const role = row.first_referee_id === refereeId ? 'first'
      : row.second_referee_id === refereeId ? 'second'
      : null;
    if (!role) continue;
    let payload = {};
    try { payload = JSON.parse(row.payload_json) || {}; } catch (_) {}
    const evaluation = payload.evaluations?.[role] || {};
    const ratings = {};
    for (const section of EVALUATION_SECTIONS) {
      const sectionData = evaluation.sections?.[section.id];
      if (!sectionData) continue;
      for (const group of section.groups) {
        const key = `${section.id}.${group.id}`;
        ratings[key] = ratingToNumber(sectionData.ratings?.[group.id]);
      }
    }
    const voteRaw = role === 'first' ? row.first_referee_vote : row.second_referee_vote;
    const voteNum = Number(voteRaw);
    if (Number.isFinite(voteNum) && voteNum > 0) votes.push(voteNum);
    matches.push({
      id: row.id,
      date: row.report_date,
      matchNumber: row.match_number,
      competition: row.competition,
      role,
      ratings
    });
  }

  let trend = 'flat';
  if (votes.length >= 4) {
    const half = Math.floor(votes.length / 2);
    const first = votes.slice(0, half);
    const second = votes.slice(-half);
    const avg = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
    const delta = avg(second) - avg(first);
    if (delta > 0.2) trend = 'up';
    else if (delta < -0.2) trend = 'down';
  }
  const averageVote = votes.length
    ? Number((votes.reduce((a, b) => a + b, 0) / votes.length).toFixed(1))
    : null;

  return {
    refereeId,
    season: sportSeason,
    matches,
    averageVote,
    trend
  };
}

export async function getRefereeRanking({ season = '', competition = '', competitions = [] } = {}) {
  const sportSeason = normalizeSeason(season);
  const cleanCompetitions = normalizeCompetitions({ competition, competitions });
  const competitionClause = cleanCompetitions.length ? `AND ${inClause('competition', cleanCompetitions)}` : '';
  const seasonCategoryClause = cleanCompetitions.length ? `WHERE ${inClause('sc.category', cleanCompetitions)}` : '';
  const params = cleanCompetitions.length
    ? [sportSeason, ...cleanCompetitions, sportSeason, ...cleanCompetitions, sportSeason, ...cleanCompetitions]
    : [sportSeason, sportSeason, sportSeason];
  const rows = await dbAll(
    `WITH votes AS (
       SELECT r.first_referee_id AS referee_id, r.first_referee_vote AS vote,
              r.id AS report_id, r.report_date,
              COALESCE(u.display_name, r.observer_name, '') AS observer_label
       FROM reports r
       LEFT JOIN users u ON u.id = r.observer_id
       WHERE r.first_referee_id IS NOT NULL
         AND r.sport_season = ?
         AND r.first_referee_vote IS NOT NULL
         AND r.first_referee_vote != ''
         ${competitionClause}
       UNION ALL
       SELECT r.second_referee_id AS referee_id, r.second_referee_vote AS vote,
              r.id AS report_id, r.report_date,
              COALESCE(u.display_name, r.observer_name, '') AS observer_label
       FROM reports r
       LEFT JOIN users u ON u.id = r.observer_id
       WHERE r.second_referee_id IS NOT NULL
         AND r.sport_season = ?
         AND r.second_referee_vote IS NOT NULL
         AND r.second_referee_vote != ''
         ${competitionClause}
     )
     SELECT r.id,
            r.first_name,
            r.last_name,
            sc.category AS season_category,
            sc.sport_season,
            COUNT(v.vote) AS votes_count,
            string_agg(v.vote, '|' ORDER BY v.report_date, v.report_id) AS votes,
            json_agg(json_build_object(
              'vote', v.vote,
              'reportId', v.report_id,
              'observerName', v.observer_label
            ) ORDER BY v.report_date, v.report_id) AS vote_details,
            AVG(CAST(v.vote AS INTEGER)) AS average_vote
     FROM votes v
     JOIN referees r ON r.id = v.referee_id
     LEFT JOIN referee_season_categories sc
       ON sc.referee_id = r.id AND sc.sport_season = ?
     ${seasonCategoryClause}
     GROUP BY r.id, sc.category, sc.sport_season
     ORDER BY average_vote DESC, votes_count DESC, r.last_name, r.first_name`,
    params
  );

  return rows.map((row) => {
    let voteDetails = row.vote_details;
    if (typeof voteDetails === 'string') {
      try { voteDetails = JSON.parse(voteDetails); } catch { voteDetails = []; }
    }
    voteDetails = Array.isArray(voteDetails) ? voteDetails.map((detail) => ({
      vote: String(detail.vote || ''),
      reportId: Number(detail.reportId) || null,
      observerName: String(detail.observerName || '')
    })) : [];
    return {
      id: row.id,
      firstName: row.first_name,
      lastName: row.last_name,
      fullName: `${row.first_name} ${row.last_name}`.trim(),
      category: row.season_category || null,
      season: row.sport_season || sportSeason,
      votes: voteDetails.length ? voteDetails.map((detail) => detail.vote) : (row.votes ? row.votes.split('|') : []),
      voteDetails,
      votesCount: row.votes_count,
      averageVote: row.average_vote === null ? null : Number(Number(row.average_vote).toFixed(1))
    };
  });
}

export async function listRosters(refereeId) {
  const categories = await listSeasonCategories(refereeId);
  return categories.map((row) => ({
    id: row.id,
    competition: row.category,
    sport_season: row.sportSeason
  }));
}

export async function addRoster(refereeId, { competition, sportSeason }) {
  await getReferee(refereeId, { season: sportSeason });
  await upsertSeasonCategory(refereeId, { sportSeason, category: competition, active: true });
  return listRosters(refereeId);
}

export async function removeRoster(refereeId, rosterId) {
  await dbRun('DELETE FROM referee_season_categories WHERE id = ? AND referee_id = ?', [rosterId, refereeId]);
}

// ---------------------------------------------------------------------------
// Fasce arbitri (esordienti / playoff / playout), per campionato e stagione.
// ---------------------------------------------------------------------------
export const REFEREE_BANDS = ['esordiente', 'playoff', 'playout'];

// Elenco degli arbitri iscritti a una (o più) fasce, filtrabile per campionato,
// stagione e fascia. Con `competitions` si applica lo scoping del formatore.
export async function listBandMembers({ competition = '', competitions = [], season = '', band = '' } = {}) {
  const sportSeason = normalizeSeason(season);
  const cleanCompetitions = normalizeCompetitions({ competition, competitions });
  const clauses = ['rb.sport_season = ?'];
  const params = [sportSeason];
  if (band) {
    if (!REFEREE_BANDS.includes(band)) throw new HttpError(400, 'Fascia non valida.');
    clauses.push('rb.band = ?');
    params.push(band);
  }
  if (cleanCompetitions.length) {
    clauses.push(inClause('rb.competition', cleanCompetitions));
    params.push(...cleanCompetitions);
  }
  const rows = await dbAll(
    `SELECT rb.id AS band_id, rb.band, rb.competition, rb.sport_season,
            r.id, r.first_name, r.last_name, r.license_number, r.active
       FROM referee_bands rb
       JOIN referees r ON r.id = rb.referee_id
      WHERE ${clauses.join(' AND ')}
      ORDER BY rb.competition, rb.band, r.last_name, r.first_name`,
    params
  );
  return rows.map((row) => ({
    bandId: row.band_id,
    band: row.band,
    competition: row.competition,
    sportSeason: row.sport_season,
    refereeId: row.id,
    fullName: `${row.last_name} ${row.first_name}`.trim(),
    licenseNumber: row.license_number || '',
    active: Boolean(row.active)
  }));
}

export async function addBandMember({ refereeId, competition, sportSeason, band }) {
  const id = Number(refereeId);
  const comp = asText(competition);
  const season = normalizeSeason(sportSeason);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Arbitro non valido.');
  if (!comp) throw new HttpError(400, 'Campionato obbligatorio.');
  if (!REFEREE_BANDS.includes(band)) throw new HttpError(400, 'Fascia non valida.');
  const referee = await dbGet('SELECT id FROM referees WHERE id = ?', [id]);
  if (!referee) throw new HttpError(404, 'Arbitro non trovato.');
  await dbRun(
    `INSERT INTO referee_bands (referee_id, competition, sport_season, band)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (referee_id, competition, sport_season, band) DO NOTHING`,
    [id, comp, season, band]
  );
  return listBandMembers({ competition: comp, season, band });
}

// Ritorna la riga della fascia (per verificarne il campionato prima di eliminarla).
export async function getBandRow(bandId) {
  return (await dbGet('SELECT * FROM referee_bands WHERE id = ?', [Number(bandId)])) || null;
}

export async function removeBandMember(bandId) {
  await dbRun('DELETE FROM referee_bands WHERE id = ?', [Number(bandId)]);
}
