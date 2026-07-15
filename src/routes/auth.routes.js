import express from 'express';
import { dbGet, dbRun } from '../database/db.js';
import { getSessionMaxAgeMs } from '../config.js';
import { buildClearSessionCookie, buildSessionCookie, getCookie } from '../utils/cookies.js';
import { createSessionToken, hashSessionToken, verifyPassword } from '../utils/passwords.js';
import { asyncHandler, HttpError } from '../utils/httpError.js';
import { config } from '../config.js';
import { changeOwnPassword, publicUserFromRow } from '../services/userService.js';
import { logAccess } from '../services/accessLogService.js';

export const authRouter = express.Router();

authRouter.get('/me', (req, res) => {
  res.json({
    user: req.user || null,
    features: { aiEnabled: config.aiEnabled }
  });
});

authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const username = String(req.body?.username || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    if (!username || !password) {
      throw new HttpError(400, 'Inserisci username e password.');
    }

    const user = await dbGet('SELECT * FROM users WHERE username = ? AND active = 1', [username]);
    if (!user || !verifyPassword(password, user.password_hash)) {
      throw new HttpError(401, 'Credenziali non valide.');
    }

    const token = createSessionToken();
    const tokenHash = hashSessionToken(token);
    const expiresAt = new Date(Date.now() + getSessionMaxAgeMs()).toISOString();
    await dbRun('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)', [tokenHash, user.id, expiresAt]);

    await logAccess(user.id, req.ip, req.headers['user-agent']);

    res.setHeader('Set-Cookie', buildSessionCookie(token));
    res.json({ user: await publicUserFromRow(user) });
  })
);

authRouter.post(
  '/logout',
  asyncHandler(async (req, res) => {
    const token = getCookie(req, config.sessionCookieName);
    if (token) {
      await dbRun('DELETE FROM sessions WHERE token_hash = ?', [hashSessionToken(token)]);
    }
    res.setHeader('Set-Cookie', buildClearSessionCookie());
    res.json({ ok: true });
  })
);

authRouter.post(
  '/change-password',
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new HttpError(401, 'Accesso richiesto.');
    }

    await changeOwnPassword({
      userId: req.user.id,
      currentPassword: req.body?.currentPassword,
      newPassword: req.body?.newPassword
    });

    res.setHeader('Set-Cookie', buildClearSessionCookie());
    res.json({ ok: true, message: 'Password aggiornata. Effettua di nuovo il login.' });
  })
);
