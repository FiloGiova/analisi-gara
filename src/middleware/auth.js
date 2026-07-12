import { dbGet, dbRun } from '../database/db.js';
import { config } from '../config.js';
import { getCookie } from '../utils/cookies.js';
import { hashSessionToken } from '../utils/passwords.js';
import { HttpError } from '../utils/httpError.js';
import { COMPETITIONS } from '../../shared/reportTemplate.js';

function parseInstructorCompetitions(value) {
  const clean = String(value || '').trim();
  if (!clean) return [];
  if (clean.startsWith('[')) {
    try {
      const parsed = JSON.parse(clean);
      return Array.isArray(parsed) ? parsed.map((item) => String(item || '').trim()).filter(Boolean) : [];
    } catch (_) {
      return [];
    }
  }
  return clean.split('|').map((item) => item.trim()).filter(Boolean);
}

function normalizeRole(role, competitions, refereeId) {
  const clean = String(role || '').trim();
  if (clean === 'referee') return 'referee';
  if (clean === 'admin' || clean === 'instructor' || clean === 'observer') return clean;
  if (clean === 'formatter' || clean === 'formatore') return 'instructor';
  if (clean === 'user') return parseInstructorCompetitions(competitions).length ? 'instructor' : 'observer';
  return 'observer';
}

function publicUser(user) {
  const allowed = new Set(COMPETITIONS.map((competition) => competition.value));
  const refereeId = user.referee_id || null;
  const role = normalizeRole(user.role, user.formatter_competition, refereeId);
  const instructorCompetitions = role === 'instructor'
    ? parseInstructorCompetitions(user.formatter_competition).filter((competition) => allowed.has(competition))
    : [];
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    role,
    refereeId: role === 'referee' ? refereeId : null,
    photoPath: user.photo_path || null,
    instructorCompetition: instructorCompetitions[0] || '',
    instructorCompetitions,
    formatterCompetition: instructorCompetitions[0] || '',
    formatterCompetitions: instructorCompetitions
  };
}

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
  return publicUser(row);
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
