import express from 'express';
import { getDb } from '../database/connection.js';
import { getSessionMaxAgeMs } from '../config.js';
import { buildClearSessionCookie, buildSessionCookie, getCookie } from '../utils/cookies.js';
import { createSessionToken, hashSessionToken, verifyPassword } from '../utils/passwords.js';
import { asyncHandler, HttpError } from '../utils/httpError.js';
import { config } from '../config.js';
import { changeOwnPassword } from '../services/userService.js';
import { logAccess } from '../services/accessLogService.js';
import { COMPETITIONS } from '../../shared/reportTemplate.js';

export const authRouter = express.Router();

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

authRouter.get('/me', (req, res) => {
  res.json({ user: req.user || null });
});

authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const username = String(req.body?.username || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    if (!username || !password) {
      throw new HttpError(400, 'Inserisci username e password.');
    }

    const user = getDb()
      .prepare('SELECT * FROM users WHERE username = ? AND active = 1')
      .get(username);
    if (!user || !verifyPassword(password, user.password_hash)) {
      throw new HttpError(401, 'Credenziali non valide.');
    }

    const token = createSessionToken();
    const tokenHash = hashSessionToken(token);
    const expiresAt = new Date(Date.now() + getSessionMaxAgeMs()).toISOString();
    getDb()
      .prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
      .run(tokenHash, user.id, expiresAt);

    logAccess(user.id, req.ip, req.headers['user-agent']);

    res.setHeader('Set-Cookie', buildSessionCookie(token));
    res.json({ user: publicUser(user) });
  })
);

authRouter.post('/logout', (req, res) => {
  const token = getCookie(req, config.sessionCookieName);
  if (token) {
    getDb().prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashSessionToken(token));
  }
  res.setHeader('Set-Cookie', buildClearSessionCookie());
  res.json({ ok: true });
});

authRouter.post(
  '/change-password',
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new HttpError(401, 'Accesso richiesto.');
    }

    changeOwnPassword({
      userId: req.user.id,
      currentPassword: req.body?.currentPassword,
      newPassword: req.body?.newPassword
    });

    res.setHeader('Set-Cookie', buildClearSessionCookie());
    res.json({ ok: true, message: 'Password aggiornata. Effettua di nuovo il login.' });
  })
);
