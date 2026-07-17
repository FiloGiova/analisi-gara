import nodemailer from 'nodemailer';
import { config } from '../config.js';
import { dbAll, dbGet, dbRun } from '../database/db.js';
import { getReport } from './reportService.js';
import { getPdfFileInfo, buildReportPdf } from './pdfService.js';
import { logEmailAttempt } from './emailLogService.js';
import { getCompetitionByValue } from './competitionService.js';
import { getSetting } from './settingsService.js';
import { DEFAULT_EMAIL_BODY_TEMPLATE, EMAIL_TEMPLATE_KEY, renderEmailTemplate } from './emailTemplate.js';
import { HttpError } from '../utils/httpError.js';

// Factory sostituibile nei test: node:test non può mockare gli import ESM.
let transportFactory = (smtp) =>
  nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: smtp.auth,
    // Timeout stretti: il default di nodemailer (2 minuti) supera il limite
    // HTTP di Render (100s) e l'utente vedrebbe un timeout generico invece
    // dell'errore SMTP loggato.
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 60000
  });

export function setTransportFactoryForTests(factory) {
  transportFactory = factory;
}

function getTransporter() {
  if (!config.smtp) {
    throw new HttpError(503, 'Invio email non configurato. Imposta le variabili SMTP nel file .env.');
  }
  return transportFactory(config.smtp);
}

async function resolveRecipient(refereeName, refereeId = null) {
  if (refereeId) {
    const row = await dbGet(
      "SELECT email FROM referees WHERE id = ? AND email IS NOT NULL AND email != ''",
      [refereeId]
    );
    if (row?.email) return row.email;
  }
  if (!refereeName) return null;
  const rows = await dbAll(
    `SELECT email FROM referees
     WHERE LOWER(TRIM(first_name || ' ' || last_name)) = LOWER(TRIM(?))
       AND email IS NOT NULL AND email != ''`,
    [refereeName]
  );
  if (rows.length > 1) {
    throw new HttpError(
      409,
      `Più arbitri omonimi per "${refereeName}": collega l'arbitro all'anagrafica dal rapporto per inviare l'email.`
    );
  }
  return rows[0]?.email || null;
}

function sentAtColumn(role) {
  return role === 'first' ? 'first_referee_sent_at' : 'second_referee_sent_at';
}

function refereeNameForRole(report, role) {
  return role === 'first' ? report.data.firstRefereeName : report.data.secondRefereeName;
}

function refereeIdForRole(report, role) {
  return role === 'first' ? report.data.firstRefereeId : report.data.secondRefereeId;
}

async function refereeSurname(refereeId, fallbackName) {
  if (refereeId) {
    const row = await dbGet('SELECT last_name FROM referees WHERE id = ?', [refereeId]);
    if (row?.last_name) return row.last_name;
  }
  return fallbackName;
}

