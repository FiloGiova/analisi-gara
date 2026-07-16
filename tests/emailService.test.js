import test from 'node:test';
import assert from 'node:assert/strict';

// Le env SMTP vanno impostate prima dell'import: config.smtp si congela al load.
process.env.SMTP_HOST = 'smtp.test.local';
process.env.SMTP_PORT = '2525';
process.env.SMTP_USER = 'noreply@test.local';
process.env.SMTP_PASS = 'segreta';
process.env.SMTP_FROM = 'FischioLab <noreply@test.local>';

const { setupTestDatabase, closeTestDatabase, insertId, dbGet, dbAll, dbRun } = await import('./helpers/testDatabase.js');
const { sendReportToReferee, previewReportEmail, setTransportFactoryForTests, isEmailEnabled } = await import(
  '../src/services/emailService.js'
);
const { listEmailLogs, countEmailLogs, listEmailLogForReport } = await import('../src/services/emailLogService.js');
const { setSetting } = await import('../src/services/settingsService.js');
const { EMAIL_TEMPLATE_KEY } = await import('../src/services/emailTemplate.js');

await setupTestDatabase();

const sentMails = [];
let failNextSend = false;
setTransportFactoryForTests(() => ({
  sendMail: async (message) => {
    if (failNextSend) {
      failNextSend = false;
      throw new Error('SMTP 550 destinatario rifiutato');
    }
    sentMails.push(message);
    return { accepted: [message.to] };
  }
}));

const SEASON = '2025/2026';
const adminId = await insertId(
  'INSERT INTO users (username, password_hash, display_name, role) VALUES (?, ?, ?, ?)',
  ['admin', 'x', 'admin', 'admin']
);
const instrId = await insertId(
  'INSERT INTO users (username, password_hash, display_name, role, formatter_competition) VALUES (?, ?, ?, ?, ?)',
  ['instr', 'x', 'instr', 'instructor', 'DR1']
);
const admin = { id: adminId, role: 'admin' };
const instructorDr1 = { id: instrId, role: 'instructor', formatter_competition: 'DR1' };

const linkedRefereeId = await insertId(
  'INSERT INTO referees (first_name, last_name, email) VALUES (?, ?, ?)',
  ['Luca', 'Bianchi', 'luca.bianchi@test.local']
);
await insertId('INSERT INTO referees (first_name, last_name, email) VALUES (?, ?, ?)', [
  'Mario',
  'Rossi',
  'mario.rossi.1@test.local'
]);
await insertId('INSERT INTO referees (first_name, last_name, email) VALUES (?, ?, ?)', [
  'Mario',
  'Rossi',
  'mario.rossi.2@test.local'
]);

function payloadFor(matchNumber, competition) {
  return JSON.stringify({
    reportDate: '2026-03-01',
    matchNumber,
    competition,
    teamHome: 'Alfa',
    teamAway: 'Beta',
    firstRefereeName: 'Luca Bianchi',
    secondRefereeName: 'Mario Rossi'
  });
}

async function mkReport({ status, matchNumber, competition, firstRefereeId = null }) {
  return insertId(
    `INSERT INTO reports (status, observer_name, report_date, match_number, competition, team_home, team_away,
        sport_season, payload_json, created_by, first_referee_id, first_referee_name, second_referee_name, finalized_at)
     VALUES (?, 'oss', '2026-03-01', ?, ?, 'Alfa', 'Beta', ?, ?, ?, ?, 'Luca Bianchi', 'Mario Rossi',
        ${status === 'final' ? 'iso_now()' : 'NULL'})`,
    [status, matchNumber, competition, SEASON, payloadFor(matchNumber, competition), adminId, firstRefereeId]
  );
}

const draftId = await mkReport({ status: 'draft', matchNumber: '000900', competition: 'DR1', firstRefereeId: linkedRefereeId });
const finalId = await mkReport({ status: 'final', matchNumber: '000901', competition: 'DR1', firstRefereeId: linkedRefereeId });
const serieCId = await mkReport({ status: 'final', matchNumber: '000902', competition: 'Serie C', firstRefereeId: linkedRefereeId });

