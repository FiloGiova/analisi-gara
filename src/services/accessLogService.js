import { dbGet, dbAll, dbRun } from '../database/db.js';

export async function logAccess(userId, ipAddress, userAgent) {
  await dbRun('INSERT INTO access_logs (user_id, ip_address, user_agent) VALUES (?, ?, ?)', [
    userId,
    ipAddress || null,
    userAgent || null
  ]);
}

export async function listAccessLogs({ limit = 100, offset = 0 } = {}) {
  return dbAll(
    `SELECT
       al.id,
       al.ip_address,
       al.user_agent,
       al.created_at,
       u.username,
       u.display_name
     FROM access_logs al
     JOIN users u ON u.id = al.user_id
     ORDER BY al.created_at DESC
     LIMIT ? OFFSET ?`,
    [limit, offset]
  );
}

export async function countAccessLogs() {
  return (await dbGet('SELECT COUNT(*) AS total FROM access_logs')).total;
}
