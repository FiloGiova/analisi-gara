import test from 'node:test';
import assert from 'node:assert/strict';

// Forza il driver Brevo prima dell'import: config si congela al load.
process.env.SMTP_HOST = '';
process.env.BREVO_API_KEY = 'xkeysib-test-key';
process.env.EMAIL_FROM = 'FischioLab <formatori@test.local>';

const { setupTestDatabase, closeTestDatabase, insertId, dbGet, dbRun } = await import('./helpers/testDatabase.js');
const { sendReportToReferee, isEmailEnabled } = await import('../src/services/emailService.js');
const { setBrevoFetchForTests, parseSender } = await import('../src/services/brevoTransport.js');
const { listEmailLogForReport } = await import('../src/services/emailLogService.js');

await setupTestDatabase();

const requests = [];
let nextResponse = null;
setBrevoFetchForTests(async (url, options) => {
  requests.push({ url, options, payload: JSON.parse(options.body) });
  return (
    nextResponse || {
      ok: true,
      status: 201,
      json: async () => ({ messageId: 'brevo-test' })
    }
  );
});

const adminId = await insertId(
  'INSERT INTO users (username, password_hash, display_name, role) VALUES (?, ?, ?, ?)',
  ['admin', 'x', 'admin', 'admin']
);
const admin = { id: adminId, role: 'admin' };
const refereeId = await insertId(
  'INSERT INTO referees (first_name, last_name, email) VALUES (?, ?, ?)',
  ['Luca', 'Bianchi', 'luca.bianchi@test.local']
);
const reportId = await insertId(
  `INSERT INTO reports (status, observer_name, report_date, match_number, competition, team_home, team_away,
      sport_season, payload_json, created_by, first_referee_id, first_referee_name, finalized_at)
   VALUES ('final', 'oss', '2026-03-01', '000920', 'DR1', 'Alfa', 'Beta', '2025/2026', ?, ?, ?, 'Luca Bianchi', iso_now())`,
  [
    JSON.stringify({
      reportDate: '2026-03-01',
      matchNumber: '000920',
      competition: 'DR1',
      teamHome: 'Alfa',
      teamAway: 'Beta',
      firstRefereeName: 'Luca Bianchi'
    }),
    adminId,
    refereeId
  ]
);
await dbRun("UPDATE competitions SET cc_emails = 'cc.dr1@test.local' WHERE value = 'DR1'");

test.after(async () => {
  await closeTestDatabase();
});

test('parseSender: nome e indirizzo, o solo indirizzo', () => {
  assert.deepEqual(parseSender('FischioLab <a@b.it>'), { name: 'FischioLab', email: 'a@b.it' });
  assert.deepEqual(parseSender('a@b.it'), { email: 'a@b.it' });
  assert.deepEqual(parseSender('<a@b.it>'), { email: 'a@b.it' });
});

test('con BREVO_API_KEY l\'invio è abilitato anche senza SMTP', () => {
  assert.equal(isEmailEnabled(), true);
});

test('invio via Brevo: endpoint, api-key, mittente, CC e allegato base64', async () => {
  const result = await sendReportToReferee(reportId, 'first', admin, {
    confirmedRecipient: 'luca.bianchi@test.local'
  });
  assert.equal(result.refereeEmail, 'luca.bianchi@test.local');

  assert.equal(requests.length, 1);
  const { url, options, payload } = requests[0];
  assert.equal(url, 'https://api.brevo.com/v3/smtp/email');
  assert.equal(options.method, 'POST');
  assert.equal(options.headers['api-key'], 'xkeysib-test-key');
  assert.deepEqual(payload.sender, { name: 'FischioLab', email: 'formatori@test.local' });
  assert.deepEqual(payload.to, [{ email: 'luca.bianchi@test.local' }]);
  assert.deepEqual(payload.cc, [{ email: 'cc.dr1@test.local' }]);
  assert.match(payload.subject, /000920/);
  assert.match(payload.textContent, /Caro Luca Bianchi/);
  assert.equal(payload.attachment.length, 1);
  assert.equal(payload.attachment[0].name, '000920_Bianchi.pdf');
  assert.ok(payload.attachment[0].content.length > 100, 'PDF in base64 non vuoto');
  assert.ok(Buffer.from(payload.attachment[0].content, 'base64').subarray(0, 4).equals(Buffer.from('%PDF')));

  const row = await dbGet('SELECT first_referee_sent_at FROM reports WHERE id = ?', [reportId]);
  assert.ok(row.first_referee_sent_at);

  const log = await listEmailLogForReport(reportId);
  assert.equal(log[0].outcome, 'success');
  assert.equal(log[0].cc, 'cc.dr1@test.local');
});

test('errore Brevo: 502 al client e dettaglio nel log invii', async () => {
  nextResponse = {
    ok: false,
    status: 400,
    json: async () => ({ code: 'invalid_parameter', message: 'sender email is not valid' })
  };

  await assert.rejects(
    () => sendReportToReferee(reportId, 'first', admin, { confirmedRecipient: 'luca.bianchi@test.local' }),
    (error) => {
      assert.equal(error.statusCode, 502);
      return true;
    }
  );
  nextResponse = null;

  const log = await listEmailLogForReport(reportId);
  assert.equal(log[0].outcome, 'error');
  assert.match(log[0].error_message, /Brevo 400: sender email is not valid/);
});
