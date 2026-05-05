import nodemailer from 'nodemailer';
import path from 'node:path';
import fs from 'node:fs';
import { config } from '../config.js';
import { getDb } from '../database/connection.js';
import { getReport } from './reportService.js';
import { generatePdfForRole, getPdfFileInfo } from './pdfService.js';
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

function findRefereeEmail(refereeName, refereeId = null) {
  if (refereeId) {
    const row = getDb()
      .prepare("SELECT email FROM referees WHERE id = ? AND email IS NOT NULL AND email != ''")
      .get(refereeId);
    if (row?.email) return row.email;
  }
  if (!refereeName) return null;
  const row = getDb()
    .prepare(
      `SELECT email FROM referees
       WHERE LOWER(TRIM(first_name || ' ' || last_name)) = LOWER(TRIM(?))
         AND email IS NOT NULL AND email != ''
       LIMIT 1`
    )
    .get(refereeName);
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

  const report = getReport(reportId, user);
  const refereeName = refereeNameForRole(report, role);

  if (!refereeName) {
    throw new HttpError(400, 'Nome arbitro non inserito nel rapporto.');
  }

  const refereeEmail = findRefereeEmail(refereeName, refereeIdForRole(report, role));
  if (!refereeEmail) {
    throw new HttpError(404, `Nessuna email trovata per "${refereeName}". Aggiorna l'anagrafica arbitri.`);
  }

  // genera PDF se non esiste ancora
  let fileInfo = getPdfFileInfo(report, role);
  if (!fs.existsSync(fileInfo.filePath)) {
    await generatePdfForRole(report, role);
    fileInfo = getPdfFileInfo(report, role);
  }

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
    attachments: [
      {
        filename: path.basename(fileInfo.filePath),
        path: fileInfo.filePath
      }
    ]
  });

  const sentAt = new Date().toISOString();
  getDb()
    .prepare(`UPDATE reports SET ${sentAtColumn(role)} = ? WHERE id = ?`)
    .run(sentAt, reportId);

  return { sentAt, refereeEmail };
}

export function isEmailEnabled() {
  return Boolean(config.smtp);
}
