import dotenv from 'dotenv';
import path from 'node:path';

dotenv.config();

const rootDir = process.cwd();
const storageDir = path.resolve(process.env.STORAGE_DIR || path.join(rootDir, 'storage'));
const dataDir = path.join(storageDir, 'data');
const outputDir = path.resolve(process.env.OUTPUT_DIR || path.join(storageDir, 'output'));
const uploadsDir = path.join(storageDir, 'uploads');

export const config = {
  rootDir,
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || '0.0.0.0',
  env: process.env.NODE_ENV || 'development',
  storageDir,
  dataDir,
  outputDir,
  templatesDir: path.join(storageDir, 'templates'),
  uploadsDir,
  profilePhotosDir: path.join(uploadsDir, 'profiles'),
  databasePath: path.resolve(process.env.DATABASE_PATH || path.join(dataDir, 'rapporti.sqlite')),
  sessionCookieName: process.env.SESSION_COOKIE_NAME || 'rapporti_sid',
  sessionDays: Number(process.env.SESSION_DAYS || 14),
  cookieSecure: String(process.env.COOKIE_SECURE || 'false').toLowerCase() === 'true',
  smtp: process.env.SMTP_HOST
    ? {
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true',
        auth: {
          user: process.env.SMTP_USER || '',
          pass: process.env.SMTP_PASS || ''
        },
        from: process.env.SMTP_FROM || process.env.SMTP_USER || ''
      }
    : null
};

export function getSessionMaxAgeMs() {
  return config.sessionDays * 24 * 60 * 60 * 1000;
}
