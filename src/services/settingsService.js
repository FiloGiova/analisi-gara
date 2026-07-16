import { dbGet, dbRun } from '../database/db.js';

export async function getSetting(key) {
  const row = await dbGet('SELECT value FROM app_settings WHERE key = ?', [key]);
  return row ? row.value : null;
}

export async function setSetting(key, value, userId = null) {
  await dbRun(
    `INSERT INTO app_settings (key, value, updated_by, updated_at)
     VALUES (?, ?, ?, iso_now())
     ON CONFLICT (key) DO UPDATE
       SET value = excluded.value, updated_by = excluded.updated_by, updated_at = iso_now()`,
    [key, String(value ?? ''), userId]
  );
}
