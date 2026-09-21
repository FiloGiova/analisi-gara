import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fischiolab-auth-'));
process.env.STORAGE_DIR = tempDir;
const { setupTestDatabase, closeTestDatabase, dbGet, dbAll, dbRun } = await import('./helpers/testDatabase.js');
const { initializeDatabase } = await import('../src/database/connection.js');
const { createUser, getUser, updateUser } = await import('../src/services/userService.js');
const accounts = await import('../src/services/accountService.js');
const google = await import('../src/services/googleAuthService.js');
const { hashSessionToken } = await import('../src/utils/passwords.js');
const { config } = await import('../src/config.js');
const { app } = await import('../server.js');
await setupTestDatabase();
config.smtp = null;
config.googleAuthEnabled = true;
config.supabaseAuthKey = 'test-public-key';
config.supabase.url = 'https://supabase.example.test';
const server = await new Promise((resolve) => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
const base = `http://127.0.0.1:${server.address().port}`;
config.appBaseUrl = base;
const password = 'Password-di-test-123';
const admin = await createUser({ username: 'admin.auth', password, roles: ['admin'], displayName: 'Admin Auth' });
let serial = 0;
const tokenOf = (link) => new URLSearchParams(new URL(link.url).hash.split('?')[1]).get('token');
async function person(roles = ['operator']) {
  return createUser({ username: `persona.${++serial}`, displayName: `Persona ${serial}`, roles,
    ...(roles.includes('instructor') ? { instructorAssignments: [{ sportSeason: '2026/2027', competitions: ['DR1'] }] } : {}) });
}
async function invite(user, kind = 'activation', resetGoogle = false) {
  return accounts.createAccountLink({ userId: user.id, kind, actorId: admin.id, resetGoogle });
}
async function activate(user) {
  return accounts.consumePasswordLink({ token: tokenOf(await invite(user)), password });
}
async function http(endpoint, { method = 'GET', data, cookie, headers = {} } = {}) {
  const response = await fetch(`${base}${endpoint}`, {
    method, redirect: 'manual', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'FischioLab', Origin: base, ...cookie && { Cookie: cookie }, ...headers },
    ...data !== undefined && { body: JSON.stringify(data) }
  });
  const body = response.headers.get('content-type')?.includes('json') ? await response.json() : null;
  return { response, body, status: response.status, cookie: response.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ') };
}
const adminSession = await accounts.authenticatePassword(admin.username, password);
const adminCookie = `${config.sessionCookieName}=${adminSession.sessionToken}`;
const identity = () => ({ supabaseUserId: crypto.randomUUID(), googleSubject: crypto.randomBytes(10).toString('hex'), email: `google${++serial}@example.test` });
async function activateGoogle(user, id = identity()) {
  const link = await invite(user);
  const flow = await google.beginGoogleFlow({ purpose: 'activation', invitationToken: tokenOf(link) });
  const result = await google.finishGoogleFlow({ flowToken: flow.flowToken, code: 'auth-code', exchange: async () => id });
  return { ...result, identity: id, link };
}

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await closeTestDatabase();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('migrazione ripetibile: utenti storici, hash e sessioni restano validi', async () => {
  const before = await dbGet('SELECT * FROM users WHERE id = ?', [admin.id]);
  await initializeDatabase();
  await initializeDatabase();
  const after = await dbGet('SELECT * FROM users WHERE id = ?', [admin.id]);
  assert.equal(after.password_hash, before.password_hash);
  assert.equal(after.id, admin.id);
  assert.ok(after.activated_at);
  assert.equal((await http('/api/auth/me', { cookie: adminCookie })).body.user.id, admin.id);
  const protectedTables = await dbAll("SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public'");
  assert.ok(protectedTables.every((row) => row.rowsecurity), 'RLS protegge tutte le tabelle applicative');
});

test('solo admin crea profili senza email/password; input credenziali ignorato', async () => {
  assert.equal((await http('/api/users')).status, 401);
  const response = await http('/api/users', { method: 'POST', cookie: adminCookie, data: { username: 'nuovo.operatore', roles: ['operator'], password: 'NonUsareQuesta', email: 'non-usare@example.test' } });
  assert.equal(response.status, 201);
  const row = await dbGet('SELECT * FROM users WHERE id = ?', [response.body.user.id]);
  assert.equal(row.password_hash, null); assert.equal(row.email, null);
  assert.equal((await http('/api/auth/login', { method: 'POST', data: { username: row.username, password: 'NonUsareQuesta' } })).status, 401);
  const operator = await person(); const session = await activate(operator);
  assert.equal((await http('/api/users', { cookie: `${config.sessionCookieName}=${session.sessionToken}` })).status, 403);
});

test('invito: anteprima ripetibile, token solo hash, scadenza 72 ore e ID/ruoli invariati', async () => {
  const user = await person(['instructor', 'operator']);
  const created = await http(`/api/users/${user.id}/invitation`, { method: 'POST', cookie: adminCookie, data: { kind: 'activation' } });
  assert.equal(created.status, 201);
  const link = created.body.invitation; const token = tokenOf(link);
  assert.ok(new Date(link.expiresAt) - Date.now() > 71 * 3600000);
  const stored = await dbGet('SELECT * FROM account_links WHERE id = ?', [link.id]);
  assert.equal(stored.token_hash, hashSessionToken(token));
  assert.ok(!JSON.stringify(stored).includes(token));
  for (let i = 0; i < 2; i++) assert.equal((await http('/api/auth/invitation', { method: 'POST', data: { token } })).body.invitation.username, user.username);
  const accepted = await http('/api/auth/activate', { method: 'POST', data: { token, password, userId: admin.id, roles: ['admin'] } });
  assert.equal(accepted.status, 200); assert.equal(accepted.body.user.id, user.id);
  assert.deepEqual(accepted.body.user.roles, user.roles);
  assert.deepEqual(accepted.body.user.instructorAssignments, user.instructorAssignments);
  assert.match(accepted.response.headers.get('set-cookie'), /HttpOnly/);
  assert.match(accepted.response.headers.get('set-cookie'), /SameSite=Lax/);
  assert.equal((await http('/api/auth/me', { cookie: accepted.cookie })).body.user.id, user.id);
  assert.equal((await accounts.accountStatus(user.id)).email, '');
  await assert.rejects(() => accounts.consumePasswordLink({ token, password }), (err) => err.statusCode === 410);
  assert.ok((await accounts.listAuthEvents(user.id)).some((event) => event.action === 'activation_completed'));
});

test('inviti concorrenti, revocati, scaduti e rigenerati non si possono riutilizzare', async () => {
  const user = await person();
  const first = await invite(user); const second = await invite(user);
  await assert.rejects(() => accounts.inspectAccountLink(tokenOf(first)), /scaduto/);
  const attempts = await Promise.allSettled([0, 1].map(() => accounts.consumePasswordLink({ token: tokenOf(second), password })));
  assert.equal(attempts.filter((result) => result.status === 'fulfilled').length, 1);
  const expiredUser = await person(); const expired = await invite(expiredUser);
  await dbRun("UPDATE account_links SET expires_at = now() - interval '1 second' WHERE id = ?", [expired.id]);
  await assert.rejects(() => accounts.inspectAccountLink(tokenOf(expired)), /scaduto/);
  const revoked = await invite(expiredUser); await accounts.revokeAccountLinks(expiredUser.id, admin.id);
  await assert.rejects(() => accounts.consumePasswordLink({ token: tokenOf(revoked), password }), /scaduto/);
});

test('utente disattivato: sessioni, inviti e login non funzionano più', async () => {
  const user = await person(); const session = await activate(user); const recovery = await invite(user, 'recovery');
  await updateUser({ id: user.id, active: false });
  assert.equal(await dbGet('SELECT 1 FROM sessions WHERE user_id = ?', [user.id]), null);
  await assert.rejects(() => accounts.inspectAccountLink(tokenOf(recovery)), /scaduto/);
  await assert.rejects(() => accounts.authenticatePassword(user.username, password), /Credenziali/);
  assert.equal((await http('/api/auth/me', { cookie: `${config.sessionCookieName}=${session.sessionToken}` })).body.user, null);
});

test('recupero senza email cambia password e chiude ogni sessione', async () => {
  const user = await person(); await activate(user); await accounts.authenticatePassword(user.username, password);
  const recovery = await invite(user, 'recovery');
  assert.ok(new Date(recovery.expiresAt) - Date.now() < 3600001);
  const reset = await accounts.consumePasswordLink({ token: tokenOf(recovery), password: 'Password-nuova-456' });
  assert.equal(reset.userId, user.id);
  assert.equal((await dbGet('SELECT count(*) AS n FROM sessions WHERE user_id = ?', [user.id])).n, 1);
  await assert.rejects(() => accounts.authenticatePassword(user.username, password), /Credenziali/);
  assert.equal((await accounts.authenticatePassword(user.username, 'Password-nuova-456')).userId, user.id);
});

test('Google: nessuna registrazione libera, stesso profilo e permessi dopo invito', async () => {
  const id = identity(); const unknown = await google.beginGoogleFlow({ purpose: 'login' });
  await assert.rejects(() => google.finishGoogleFlow({ flowToken: unknown.flowToken, code: 'code', exchange: async () => id }), (err) => err.statusCode === 403);
  const user = await person(['instructor', 'operator']);
  const result = await activateGoogle(user, id);
  assert.equal(result.userId, user.id);
  const status = await accounts.accountStatus(user.id);
  assert.equal(status.hasPassword, false); assert.equal(status.google.email, id.email);
  const signedIn = await http('/api/auth/me', { cookie: `${config.sessionCookieName}=${result.sessionToken}` });
  assert.deepEqual(signedIn.body.user.roles, user.roles); assert.deepEqual(signedIn.body.user.instructorAssignments, user.instructorAssignments);
  const flow = await google.beginGoogleFlow({ purpose: 'login' });
  assert.equal((await google.finishGoogleFlow({ flowToken: flow.flowToken, code: 'code', exchange: async () => id })).userId, user.id);
  await assert.rejects(() => accounts.inspectAccountLink(tokenOf(result.link)), /scaduto/);
});

test('Google: collisioni e callback ripetuti non consumano l’invito di un altro utente', async () => {
  const id = identity(); await activateGoogle(await person(), id);
  const other = await person(); const link = await invite(other);
  const flow = await google.beginGoogleFlow({ purpose: 'activation', invitationToken: tokenOf(link) });
  await assert.rejects(() => google.finishGoogleFlow({ flowToken: flow.flowToken, code: 'code', exchange: async () => id }), (err) => err.statusCode === 409);
  assert.equal((await accounts.inspectAccountLink(tokenOf(link))).username, other.username);
  await assert.rejects(() => google.finishGoogleFlow({ flowToken: flow.flowToken, code: 'code', exchange: async () => id }), /scaduto/);
});

test('Google: collegamento richiede password e stessa sessione del browser', async () => {
  const user = await person(); const local = await activate(user); const sessionHash = hashSessionToken(local.sessionToken);
  await assert.rejects(() => google.beginGoogleFlow({ purpose: 'link', userId: user.id, sessionHash, password: 'sbagliata' }), /Password attuale/);
  const badFlow = await google.beginGoogleFlow({ purpose: 'link', userId: user.id, sessionHash, password });
  await assert.rejects(() => google.finishGoogleFlow({ flowToken: badFlow.flowToken, code: 'code', currentUserId: admin.id, sessionHash, exchange: async () => identity() }), /sessione è cambiata/);
  const flow = await google.beginGoogleFlow({ purpose: 'link', userId: user.id, sessionHash, password });
  const url = new URL(flow.url);
  assert.equal(url.searchParams.get('provider'), 'google'); assert.equal(url.searchParams.get('code_challenge_method'), 's256');
  const stored = await dbGet('SELECT * FROM oauth_flows WHERE token_hash = ?', [hashSessionToken(flow.flowToken)]);
  assert.equal(url.searchParams.get('code_challenge'), crypto.createHash('sha256').update(stored.code_verifier).digest('base64url'));
  const result = await google.finishGoogleFlow({ flowToken: flow.flowToken, code: 'code', currentUserId: user.id, sessionHash, exchange: async () => identity() });
  assert.equal(result.userId, user.id);
  assert.equal(await dbGet('SELECT 1 FROM sessions WHERE token_hash = ?', [sessionHash]), null);
  assert.equal((await accounts.authenticatePassword(user.username, password)).userId, user.id);
});

test('Google: invito revocato e credenziali modificate durante OAuth impediscono il collegamento', async () => {
  const user = await person(); const link = await invite(user);
  const flow = await google.beginGoogleFlow({ purpose: 'activation', invitationToken: tokenOf(link) });
  await accounts.revokeAccountLinks(user.id, admin.id);
  await assert.rejects(() => google.finishGoogleFlow({ flowToken: flow.flowToken, code: 'code', exchange: async () => identity() }), /scaduto/);
  const local = await activate(user); const sessionHash = hashSessionToken(local.sessionToken);
  const pending = await google.beginGoogleFlow({ purpose: 'link', userId: user.id, sessionHash, password });
  await accounts.changeAccountPassword({ userId: user.id, currentPassword: password, newPassword: 'Cambiata-123456' });
  await assert.rejects(() => google.finishGoogleFlow({ flowToken: pending.flowToken, code: 'code', currentUserId: user.id, sessionHash, exchange: async () => identity() }), /credenziali sono cambiate/);
});

test('Google-only: password aggiungibile con accesso recente; nessuno può scollegare l’ultimo metodo', async () => {
  const user = await person(); const googleSession = await activateGoogle(user);
  await assert.rejects(() => accounts.unlinkGoogle({ userId: user.id, password }), /Crea prima/);
  await assert.rejects(() => accounts.changeAccountPassword({ userId: user.id, newPassword: password }), /accedi di nuovo/);
  await accounts.changeAccountPassword({ userId: user.id, newPassword: password, session: { hash: hashSessionToken(googleSession.sessionToken) } });
  assert.ok((await accounts.accountStatus(user.id)).hasPassword);
  await accounts.unlinkGoogle({ userId: user.id, password });
  assert.equal((await accounts.accountStatus(user.id)).google, null);
  assert.equal((await accounts.authenticatePassword(user.username, password)).userId, user.id);
});

test('recupero amministrativo può scollegare Google senza cambiare l’identità interna', async () => {
  const user = await person(); await activateGoogle(user);
  const recovery = await invite(user, 'recovery', true);
  await accounts.consumePasswordLink({ token: tokenOf(recovery), password });
  assert.equal((await accounts.accountStatus(user.id)).google, null);
  assert.equal((await getUser(user.id)).username, user.username);
});

test('email facoltativa non verificata non diventa login o recupero; SMTP assente non blocca', async () => {
  const user = await person(); const link = await invite(user);
  await accounts.consumePasswordLink({ token: tokenOf(link), password, email: 'Facoltativa@EXAMPLE.test' });
  assert.equal((await accounts.accountStatus(user.id)).email, 'facoltativa@example.test');
  assert.equal((await accounts.requestEmailVerification(user.id)).sent, false);
  await assert.rejects(() => accounts.authenticatePassword('facoltativa@example.test', password), /Credenziali/);
  await accounts.requestEmailRecovery('facoltativa@example.test');
  assert.equal(await dbGet("SELECT 1 FROM account_links WHERE user_id = ? AND kind = 'recovery'", [user.id]), null);
});

test('email: verifica, login e recupero con trasporto simulato; unicità solo dopo verifica', async () => {
  const sent = [];
  config.smtp = { from: 'test@example.test' };
  accounts.setAuthMailTransportForTests(() => ({ sendMail: async (message) => sent.push(message) }));
  try {
    const user = await person(); await activate(user);
    await assert.rejects(() => accounts.updateAccountEmail(user.id, 'verified@example.test'), /Password attuale/);
    const result = await accounts.updateAccountEmail(user.id, 'verified@example.test', password);
    assert.equal(result.sent, true);
    const url = sent.at(-1).text.match(/https?:\/\/\S+/)[0];
    await accounts.verifyAccountEmail(tokenOf({ url }));
    assert.equal((await accounts.authenticatePassword('VERIFIED@example.test', password)).userId, user.id);
    await accounts.requestEmailRecovery('verified@example.test');
    const recovery = tokenOf({ url: sent.at(-1).text.match(/https?:\/\/\S+/)[0] });
    await accounts.consumePasswordLink({ token: recovery, password: 'Ripristinata-12345' });
    const other = await person(); await activate(other);
    await accounts.updateAccountEmail(other.id, 'verified@example.test', password);
    await assert.rejects(() => accounts.verifyAccountEmail(tokenOf({ url: sent.at(-1).text.match(/https?:\/\/\S+/)[0] })), (err) => err.statusCode === 409);
    const before = sent.length;
    await accounts.requestEmailRecovery('unknown@example.test');
    assert.equal(sent.length, before);
  } finally { config.smtp = null; }
});

test('email: cambio indirizzo revoca i vecchi link e fallimento SMTP non perde il profilo', async () => {
  const sent = []; config.smtp = { from: 'test@example.test' };
  accounts.setAuthMailTransportForTests(() => ({ sendMail: async (message) => sent.push(message) }));
  try {
    const user = await person(); await activate(user);
    await accounts.updateAccountEmail(user.id, 'old@example.test', password);
    const token = tokenOf({ url: sent.at(-1).text.match(/https?:\/\/\S+/)[0] });
    accounts.setAuthMailTransportForTests(() => ({ sendMail: async () => { throw new Error('SMTP test'); } }));
    const result = await accounts.updateAccountEmail(user.id, 'new@example.test', password);
    assert.equal(result.sent, false);
    await assert.rejects(() => accounts.verifyAccountEmail(token), /scaduto/);
    assert.equal((await accounts.accountStatus(user.id)).email, 'new@example.test');
  } finally { config.smtp = null; }
});

test('CSRF, token non validi, cookie corrotti e callback senza browser sono gestiti', async () => {
  assert.equal((await http('/api/auth/login', { method: 'POST', headers: { 'X-Requested-With': '' }, data: { username: admin.username, password } })).status, 403);
  assert.equal((await http('/api/auth/login', { method: 'POST', headers: { Origin: 'https://attacker.test' }, data: { username: admin.username, password } })).status, 403);
  assert.equal((await http('/api/auth/invitation', { method: 'POST', data: { token: 'invalid' } })).status, 410);
  assert.equal((await http('/api/auth/me', { cookie: '%E0%A4%A=bad' })).status, 200);
  const callback = await http('/auth/callback?code=invalid&next=https://attacker.test');
  assert.equal(callback.status, 303); assert.match(callback.response.headers.get('location'), /^\/#\/auth-result\?error=/);
  assert.equal(callback.response.headers.get('cache-control'), 'no-store');
  const start = await http('/api/auth/google/start', { method: 'POST', data: { purpose: 'login' } });
  assert.equal(start.status, 200); assert.match(start.cookie, /_oauth=/);
  const cancelled = await http('/auth/callback?error=access_denied', { cookie: start.cookie });
  assert.equal(cancelled.status, 303); assert.match(decodeURIComponent(cancelled.response.headers.get('location')), /annullato/);
});

test('rate limit persistente blocca ripetuti tentativi anche senza utenti validi', async () => {
  await dbRun('DELETE FROM auth_rate_limits');
  const responses = [];
  for (let i = 0; i < 6; i++) responses.push(await http('/api/auth/recover', { method: 'POST', data: { email: 'absent@example.test' } }));
  assert.equal(responses[4].status, 200); assert.equal(responses[5].status, 429);
  assert.ok(responses[5].response.headers.get('retry-after'));
});

test('un admin soltanto invitato non sostituisce l’ultimo amministratore che può accedere', async () => {
  const invitedAdmin = await person(['admin']);
  await invite(invitedAdmin);
  await assert.rejects(() => updateUser({ id: admin.id, active: false }), /ultimo amministratore/);
  await dbRun('DELETE FROM users WHERE id = ?', [invitedAdmin.id]);
});

test('callback Google HTTP riuscito: verifica provider, cookie locale e nessun token Supabase esposto', async (t) => {
  const user = await person(['instructor']); const link = await invite(user); const id = identity();
  const start = await http('/api/auth/google/start', { method: 'POST', data: { purpose: 'activation', token: tokenOf(link) } });
  const originalFetch = globalThis.fetch;
  const mock = t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (String(url).startsWith(base)) return originalFetch(url, options);
    let body;
    if (String(url).includes('/token?')) {
      const verifier = JSON.parse(options.body).code_verifier;
      assert.equal(crypto.createHash('sha256').update(verifier).digest('base64url'), new URL(start.body.url).searchParams.get('code_challenge'));
      body = { access_token: 'supabase-private-token', provider_token: 'google-private-token' };
    } else if (String(url).includes('/auth/v1/user')) body = { id: id.supabaseUserId, identities: [{ provider: 'google', identity_data: { sub: id.googleSubject, email: id.email, email_verified: true } }] };
    else body = { sub: id.googleSubject, email: id.email, email_verified: true };
    return new Response(JSON.stringify(body), { status: 200 });
  });
  try {
    const result = await http('/auth/callback?code=test-success', { cookie: start.cookie });
    assert.equal(result.status, 303); assert.equal(result.response.headers.get('location'), '/#/account?auth=activated');
    assert.ok(!result.cookie.includes('private-token'));
    const session = await http('/api/auth/me', { cookie: result.cookie });
    assert.equal(session.body.user.id, user.id); assert.deepEqual(session.body.user.roles, ['instructor']);
  } finally { mock.mock.restore(); }
});

