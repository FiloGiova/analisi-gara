import crypto from 'node:crypto';
import { config } from '../config.js';
import { dbGet, dbRun, dbTx } from '../database/db.js';
import { createSessionToken, hashSessionToken } from '../utils/passwords.js';
import { HttpError } from '../utils/httpError.js';
import { authEvent, findAccountLink, insertSession, INVALID_LINK, lockActiveUser, requireCurrentPassword, revokeLinks, validLink } from './accountService.js';

export function googleAvailable() {
  return Boolean(config.googleAuthEnabled && config.supabase.url && config.supabaseAuthKey);
}

function assertConfigured() {
  if (!googleAvailable()) throw new HttpError(503, 'Accesso Google non disponibile. Usa username e password.');
}

export async function beginGoogleFlow({ purpose, invitationToken, userId, sessionHash, password }) {
  assertConfigured();
  if (!['login', 'activation', 'link'].includes(purpose)) throw new HttpError(400, 'Operazione non valida.');
  if (purpose !== 'link' && userId) throw new HttpError(409, 'Esci dall’account attuale prima di usare un invito o un altro accesso.');
  if (purpose === 'link' && (!userId || !sessionHash)) throw new HttpError(401, 'Accedi prima al tuo account.');
  const invitation = purpose === 'activation' ? await findAccountLink(invitationToken) : null;
  if (invitation && invitation.kind !== 'activation') throw new HttpError(400, 'Il recupero richiede una nuova password.');
  const flowToken = createSessionToken();
  const verifier = crypto.randomBytes(48).toString('base64url');
  await dbRun('DELETE FROM oauth_flows WHERE expires_at <= now()');
  await dbTx(async (client) => {
    const targetId = invitation?.user_id || userId || null;
    const user = targetId ? await lockActiveUser(client, targetId) : null;
    if (purpose === 'link') {
      requireCurrentPassword(user, password);
      if (await client.get('SELECT 1 FROM user_google_identities WHERE user_id = ?', [userId])) throw new HttpError(409, 'Google è già collegato.');
    }
    if (invitation && !validLink(await client.get('SELECT * FROM account_links WHERE id = ?', [invitation.id]))) throw new HttpError(410, INVALID_LINK);
    await client.run(
      'INSERT INTO oauth_flows (token_hash, purpose, user_id, link_id, session_hash, auth_version, code_verifier, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [hashSessionToken(flowToken), purpose, targetId, invitation?.id || null, purpose === 'link' ? sessionHash : null, user?.auth_version ?? null, verifier, new Date(Date.now() + 600000).toISOString()]
    );
  });
  const url = new URL(`${config.supabase.url.replace(/\/$/, '')}/auth/v1/authorize`);
  url.search = new URLSearchParams({
    provider: 'google', redirect_to: `${config.appBaseUrl}/auth/callback`,
    scopes: 'openid email profile', prompt: 'select_account',
    code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 's256'
  }).toString();
  return { flowToken, url: url.toString() };
}

