import { dbGet, dbRun } from '../database/db.js';
import { config } from '../config.js';
import { getCookie } from '../utils/cookies.js';
import { hashSessionToken } from '../utils/passwords.js';
import { HttpError } from '../utils/httpError.js';
import { publicUserFromRow } from '../services/userService.js';

export async function getCurrentUser(req) {
  const token = getCookie(req, config.sessionCookieName);
  if (!token) return null;

  const tokenHash = hashSessionToken(token);
  const row = await dbGet(
    `SELECT sessions.id AS session_id,
            sessions.expires_at,
            users.id,
            users.username,
            users.display_name,
            users.role,
            users.formatter_competition,
            users.photo_path,
            users.referee_id,
            users.active
       FROM sessions
       JOIN users ON users.id = sessions.user_id
      WHERE sessions.token_hash = ?`,
    [tokenHash]
  );

  if (!row || !row.active || new Date(row.expires_at).getTime() <= Date.now()) {
    if (row?.session_id) {
      await dbRun('DELETE FROM sessions WHERE id = ?', [row.session_id]);
    }
    return null;
  }

  await dbRun('UPDATE sessions SET last_seen_at = ts_now() WHERE id = ?', [row.session_id]);
  return publicUserFromRow(row);
}

export async function attachUser(req, _res, next) {
  try {
    req.user = await getCurrentUser(req);
    next();
  } catch (err) {
    next(err);
  }
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

export function requireReferee(req, _res, next) {
  if (!req.user || req.user.role !== 'referee' || !req.user.refereeId) {
    next(new HttpError(403, 'Permessi arbitro richiesti.'));
    return;
  }
  next();
}

export function requireAdminOrInstructor(req, _res, next) {
  if (!req.user) {
    next(new HttpError(401, 'Accesso richiesto.'));
    return;
  }
  if (req.user.role !== 'admin' && req.user.role !== 'instructor') {
    next(new HttpError(403, 'Permessi insufficienti.'));
    return;
  }
  next();
}

export function requireReportAuthors(req, _res, next) {
  if (!req.user) {
    next(new HttpError(401, 'Accesso richiesto.'));
    return;
  }
  if (req.user.role !== 'admin' && req.user.role !== 'instructor' && req.user.role !== 'observer') {
    next(new HttpError(403, 'Permessi insufficienti.'));
    return;
  }
  next();
}
