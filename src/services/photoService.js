import crypto from 'node:crypto';
import { dbGet, dbRun } from '../database/db.js';
import { HttpError } from '../utils/httpError.js';
import { putObject, getObject, objectExists, removeObject } from './storageService.js';

const ALLOWED_KIND = new Set(['user', 'referee']);
const FILENAME_RE = /^(user|referee)-\d+-[a-f0-9]{8}\.(jpe?g|png|webp)$/;

const MAGIC = [
  { mime: 'image/jpeg', ext: 'jpg', match: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png',  ext: 'png', match: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { mime: 'image/webp', ext: 'webp', match: (b) =>
      b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  }
];

// Chiave storage: mantiene la struttura 'uploads/profiles/<filename>' (compatibile
// col filesystem locale esistente e col bucket Supabase).
function photoKey(filename) {
  return `uploads/profiles/${filename}`;
}

function detectImage(buffer) {
  if (!buffer || buffer.length < 12) return null;
  for (const m of MAGIC) {
    if (m.match(buffer)) return m;
  }
  return null;
}

function buildFileName(kind, entityId, ext) {
  const rand = crypto.randomBytes(4).toString('hex');
  return `${kind}-${entityId}-${rand}.${ext}`;
}

async function deletePhotoFile(filename) {
  if (!filename || !FILENAME_RE.test(filename)) return;
  await removeObject(photoKey(filename));
}

async function persistPhoto(kind, entityId, buffer) {
  if (!ALLOWED_KIND.has(kind)) throw new HttpError(400, 'Tipo foto non valido.');
  const detected = detectImage(buffer);
  if (!detected) throw new HttpError(400, 'Formato immagine non riconosciuto. Usa JPEG, PNG o WEBP.');
  const fileName = buildFileName(kind, entityId, detected.ext);
  await putObject(photoKey(fileName), buffer, detected.mime);
  return fileName;
}

export async function savePhotoForUser(userId, buffer) {
  const existing = await dbGet('SELECT photo_path FROM users WHERE id = ?', [userId]);
  if (!existing) throw new HttpError(404, 'Utente non trovato.');
  const fileName = await persistPhoto('user', userId, buffer);
  await dbRun('UPDATE users SET photo_path = ? WHERE id = ?', [fileName, userId]);
  if (existing.photo_path && existing.photo_path !== fileName) await deletePhotoFile(existing.photo_path);
  return fileName;
}

export async function deletePhotoForUser(userId) {
  const existing = await dbGet('SELECT photo_path FROM users WHERE id = ?', [userId]);
  if (!existing) throw new HttpError(404, 'Utente non trovato.');
  if (existing.photo_path) await deletePhotoFile(existing.photo_path);
  await dbRun('UPDATE users SET photo_path = NULL WHERE id = ?', [userId]);
}

export async function savePhotoForReferee(refereeId, buffer) {
  const existing = await dbGet('SELECT photo_path FROM referees WHERE id = ?', [refereeId]);
  if (!existing) throw new HttpError(404, 'Arbitro non trovato.');
  const fileName = await persistPhoto('referee', refereeId, buffer);
  await dbRun('UPDATE referees SET photo_path = ? WHERE id = ?', [fileName, refereeId]);
  if (existing.photo_path && existing.photo_path !== fileName) await deletePhotoFile(existing.photo_path);
  return fileName;
}

export async function deletePhotoForReferee(refereeId) {
  const existing = await dbGet('SELECT photo_path FROM referees WHERE id = ?', [refereeId]);
  if (!existing) throw new HttpError(404, 'Arbitro non trovato.');
  if (existing.photo_path) await deletePhotoFile(existing.photo_path);
  await dbRun('UPDATE referees SET photo_path = NULL WHERE id = ?', [refereeId]);
}

export async function streamProfilePhoto(filename, res) {
  if (!FILENAME_RE.test(filename)) throw new HttpError(404, 'Foto non trovata.');
  if (!(await objectExists(photoKey(filename)))) throw new HttpError(404, 'Foto non trovata.');
  const buffer = await getObject(photoKey(filename));
  const ext = filename.split('.').pop().toLowerCase();
  const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
  res.setHeader('Content-Type', mime);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.end(buffer);
}
