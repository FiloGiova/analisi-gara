import crypto from 'node:crypto';
import { dbGet, dbRun } from '../database/db.js';
import { HttpError } from '../utils/httpError.js';
import { putObject, getObject, objectExists, removeObject } from './storageService.js';

// Allegato del rapporto a video: il referto che il formatore ha compilato
// altrove (PDF) o il foglio di sintesi (XLSX). Un solo file per rapporto,
// sostituibile: è il documento della visionatura, non una galleria.
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

const ALLOWED_TYPES = [
  {
    mime: 'application/pdf',
    ext: 'pdf',
    label: 'PDF',
    match: (b) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46
  },
  {
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ext: 'xlsx',
    label: 'XLSX',
    // Un .xlsx è uno ZIP: la firma riconosciuta è quella (PK).
    match: (b) => b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05 || b[2] === 0x07)
  }
];

const KEY_RE = /^reports\/\d+\/allegato-[a-f0-9]{8}\.(pdf|xlsx)$/;

function attachmentKey(reportId, fileName) {
  return `reports/${reportId}/${fileName}`;
}

function detectType(buffer) {
  if (!buffer || buffer.length < 4) return null;
  return ALLOWED_TYPES.find((type) => type.match(buffer)) || null;
}

// Il nome scelto dall'utente viene mostrato ma mai usato come chiave: si
// conserva solo per l'etichetta e per il nome del file scaricato.
function safeDisplayName(originalName, ext) {
  const clean = String(originalName || '')
    .replace(/[\\/]/g, ' ')
    .replace(/[^\x20-ÿ]/g, '')
    .trim()
    .slice(0, 120);
  if (!clean) return `allegato.${ext}`;
  return clean.toLowerCase().endsWith(`.${ext}`) ? clean : `${clean}.${ext}`;
}

async function getReportRow(reportId) {
  const row = await dbGet(
    'SELECT id, report_type, attachment_path, attachment_name, attachment_type FROM reports WHERE id = ?',
    [reportId]
  );
  if (!row) throw new HttpError(404, 'Rapporto non trovato.');
  return row;
}

export async function saveReportAttachment(reportId, { buffer, originalName }) {
  const row = await getReportRow(reportId);
  if (row.report_type !== 'video') {
    throw new HttpError(400, 'L’allegato è previsto solo sui rapporti a video.');
  }
  if (!buffer?.length) throw new HttpError(400, 'File vuoto.');
  if (buffer.length > MAX_ATTACHMENT_BYTES) {
    throw new HttpError(413, 'L’allegato può pesare al massimo 10 MB.');
  }
  const detected = detectType(buffer);
  if (!detected) throw new HttpError(400, 'Formato non riconosciuto: allega un PDF o un XLSX.');

  const fileName = `allegato-${crypto.randomBytes(4).toString('hex')}.${detected.ext}`;
  const key = attachmentKey(reportId, fileName);
  await putObject(key, buffer, detected.mime);

  const displayName = safeDisplayName(originalName, detected.ext);
  await dbRun(
    `UPDATE reports
        SET attachment_path = ?, attachment_name = ?, attachment_type = ?, attachment_size = ?,
            attachment_uploaded_at = ts_now(), updated_at = ts_now()
      WHERE id = ?`,
    [key, displayName, detected.mime, buffer.length, reportId]
  );

  if (row.attachment_path && row.attachment_path !== key && KEY_RE.test(row.attachment_path)) {
    await removeObject(row.attachment_path);
  }

  return { name: displayName, type: detected.mime, label: detected.label, size: buffer.length };
}

export async function deleteReportAttachment(reportId) {
  const row = await getReportRow(reportId);
  if (row.attachment_path && KEY_RE.test(row.attachment_path)) await removeObject(row.attachment_path);
  await dbRun(
    `UPDATE reports
        SET attachment_path = NULL, attachment_name = NULL, attachment_type = NULL,
            attachment_size = NULL, attachment_uploaded_at = NULL, updated_at = ts_now()
      WHERE id = ?`,
    [reportId]
  );
}

export async function streamReportAttachment(reportId, res) {
  const row = await getReportRow(reportId);
  if (!row.attachment_path || !KEY_RE.test(row.attachment_path)) {
    throw new HttpError(404, 'Nessun allegato su questo rapporto.');
  }
  if (!(await objectExists(row.attachment_path))) throw new HttpError(404, 'Allegato non più disponibile.');
  const buffer = await getObject(row.attachment_path);
  res.setHeader('Content-Type', row.attachment_type || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${row.attachment_name || 'allegato'}"`);
  res.end(buffer);
}