test.after(async () => {
  await closeTestDatabase();
});

test('con le env SMTP impostate l\'invio risulta abilitato', () => {
  assert.equal(isEmailEnabled(), true);
});

test('bozza: l\'invio è rifiutato con 409 e nessuna mail parte', async () => {
  await assert.rejects(() => sendReportToReferee(draftId, 'first', admin), /bozza/);
  assert.equal(sentMails.length, 0);
});

test('ruolo non valido: 400', async () => {
  await assert.rejects(() => sendReportToReferee(finalId, 'third', admin), /Ruolo non valido/);
});

test('arbitro: accesso in sola lettura, invio negato', async () => {
  await assert.rejects(
    () => sendReportToReferee(finalId, 'first', { id: 999, role: 'referee' }),
    /sola lettura/
  );
  assert.equal(sentMails.length, 0);
});

test('formatore fuori campionato: 403', async () => {
  await assert.rejects(() => sendReportToReferee(serieCId, 'first', instructorDr1), /fuori dai campionati/);
  assert.equal(sentMails.length, 0);
});

test('omonimi senza collegamento all\'anagrafica: errore esplicito, nessun invio', async () => {
  await assert.rejects(() => sendReportToReferee(finalId, 'second', admin), /omonimi/);
  assert.equal(sentMails.length, 0);
});

test('senza conferma del destinatario: 400, nessun invio', async () => {
  await assert.rejects(() => sendReportToReferee(finalId, 'first', admin), /Conferma il destinatario/);
  assert.equal(sentMails.length, 0);
});

test('destinatario confermato diverso da quello risolto: 409, nessun invio', async () => {
  await assert.rejects(
    () => sendReportToReferee(finalId, 'first', admin, { confirmedRecipient: 'altro@test.local' }),
    (error) => {
      assert.equal(error.statusCode, 409);
      assert.match(error.message, /destinatario è cambiato/);
      return true;
    }
  );
  assert.equal(sentMails.length, 0);
  const row = await dbGet('SELECT first_referee_sent_at FROM reports WHERE id = ?', [finalId]);
  assert.equal(row.first_referee_sent_at, null);
});

test('invio riuscito: destinatario, oggetto, allegato e sent_at aggiornato', async () => {
  // La conferma tollera maiuscole e spazi: conta l'indirizzo, non la forma.
  const result = await sendReportToReferee(finalId, 'first', admin, {
    confirmedRecipient: '  LUCA.BIANCHI@test.local '
  });

  assert.equal(result.refereeEmail, 'luca.bianchi@test.local');
  assert.ok(result.sentAt);

  assert.equal(sentMails.length, 1);
  const message = sentMails.at(-1);
  assert.equal(message.to, 'luca.bianchi@test.local');
  assert.equal(message.from, 'FischioLab <noreply@test.local>');
  assert.equal(message.subject, 'FischioLab — Rapporto gara 000901 · Divisione Regionale 1 · Bianchi');
  assert.match(message.text, /Caro Luca Bianchi/);
  assert.ok(!message.text.includes('Mario Rossi'), 'il corpo non deve citare l\'altro arbitro');
  assert.equal(message.attachments.length, 1);
  assert.equal(message.attachments[0].filename, '000901_Bianchi.pdf');
  assert.ok(Buffer.isBuffer(message.attachments[0].content));
  assert.ok(message.attachments[0].content.length > 0);

  const row = await dbGet('SELECT first_referee_sent_at, second_referee_sent_at FROM reports WHERE id = ?', [finalId]);
  assert.ok(row.first_referee_sent_at);
  assert.equal(row.second_referee_sent_at, null);
});

test('il formatore nel proprio campionato può inviare', async () => {
  await assert.doesNotReject(() =>
    sendReportToReferee(finalId, 'first', instructorDr1, { confirmedRecipient: 'luca.bianchi@test.local' })
  );
});

