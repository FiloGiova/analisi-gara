import { getDb } from '../database/connection.js';

export function logAccess(userId, ipAddress, userAgent) {
  getDb()
    .prepare(
      'INSERT INTO access_logs (user_id, ip_address, user_agent) VALUES (?, ?, ?)'
    )
    .run(userId, ipAddress || null, userAgent || null);
}

export function listAccessLogs({ limit = 100, offset = 0 } = {}) {
  return getDb()
    .prepare(
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
       LIMIT ? OFFSET ?`
    )
    .all(limit, offset);
}

export function countAccessLogs() {
  return getDb()
    .prepare('SELECT COUNT(*) AS total FROM access_logs')
    .get().total;
}
