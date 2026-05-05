import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { getDb } from '../database/connection.js';
import { HttpError } from '../utils/httpError.js';

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

function deletePhotoFile(filename) {
  if (!filename || !FILENAME_RE.test(filename)) return;
  const filePath = path.join(config.profilePhotosDir, filename);
  fs.rm(filePath, { force: true }, () => {});
}

function persistPhoto(kind, entityId, buffer) {
  if (!ALLOWED_KIND.has(kind)) throw new HttpError(400, 'Tipo foto non valido.');
  const detected = detectImage(buffer);
  if (!detected) throw new HttpError(400, 'Formato immagine non riconosciuto. Usa JPEG, PNG o WEBP.');
  const fileName = buildFileName(kind, entityId, detected.ext);
  const filePath = path.join(config.profilePhotosDir, fileName);
  fs.writeFileSync(filePath, buffer);
  return fileName;
}

export function savePhotoForUser(userId, buffer) {
  const db = getDb();
  const existing = db.prepare('SELECT photo_path FROM users WHERE id = ?').get(userId);
  if (!existing) throw new HttpError(404, 'Utente non trovato.');
  const fileName = persistPhoto('user', userId, buffer);
  db.prepare('UPDATE users SET photo_path = ? WHERE id = ?').run(fileName, userId);
  if (existing.photo_path && existing.photo_path !== fileName) deletePhotoFile(existing.photo_path);
  return fileName;
}

export function deletePhotoForUser(userId) {
  const db = getDb();
  const existing = db.prepare('SELECT photo_path FROM users WHERE id = ?').get(userId);
  if (!existing) throw new HttpError(404, 'Utente non trovato.');
  if (existing.photo_path) deletePhotoFile(existing.photo_path);
  db.prepare('UPDATE users SET photo_path = NULL WHERE id = ?').run(userId);
}

export function savePhotoForReferee(refereeId, buffer) {
  const db = getDb();
  const existing = db.prepare('SELECT photo_path FROM referees WHERE id = ?').get(refereeId);
  if (!existing) throw new HttpError(404, 'Arbitro non trovato.');
  const fileName = persistPhoto('referee', refereeId, buffer);
  db.prepare('UPDATE referees SET photo_path = ? WHERE id = ?').run(fileName, refereeId);
  if (existing.photo_path && existing.photo_path !== fileName) deletePhotoFile(existing.photo_path);
  return fileName;
}

export function deletePhotoForReferee(refereeId) {
  const db = getDb();
  const existing = db.prepare('SELECT photo_path FROM referees WHERE id = ?').get(refereeId);
  if (!existing) throw new HttpError(404, 'Arbitro non trovato.');
  if (existing.photo_path) deletePhotoFile(existing.photo_path);
  db.prepare('UPDATE referees SET photo_path = NULL WHERE id = ?').run(refereeId);
}

export function streamProfilePhoto(filename, res) {
  if (!FILENAME_RE.test(filename)) throw new HttpError(404, 'Foto non trovata.');
  const filePath = path.join(config.profilePhotosDir, filename);
  if (!fs.existsSync(filePath)) throw new HttpError(404, 'Foto non trovata.');
  const ext = filename.split('.').pop().toLowerCase();
  const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
  res.setHeader('Content-Type', mime);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  fs.createReadStream(filePath).pipe(res);
}
