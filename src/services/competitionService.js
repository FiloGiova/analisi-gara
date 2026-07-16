import { dbGet, dbAll, dbRun } from '../database/db.js';
import { HttpError } from '../utils/httpError.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function mapRow(row) {
  return {
    id: row.id,
    value: row.value,
    label: row.label,
    ccEmails: row.cc_emails || '',
    emailSignature: row.email_signature || '',
    sortOrder: row.sort_order,
    active: Boolean(row.active),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

// Normalizza "a@b.it, c@d.it" in una stringa pulita; rifiuta indirizzi malformati.
function normalizeCcEmails(value) {
  const addresses = String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  for (const address of addresses) {
    if (!EMAIL_RE.test(address)) {
      throw new HttpError(400, `Indirizzo CC non valido: ${address}`);
    }
  }
  return addresses.join(', ');
}

function normalizeSortOrder(value, fallback = 0) {
  const n = Number(value);
  return Number.isInteger(n) ? n : fallback;
}

export async function listCompetitions({ activeOnly = false } = {}) {
  const rows = await dbAll(
    `SELECT * FROM competitions ${activeOnly ? 'WHERE active = 1' : ''} ORDER BY sort_order ASC, label ASC`
  );
  return rows.map(mapRow);
}

export async function getCompetitionByValue(value) {
  const clean = String(value || '').trim();
  if (!clean) return null;
  const row = await dbGet('SELECT * FROM competitions WHERE value = ?', [clean]);
  return row ? mapRow(row) : null;
}

// Set di tutti i codici noti, inattivi inclusi: i dati storici restano validi
// anche quando un campionato non è più selezionabile.
export async function allowedCompetitionValues() {
  const rows = await dbAll('SELECT value FROM competitions');
  return new Set(rows.map((row) => row.value));
}

export async function getCompetition(id) {
  const row = await dbGet('SELECT * FROM competitions WHERE id = ?', [id]);
  if (!row) throw new HttpError(404, 'Campionato non trovato.');
  return mapRow(row);
}

export async function createCompetition({ value, label, ccEmails = '', emailSignature = '', sortOrder = 0 }) {
  const cleanValue = String(value || '').trim();
  if (!cleanValue) throw new HttpError(400, 'Codice campionato obbligatorio.');
  const cleanLabel = String(label || '').trim() || cleanValue;

  const existing = await dbGet('SELECT id FROM competitions WHERE value = ?', [cleanValue]);
  if (existing) throw new HttpError(409, 'Campionato già esistente.');

  const result = await dbRun(
    `INSERT INTO competitions (value, label, cc_emails, email_signature, sort_order)
     VALUES (?, ?, ?, ?, ?) RETURNING id`,
    [cleanValue, cleanLabel, normalizeCcEmails(ccEmails), String(emailSignature || '').trim(), normalizeSortOrder(sortOrder)]
  );
  return getCompetition(result.rows[0].id);
}

export async function updateCompetition(id, { value, label, ccEmails, emailSignature, sortOrder, active }) {
  const current = await dbGet('SELECT * FROM competitions WHERE id = ?', [id]);
  if (!current) throw new HttpError(404, 'Campionato non trovato.');

  // Il codice è la chiave salvata nelle altre tabelle: cambiarlo scollegherebbe
  // rapporti, gare e assegnazioni esistenti.
  if (value !== undefined && String(value).trim() !== current.value) {
    throw new HttpError(400, 'Il codice del campionato non è modificabile.');
  }

  const nextLabel = label === undefined ? current.label : String(label || '').trim();
  if (!nextLabel) throw new HttpError(400, 'Nome campionato obbligatorio.');
  const nextCc = ccEmails === undefined ? current.cc_emails : normalizeCcEmails(ccEmails);
  const nextSignature = emailSignature === undefined ? current.email_signature : String(emailSignature || '').trim();
  const nextSortOrder = sortOrder === undefined ? current.sort_order : normalizeSortOrder(sortOrder, current.sort_order);
  const nextActive = active === undefined ? current.active : (active ? 1 : 0);

  await dbRun(
    `UPDATE competitions
        SET label = ?, cc_emails = ?, email_signature = ?, sort_order = ?, active = ?, updated_at = iso_now()
      WHERE id = ?`,
    [nextLabel, nextCc, nextSignature, nextSortOrder, nextActive, id]
  );
  return getCompetition(id);
}
