import express from 'express';
import { dbRun } from '../database/db.js';
import { config } from '../config.js';
import { buildClearSessionCookie, buildSessionCookie, buildFlowCookie, getCookie } from '../utils/cookies.js';
import { hashSessionToken } from '../utils/passwords.js';
import { asyncHandler, HttpError } from '../utils/httpError.js';
import { getUser } from '../services/userService.js';
import { logAccess } from '../services/accessLogService.js';
import { requireAuth } from '../middleware/auth.js';
import { authRateLimit, authWriteGuard } from '../middleware/authSecurity.js';
import {
  accountStatus, authenticatePassword, changeAccountPassword, consumePasswordLink,
  inspectAccountLink, requestEmailVerification, requestEmailRecovery, unlinkGoogle,
  updateAccountEmail, verifyAccountEmail
} from '../services/accountService.js';
import { beginGoogleFlow, finishGoogleFlow, googleAvailable } from '../services/googleAuthService.js';

export const authRouter = express.Router();
authRouter.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
authRouter.use(authWriteGuard);

authRouter.get('/me', (req, res) => res.json({
  user: req.user || null,
  features: { aiEnabled: config.aiEnabled, googleAuth: googleAvailable(), emailDelivery: Boolean(config.smtp) }
}));

async function respondWithSession(req, res, result, message) {
  await logAccess(result.userId, req.ip, req.headers['user-agent']);
  res.setHeader('Set-Cookie', buildSessionCookie(result.sessionToken));
  res.json({ user: await getUser(result.userId), message });
}

authRouter.post('/login', authRateLimit('login'), asyncHandler(async (req, res) => {
  await respondWithSession(req, res, await authenticatePassword(req.body?.username, req.body?.password));
}));

authRouter.post('/logout', asyncHandler(async (req, res) => {
  const token = getCookie(req, config.sessionCookieName);
  if (token) await dbRun('DELETE FROM sessions WHERE token_hash = ?', [hashSessionToken(token)]);
  const flow = getCookie(req, `${config.sessionCookieName}_oauth`);
  if (flow) await dbRun('DELETE FROM oauth_flows WHERE token_hash = ?', [hashSessionToken(flow)]);
  res.setHeader('Set-Cookie', [buildClearSessionCookie(), buildFlowCookie()]);
  res.json({ ok: true });
}));

authRouter.post('/change-password', requireAuth, authRateLimit('password', 10), asyncHandler(async (req, res) => {
  await changeAccountPassword({ userId: req.user.id, currentPassword: req.body?.currentPassword, newPassword: req.body?.newPassword, session: req.authSession });
  res.setHeader('Set-Cookie', buildClearSessionCookie());
  res.json({ ok: true, message: 'Password aggiornata. Effettua di nuovo il login.' });
}));

// Il token sta nel fragment della landing e nel body, mai nel path o nella query API.
// L'anteprima non consuma l'invito: anche gli scanner dei messaggi possono aprirlo.
authRouter.post('/invitation', authRateLimit('invite-preview', 60), asyncHandler(async (req, res) => {
  res.json({ invitation: await inspectAccountLink(req.body?.token) });
}));
authRouter.post('/activate', authRateLimit('activate', 15), asyncHandler(async (req, res) => {
  if (req.user) throw new HttpError(409, 'Esci dall’account attuale prima di usare il link.');
  const result = await consumePasswordLink(req.body || {});
  let message;
  if (result.verifyEmail) message = (await requestEmailVerification(result.userId)).message;
  await respondWithSession(req, res, result, message);
}));
authRouter.post('/verify-email', authRateLimit('verify-email', 20), asyncHandler(async (req, res) => {
  await verifyAccountEmail(req.body?.token);
  res.json({ message: 'Email verificata. Ora puoi usarla anche per accedere e recuperare la password.' });
}));
authRouter.post('/recover', authRateLimit('recover', 5), asyncHandler(async (req, res) => {
  await requestEmailRecovery(req.body?.email);
  res.json({ message: 'Se l’indirizzo è verificato e l’invio è disponibile, riceverai un link. Puoi sempre chiedere un link di recupero all’amministratore.' });
}));
authRouter.get('/account', requireAuth, asyncHandler(async (req, res) => res.json(await accountStatus(req.user.id))));
authRouter.put('/email', requireAuth, authRateLimit('email', 5), asyncHandler(async (req, res) => {
  res.json(await updateAccountEmail(req.user.id, req.body?.email, req.body?.password, req.authSession));
}));
authRouter.post('/email/verify', requireAuth, authRateLimit('email', 5), asyncHandler(async (req, res) => {
  res.json(await requestEmailVerification(req.user.id));
}));
authRouter.post('/google/start', authRateLimit('google', 20), asyncHandler(async (req, res) => {
  const oldFlow = getCookie(req, `${config.sessionCookieName}_oauth`);
  if (oldFlow) await dbRun('DELETE FROM oauth_flows WHERE token_hash = ?', [hashSessionToken(oldFlow)]);
  const flow = await beginGoogleFlow({ purpose: req.body?.purpose, invitationToken: req.body?.token, userId: req.user?.id, sessionHash: req.authSession?.hash, password: req.body?.password });
  res.setHeader('Set-Cookie', buildFlowCookie(flow.flowToken));
  res.json({ url: flow.url });
}));
authRouter.delete('/google', requireAuth, authRateLimit('google-unlink', 10), asyncHandler(async (req, res) => {
  await unlinkGoogle({ userId: req.user.id, password: req.body?.password });
  res.setHeader('Set-Cookie', buildClearSessionCookie());
  res.json({ ok: true });
}));

export async function googleCallback(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Set-Cookie', buildFlowCookie());
  try {
    const result = await finishGoogleFlow({
      flowToken: getCookie(req, `${config.sessionCookieName}_oauth`), code: req.query.code,
      providerError: req.query.error, currentUserId: req.user?.id, sessionHash: req.authSession?.hash
    });
    await logAccess(result.userId, req.ip, req.headers['user-agent']);
    res.setHeader('Set-Cookie', [buildFlowCookie(), buildSessionCookie(result.sessionToken)]);
    res.redirect(303, `/#/account?auth=${result.purpose === 'link' ? 'linked' : result.purpose === 'activation' ? 'activated' : 'login'}`);
  } catch (err) {
    const message = err instanceof HttpError ? err.message : 'Accesso Google non riuscito. Riprova o contatta l’amministratore.';
    res.redirect(303, `/#/auth-result?error=${encodeURIComponent(message)}`);
  }
}