test('scambio PKCE verifica sia Supabase sia il soggetto Google effettivo', async (t) => {
  const id = identity(); const calls = [];
  const tokenResponse = { access_token: 'supabase-token', provider_token: 'google-token' };
  let googleSubject = id.googleSubject;
  const mock = t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    const body = String(url).includes('/token?') ? tokenResponse : String(url).includes('/auth/v1/user')
      ? { id: id.supabaseUserId, identities: [{ provider: 'google', identity_data: { sub: id.googleSubject, email: id.email, email_verified: true } }] }
      : { sub: googleSubject, email: id.email, email_verified: true };
    return new Response(JSON.stringify(body), { status: 200 });
  });
  assert.deepEqual(await google.exchangeGoogleCode('code', 'verifier'), id);
  assert.deepEqual(JSON.parse(calls[0].options.body), { auth_code: 'code', code_verifier: 'verifier' });
  assert.equal(calls[1].options.headers.Authorization, 'Bearer supabase-token');
  assert.equal(calls[2].options.headers.Authorization, 'Bearer google-token');
  googleSubject = 'different-subject';
  await assert.rejects(() => google.exchangeGoogleCode('code', 'verifier'), /non ha completato/);
  delete tokenResponse.provider_token;
  await assert.rejects(() => google.exchangeGoogleCode('code', 'verifier'), /non ha completato/);
  mock.mock.restore();
});
