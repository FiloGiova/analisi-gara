import nodemailer from 'nodemailer';
import { config, getSessionMaxAgeMs } from '../config.js';
import { dbAll, dbGet, dbRun, dbTx } from '../database/db.js';
import { createSessionToken, hashSessionToken, hashPassword, verifyPassword } from '../utils/passwords.js';
import { HttpError } from '../utils/httpError.js';
import { validatePassword } from './userService.js';

export const INVALID_LINK = 'Il link è scaduto, revocato o già utilizzato. Chiedi un nuovo link all’amministratore.';

export function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw new HttpError(400, 'Indirizzo email non valido.');
  return email || null;
}

export async function authEvent(client, userId, actorId, action) {
  await client.run('INSERT INTO auth_events (user_id, actor_id, action) VALUES (?, ?, ?)', [userId, actorId, action]);
}

export async function lockActiveUser(client, id) {
  const row = await client.get('SELECT * FROM users WHERE id = ? FOR UPDATE', [id]);
  if (!row?.active) throw new HttpError(403, 'Utente non disponibile. Contatta l’amministratore.');
  return row;
}

export function validLink(row) {
  return row && !row.used_at && !row.revoked_at && new Date(row.expires_at).getTime() > Date.now();
}

export async function revokeLinks(client, userId) {
  await client.run('UPDATE account_links SET revoked_at = now() WHERE user_id = ? AND used_at IS NULL AND revoked_at IS NULL', [userId]);
}

export async function insertSession(client, userId, method = 'password') {
  const token = createSessionToken();
  await client.run('INSERT INTO sessions (token_hash, user_id, expires_at, auth_method) VALUES (?, ?, ?, ?)', [
    hashSessionToken(token), userId, new Date(Date.now() + getSessionMaxAgeMs()).toISOString(), method
  ]);
  return token;
}

export async function accountStatus(userId) {
  const row = await dbGet('SELECT password_hash, email, email_verified_at, activated_at FROM users WHERE id = ?', [userId]);
  if (!row) throw new HttpError(404, 'Utente non trovato.');
  const google = await dbGet('SELECT email, created_at FROM user_google_identities WHERE user_id = ?', [userId]);
  return { hasPassword: Boolean(row.password_hash), email: row.email || '', emailVerified: Boolean(row.email_verified_at), google, activatedAt: row.activated_at };
}

async function insertLink(client, { userId, kind, actorId = null, email = null, resetGoogle = false }) {
  const token = createSessionToken();
  const hours = kind === 'activation' ? 72 : kind === 'verify_email' ? 24 : 1;
  await client.run('UPDATE account_links SET revoked_at = now() WHERE user_id = ? AND kind = ? AND used_at IS NULL AND revoked_at IS NULL', [userId, kind]);
  const expiresAt = new Date(Date.now() + hours * 3600000).toISOString();
  const row = await client.get(
    'INSERT INTO account_links (user_id, kind, token_hash, email, reset_google, created_by, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id',
    [userId, kind, hashSessionToken(token), email, resetGoogle, actorId, expiresAt]
  );
  await authEvent(client, userId, actorId, `${kind}_created`);
  return { id: row.id, kind, expiresAt, url: `${config.appBaseUrl}/#/activate?token=${token}` };
}

export async function createAccountLink({ userId, kind, actorId, resetGoogle = false }) {
  if (!['activation', 'recovery'].includes(kind)) throw new HttpError(400, 'Tipo di invito non valido.');
  return dbTx(async (client) => {
    const user = await lockActiveUser(client, userId);
    const google = await client.get('SELECT 1 FROM user_google_identities WHERE user_id = ?', [userId]);
    const activated = Boolean(user.password_hash || google);
    if (kind === 'activation' && activated) throw new HttpError(409, 'Account già attivato. Usa il link di recupero.');
    if (kind === 'recovery' && !activated) throw new HttpError(409, 'Account da attivare. Genera un invito.');
    return insertLink(client, { userId, kind, actorId, resetGoogle: kind === 'recovery' && Boolean(resetGoogle) });
  });
}

export async function revokeAccountLinks(userId, actorId) {
  await dbTx(async (client) => {
    await lockActiveUser(client, userId);
    await revokeLinks(client, userId);
    await authEvent(client, userId, actorId, 'links_revoked');
  });
}

export async function findAccountLink(token) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(String(token || ''))) throw new HttpError(410, INVALID_LINK);
  const link = await dbGet('SELECT * FROM account_links WHERE token_hash = ?', [hashSessionToken(token)]);
  if (!validLink(link)) throw new HttpError(410, INVALID_LINK);
  return link;
}

export async function inspectAccountLink(token) {
  const link = await findAccountLink(token);
  const user = await dbGet('SELECT username, display_name, active FROM users WHERE id = ?', [link.user_id]);
  if (!user?.active) throw new HttpError(410, INVALID_LINK);
  return { username: user.username, displayName: user.display_name, kind: link.kind, expiresAt: link.expires_at, resetGoogle: link.reset_google };
}

