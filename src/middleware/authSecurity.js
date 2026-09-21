import { config } from '../config.js';
import { dbGet, dbRun } from '../database/db.js';
import { hashSessionToken } from '../utils/passwords.js';
import { HttpError, asyncHandler } from '../utils/httpError.js';

// Il custom header rende impossibili POST da form esterni. Non abilitiamo CORS.
export function authWriteGuard(req, _res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('X-Requested-With') !== 'FischioLab') return next(new HttpError(403, 'Richiesta non consentita. Ricarica la pagina.'));
  const origin = req.get('origin');
  if (origin && origin !== new URL(config.appBaseUrl).origin) {
    return next(new HttpError(403, 'Origine della richiesta non consentita.'));
  }
  next();
}

export function authRateLimit(action, limit = 30, minutes = 15) {
  return asyncHandler(async (req, res, next) => {
    await dbRun('DELETE FROM auth_rate_limits WHERE expires_at <= now()');
    const keys = [`${action}:ip:${req.ip}`];
    if (action === 'login' && req.body?.username) keys.push(`${action}:user:${String(req.body.username).trim().toLowerCase()}`);
    for (const key of keys) {
      const row = await dbGet(
        `INSERT INTO auth_rate_limits (bucket, hits, expires_at) VALUES (?, 1, now() + (? * interval '1 minute'))
         ON CONFLICT (bucket) DO UPDATE SET hits = auth_rate_limits.hits + 1 RETURNING hits`,
        [hashSessionToken(key), minutes]
      );
      if (row.hits > limit) {
        res.setHeader('Retry-After', String(minutes * 60));
        throw new HttpError(429, 'Troppi tentativi. Attendi qualche minuto e riprova.');
      }
    }
    next();
  });
}