// Richieste server-to-server, senza client condivisi, token nel browser o refresh persistenti.
// Il protocollo è lo stesso di auth-js exchangeCodeForSession + getUser.
export async function exchangeGoogleCode(code, verifier) {
  const base = `${config.supabase.url.replace(/\/$/, '')}/auth/v1`;
  const headers = { apikey: config.supabaseAuthKey, 'Content-Type': 'application/json' };
  try {
    const response = await fetch(`${base}/token?grant_type=pkce`, {
      method: 'POST', headers, body: JSON.stringify({ auth_code: code, code_verifier: verifier }), signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw new Error('exchange');
    const session = await response.json();
    if (!session.access_token) throw new Error('session');
    const userResponse = await fetch(`${base}/user`, {
      headers: { ...headers, Authorization: `Bearer ${session.access_token}` }, signal: AbortSignal.timeout(15000)
    });
    if (!userResponse.ok) throw new Error('user');
    const user = await userResponse.json();
    const google = user.identities?.find((identity) => identity.provider === 'google');
    const subject = google?.identity_data?.sub;
    const email = google?.identity_data?.email;
    if (!user.id || !subject || !email || google.identity_data.email_verified !== true) throw new Error('identity');
    // Un'identità Google presente nel profilo Supabase non prova da sola che
    // questo accesso sia avvenuto tramite Google (Supabase può unire identità).
    if (!session.provider_token) throw new Error('google-token');
    const googleResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${session.provider_token}` }, signal: AbortSignal.timeout(15000)
    });
    if (!googleResponse.ok) throw new Error('google-user');
    const googleUser = await googleResponse.json();
    if (String(googleUser.sub) !== String(subject) || googleUser.email_verified !== true || String(googleUser.email).toLowerCase() !== String(email).toLowerCase()) throw new Error('google-mismatch');
    return { supabaseUserId: user.id, googleSubject: String(subject), email: String(email).toLowerCase() };
  } catch {
    throw new HttpError(401, 'Google non ha completato la verifica. Riprova dal login o riapri il tuo invito.');
  }
}

export async function finishGoogleFlow({ flowToken, code, providerError, currentUserId, sessionHash, exchange = exchangeGoogleCode }) {
  assertConfigured();
  if (!/^[A-Za-z0-9_-]{43}$/.test(String(flowToken || ''))) throw new HttpError(400, 'Accesso Google scaduto. Riprova dallo stesso browser.');
  // DELETE RETURNING rende il callback monouso anche tra processi diversi.
  const flow = await dbGet('DELETE FROM oauth_flows WHERE token_hash = ? RETURNING *', [hashSessionToken(flowToken)]);
  if (!flow || new Date(flow.expires_at).getTime() <= Date.now()) throw new HttpError(410, 'Accesso Google scaduto. Riprova dal login o riapri l’invito.');
  if (providerError || typeof code !== 'string' || !code || code.length > 2048) throw new HttpError(400, 'Accesso Google annullato. Puoi riprovare o usare username e password.');
  if (flow.purpose === 'link' && (flow.user_id !== currentUserId || flow.session_hash !== sessionHash)) throw new HttpError(403, 'La sessione è cambiata. Accedi di nuovo e ripeti il collegamento.');
  if (flow.purpose === 'activation' && currentUserId) throw new HttpError(409, 'Esci dall’account attuale e riapri l’invito.');
  const identity = await exchange(code, flow.code_verifier);
  try {
    return await dbTx(async (client) => {
      const bound = await client.get('SELECT * FROM user_google_identities WHERE supabase_user_id = ? OR google_subject = ?', [identity.supabaseUserId, identity.googleSubject]);
      if (flow.purpose === 'login') {
        if (!bound || bound.supabase_user_id !== identity.supabaseUserId || bound.google_subject !== identity.googleSubject) throw new HttpError(403, 'Questo account Google non è collegato a FischioLab. Usa il tuo invito oppure entra con lo username e collega Google dal tuo account.');
        if (currentUserId && currentUserId !== bound.user_id) throw new HttpError(409, 'Esci dall’account attuale prima di accedere con un altro utente.');
        const user = await lockActiveUser(client, bound.user_id);
        // Ricontrolla dopo il lock: un reset o scollegamento può essere appena terminato.
        const stillBound = await client.get('SELECT 1 FROM user_google_identities WHERE user_id = ? AND supabase_user_id = ? AND google_subject = ?', [user.id, identity.supabaseUserId, identity.googleSubject]);
        if (!stillBound) throw new HttpError(403, 'Collegamento Google revocato. Usa username e password.');
        await authEvent(client, user.id, user.id, 'google_login');
        return { userId: user.id, sessionToken: await insertSession(client, user.id, 'google'), purpose: 'login' };
      }
      const user = await lockActiveUser(client, flow.user_id);
      if (user.auth_version !== flow.auth_version) throw new HttpError(409, 'Le credenziali sono cambiate. Ripeti l’operazione.');
      if (bound || await client.get('SELECT 1 FROM user_google_identities WHERE user_id = ?', [user.id])) throw new HttpError(409, 'Account Google già collegato. Contatta l’amministratore se serve correggere l’associazione.');
      if (flow.purpose === 'link') {
        const liveSession = await client.get('SELECT 1 FROM sessions WHERE token_hash = ? AND user_id = ? AND expires_at > ?', [sessionHash, user.id, new Date().toISOString()]);
        if (!liveSession) throw new HttpError(401, 'Sessione scaduta. Accedi di nuovo.');
      } else {
        const link = await client.get('SELECT * FROM account_links WHERE id = ? FOR UPDATE', [flow.link_id]);
        if (!validLink(link) || link.user_id !== user.id || link.kind !== 'activation') throw new HttpError(410, INVALID_LINK);
        if (user.password_hash) throw new HttpError(409, 'Account già attivato. Collega Google dalla pagina account.');
        await client.run('UPDATE account_links SET used_at = now() WHERE id = ?', [link.id]);
        await revokeLinks(client, user.id);
        await client.run('DELETE FROM sessions WHERE user_id = ?', [user.id]);
      }
      await client.run('INSERT INTO user_google_identities (user_id, supabase_user_id, google_subject, email) VALUES (?, ?, ?, ?)', [user.id, identity.supabaseUserId, identity.googleSubject, identity.email]);
      await client.run('UPDATE users SET activated_at = COALESCE(activated_at, now()), auth_version = auth_version + 1, updated_at = ts_now() WHERE id = ?', [user.id]);
      await authEvent(client, user.id, user.id, flow.purpose === 'link' ? 'google_linked' : 'google_activated');
      // Ruota il cookie e chiude la sessione che ha avviato il collegamento.
      if (flow.session_hash) await client.run('DELETE FROM sessions WHERE token_hash = ?', [flow.session_hash]);
      return { userId: user.id, sessionToken: await insertSession(client, user.id, 'google'), purpose: flow.purpose };
    });
  } catch (err) {
    if (err.code === '23505') throw new HttpError(409, 'Questo account Google è già collegato a un utente.');
    throw err;
  }
}
