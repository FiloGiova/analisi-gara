import { dbGet, dbAll, dbRun, dbTx } from '../database/db.js';
import { COMPETITIONS, currentSportSeason } from '../../shared/reportTemplate.js';
import { hashPassword, verifyPassword } from '../utils/passwords.js';
import { HttpError } from '../utils/httpError.js';

const USERNAME_RE = /^[a-zA-Z0-9._-]{3,40}$/;
const ROLES = new Set(['admin', 'instructor', 'observer', 'referee']);

function normalizeUsername(username) {
  return String(username || '').trim().toLowerCase();
}

function normalizeRole(role, competitions = '') {
  const clean = String(role || '').trim();
  if (ROLES.has(clean)) return clean;
  if (clean === 'formatter' || clean === 'formatore') return 'instructor';
  if (clean === 'user') return parseInstructorCompetitions(competitions).length ? 'instructor' : 'observer';
  return 'observer';
}

function parseInstructorCompetitions(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean);
  }

  const clean = String(value || '').trim();
  if (!clean) return [];

  if (clean.startsWith('[')) {
    try {
      const parsed = JSON.parse(clean);
      if (Array.isArray(parsed)) return parsed.map((item) => String(item || '').trim()).filter(Boolean);
    } catch (_) {
      return [];
    }
  }

  return clean.split('|').map((item) => item.trim()).filter(Boolean);
}

function normalizeInstructorCompetitions(value) {
  const allowed = new Set(COMPETITIONS.map((competition) => competition.value));
  const unique = [];
  for (const item of parseInstructorCompetitions(value)) {
    if (!allowed.has(item)) {
      throw new HttpError(400, 'Campionato formatore non valido.');
    }
    if (!unique.includes(item)) unique.push(item);
  }
  return unique;
}

function normalizeStoredInstructorCompetitions(value) {
  const allowed = new Set(COMPETITIONS.map((competition) => competition.value));
  const unique = [];
  for (const item of parseInstructorCompetitions(value)) {
    if (allowed.has(item) && !unique.includes(item)) unique.push(item);
  }
  return unique;
}

function instructorCompetitionInput({ instructorCompetition, formatterCompetition }) {
  return instructorCompetition !== undefined ? instructorCompetition : formatterCompetition;
}

function normalizeSportSeason(value) {
  const clean = String(value || '').trim();
  const match = clean.match(/^(\d{4})\/(\d{4})$/);
  if (!match || Number(match[2]) !== Number(match[1]) + 1) {
    throw new HttpError(400, 'Stagione formatore non valida: usa il formato 2025/2026.');
  }
  return clean;
}

function normalizeInstructorAssignments(value, legacyCompetitionInput) {
  const source = value === undefined
    ? [{ sportSeason: currentSportSeason(), competitions: normalizeInstructorCompetitions(legacyCompetitionInput) }]
    : value;
  if (!Array.isArray(source)) throw new HttpError(400, 'Storico formatore non valido.');

  const grouped = new Map();
  for (const item of source) {
    const sportSeason = normalizeSportSeason(item?.sportSeason || item?.season);
    const competitions = normalizeInstructorCompetitions(item?.competitions);
    if (!competitions.length) continue;
    const existing = grouped.get(sportSeason) || [];
    grouped.set(sportSeason, [...new Set([...existing, ...competitions])]);
  }
  return [...grouped.entries()]
    .map(([sportSeason, competitions]) => ({ sportSeason, competitions }))
    .sort((a, b) => b.sportSeason.localeCompare(a.sportSeason));
}

function validateRoleConfiguration(role, assignments) {
  if (role === 'instructor' && !assignments.length) {
    throw new HttpError(400, 'Assegna almeno una stagione e un campionato al formatore.');
  }
}

function assignmentCompetitions(assignments) {
  return [...new Set(assignments.flatMap((assignment) => assignment.competitions))];
}

async function replaceInstructorAssignments(client, userId, assignments) {
  await client.run('DELETE FROM instructor_competition_assignments WHERE user_id = ?', [userId]);
  for (const assignment of assignments) {
    for (const competition of assignment.competitions) {
      await client.run(
        `INSERT INTO instructor_competition_assignments (user_id, sport_season, competition)
         VALUES (?, ?, ?)`,
        [userId, assignment.sportSeason, competition]
      );
    }
  }
}