export async function consumePasswordLink({ token, password, email }) {
  validatePassword(password);
  const normalizedEmail = normalizeEmail(email);
  const initial = await findAccountLink(token);
  if (!['activation', 'recovery'].includes(initial.kind)) throw new HttpError(400, 'Questo link serve a verificare l’email.');
  const passwordHash = hashPassword(password);
  return dbTx(async (client) => {
    const user = await lockActiveUser(client, initial.user_id);
    const link = await client.get('SELECT * FROM account_links WHERE id = ? FOR UPDATE', [initial.id]);
    if (!validLink(link)) throw new HttpError(410, INVALID_LINK);
    if (link.kind === 'activation' && (user.password_hash || await client.get('SELECT 1 FROM user_google_identities WHERE user_id = ?', [user.id]))) throw new HttpError(409, 'Account già attivato.');
    await client.run('UPDATE account_links SET used_at = now() WHERE id = ?', [link.id]);
    await client.run('UPDATE users SET password_hash = ?, activated_at = COALESCE(activated_at, now()), auth_version = auth_version + 1, updated_at = ts_now() WHERE id = ?', [passwordHash, user.id]);
    if (link.kind === 'activation') await client.run('UPDATE users SET email = ?, email_verified_at = NULL WHERE id = ?', [normalizedEmail, user.id]);
    if (link.reset_google) await client.run('DELETE FROM user_google_identities WHERE user_id = ?', [user.id]);
    await client.run('DELETE FROM sessions WHERE user_id = ?', [user.id]);
    await revokeLinks(client, user.id);
    await authEvent(client, user.id, user.id, `${link.kind}_completed`);
    const sessionToken = await insertSession(client, user.id);
    return { userId: user.id, sessionToken, verifyEmail: link.kind === 'activation' && Boolean(normalizedEmail) };
  });
}

export async function authenticatePassword(username, password) {
  const login = String(username || '').trim().toLowerCase();
  if (!login || typeof password !== 'string' || !password || password.length > 1024) throw new HttpError(400, 'Inserisci username e password.');
  // Stesso costo bcrypt anche quando il nome non esiste.
  const dummyHash = '$2a$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW';
  const found = await dbGet('SELECT * FROM users WHERE username = ? OR (lower(email) = ? AND email_verified_at IS NOT NULL)', [login, login]);
  const valid = verifyPassword(password, found?.password_hash || dummyHash);
  if (!found?.active || !found.password_hash || !valid) throw new HttpError(401, 'Credenziali non valide.');
  return dbTx(async (client) => {
    const user = await lockActiveUser(client, found.id);
    if (user.password_hash !== found.password_hash) throw new HttpError(401, 'Credenziali non valide.');
    return { userId: user.id, sessionToken: await insertSession(client, user.id) };
  });
}

export function requireCurrentPassword(user, password) {
  if (!user.password_hash || !verifyPassword(String(password || ''), user.password_hash)) throw new HttpError(400, 'Password attuale non corretta.');
}

async function requireRecentOwner(client, user, password, session) {
  if (user.password_hash) return requireCurrentPassword(user, password);
  const row = session?.hash && await client.get("SELECT 1 FROM sessions WHERE token_hash = ? AND user_id = ? AND auth_method = 'google' AND created_at::timestamp > (now() AT TIME ZONE 'utc') - interval '10 minutes'", [session.hash, user.id]);
  if (!row) throw new HttpError(403, 'Per questa modifica, esci e accedi di nuovo con Google. Poi riprova entro 10 minuti.');
}

export async function changeAccountPassword({ userId, currentPassword, newPassword, session }) {
  validatePassword(newPassword);
  const passwordHash = hashPassword(newPassword);
  await dbTx(async (client) => {
    const user = await lockActiveUser(client, userId);
    await requireRecentOwner(client, user, currentPassword, session);
    await client.run('UPDATE users SET password_hash = ?, auth_version = auth_version + 1, updated_at = ts_now() WHERE id = ?', [passwordHash, userId]);
    await client.run('DELETE FROM sessions WHERE user_id = ?', [userId]);
    await revokeLinks(client, userId);
    await authEvent(client, userId, userId, 'password_changed');
  });
}

export async function unlinkGoogle({ userId, password }) {
  await dbTx(async (client) => {
    const user = await lockActiveUser(client, userId);
    if (!user.password_hash) throw new HttpError(400, 'Crea prima una password per continuare ad accedere senza Google.');
    requireCurrentPassword(user, password);
    await client.run('DELETE FROM user_google_identities WHERE user_id = ?', [userId]);
    await client.run('UPDATE users SET auth_version = auth_version + 1 WHERE id = ?', [userId]);
    await client.run('DELETE FROM sessions WHERE user_id = ?', [userId]);
    await authEvent(client, userId, userId, 'google_unlinked');
  });
}

