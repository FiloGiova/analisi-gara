import dotenv from 'dotenv';
import path from 'node:path';

dotenv.config();

const rootDir = process.cwd();
const storageDir = path.resolve(process.env.STORAGE_DIR || path.join(rootDir, 'storage'));
const dataDir = path.join(storageDir, 'data');
const outputDir = path.resolve(process.env.OUTPUT_DIR || path.join(storageDir, 'output'));

export const config = {
  rootDir,
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || '0.0.0.0',
  env: process.env.NODE_ENV || 'development',
  storageDir,
  dataDir,
  outputDir,
  templatesDir: path.join(storageDir, 'templates'),
  uploadsDir: path.join(storageDir, 'uploads'),
  databasePath: path.resolve(process.env.DATABASE_PATH || path.join(dataDir, 'rapporti.sqlite')),
  sessionCookieName: process.env.SESSION_COOKIE_NAME || 'rapporti_sid',
  sessionDays: Number(process.env.SESSION_DAYS || 14),
  cookieSecure: String(process.env.COOKIE_SECURE || 'false').toLowerCase() === 'true'
};

export function getSessionMaxAgeMs() {
  return config.sessionDays * 24 * 60 * 60 * 1000;
}
