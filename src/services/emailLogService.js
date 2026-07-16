import { dbGet, dbAll, dbRun } from '../database/db.js';

export async function logEmailAttempt({
  reportId,
  matchNumber = '',
  competition = '',
  role,
  recipient,
  cc = '',
  subject = '',
  sentBy = null,
  outcome,
  errorMessage = null
}) {
  await dbRun(
    `INSERT INTO report_email_log
       (report_id, match_number, competition, role, recipient, cc, subject, sent_by, outcome, error_message)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [reportId, matchNumber, competition, role, recipient, cc, subject, sentBy, outcome, errorMessage]
  );
}

export async function listEmailLogs({ limit = 100, offset = 0 } = {}) {
  return dbAll(
    `SELECT
       l.id,
       l.report_id,
       l.match_number,
       l.competition,
       l.role,
       l.recipient,
       l.cc,
       l.subject,
       l.outcome,
       l.error_message,
       l.created_at,
       u.username AS sent_by_username,
       u.display_name AS sent_by_display_name
     FROM report_email_log l
     LEFT JOIN users u ON u.id = l.sent_by
     ORDER BY l.created_at DESC, l.id DESC
     LIMIT ? OFFSET ?`,
    [limit, offset]
  );
}

export async function countEmailLogs() {
  return (await dbGet('SELECT COUNT(*) AS total FROM report_email_log')).total;
}

export async function listEmailLogForReport(reportId) {
  return dbAll(
    `SELECT
       l.id,
       l.role,
       l.recipient,
       l.cc,
       l.outcome,
       l.error_message,
       l.created_at,
       u.display_name AS sent_by_display_name
     FROM report_email_log l
     LEFT JOIN users u ON u.id = l.sent_by
     WHERE l.report_id = ?
     ORDER BY l.created_at DESC, l.id DESC`,
    [reportId]
  );
}
