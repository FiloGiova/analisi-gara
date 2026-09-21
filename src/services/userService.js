import { dbGet, dbAll, dbRun, dbTx } from '../database/db.js';
import { currentSportSeason } from '../../shared/reportTemplate.js';
import { allowedCompetitionValues } from './competitionService.js';
import { hashPassword } from '../utils/passwords.js';
import { HttpError } from '../utils/httpError.js';
import { normalizeRoles, primaryRole, ROLES as ROLE_LIST } from '../../shared/permissions.js';
import { hasAnyRoleSql } from '../database/userRoles.js';

const USERNAME_RE = /^[a-zA-Z0-9._-]{3,40}$/;
const ROLES = new Set(ROLE_LIST);

function normalizeUsername(username) {
  return String(username || '').trim().toLowerCase();
}

function normalizeRole(role, competitions = '') {
  const clean = String(role || '').trim();
  if (ROLES.has(clean)) return clean;
  if (clean === 'formatter' || clean === 'formatore') return 'instructor';
  if (clean === 'user') return parseInstructorCompetitions(competitions).length ? 'instructor' : 'observer';
  return 'observer';
}

function parseInstructorCompetitions(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean);
  }

  const clean = String(value || '').trim();
  if (!clean) return [];

  if (clean.startsWith('[')) {
    try {
      const parsed = JSON.parse(clean);
      if (Array.isArray(parsed)) return parsed.map((item) => String(item || '').trim()).filter(Boolean);
    } catch (_) {
      return [];
    }
  }

  return clean.split('|').map((item) => item.trim()).filter(Boolean);
}

function normalizeInstructorCompetitions(value, allowed) {
  const unique = [];
  for (const item of parseInstructorCompetitions(value)) {
    if (!allowed.has(item)) {
      throw new HttpError(400, 'Campionato formatore non valido.');
    }
    if (!unique.includes(item)) unique.push(item);
  }
  return unique;
}

function normalizeStoredInstructorCompetitions(value, allowed) {
  const unique = [];
  for (const item of parseInstructorCompetitions(value)) {
    if (allowed.has(item) && !unique.includes(item)) unique.push(item);
  }
  return unique;
}

function instructorCompetitionInput({ instructorCompetition, formatterCompetition }) {
  return instructorCompetition !== undefined ? instructorCompetition : formatterCompetition;
}

function normalizeSportSeason(value) {
  const clean = String(value || '').trim();
  const match = clean.match(/^(\d{4})\/(\d{4})$/);
  if (!match || Number(match[2]) !== Number(match[1]) + 1) {
    throw new HttpError(400, 'Stagione formatore non valida: usa il formato 2025/2026.');
  }
  return clean;
}

function normalizeInstructorAssignments(value, legacyCompetitionInput, allowed) {
  const source = value === undefined
    ? [{ sportSeason: currentSportSeason(), competitions: normalizeInstructorCompetitions(legacyCompetitionInput, allowed) }]
    : value;
  if (!Array.isArray(source)) throw new HttpError(400, 'Storico formatore non valido.');

  const grouped = new Map();
  for (const item of source) {
    const sportSeason = normalizeSportSeason(item?.sportSeason || item?.season);
    const competitions = normalizeInstructorCompetitions(item?.competitions, allowed);
    if (!competitions.length) continue;
    const existing = grouped.get(sportSeason) || [];
    grouped.set(sportSeason, [...new Set([...existing, ...competitions])]);
  }
  return [...grouped.entries()]
    .map(([sportSeason, competitions]) => ({ sportSeason, competitions }))
    .sort((a, b) => b.sportSeason.localeCompare(a.sportSeason));
}

function validateRoleConfiguration(roles, assignments) {
  if (roles.includes('instructor') && !assignments.length) {
    throw new HttpError(400, 'Assegna almeno una stagione e un campionato al formatore.');
  }
}