async function loadInstructorAssignments(userId) {
  const rows = await dbAll(
    `SELECT sport_season, competition
       FROM instructor_competition_assignments
      WHERE user_id = ?
      ORDER BY sport_season DESC, competition ASC`,
    [userId]
  );
  const grouped = new Map();
  for (const row of rows) {
    if (!grouped.has(row.sport_season)) grouped.set(row.sport_season, []);
    grouped.get(row.sport_season).push(row.competition);
  }
  return [...grouped.entries()].map(([sportSeason, competitions]) => ({ sportSeason, competitions }));
}

function normalizeRefereeId(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

async function validateRefereeConfiguration({ role, refereeId, exceptUserId = null }) {
  if (role !== 'referee') return null;
  const cleanRefereeId = normalizeRefereeId(refereeId);
  if (!cleanRefereeId) {
    throw new HttpError(400, 'Collega un arbitro anagrafico all’utente referee.');
  }
  const referee = await dbGet('SELECT id FROM referees WHERE id = ?', [cleanRefereeId]);
  if (!referee) throw new HttpError(404, 'Arbitro collegato non trovato.');
  const existing = exceptUserId
    ? await dbGet("SELECT id FROM users WHERE referee_id = ? AND role = 'referee' AND id <> ?", [cleanRefereeId, exceptUserId])
    : await dbGet("SELECT id FROM users WHERE referee_id = ? AND role = 'referee'", [cleanRefereeId]);
  if (existing) throw new HttpError(409, 'Esiste già un utente collegato a questo arbitro.');
  return cleanRefereeId;
}

function validateUsername(username) {
  if (!USERNAME_RE.test(username)) {
    throw new HttpError(400, 'Username non valido: usa 3-40 caratteri, lettere, numeri, punto, trattino o underscore.');
  }
}

function validatePassword(password) {
  if (String(password || '').length < 8) {
    throw new HttpError(400, 'La password deve avere almeno 8 caratteri.');
  }
}

export async function publicUserFromRow(row) {
  const role = normalizeRole(row.role, row.formatter_competition);
  const storedAssignments = role === 'instructor' ? await loadInstructorAssignments(row.id) : [];
  const instructorAssignments = role === 'instructor' && storedAssignments.length
    ? storedAssignments
    : role === 'instructor'
      ? [{ sportSeason: currentSportSeason(), competitions: normalizeStoredInstructorCompetitions(row.formatter_competition) }]
          .filter((assignment) => assignment.competitions.length)
      : [];
  const instructorCompetitions = assignmentCompetitions(instructorAssignments);
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role,
    refereeId: role === 'referee' ? row.referee_id || null : null,
    photoPath: row.photo_path || null,
    instructorCompetition: instructorCompetitions[0] || '',
    instructorCompetitions,
    instructorAssignments,
    formatterCompetition: instructorCompetitions[0] || '',
    formatterCompetitions: instructorCompetitions,
    active: Boolean(row.active),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function activeAdminCount(exceptUserId = null) {
  if (exceptUserId) {
    return (
      await dbGet("SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND active = 1 AND id <> ?", [exceptUserId])
    ).count;
  }

  return (await dbGet("SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND active = 1")).count;
}

async function ensureCanChangeAdminState({ id, nextRole, nextActive }) {
  const current = await dbGet('SELECT id, role, active FROM users WHERE id = ?', [id]);
  if (!current) throw new HttpError(404, 'Utente non trovato.');

  const wasActiveAdmin = current.role === 'admin' && Boolean(current.active);
  const remainsActiveAdmin = nextRole === 'admin' && Boolean(nextActive);
  if (wasActiveAdmin && !remainsActiveAdmin && (await activeAdminCount(id)) === 0) {
    throw new HttpError(400, "Non puoi rimuovere l'ultimo amministratore attivo.");
  }
}

export async function countUsers() {
  return (await dbGet('SELECT COUNT(*) AS count FROM users')).count;
}

export async function upsertUser({
  username,
  password,
  displayName = username,
  role = 'admin',
  instructorCompetition,
  instructorAssignments,
  formatterCompetition = '',
  refereeId = null
}) {
  const cleanUsername = normalizeUsername(username);
  validateUsername(cleanUsername);
  validatePassword(password);

  const competitionInput = instructorCompetitionInput({ instructorCompetition, formatterCompetition });
  const cleanRole = normalizeRole(role, competitionInput);
  const assignments = cleanRole === 'instructor'
    ? normalizeInstructorAssignments(instructorAssignments, competitionInput)
    : [];
  validateRoleConfiguration(cleanRole, assignments);
  const instructorCompetitions = assignmentCompetitions(assignments);
  const cleanInstructorCompetition = instructorCompetitions.length ? JSON.stringify(instructorCompetitions) : null;
  const existing = await dbGet('SELECT id FROM users WHERE username = ?', [cleanUsername]);
  const cleanRefereeId = await validateRefereeConfiguration({
    role: cleanRole,
    refereeId,
    exceptUserId: existing?.id || null
  });
  const passwordHash = hashPassword(password);

  if (existing) {
    await ensureCanChangeAdminState({ id: existing.id, nextRole: cleanRole, nextActive: true });
    await dbTx(async (client) => {
      await client.run(
        `UPDATE users
          SET password_hash = ?,
              display_name = ?,
              role = ?,
              formatter_competition = ?,
              referee_id = ?,
              active = 1,
              updated_at = ts_now()
        WHERE id = ?`,
        [passwordHash, String(displayName || cleanUsername).trim(), cleanRole, cleanInstructorCompetition, cleanRefereeId, existing.id]
      );
      await replaceInstructorAssignments(client, existing.id, assignments);
    });
    return existing.id;
  }

  return dbTx(async (client) => {
    const result = await client.run(
      `INSERT INTO users (username, password_hash, display_name, role, formatter_competition, referee_id)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
      [cleanUsername, passwordHash, String(displayName || cleanUsername).trim(), cleanRole, cleanInstructorCompetition, cleanRefereeId]
    );
    await replaceInstructorAssignments(client, result.rows[0].id, assignments);
    return result.rows[0].id;
  });
}

export async function listUsers() {
  const rows = await dbAll(
    `SELECT id, username, display_name, role, formatter_competition, photo_path, referee_id, active, created_at, updated_at
       FROM users
      ORDER BY active DESC, role ASC, LOWER(display_name) ASC`
  );
  return Promise.all(rows.map(publicUserFromRow));
}

export async function createUser({
  username,
  password,
  displayName,
  role = 'observer',
  instructorCompetition,
  instructorAssignments,
  formatterCompetition = '',
  refereeId = null
}) {
  const cleanUsername = normalizeUsername(username);
  validateUsername(cleanUsername);
  validatePassword(password);

  const existing = await dbGet('SELECT id FROM users WHERE username = ?', [cleanUsername]);
  if (existing) throw new HttpError(409, 'Username già presente.');

  const competitionInput = instructorCompetitionInput({ instructorCompetition, formatterCompetition });
  const cleanRole = normalizeRole(role, competitionInput);
  const assignments = cleanRole === 'instructor'
    ? normalizeInstructorAssignments(instructorAssignments, competitionInput)
    : [];
  validateRoleConfiguration(cleanRole, assignments);
  const instructorCompetitions = assignmentCompetitions(assignments);
  const cleanRefereeId = await validateRefereeConfiguration({ role: cleanRole, refereeId });

  const id = await dbTx(async (client) => {
    const result = await client.run(
      `INSERT INTO users (username, password_hash, display_name, role, formatter_competition, referee_id, active)
       VALUES (?, ?, ?, ?, ?, ?, 1) RETURNING id`,
      [
        cleanUsername,
        hashPassword(password),
        String(displayName || cleanUsername).trim(),
        cleanRole,
        instructorCompetitions.length ? JSON.stringify(instructorCompetitions) : null,
        cleanRefereeId
      ]
    );
    await replaceInstructorAssignments(client, result.rows[0].id, assignments);
    return result.rows[0].id;
  });

  return getUser(id);
}

export async function getUser(id) {
  const row = await dbGet(
    'SELECT id, username, display_name, role, formatter_competition, photo_path, referee_id, active, created_at, updated_at FROM users WHERE id = ?',
    [id]
  );
  if (!row) throw new HttpError(404, 'Utente non trovato.');
  return publicUserFromRow(row);
}

export async function updateUser({ id, displayName, role, active, instructorCompetition, instructorAssignments, formatterCompetition, refereeId }) {
  const current = await dbGet('SELECT id, display_name, role, formatter_competition, referee_id, active FROM users WHERE id = ?', [id]);
  if (!current) throw new HttpError(404, 'Utente non trovato.');

  const competitionInput = instructorCompetitionInput({ instructorCompetition, formatterCompetition });
  const nextRole = normalizeRole(role || current.role, competitionInput ?? current.formatter_competition);
  const nextActive = active === undefined ? Boolean(current.active) : Boolean(active);
  const currentAssignments = nextRole === 'instructor' ? await loadInstructorAssignments(id) : [];
  const nextAssignments = nextRole !== 'instructor'
    ? []
    : instructorAssignments === undefined && competitionInput === undefined
      ? currentAssignments
      : normalizeInstructorAssignments(instructorAssignments, competitionInput);
  validateRoleConfiguration(nextRole, nextAssignments);
  const nextCompetitions = assignmentCompetitions(nextAssignments);
  const nextInstructorCompetition = nextCompetitions.length ? JSON.stringify(nextCompetitions) : null;
  const nextRefereeId = nextRole === 'referee'
    ? await validateRefereeConfiguration({
        role: nextRole,
        refereeId: refereeId === undefined ? current.referee_id : refereeId,
        exceptUserId: id
      })
    : null;
  await ensureCanChangeAdminState({ id, nextRole, nextActive });

  await dbTx(async (client) => {
    await client.run(
      `UPDATE users
        SET display_name = ?,
            role = ?,
            formatter_competition = ?,
            referee_id = ?,
            active = ?,
            updated_at = ts_now()
      WHERE id = ?`,
      [String(displayName || current.display_name).trim(), nextRole, nextInstructorCompetition, nextRefereeId, nextActive ? 1 : 0, id]
    );
    await replaceInstructorAssignments(client, id, nextAssignments);
    if (!nextActive) {
      await client.run('DELETE FROM sessions WHERE user_id = ?', [id]);
    }
  });

  return getUser(id);
}

export async function resetUserPassword({ id, password }) {
  validatePassword(password);
  const existing = await dbGet('SELECT id FROM users WHERE id = ?', [id]);
  if (!existing) throw new HttpError(404, 'Utente non trovato.');

  await dbRun('UPDATE users SET password_hash = ?, updated_at = ts_now() WHERE id = ?', [hashPassword(password), id]);

  await dbRun('DELETE FROM sessions WHERE user_id = ?', [id]);
  return getUser(id);
}

export async function changeOwnPassword({ userId, currentPassword, newPassword }) {
  validatePassword(newPassword);
  const user = await dbGet('SELECT id, password_hash FROM users WHERE id = ? AND active = 1', [userId]);
  if (!user) throw new HttpError(404, 'Utente non trovato.');
  if (!verifyPassword(String(currentPassword || ''), user.password_hash)) {
    throw new HttpError(400, 'Password attuale non corretta.');
  }

  await dbRun('UPDATE users SET password_hash = ?, updated_at = ts_now() WHERE id = ?', [hashPassword(newPassword), userId]);

  await dbRun('DELETE FROM sessions WHERE user_id = ?', [userId]);
}

export async function updateOwnProfile({ userId, displayName }) {
  const cleanDisplayName = String(displayName || '').trim();
  if (!cleanDisplayName) throw new HttpError(400, 'Nome visualizzato obbligatorio.');

  const existing = await dbGet('SELECT id FROM users WHERE id = ? AND active = 1', [userId]);
  if (!existing) throw new HttpError(404, 'Utente non trovato.');

  await dbRun('UPDATE users SET display_name = ?, updated_at = ts_now() WHERE id = ?', [cleanDisplayName, userId]);

  return getUser(userId);
}
