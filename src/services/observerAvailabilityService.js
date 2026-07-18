import { dbAll, dbGet, dbRun } from '../database/db.js';
import { HttpError } from '../utils/httpError.js';

const OBSERVER_ROLES = new Set(['observer', 'instructor']);
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function asPositiveInteger(value, label = 'ID') {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new HttpError(400, `${label} non valido.`);
  }
  return number;
}

function normalizeDate(value, label) {
  const clean = String(value || '').trim();
  if (!ISO_DATE_RE.test(clean)) {
    throw new HttpError(400, `${label} non valida: usa il formato aaaa-mm-gg.`);
  }
  const [year, month, day] = clean.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new HttpError(400, `${label} non valida.`);
  }
  return clean;
}

function todayIso() {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Europe/Rome',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function publicAvailability(row) {
  return {
    id: row.id,
    userId: row.user_id,
    startDate: row.start_date,
    endDate: row.end_date,
    note: row.note || '',
    createdBy: row.created_by || null,
    createdByName: row.created_by_name || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function availabilityPeriodLabel(availability) {
  if (!availability) return '';
  const format = (value) => {
    const [year, month, day] = String(value || '').split('-');
    return year && month && day ? `${day}/${month}/${year}` : String(value || '');
  };
  return availability.startDate === availability.endDate
    ? format(availability.startDate)
    : `${format(availability.startDate)}–${format(availability.endDate)}`;
}

async function getObserverRow(userId) {
  const id = asPositiveInteger(userId, 'ID osservatore');
  const observer = await dbGet(
    `SELECT id, username, display_name, role, photo_path, active, created_at, updated_at
       FROM users
      WHERE id = ?`,
    [id]
  );
  if (!observer || !OBSERVER_ROLES.has(observer.role)) {
    throw new HttpError(404, 'Osservatore non trovato.');
  }
  return observer;
}

function assertCanManage(actor, observerId) {
  if (!actor) throw new HttpError(401, 'Accesso richiesto.');
  if (actor.role === 'admin' || actor.role === 'instructor') return;
  if (actor.id === observerId && OBSERVER_ROLES.has(actor.role)) return;
  throw new HttpError(403, 'Non puoi gestire le indisponibilità di questo osservatore.');
}

async function listRowsForObserver(userId) {
  return dbAll(
    `SELECT ou.*, creator.display_name AS created_by_name
       FROM observer_unavailabilities ou
       LEFT JOIN users creator ON creator.id = ou.created_by
      WHERE ou.user_id = ?
      ORDER BY ou.start_date DESC, ou.end_date DESC, ou.id DESC`,
    [userId]
  );
}

export async function listObserversWithAvailability() {
  const today = todayIso();
  const rows = await dbAll(
    `SELECT u.id, u.username, u.display_name, u.role, u.photo_path, u.active,
            COUNT(ou.id) AS unavailability_count,
            MAX(CASE WHEN ou.start_date <= ? AND ou.end_date >= ? THEN ou.start_date END) AS current_unavailable_from,
            MIN(CASE WHEN ou.start_date > ? THEN ou.start_date END) AS next_future_from
       FROM users u
       LEFT JOIN observer_unavailabilities ou ON ou.user_id = u.id
      WHERE u.role IN ('observer', 'instructor')
      GROUP BY u.id, u.username, u.display_name, u.role, u.photo_path, u.active
      ORDER BY u.active DESC, LOWER(u.display_name) ASC`,
    [today, today, today]
  );
  return rows.map((row) => ({
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    photoPath: row.photo_path || null,
    active: Boolean(row.active),
    unavailabilityCount: Number(row.unavailability_count || 0),
    currentlyUnavailable: Boolean(row.current_unavailable_from),
    nextUnavailableFrom: row.current_unavailable_from || row.next_future_from || null
  }));
}

export async function getObserverAvailabilityProfile({ observerId, actor }) {
  const observer = await getObserverRow(observerId);
  assertCanManage(actor, observer.id);
  const rows = await listRowsForObserver(observer.id);
  return {
    observer: {
      id: observer.id,
      username: observer.username,
      displayName: observer.display_name,
      role: observer.role,
      photoPath: observer.photo_path || null,
      active: Boolean(observer.active),
      createdAt: observer.created_at,
      updatedAt: observer.updated_at
    },
    unavailabilities: rows.map(publicAvailability)
  };
}

export async function createObserverAvailability({ observerId, actor, startDate, endDate, note = '' }) {
  const observer = await getObserverRow(observerId);
  assertCanManage(actor, observer.id);
  const cleanStartDate = normalizeDate(startDate, 'Data iniziale');
  const cleanEndDate = normalizeDate(endDate || startDate, 'Data finale');
  if (cleanEndDate < cleanStartDate) {
    throw new HttpError(400, 'La data finale non può precedere quella iniziale.');
  }
  const cleanNote = String(note || '').trim();
  if (cleanNote.length > 300) {
    throw new HttpError(400, 'La nota può contenere al massimo 300 caratteri.');
  }

  const overlap = await dbGet(
    `SELECT id, start_date, end_date
       FROM observer_unavailabilities
      WHERE user_id = ? AND start_date <= ? AND end_date >= ?
      ORDER BY start_date
      LIMIT 1`,
    [observer.id, cleanEndDate, cleanStartDate]
  );
  if (overlap) {
    throw new HttpError(409, 'Esiste già un’indisponibilità che comprende almeno uno di questi giorni.', {
      overlappingAvailability: {
        id: overlap.id,
        startDate: overlap.start_date,
        endDate: overlap.end_date
      }
    });
  }

  const result = await dbRun(
    `INSERT INTO observer_unavailabilities (user_id, start_date, end_date, note, created_by)
     VALUES (?, ?, ?, ?, ?)
     RETURNING id`,
    [observer.id, cleanStartDate, cleanEndDate, cleanNote, actor.id]
  );
  const created = await dbGet(
    `SELECT ou.*, creator.display_name AS created_by_name
       FROM observer_unavailabilities ou
       LEFT JOIN users creator ON creator.id = ou.created_by
      WHERE ou.id = ?`,
    [result.rows[0].id]
  );
  return publicAvailability(created);
}

export async function deleteObserverAvailability({ availabilityId, actor }) {
  const id = asPositiveInteger(availabilityId, 'ID indisponibilità');
  const row = await dbGet('SELECT id, user_id FROM observer_unavailabilities WHERE id = ?', [id]);
  if (!row) throw new HttpError(404, 'Indisponibilità non trovata.');
  const observer = await getObserverRow(row.user_id);
  assertCanManage(actor, observer.id);
  await dbRun('DELETE FROM observer_unavailabilities WHERE id = ?', [id]);
}

export async function availabilityForObserverOnDate(userId, dateValue) {
  const cleanDate = String(dateValue || '').slice(0, 10);
  if (!ISO_DATE_RE.test(cleanDate)) return null;
  const row = await dbGet(
    `SELECT id, user_id, start_date, end_date, note, created_by, created_at, updated_at
       FROM observer_unavailabilities
      WHERE user_id = ? AND start_date <= ? AND end_date >= ?
      ORDER BY start_date
      LIMIT 1`,
    [Number(userId), cleanDate, cleanDate]
  );
  return row ? publicAvailability(row) : null;
}

export async function availabilityByObserverOnDate(userIds, dateValue) {
  const cleanDate = String(dateValue || '').slice(0, 10);
  const cleanIds = [...new Set((userIds || []).map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  if (!cleanIds.length || !ISO_DATE_RE.test(cleanDate)) return new Map();
  const rows = await dbAll(
    `SELECT id, user_id, start_date, end_date, note, created_by, created_at, updated_at
       FROM observer_unavailabilities
      WHERE user_id IN (${cleanIds.map(() => '?').join(', ')})
        AND start_date <= ? AND end_date >= ?
      ORDER BY start_date`,
    [...cleanIds, cleanDate, cleanDate]
  );
  return new Map(rows.map((row) => [row.user_id, publicAvailability(row)]));
}

export async function availabilityRangesByObserver(userIds) {
  const cleanIds = [...new Set((userIds || []).map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  const result = new Map(cleanIds.map((id) => [id, []]));
  if (!cleanIds.length) return result;
  const rows = await dbAll(
    `SELECT id, user_id, start_date, end_date
       FROM observer_unavailabilities
      WHERE user_id IN (${cleanIds.map(() => '?').join(', ')})
      ORDER BY start_date, end_date`,
    cleanIds
  );
  for (const row of rows) {
    result.get(row.user_id)?.push({
      id: row.id,
      startDate: row.start_date,
      endDate: row.end_date
    });
  }
  return result;
}
