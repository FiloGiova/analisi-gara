import express from 'express';
import { getDb } from '../database/connection.js';
import { getSessionMaxAgeMs } from '../config.js';
import { buildClearSessionCookie, buildSessionCookie, getCookie } from '../utils/cookies.js';
import { createSessionToken, hashSessionToken, verifyPassword } from '../utils/passwords.js';
import { asyncHandler, HttpError } from '../utils/httpError.js';
import { config } from '../config.js';
import { changeOwnPassword } from '../services/userService.js';

export const authRouter = express.Router();

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    role: user.role
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
