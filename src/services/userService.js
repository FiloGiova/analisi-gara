import { getDb } from '../database/connection.js';
import { hashPassword, verifyPassword } from '../utils/passwords.js';
import { HttpError } from '../utils/httpError.js';

const USERNAME_RE = /^[a-zA-Z0-9._-]{3,40}$/;
const ROLES = new Set(['admin', 'user']);

function normalizeUsername(username) {
  return String(username || '').trim().toLowerCase();
}

function normalizeRole(role) {
  return ROLES.has(role) ? role : 'user';
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
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
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

export function upsertUser({ username, password, displayName = username, role = 'admin' }) {
  const cleanUsername = normalizeUsername(username);
  validateUsername(cleanUsername);
  validatePassword(password);

  const cleanRole = normalizeRole(role);
  const existing = getDb().prepare('SELECT id FROM users WHERE username = ?').get(cleanUsername);
  const passwordHash = hashPassword(password);

  if (existing) {
    ensureCanChangeAdminState({ id: existing.id, nextRole: cleanRole, nextActive: true });
    getDb()
      .prepare(
        `UPDATE users
            SET password_hash = ?,
                display_name = ?,
                role = ?,
                active = 1,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = ?`
      )
      .run(passwordHash, String(displayName || cleanUsername).trim(), cleanRole, existing.id);
    return existing.id;
  }

  const result = getDb()
    .prepare(
      `INSERT INTO users (username, password_hash, display_name, role)
       VALUES (?, ?, ?, ?)`
    )
    .run(cleanUsername, passwordHash, String(displayName || cleanUsername).trim(), cleanRole);
  return result.lastInsertRowid;
}

export function listUsers() {
  return getDb()
    .prepare(
      `SELECT id, username, display_name, role, active, created_at, updated_at
         FROM users
        ORDER BY active DESC, role ASC, display_name COLLATE NOCASE ASC`
    )
    .all()
    .map(publicUser);
}

export function createUser({ username, password, displayName, role = 'user' }) {
  const cleanUsername = normalizeUsername(username);
  validateUsername(cleanUsername);
  validatePassword(password);

  const existing = getDb().prepare('SELECT id FROM users WHERE username = ?').get(cleanUsername);
  if (existing) throw new HttpError(409, 'Username già presente.');

  const result = getDb()
    .prepare(
      `INSERT INTO users (username, password_hash, display_name, role, active)
       VALUES (?, ?, ?, ?, 1)`
    )
    .run(
      cleanUsername,
      hashPassword(password),
      String(displayName || cleanUsername).trim(),
      normalizeRole(role)
    );

  return getUser(result.lastInsertRowid);
}

export function getUser(id) {
  const row = getDb()
    .prepare('SELECT id, username, display_name, role, active, created_at, updated_at FROM users WHERE id = ?')
    .get(id);
  if (!row) throw new HttpError(404, 'Utente non trovato.');
  return publicUser(row);
}

export function updateUser({ id, displayName, role, active }) {
  const current = getDb().prepare('SELECT id, display_name, role, active FROM users WHERE id = ?').get(id);
  if (!current) throw new HttpError(404, 'Utente non trovato.');

  const nextRole = normalizeRole(role || current.role);
  const nextActive = active === undefined ? Boolean(current.active) : Boolean(active);
  ensureCanChangeAdminState({ id, nextRole, nextActive });

  getDb()
    .prepare(
      `UPDATE users
          SET display_name = ?,
              role = ?,
              active = ?,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`
    )
    .run(String(displayName || current.display_name).trim(), nextRole, nextActive ? 1 : 0, id);

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