// I ruoli richiesti dal chiamante: il nuovo elenco, oppure il vecchio campo
// singolo per le chiamate (e i test) non ancora convertiti.
function rolesInput({ roles, role, competitions = '' }, fallback = null) {
  if (Array.isArray(roles) && roles.length) return normalizeRoles(roles);
  if (role !== undefined && role !== null && role !== '') {
    return normalizeRoles([normalizeRole(role, competitions)]);
  }
  return fallback ? normalizeRoles(fallback) : null;
}

async function loadUserRoles(userId) {
  const rows = await dbAll('SELECT role FROM user_roles WHERE user_id = ? ORDER BY role', [userId]);
  return rows.map((row) => row.role);
}

async function replaceUserRoles(client, userId, roles) {
  await client.run('DELETE FROM user_roles WHERE user_id = ?', [userId]);
  for (const role of roles) {
    await client.run('INSERT INTO user_roles (user_id, role) VALUES (?, ?) ON CONFLICT DO NOTHING', [userId, role]);
  }
}

function assignmentCompetitions(assignments) {
  return [...new Set(assignments.flatMap((assignment) => assignment.competitions))];
}

async function replaceInstructorAssignments(client, userId, assignments) {
  await client.run('DELETE FROM instructor_competition_assignments WHERE user_id = ?', [userId]);
  for (const assignment of assignments) {
    for (const competition of assignment.competitions) {
      await client.run(
        `INSERT INTO instructor_competition_assignments (user_id, sport_season, competition)
         VALUES (?, ?, ?)`,
        [userId, assignment.sportSeason, competition]
      );
    }
  }
}

async function loadInstructorAssignments(userId) {
  const rows = await dbAll(
    `SELECT sport_season, competition
       FROM instructor_competition_assignments
      WHERE user_id = ?
      ORDER BY sport_season DESC, competition ASC`,
    [userId]
  );
  const grouped = new Map();
  for (const row of rows) {
    if (!grouped.has(row.sport_season)) grouped.set(row.sport_season, []);
    grouped.get(row.sport_season).push(row.competition);
  }
  return [...grouped.entries()].map(([sportSeason, competitions]) => ({ sportSeason, competitions }));
}

function normalizeRefereeId(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

async function validateRefereeConfiguration({ roles, refereeId, exceptUserId = null }) {
  if (!roles.includes('referee')) return null;
  const cleanRefereeId = normalizeRefereeId(refereeId);
  if (!cleanRefereeId) {
    throw new HttpError(400, 'Collega un arbitro anagrafico all’utente referee.');
  }
  const referee = await dbGet('SELECT id FROM referees WHERE id = ?', [cleanRefereeId]);
  if (!referee) throw new HttpError(404, 'Arbitro collegato non trovato.');
  const refereeClause = hasAnyRoleSql('u', ['referee']);
  const existing = exceptUserId
    ? await dbGet(`SELECT u.id FROM users u WHERE u.referee_id = ? AND ${refereeClause} AND u.id <> ?`, [cleanRefereeId, exceptUserId])
    : await dbGet(`SELECT u.id FROM users u WHERE u.referee_id = ? AND ${refereeClause}`, [cleanRefereeId]);
  if (existing) throw new HttpError(409, 'Esiste già un utente collegato a questo arbitro.');
  return cleanRefereeId;
}

function validateUsername(username) {
  if (!USERNAME_RE.test(username)) {
    throw new HttpError(400, 'Username non valido: usa 3-40 caratteri, lettere, numeri, punto, trattino o underscore.');
  }
}

export function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 8) {
    throw new HttpError(400, 'La password deve avere almeno 8 caratteri.');
  }
  if (Buffer.byteLength(password, 'utf8') > 72) throw new HttpError(400, 'La password è troppo lunga (massimo 72 byte).');
}

