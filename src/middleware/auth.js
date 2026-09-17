import { dbGet, dbRun } from '../database/db.js';
import { config } from '../config.js';
import { getCookie } from '../utils/cookies.js';
import { hashSessionToken } from '../utils/passwords.js';
import { HttpError } from '../utils/httpError.js';
import { publicUserFromRow } from '../services/userService.js';
import { can, hasRole } from '../../shared/permissions.js';

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

// Guardia per capability: è il modo giusto di proteggere una rotta, perché
// segue la tabella dei permessi in shared/permissions.js invece di elencare
// ruoli qui. Il perimetro per campionato resta responsabilità del servizio.
export function requireCapability(capability) {
  return function guard(req, _res, next) {
    if (!req.user) {
      next(new HttpError(401, 'Accesso richiesto.'));
      return;
    }
    if (!can(req.user, capability)) {
      next(new HttpError(403, 'Permessi insufficienti.'));
      return;
    }
    next();
  };
}

// Alcune schermate servono a più di un ruolo per motivi diversi (per esempio
// i candidati per un nome da associare: li vede chi designa e chi confronta
// gli alias): basta una delle capability elencate.
export function requireAnyCapability(...capabilities) {
  return function guard(req, _res, next) {
    if (!req.user) {
      next(new HttpError(401, 'Accesso richiesto.'));
      return;
    }
    if (!capabilities.some((capability) => can(req.user, capability))) {
      next(new HttpError(403, 'Permessi insufficienti.'));
      return;
    }
    next();
  };
}

export function requireAdmin(req, _res, next) {
  if (!req.user || !hasRole(req.user, 'admin')) {
    next(new HttpError(403, 'Permessi amministratore richiesti.'));
    return;
  }
  next();
}

export function requireReferee(req, _res, next) {
  if (!req.user || !hasRole(req.user, 'referee') || !req.user.refereeId) {
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
  if (!hasRole(req.user, 'admin') && !hasRole(req.user, 'instructor')) {
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
  if (!can(req.user, 'reports:write')) {
    next(new HttpError(403, 'Permessi insufficienti.'));
    return;
  }
  next();
}
