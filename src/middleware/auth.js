import { getDb } from '../database/connection.js';
import { config } from '../config.js';
import { getCookie } from '../utils/cookies.js';
import { hashSessionToken } from '../utils/passwords.js';
import { HttpError } from '../utils/httpError.js';

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    role: user.role
  };
}

export function getCurrentUser(req) {
  const token = getCookie(req, config.sessionCookieName);
  if (!token) return null;

  const tokenHash = hashSessionToken(token);
  const row = getDb()
    .prepare(
      `SELECT sessions.id AS session_id,
              sessions.expires_at,
              users.id,
              users.username,
              users.display_name,
              users.role,
              users.active
         FROM sessions
         JOIN users ON users.id = sessions.user_id
        WHERE sessions.token_hash = ?`
    )
    .get(tokenHash);

  if (!row || !row.active || new Date(row.expires_at).getTime() <= Date.now()) {
    if (row?.session_id) {
      getDb().prepare('DELETE FROM sessions WHERE id = ?').run(row.session_id);
    }
    return null;
  }

  getDb().prepare('UPDATE sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?').run(row.session_id);
  return publicUser(row);
}

export function attachUser(req, _res, next) {
  req.user = getCurrentUser(req);
  next();
}

export function requireAuth(req, _res, next) {
  if (!req.user) {
    next(new HttpError(401, 'Accesso richiesto.'));
    return;
  }
  next();
}

export function requireAdmin(req, _res, next) {
  if (!req.user || req.user.role !== 'admin') {
    next(new HttpError(403, 'Permessi amministratore richiesti.'));
    return;
  }
  next();
}
