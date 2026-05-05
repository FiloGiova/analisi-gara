import { getDb } from '../database/connection.js';
import { COMPETITIONS } from '../../shared/reportTemplate.js';
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

function serializeInstructorCompetitions(value) {
  const competitions = normalizeInstructorCompetitions(value);
  return competitions.length ? JSON.stringify(competitions) : null;
}

function serializeStoredInstructorCompetitions(value) {
  const competitions = normalizeStoredInstructorCompetitions(value);
  return competitions.length ? JSON.stringify(competitions) : null;
}

function instructorCompetitionInput({ instructorCompetition, formatterCompetition }) {
  return instructorCompetition !== undefined ? instructorCompetition : formatterCompetition;
}

function validateRoleConfiguration(role, competitions) {
  if (role === 'instructor' && !competitions.length) {
    throw new HttpError(400, 'Assegna almeno un campionato al formatore.');
  }
}

function normalizeRefereeId(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function validateRefereeConfiguration({ role, refereeId, exceptUserId = null }) {
  if (role !== 'referee') return null;
  const cleanRefereeId = normalizeRefereeId(refereeId);
  if (!cleanRefereeId) {
    throw new HttpError(400, 'Collega un arbitro anagrafico all’utente referee.');
  }
  const referee = getDb().prepare('SELECT id FROM referees WHERE id = ?').get(cleanRefereeId);
  if (!referee) throw new HttpError(404, 'Arbitro collegato non trovato.');
  const existing = exceptUserId
    ? getDb().prepare("SELECT id FROM users WHERE referee_id = ? AND role = 'referee' AND id <> ?").get(cleanRefereeId, exceptUserId)
    : getDb().prepare("SELECT id FROM users WHERE referee_id = ? AND role = 'referee'").get(cleanRefereeId);
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

function publicUser(row) {
  const role = normalizeRole(row.role, row.formatter_competition);
  const instructorCompetitions = role === 'instructor'
    ? normalizeStoredInstructorCompetitions(row.formatter_competition)
    : [];
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role,
    refereeId: role === 'referee' ? row.referee_id || null : null,
    photoPath: row.photo_path || null,
    instructorCompetition: instructorCompetitions[0] || '',
    instructorCompetitions,
    formatterCompetition: instructorCompetitions[0] || '',
    formatterCompetitions: instructorCompetitions,
    active: Boolean(row.active),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function activeAdminCount(exceptUserId = null) {
  if (exceptUserId) {
    return getDb()
      .prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND active = 1 AND id <> ?")
      .get(exceptUserId).count;
  }

  return getDb().prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND active = 1").get().count;
}

function ensureCanChangeAdminState({ id, nextRole, nextActive }) {
  const current = getDb().prepare('SELECT id, role, active FROM users WHERE id = ?').get(id);
  if (!current) throw new HttpError(404, 'Utente non trovato.');

  const wasActiveAdmin = current.role === 'admin' && Boolean(current.active);
  const remainsActiveAdmin = nextRole === 'admin' && Boolean(nextActive);
  if (wasActiveAdmin && !remainsActiveAdmin && activeAdminCount(id) === 0) {
    throw new HttpError(400, "Non puoi rimuovere l'ultimo amministratore attivo.");
  }
}

export function countUsers() {
  return getDb().prepare('SELECT COUNT(*) AS count FROM users').get().count;
}

export function upsertUser({
  username,
  password,
  displayName = username,
  role = 'admin',
  instructorCompetition,
  formatterCompetition = '',
  refereeId = null
}) {
  const cleanUsername = normalizeUsername(username);
  validateUsername(cleanUsername);
  validatePassword(password);

  const competitionInput = instructorCompetitionInput({ instructorCompetition, formatterCompetition });
  const cleanRole = normalizeRole(role, competitionInput);
  const instructorCompetitions = cleanRole === 'instructor' ? normalizeInstructorCompetitions(competitionInput) : [];
  validateRoleConfiguration(cleanRole, instructorCompetitions);
  const cleanInstructorCompetition = instructorCompetitions.length ? JSON.stringify(instructorCompetitions) : null;
  const existing = getDb().prepare('SELECT id FROM users WHERE username = ?').get(cleanUsername);
  const cleanRefereeId = validateRefereeConfiguration({
    role: cleanRole,
    refereeId,
    exceptUserId: existing?.id || null
  });
  const passwordHash = hashPassword(password);

  if (existing) {
    ensureCanChangeAdminState({ id: existing.id, nextRole: cleanRole, nextActive: true });
    getDb()
      .prepare(
        `UPDATE users
            SET password_hash = ?,
                display_name = ?,
                role = ?,
                formatter_competition = ?,
                referee_id = ?,
                active = 1,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = ?`
      )
      .run(passwordHash, String(displayName || cleanUsername).trim(), cleanRole, cleanInstructorCompetition, cleanRefereeId, existing.id);
    return existing.id;
  }

  const result = getDb()
    .prepare(
      `INSERT INTO users (username, password_hash, display_name, role, formatter_competition, referee_id)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(cleanUsername, passwordHash, String(displayName || cleanUsername).trim(), cleanRole, cleanInstructorCompetition, cleanRefereeId);
  return result.lastInsertRowid;
}

export function listUsers() {
  return getDb()
    .prepare(
      `SELECT id, username, display_name, role, formatter_competition, photo_path, referee_id, active, created_at, updated_at
         FROM users
        ORDER BY active DESC, role ASC, display_name COLLATE NOCASE ASC`
    )
    .all()
    .map(publicUser);
}

export function createUser({
  username,
  password,
  displayName,
  role = 'observer',
  instructorCompetition,
  formatterCompetition = '',
  refereeId = null
}) {
  const cleanUsername = normalizeUsername(username);
  validateUsername(cleanUsername);
  validatePassword(password);

  const existing = getDb().prepare('SELECT id FROM users WHERE username = ?').get(cleanUsername);
  if (existing) throw new HttpError(409, 'Username già presente.');

  const competitionInput = instructorCompetitionInput({ instructorCompetition, formatterCompetition });
  const cleanRole = normalizeRole(role, competitionInput);
  const instructorCompetitions = cleanRole === 'instructor' ? normalizeInstructorCompetitions(competitionInput) : [];
  validateRoleConfiguration(cleanRole, instructorCompetitions);
  const cleanRefereeId = validateRefereeConfiguration({ role: cleanRole, refereeId });

  const result = getDb()
    .prepare(
      `INSERT INTO users (username, password_hash, display_name, role, formatter_competition, referee_id, active)
       VALUES (?, ?, ?, ?, ?, ?, 1)`
    )
    .run(
      cleanUsername,
      hashPassword(password),
      String(displayName || cleanUsername).trim(),
      cleanRole,
      instructorCompetitions.length ? JSON.stringify(instructorCompetitions) : null,
      cleanRefereeId
    );

  return getUser(result.lastInsertRowid);
}

export function getUser(id) {
  const row = getDb()
    .prepare('SELECT id, username, display_name, role, formatter_competition, photo_path, referee_id, active, created_at, updated_at FROM users WHERE id = ?')
    .get(id);
  if (!row) throw new HttpError(404, 'Utente non trovato.');
  return publicUser(row);
}

export function updateUser({ id, displayName, role, active, instructorCompetition, formatterCompetition, refereeId }) {
  const current = getDb().prepare('SELECT id, display_name, role, formatter_competition, referee_id, active FROM users WHERE id = ?').get(id);
  if (!current) throw new HttpError(404, 'Utente non trovato.');

  const competitionInput = instructorCompetitionInput({ instructorCompetition, formatterCompetition });
  const nextRole = normalizeRole(role || current.role, competitionInput ?? current.formatter_competition);
  const nextActive = active === undefined ? Boolean(current.active) : Boolean(active);
  const nextInstructorCompetition = nextRole !== 'instructor'
    ? null
    : competitionInput === undefined
      ? serializeStoredInstructorCompetitions(current.formatter_competition)
      : serializeInstructorCompetitions(competitionInput);
  validateRoleConfiguration(nextRole, normalizeStoredInstructorCompetitions(nextInstructorCompetition));
  const nextRefereeId = nextRole === 'referee'
    ? validateRefereeConfiguration({
        role: nextRole,
        refereeId: refereeId === undefined ? current.referee_id : refereeId,
        exceptUserId: id
      })
    : null;
  ensureCanChangeAdminState({ id, nextRole, nextActive });

  getDb()
    .prepare(
      `UPDATE users
          SET display_name = ?,
              role = ?,
              formatter_competition = ?,
              referee_id = ?,
              active = ?,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`
    )
    .run(String(displayName || current.display_name).trim(), nextRole, nextInstructorCompetition, nextRefereeId, nextActive ? 1 : 0, id);

  if (!nextActive) {
    getDb().prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  }

  return getUser(id);
}

export function resetUserPassword({ id, password }) {
  validatePassword(password);
  const existing = getDb().prepare('SELECT id FROM users WHERE id = ?').get(id);
  if (!existing) throw new HttpError(404, 'Utente non trovato.');

  getDb()
    .prepare('UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(hashPassword(password), id);

  getDb().prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  return getUser(id);
}

export function changeOwnPassword({ userId, currentPassword, newPassword }) {
  validatePassword(newPassword);
  const user = getDb().prepare('SELECT id, password_hash FROM users WHERE id = ? AND active = 1').get(userId);
  if (!user) throw new HttpError(404, 'Utente non trovato.');
  if (!verifyPassword(String(currentPassword || ''), user.password_hash)) {
    throw new HttpError(400, 'Password attuale non corretta.');
  }

  getDb()
    .prepare('UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(hashPassword(newPassword), userId);

  getDb().prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

export function updateOwnProfile({ userId, displayName }) {
  const cleanDisplayName = String(displayName || '').trim();
  if (!cleanDisplayName) throw new HttpError(400, 'Nome visualizzato obbligatorio.');

  const existing = getDb().prepare('SELECT id FROM users WHERE id = ? AND active = 1').get(userId);
  if (!existing) throw new HttpError(404, 'Utente non trovato.');

  getDb()
    .prepare('UPDATE users SET display_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(cleanDisplayName, userId);

  return getUser(userId);
}