// Valida e calcola tutto ciò che serve all'invio senza inviare nulla:
// è la base sia del preview sia dell'invio vero, così restano coerenti.
export async function buildEmailPlan(reportId, role, user) {
  if (user?.role === 'referee') {
    throw new HttpError(403, 'Gli arbitri hanno accesso in sola lettura.');
  }
  if (!['first', 'second'].includes(role)) {
    throw new HttpError(400, 'Ruolo non valido.');
  }

  const report = await getReport(reportId, user);
  if (report.status !== 'final') {
    throw new HttpError(409, 'Il rapporto è in bozza: finalizzalo prima di inviarlo.');
  }

  const refereeName = refereeNameForRole(report, role);
  if (!refereeName) {
    throw new HttpError(400, 'Nome arbitro non inserito nel rapporto.');
  }

  const recipient = await resolveRecipient(refereeName, refereeIdForRole(report, role));
  if (!recipient) {
    throw new HttpError(404, `Nessuna email trovata per "${refereeName}". Aggiorna l'anagrafica arbitri.`);
  }

  const { fileName } = await getPdfFileInfo(report, role);
  const labelRole = role === 'first' ? '1° arbitro' : '2° arbitro';

  // CC e firma arrivano dalla configurazione del campionato (pagina admin).
  // Configurazione assente = nessun CC e firma di ripiego: l'invio non si blocca.
  const competitionValue = report.competition || report.data.competition || '';
  const competition = await getCompetitionByValue(competitionValue);
  const competitionName = competition?.label || competitionValue || '—';
  const cc = (competition?.ccEmails || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const signature = competition?.emailSignature || (competition ? `Formatori ${competition.label}` : 'FischioLab');

  const matchNumber = report.data.matchNumber || report.id;
  const surname = await refereeSurname(refereeIdForRole(report, role), refereeName);
  const subject = `FischioLab — Rapporto gara ${matchNumber} · ${competitionName} · ${surname}`;

  // Corpo dal template salvato dall'admin (default nel codice come fallback).
  // I valori riguardano SOLO l'arbitro destinatario: mai dati dell'altro arbitro.
  const template = (await getSetting(EMAIL_TEMPLATE_KEY)) || DEFAULT_EMAIL_BODY_TEMPLATE;
  const bodyText = renderEmailTemplate(template, {
    nomeArbitro: refereeName,
    numeroGara: String(matchNumber),
    campionato: competitionName,
    dataGara: report.data.reportDate || '—',
    squadre: `${report.data.teamHome || '—'} - ${report.data.teamAway || '—'}`,
    ruolo: labelRole,
    firma: signature
  });

  return {
    report,
    role,
    refereeName,
    recipient,
    subject,
    bodyText,
    cc,
    competitionName,
    attachmentName: fileName,
    lastSentAt: role === 'first' ? report.firstRefereeSentAt : report.secondRefereeSentAt
  };
}

// Dati mostrati nel dialog di conferma: stessa pipeline dell'invio, nessuna mail.
export async function previewReportEmail(reportId, role, user) {
  const plan = await buildEmailPlan(reportId, role, user);
  return {
    recipient: plan.recipient,
    refereeName: plan.refereeName,
    subject: plan.subject,
    attachmentName: plan.attachmentName,
    cc: plan.cc,
    lastSentAt: plan.lastSentAt,
    competition: plan.competitionName,
    matchNumber: plan.report.data.matchNumber || plan.report.id
  };
}

export async function sendReportToReferee(reportId, role, user, { confirmedRecipient } = {}) {
  const plan = await buildEmailPlan(reportId, role, user);

  // Il client conferma l'indirizzo visto a schermo: se nel frattempo
  // l'anagrafica è cambiata l'invio si ferma invece di partire alla cieca.
  const confirmed = String(confirmedRecipient || '').trim().toLowerCase();
  if (!confirmed) {
    throw new HttpError(400, "Conferma il destinatario prima dell'invio.");
  }
  if (confirmed !== plan.recipient.trim().toLowerCase()) {
    throw new HttpError(409, 'Il destinatario è cambiato: riapri la conferma di invio.');
  }

  // PDF rigenerato dal payload e allegato come buffer (nessun file su disco).
  const buffer = await buildReportPdf(plan.report, role);

  const transporter = getTransporter();
  const logBase = {
    reportId,
    matchNumber: plan.report.matchNumber || plan.report.data.matchNumber || '',
    competition: plan.report.competition || plan.report.data.competition || '',
    role,
    recipient: plan.recipient,
    cc: plan.cc.join(', '),
    subject: plan.subject,
    sentBy: user?.id || null
  };

  try {
    await transporter.sendMail({
      from: config.smtp.from,
      to: plan.recipient,
      ...(plan.cc.length ? { cc: plan.cc } : {}),
      subject: plan.subject,
      text: plan.bodyText,
      attachments: [{ filename: plan.attachmentName, content: buffer }]
    });
  } catch (error) {
    await logEmailAttempt({ ...logBase, outcome: 'error', errorMessage: error?.message || String(error) });
    throw new HttpError(502, 'Invio email non riuscito: riprova più tardi.');
  }

  await logEmailAttempt({ ...logBase, outcome: 'success' });

  const sentAt = new Date().toISOString();
  await dbRun(`UPDATE reports SET ${sentAtColumn(role)} = ? WHERE id = ?`, [sentAt, reportId]);

  return { sentAt, refereeEmail: plan.recipient };
}

export function isEmailEnabled() {
  return Boolean(config.smtp);
}

export async function sendOperationalEmail({ to, subject, text }) {
  if (!config.smtp || !to) return false;
  const transporter = getTransporter();
  await transporter.sendMail({ from: config.smtp.from, to, subject, text });
  return true;
}
