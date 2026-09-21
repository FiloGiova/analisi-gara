import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { load } from 'cheerio';
import { renderPublicPage } from '../src/views/publicPages.js';

// Nessun database: un cookie presente non deve richiedere il DB sulle pagine pubbliche.
process.env.DATABASE_URL = 'postgresql://127.0.0.1:1/fischiolab_public_test';
process.env.SUPABASE_URL = '';
process.env.SUPABASE_SERVICE_KEY = '';
// Verifica i valori pubblici versionati, senza dipendere da override locali.
for (const key of ['PUBLIC_OPERATOR_NAME', 'PUBLIC_CONTACT_EMAIL', 'PUBLIC_PRIVACY_LEGAL_BASIS', 'PUBLIC_PRIVACY_RETENTION']) process.env[key] = '';
const { app } = await import('../server.js');
const { config } = await import('../src/config.js');
const { closeDatabase } = await import('../src/database/connection.js');
const originalInfo = config.publicInfo;
const info = {
  operatorName: 'Gestore di prova', contactEmail: 'privacy@example.test',
  legalBasis: 'Test: basi definite dal titolare.', retention: 'Test: criteri definiti dal titolare.',
  googleSiteVerification: '2q3aWC9ruCDa7mf73dm9t2SW-D5yxRvlv1pL5CSBGHw'
};
const server = await new Promise((resolve) => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
const base = `http://127.0.0.1:${server.address().port}`;
test.afterEach(() => { config.publicInfo = originalInfo; });
test.after(async () => { await new Promise((resolve) => server.close(resolve)); await closeDatabase(); });

test('home HTML leggibile senza JavaScript, con tag Google e link, anche con cookie e DB indisponibile', async () => {
  const response = await fetch(base, { headers: { Cookie: `${config.sessionCookieName}=sessione-non-valida` } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('set-cookie'), null);
  const $ = load(await response.text());
  assert.match($('h1').text(), /stagione arbitrale/);
  assert.equal($('meta[name="google-site-verification"]').attr('content'), info.googleSiteVerification);
  assert.ok($('a[href="/privacy"]').length);
  assert.ok($('a[href="/termini"]').length);
  assert.ok($('a[href="/app"]').length);
  assert.equal($('input[type="password"]').length, 0);
});

test('documenti incompleti non vengono presentati come informativa definitiva', async () => {
  config.publicInfo = {};
  for (const route of ['/privacy', '/termini']) {
    const response = await fetch(base + route);
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow');
    assert.match(await response.text(), /Documento in preparazione/);
  }
});

test('privacy e termini usano i dati reali versionati senza nuove variabili e senza login', async () => {
  for (const [route, heading] of [['/privacy', 'Informativa privacy'], ['/termini', 'Termini di utilizzo']]) {
    const response = await fetch(base + route, { headers: { Cookie: `${config.sessionCookieName}=sessione-non-valida` } });
    assert.equal(response.status, 200);
    const $ = load(await response.text());
    assert.equal($('h1').text(), heading);
    assert.ok($('article').text().includes('Filippo Giovagnini'));
    assert.ok($('a[href="mailto:filo.giova98@gmail.com"]').length);
    assert.equal($('time').attr('datetime'), '2026-09-20');
    assert.equal($('script').length, 0);
    assert.equal($('meta[name="robots"]').length, 0);
  }
});

test('testi del gestore escapati, email e tag HTML malformati non vengono pubblicati', () => {
  const injected = '<script>alert(1)</script>';
  const result = renderPublicPage('privacy', { publicInfo: { ...info, operatorName: injected, legalBasis: injected, googleSiteVerification: injected } });
  assert.equal(result.ready, true);
  const $ = load(result.html);
  assert.equal($('script').length, 0);
  assert.equal($('meta[name="google-site-verification"]').length, 0);
  assert.ok($('article').text().includes(injected));
  assert.equal(renderPublicPage('privacy', { publicInfo: { ...info, contactEmail: 'non-valida' } }).ready, false);
});

test('informativa AI segue la funzionalità effettivamente abilitata', () => {
  assert.doesNotMatch(renderPublicPage('privacy', { publicInfo: info, aiEnabled: false }).html, /Anthropic/);
  assert.match(renderPublicPage('privacy', { publicInfo: info, aiEnabled: true }).html, /Anthropic/);
});

test('vecchi link di invito e callback mantengono hash e token; la home non reindirizza senza hash applicativo', () => {
  const script = fs.readFileSync(new URL('../client/public/public-navigation.js', import.meta.url), 'utf8');
  for (const hash of ['', '#contenuto', '#/activate?token=token%2Bdi-prova', '#/auth-result?error=errore', '#/account?auth=linked', '#/reports/123']) {
    let destination;
    vm.runInNewContext(script, { window: { location: { hash, search: '', replace(value) { destination = value; } } } });
    assert.equal(destination, hash.startsWith('#/') ? `/app${hash}` : undefined);
  }
});

test('API riservate continuano a richiedere autenticazione', async () => {
  assert.equal((await fetch(base + '/api/users')).status, 401);
  assert.equal((await fetch(base + '/api/reports')).status, 401);
});