let mailTransport = () => nodemailer.createTransport({ ...config.smtp, connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000 });
export function setAuthMailTransportForTests(factory) { mailTransport = factory; }

async function sendAccountEmail(email, link) {
  try {
    await mailTransport().sendMail({
      from: config.smtp.from, to: email,
      subject: link.kind === 'verify_email' ? 'FischioLab — verifica la tua email' : 'FischioLab — recupera l’accesso',
      text: `Apri questo link personale su FischioLab:\n${link.url}\n\nScade il ${new Date(link.expiresAt).toLocaleString('it-IT', { timeZone: 'Europe/Rome' })}. Se non hai richiesto questa operazione, ignora il messaggio.`
    });
    return true;
  } catch {
    const revoked = await dbGet('UPDATE account_links SET revoked_at = now() WHERE id = ? AND used_at IS NULL RETURNING user_id', [link.id]);
    if (revoked) await authEvent({ run: dbRun }, revoked.user_id, null, 'email_delivery_failed');
    return false;
  }
}

export async function requestEmailVerification(userId) {
  if (!config.smtp) return { sent: false, message: 'Email salvata. La verifica via email non è ancora disponibile: usa lo username per entrare.' };
  const result = await dbTx(async (client) => {
    const user = await lockActiveUser(client, userId);
    if (!user.email) throw new HttpError(400, 'Inserisci prima un indirizzo email.');
    if (user.email_verified_at) throw new HttpError(409, 'Email già verificata.');
    return { email: user.email, link: await insertLink(client, { userId, kind: 'verify_email', actorId: userId, email: user.email }) };
  });
  const sent = await sendAccountEmail(result.email, result.link);
  return { sent, message: sent ? 'Controlla la posta per verificare l’email.' : 'Email salvata, ma il messaggio di verifica non è stato inviato. Riprova dall’account o usa lo username.' };
}

export async function updateAccountEmail(userId, value, password, session) {
  const email = normalizeEmail(value);
  const changed = await dbTx(async (client) => {
    const user = await lockActiveUser(client, userId);
    if (user.email === email) return false;
    await requireRecentOwner(client, user, password, session);
    await client.run('UPDATE users SET email = ?, email_verified_at = NULL, updated_at = ts_now() WHERE id = ?', [email, userId]);
    await client.run("UPDATE account_links SET revoked_at = now() WHERE user_id = ? AND kind IN ('verify_email', 'recovery') AND used_at IS NULL AND revoked_at IS NULL", [userId]);
    await authEvent(client, userId, userId, 'email_changed');
    return true;
  });
  return changed && email ? requestEmailVerification(userId) : { sent: false, message: email ? 'Email invariata.' : 'Email rimossa. Continua ad accedere con lo username o con Google, se collegato.' };
}

export async function verifyAccountEmail(token) {
  const initial = await findAccountLink(token);
  if (initial.kind !== 'verify_email') throw new HttpError(400, 'Link non valido per la verifica email.');
  try {
    await dbTx(async (client) => {
      const user = await lockActiveUser(client, initial.user_id);
      const link = await client.get('SELECT * FROM account_links WHERE id = ? FOR UPDATE', [initial.id]);
      if (!validLink(link) || user.email !== link.email) throw new HttpError(410, INVALID_LINK);
      await client.run('UPDATE users SET email_verified_at = now() WHERE id = ?', [user.id]);
      await client.run('UPDATE account_links SET used_at = now() WHERE id = ?', [link.id]);
      await authEvent(client, user.id, user.id, 'email_verified');
    });
  } catch (err) {
    if (err.code === '23505') throw new HttpError(409, 'Questa email è già associata a un altro account. Contatta l’amministratore.');
    throw err;
  }
}

export async function requestEmailRecovery(value) {
  const email = normalizeEmail(value);
  if (!config.smtp || !email) return;
  const user = await dbGet('SELECT id FROM users WHERE lower(email) = ? AND email_verified_at IS NOT NULL AND active = 1', [email]);
  if (!user) return;
  const result = await dbTx(async (client) => {
    const current = await lockActiveUser(client, user.id);
    if (current.email !== email || !current.email_verified_at) return null;
    // Non invalida un link amministrativo già consegnato: impedisce il DoS pubblico.
    const pending = await client.get("SELECT 1 FROM account_links WHERE user_id = ? AND kind = 'recovery' AND used_at IS NULL AND revoked_at IS NULL AND expires_at > now()", [user.id]);
    if (pending) return null;
    return insertLink(client, { userId: user.id, kind: 'recovery', email });
  });
  if (result) await sendAccountEmail(email, result);
}

export async function listAuthEvents(userId) {
  return dbAll('SELECT e.action, e.created_at, u.username AS actor FROM auth_events e LEFT JOIN users u ON u.id = e.actor_id WHERE e.user_id = ? ORDER BY e.id DESC LIMIT 30', [userId]);
}