test('ogni invio riuscito scrive una riga nel log email', async () => {
  const rows = await dbAll('SELECT * FROM report_email_log WHERE report_id = ? ORDER BY id', [finalId]);
  assert.equal(rows.length, 2, 'due invii riusciti finora: admin e formatore');
  assert.ok(rows.every((row) => row.outcome === 'success'));
  assert.ok(rows.every((row) => row.recipient === 'luca.bianchi@test.local'));
  assert.match(rows[0].subject, /000901/);
  assert.equal(rows[0].match_number, '000901');
  assert.equal(rows[0].competition, 'DR1');
  assert.equal(rows[0].sent_by, adminId);
  assert.equal(rows[1].sent_by, instrId);
});

test('un errore SMTP viene loggato, torna 502 e non aggiorna sent_at', async () => {
  failNextSend = true;
  await assert.rejects(
    () => sendReportToReferee(serieCId, 'first', admin, { confirmedRecipient: 'luca.bianchi@test.local' }),
    (error) => {
      assert.equal(error.statusCode, 502);
      assert.match(error.message, /non riuscito/);
      return true;
    }
  );

  const row = await dbGet('SELECT first_referee_sent_at FROM reports WHERE id = ?', [serieCId]);
  assert.equal(row.first_referee_sent_at, null);

  const entries = await listEmailLogForReport(serieCId);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].outcome, 'error');
  assert.match(entries[0].error_message, /550/);
});

test('lista log email: paginazione, totale e mittente risolto', async () => {
  const total = await countEmailLogs();
  assert.equal(total, 3, 'due successi e un errore');
  const page = await listEmailLogs({ limit: 2, offset: 0 });
  assert.equal(page.length, 2);
  assert.ok(page.every((entry) => entry.sent_by_display_name));
});

test('il preview non invia nulla e riporta i dati per la conferma', async () => {
  const before = sentMails.length;
  const preview = await previewReportEmail(finalId, 'first', admin);

  assert.equal(preview.recipient, 'luca.bianchi@test.local');
  assert.equal(preview.refereeName, 'Luca Bianchi');
  assert.equal(preview.attachmentName, '000901_Bianchi.pdf');
  assert.match(preview.subject, /000901/);
  assert.equal(preview.competition, 'Divisione Regionale 1');
  assert.equal(preview.matchNumber, '000901');
  assert.deepEqual(preview.cc, []);
  assert.ok(preview.lastSentAt, 'dopo un invio riuscito lastSentAt è valorizzato');
  assert.equal(sentMails.length, before, 'il preview non deve produrre invii');
});

test('CC e firma del campionato vengono applicati e loggati', async () => {
  await dbRun(
    "UPDATE competitions SET cc_emails = 'cc1@test.local, cc2@test.local', email_signature = 'Formatori DR1' WHERE value = 'DR1'"
  );

  await sendReportToReferee(finalId, 'first', admin, { confirmedRecipient: 'luca.bianchi@test.local' });
  const message = sentMails.at(-1);
  assert.deepEqual(message.cc, ['cc1@test.local', 'cc2@test.local']);
  assert.match(message.text, /Formatori DR1/);

  const entries = await listEmailLogForReport(finalId);
  assert.equal(entries[0].cc, 'cc1@test.local, cc2@test.local');
});

test('senza CC configurati il messaggio non ha il campo cc e la firma fa fallback', async () => {
  await sendReportToReferee(serieCId, 'first', admin, { confirmedRecipient: 'luca.bianchi@test.local' });
  const message = sentMails.at(-1);
  assert.ok(!('cc' in message));
  assert.match(message.text, /Formatori Serie C/);
});

test('il template salvato dall\'admin sostituisce il default e ignora l\'altro arbitro', async () => {
  await setSetting(EMAIL_TEMPLATE_KEY, 'Ciao {{nomeArbitro}}, gara {{numeroGara}} ({{campionato}}). Saluti, {{firma}}', adminId);

  await sendReportToReferee(finalId, 'first', admin, { confirmedRecipient: 'luca.bianchi@test.local' });
  const message = sentMails.at(-1);
  assert.equal(message.text, 'Ciao Luca Bianchi, gara 000901 (Divisione Regionale 1). Saluti, Formatori DR1');
  assert.ok(!message.text.includes('Mario Rossi'), 'il corpo non deve citare l\'altro arbitro');
});
