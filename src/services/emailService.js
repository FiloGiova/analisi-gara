import nodemailer from 'nodemailer';
import { config } from '../config.js';
import { dbGet, dbRun } from '../database/db.js';
import { getReport } from './reportService.js';
import { getPdfFileInfo, buildReportPdf } from './pdfService.js';
import { HttpError } from '../utils/httpError.js';

function getTransporter() {
  if (!config.smtp) {
    throw new HttpError(503, 'Invio email non configurato. Imposta le variabili SMTP nel file .env.');
  }
  return nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: config.smtp.auth
  });
}

async function findRefereeEmail(refereeName, refereeId = null) {
  if (refereeId) {
    const row = await dbGet(
      "SELECT email FROM referees WHERE id = ? AND email IS NOT NULL AND email != ''",
      [refereeId]
    );
    if (row?.email) return row.email;
  }
  if (!refereeName) return null;
  const row = await dbGet(
    `SELECT email FROM referees
     WHERE LOWER(TRIM(first_name || ' ' || last_name)) = LOWER(TRIM(?))
       AND email IS NOT NULL AND email != ''
     LIMIT 1`,
    [refereeName]
  );
  return row?.email || null;
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

export async function sendReportToReferee(reportId, role, user) {
  if (user?.role === 'referee') {
    throw new HttpError(403, 'Gli arbitri hanno accesso in sola lettura.');
  }
  if (!['first', 'second'].includes(role)) {
    throw new HttpError(400, 'Ruolo non valido.');
  }

  const report = await getReport(reportId, user);
  const refereeName = refereeNameForRole(report, role);

  if (!refereeName) {
    throw new HttpError(400, 'Nome arbitro non inserito nel rapporto.');
  }

  const refereeEmail = await findRefereeEmail(refereeName, refereeIdForRole(report, role));
  if (!refereeEmail) {
    throw new HttpError(404, `Nessuna email trovata per "${refereeName}". Aggiorna l'anagrafica arbitri.`);
  }

  // PDF rigenerato dal payload e allegato come buffer (nessun file su disco).
  const { fileName } = await getPdfFileInfo(report, role);
  const buffer = await buildReportPdf(report, role);

  const transporter = getTransporter();
  const labelRole = role === 'first' ? '1° arbitro' : '2° arbitro';
  const subject = `Rapporto arbitrale — Gara ${report.data.matchNumber || report.id}`;
  const text = [
    `Gentile ${refereeName},`,
    '',
    `In allegato trovi il rapporto di valutazione per la gara n. ${report.data.matchNumber || report.id}`,
    `del ${report.data.reportDate || '—'} (${report.data.competition || '—'}),`,
    `${report.data.teamHome} - ${report.data.teamAway}.`,
    '',
    `Ruolo: ${labelRole}`,
    '',
    'Cordiali saluti'
  ].join('\n');

  await transporter.sendMail({
    from: config.smtp.from,
    to: refereeEmail,
    subject,
    text,
    attachments: [{ filename: fileName, content: buffer }]
  });

  const sentAt = new Date().toISOString();
  await dbRun(`UPDATE reports SET ${sentAtColumn(role)} = ? WHERE id = ?`, [sentAt, reportId]);

  return { sentAt, refereeEmail };
}

export function isEmailEnabled() {
  return Boolean(config.smtp);
}
