import test from 'node:test';
import assert from 'node:assert/strict';

// Forza l'assenza di configurazione SMTP prima dell'import (dotenv non
// sovrascrive le variabili già presenti, stringa vuota inclusa).
process.env.SMTP_HOST = '';

const { setupTestDatabase, closeTestDatabase, insertId } = await import('./helpers/testDatabase.js');
const { sendReportToReferee, isEmailEnabled } = await import('../src/services/emailService.js');

await setupTestDatabase();

const adminId = await insertId(
  'INSERT INTO users (username, password_hash, display_name, role) VALUES (?, ?, ?, ?)',
  ['admin', 'x', 'admin', 'admin']
);
const refereeId = await insertId(
  'INSERT INTO referees (first_name, last_name, email) VALUES (?, ?, ?)',
  ['Luca', 'Bianchi', 'luca.bianchi@test.local']
);
const reportId = await insertId(
  `INSERT INTO reports (status, observer_name, report_date, match_number, competition, team_home, team_away,
      sport_season, payload_json, created_by, first_referee_id, first_referee_name, finalized_at)
   VALUES ('final', 'oss', '2026-03-01', '000910', 'DR1', 'Alfa', 'Beta', '2025/2026', ?, ?, ?, 'Luca Bianchi', iso_now())`,
  [
    JSON.stringify({
      reportDate: '2026-03-01',
      matchNumber: '000910',
      competition: 'DR1',
      teamHome: 'Alfa',
      teamAway: 'Beta',
      firstRefereeName: 'Luca Bianchi'
    }),
    adminId,
    refereeId
  ]
);

test.after(async () => {
  await closeTestDatabase();
});

test('senza env SMTP l\'invio risulta disabilitato', () => {
  assert.equal(isEmailEnabled(), false);
});

test('senza SMTP configurato l\'invio fallisce con 503 chiaro', async () => {
  await assert.rejects(
    () =>
      sendReportToReferee(reportId, 'first', { id: adminId, role: 'admin' }, {
        confirmedRecipient: 'luca.bianchi@test.local'
      }),
    (error) => {
      assert.equal(error.statusCode, 503);
      assert.match(error.message, /non configurato/);
      return true;
    }
  );
});