export async function publicUserFromRow(row, allowedValues = null) {
  const storedRoles = await loadUserRoles(row.id);
  const roles = storedRoles.length
    ? normalizeRoles(storedRoles)
    : normalizeRoles([normalizeRole(row.role, row.formatter_competition)]);
  const role = primaryRole(roles);
  const isInstructor = roles.includes('instructor');
  const storedAssignments = isInstructor ? await loadInstructorAssignments(row.id) : [];
  let instructorAssignments = [];
  if (isInstructor) {
    if (storedAssignments.length) {
      instructorAssignments = storedAssignments;
    } else if (String(row.formatter_competition || '').trim()) {
      // Fallback legacy: filtra i valori sciolti contro il catalogo (inattivi
      // inclusi, per non nascondere assegnazioni storiche).
      const allowed = allowedValues || (await allowedCompetitionValues());
      instructorAssignments = [
        { sportSeason: currentSportSeason(), competitions: normalizeStoredInstructorCompetitions(row.formatter_competition, allowed) }
      ].filter((assignment) => assignment.competitions.length);
    }
  }
  const instructorCompetitions = assignmentCompetitions(instructorAssignments);
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role,
    roles,
    refereeId: roles.includes('referee') ? row.referee_id || null : null,
    photoPath: row.photo_path || null,
    instructorCompetition: instructorCompetitions[0] || '',
    instructorCompetitions,
    instructorAssignments,
    formatterCompetition: instructorCompetitions[0] || '',
    formatterCompetitions: instructorCompetitions,
    active: Boolean(row.active),
    hasPassword: Boolean(row.password_hash),
    activatedAt: row.activated_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function ensureCanChangeAdminState(client, { id, nextRoles, nextActive }) {
  // Serializza le modifiche amministrative: due richieste non possono
  // disattivare contemporaneamente gli ultimi due amministratori.
  await client.run('SELECT pg_advisory_xact_lock(70619001)');
  const current = await client.get('SELECT id, role, active FROM users WHERE id = ?', [id]);
  if (!current) throw new HttpError(404, 'Utente non trovato.');
  const currentRoles = (await client.all('SELECT role FROM user_roles WHERE user_id = ?', [id])).map((row) => row.role);
  const wasActiveAdmin = (currentRoles.length ? currentRoles : [current.role]).includes('admin') && Boolean(current.active);
  const remainsActiveAdmin = nextRoles.includes('admin') && Boolean(nextActive);
  if (wasActiveAdmin && !remainsActiveAdmin) {
    const row = await client.get(`SELECT COUNT(*) AS count FROM users u
      WHERE ${hasAnyRoleSql('u', ['admin'])} AND u.active = 1 AND u.id <> ?
        AND (u.password_hash IS NOT NULL OR EXISTS (SELECT 1 FROM user_google_identities g WHERE g.user_id = u.id))`, [id]);
    if (row.count === 0) throw new HttpError(400, "Non puoi rimuovere l'ultimo amministratore attivo.");
  }
}

export async function countUsers() {
  return (await dbGet('SELECT COUNT(*) AS count FROM users')).count;
}

export async function upsertUser({
  username,
  password,
  displayName = username,
  role = 'admin',
  roles,
  instructorCompetition,
  instructorAssignments,
  formatterCompetition = '',
  refereeId = null
}) {
  const cleanUsername = normalizeUsername(username);
  validateUsername(cleanUsername);
  validatePassword(password);

  const competitionInput = instructorCompetitionInput({ instructorCompetition, formatterCompetition });
  const cleanRoles = rolesInput({ roles, role, competitions: competitionInput });
  const cleanRole = primaryRole(cleanRoles);
  const assignments = cleanRoles.includes('instructor')
    ? normalizeInstructorAssignments(instructorAssignments, competitionInput, await allowedCompetitionValues())
    : [];
  validateRoleConfiguration(cleanRoles, assignments);
  const instructorCompetitions = assignmentCompetitions(assignments);
  const cleanInstructorCompetition = instructorCompetitions.length ? JSON.stringify(instructorCompetitions) : null;
  const existing = await dbGet('SELECT id FROM users WHERE username = ?', [cleanUsername]);
  const cleanRefereeId = await validateRefereeConfiguration({
    roles: cleanRoles,
    refereeId,
    exceptUserId: existing?.id || null
  });
  const passwordHash = hashPassword(password);

  if (existing) {
    await dbTx(async (client) => {
      await ensureCanChangeAdminState(client, { id: existing.id, nextRoles: cleanRoles, nextActive: true });
      await client.run(
        `UPDATE users
          SET password_hash = ?,
              display_name = ?,
              role = ?,
              formatter_competition = ?,
              referee_id = ?,
              active = 1,
              activated_at = COALESCE(activated_at, now()),
              auth_version = auth_version + 1,
              updated_at = ts_now()
        WHERE id = ?`,
        [passwordHash, String(displayName || cleanUsername).trim(), cleanRole, cleanInstructorCompetition, cleanRefereeId, existing.id]
      );
      await client.run('DELETE FROM sessions WHERE user_id = ?', [existing.id]);
      await client.run('UPDATE account_links SET revoked_at = now() WHERE user_id = ? AND used_at IS NULL AND revoked_at IS NULL', [existing.id]);
      await replaceInstructorAssignments(client, existing.id, assignments);
      await replaceUserRoles(client, existing.id, cleanRoles);
    });
    return existing.id;
  }

  return dbTx(async (client) => {
    const result = await client.run(
      `INSERT INTO users (username, password_hash, display_name, role, formatter_competition, referee_id)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
      [cleanUsername, passwordHash, String(displayName || cleanUsername).trim(), cleanRole, cleanInstructorCompetition, cleanRefereeId]
    );
    await replaceInstructorAssignments(client, result.rows[0].id, assignments);
    await replaceUserRoles(client, result.rows[0].id, cleanRoles);
    if (password) await client.run('UPDATE users SET activated_at = now() WHERE id = ?', [result.rows[0].id]);
    return result.rows[0].id;
  });
}

export async function listUsers() {
  const rows = await dbAll(
    `SELECT *
       FROM users
      ORDER BY active DESC, role ASC, LOWER(display_name) ASC`
  );
  const allowed = await allowedCompetitionValues();
  return Promise.all(rows.map(async (row) => ({
    ...await publicUserFromRow(row, allowed),
    hasGoogle: Boolean(await dbGet('SELECT 1 FROM user_google_identities WHERE user_id = ?', [row.id])),
    pendingInvitation: await dbGet("SELECT id, kind, expires_at FROM account_links WHERE user_id = ? AND kind IN ('activation', 'recovery') AND used_at IS NULL AND revoked_at IS NULL AND expires_at > now() ORDER BY id DESC LIMIT 1", [row.id])
  })));
}

export async function createUser({
  username,
  password,
  displayName,
  role = 'observer',
  roles,
  instructorCompetition,
  instructorAssignments,
  formatterCompetition = '',
  refereeId = null
}) {
  const cleanUsername = normalizeUsername(username);
  validateUsername(cleanUsername);
  if (password) validatePassword(password);

  const existing = await dbGet('SELECT id FROM users WHERE username = ?', [cleanUsername]);
  if (existing) throw new HttpError(409, 'Username già presente.');

  const competitionInput = instructorCompetitionInput({ instructorCompetition, formatterCompetition });
  const cleanRoles = rolesInput({ roles, role, competitions: competitionInput });
  const cleanRole = primaryRole(cleanRoles);
  const assignments = cleanRoles.includes('instructor')
    ? normalizeInstructorAssignments(instructorAssignments, competitionInput, await allowedCompetitionValues())
    : [];
  validateRoleConfiguration(cleanRoles, assignments);
  const instructorCompetitions = assignmentCompetitions(assignments);
  const cleanRefereeId = await validateRefereeConfiguration({ roles: cleanRoles, refereeId });

  const id = await dbTx(async (client) => {
    const result = await client.run(
      `INSERT INTO users (username, password_hash, display_name, role, formatter_competition, referee_id, active)
       VALUES (?, ?, ?, ?, ?, ?, 1) RETURNING id`,
      [
        cleanUsername,
        password ? hashPassword(password) : null,
        String(displayName || cleanUsername).trim(),
        cleanRole,
        instructorCompetitions.length ? JSON.stringify(instructorCompetitions) : null,
        cleanRefereeId
      ]
    );
    await replaceInstructorAssignments(client, result.rows[0].id, assignments);
    await replaceUserRoles(client, result.rows[0].id, cleanRoles);
    if (password) await client.run('UPDATE users SET activated_at = now() WHERE id = ?', [result.rows[0].id]);
    return result.rows[0].id;
  });

  return getUser(id);
}

export async function getUser(id) {
  const row = await dbGet(
    'SELECT * FROM users WHERE id = ?',
    [id]
  );
  if (!row) throw new HttpError(404, 'Utente non trovato.');
  return publicUserFromRow(row);
}

export async function updateUser({ id, displayName, role, roles, active, instructorCompetition, instructorAssignments, formatterCompetition, refereeId }) {
  const current = await dbGet('SELECT id, display_name, role, formatter_competition, referee_id, active FROM users WHERE id = ?', [id]);
  if (!current) throw new HttpError(404, 'Utente non trovato.');

  const competitionInput = instructorCompetitionInput({ instructorCompetition, formatterCompetition });
  const currentRoles = await loadUserRoles(id);
  const nextRoles = rolesInput(
    { roles, role, competitions: competitionInput ?? current.formatter_competition },
    currentRoles.length ? currentRoles : [current.role]
  );
  const nextRole = primaryRole(nextRoles);
  const nextActive = active === undefined ? Boolean(current.active) : Boolean(active);
  const isInstructor = nextRoles.includes('instructor');
  const currentAssignments = isInstructor ? await loadInstructorAssignments(id) : [];
  const nextAssignments = !isInstructor
    ? []
    : instructorAssignments === undefined && competitionInput === undefined
      ? currentAssignments
      : normalizeInstructorAssignments(instructorAssignments, competitionInput, await allowedCompetitionValues());
  validateRoleConfiguration(nextRoles, nextAssignments);
  const nextCompetitions = assignmentCompetitions(nextAssignments);
  const nextInstructorCompetition = nextCompetitions.length ? JSON.stringify(nextCompetitions) : null;
  const nextRefereeId = await validateRefereeConfiguration({
    roles: nextRoles,
    refereeId: refereeId === undefined ? current.referee_id : refereeId,
    exceptUserId: id
  });
  await dbTx(async (client) => {
    await ensureCanChangeAdminState(client, { id, nextRoles, nextActive });
    await client.run(
      `UPDATE users
        SET display_name = ?,
            role = ?,
            formatter_competition = ?,
            referee_id = ?,
            active = ?,
            updated_at = ts_now()
      WHERE id = ?`,
      [String(displayName || current.display_name).trim(), nextRole, nextInstructorCompetition, nextRefereeId, nextActive ? 1 : 0, id]
    );
    await replaceInstructorAssignments(client, id, nextAssignments);
    await replaceUserRoles(client, id, nextRoles);
    if (!nextActive) {
      await client.run('DELETE FROM sessions WHERE user_id = ?', [id]);
      await client.run('UPDATE users SET auth_version = auth_version + 1 WHERE id = ?', [id]);
      await client.run('UPDATE account_links SET revoked_at = now() WHERE user_id = ? AND used_at IS NULL AND revoked_at IS NULL', [id]);
      await client.run('DELETE FROM oauth_flows WHERE user_id = ?', [id]);
    }
  });

  return getUser(id);
}

export async function updateOwnProfile({ userId, displayName }) {
  const cleanDisplayName = String(displayName || '').trim();
  if (!cleanDisplayName) throw new HttpError(400, 'Nome visualizzato obbligatorio.');

  const existing = await dbGet('SELECT id FROM users WHERE id = ? AND active = 1', [userId]);
  if (!existing) throw new HttpError(404, 'Utente non trovato.');

  await dbRun('UPDATE users SET display_name = ?, updated_at = ts_now() WHERE id = ?', [cleanDisplayName, userId]);

  return getUser(userId);
}
