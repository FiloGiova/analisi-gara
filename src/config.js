import dotenv from 'dotenv';
import path from 'node:path';
import { publicInformation } from './publicInformation.js';

dotenv.config();

const SYNC_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

// "11:00,21:00" → ['11:00', '21:00']; valori non validi ignorati, ordine crescente.
function parseSyncTimes(raw, fallback) {
  const times = String(raw || '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => SYNC_TIME_PATTERN.test(value));
  return times.length ? [...new Set(times)].sort() : fallback;
}

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
  appBaseUrl: (process.env.APP_BASE_URL || process.env.RENDER_EXTERNAL_URL || 'http://localhost:5173').replace(/\/$/, ''),
  trustProxy: Number(process.env.TRUST_PROXY_HOPS || 0),
  googleAuthEnabled: String(process.env.ENABLE_GOOGLE_AUTH || 'false').toLowerCase() === 'true',
  supabaseAuthKey: process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || '',
  publicInfo: {
    operatorName: (process.env.PUBLIC_OPERATOR_NAME || publicInformation.operatorName).trim(),
    contactEmail: (process.env.PUBLIC_CONTACT_EMAIL || publicInformation.contactEmail).trim(),
    legalBasis: (process.env.PUBLIC_PRIVACY_LEGAL_BASIS || publicInformation.legalBasis).trim(),
    retention: (process.env.PUBLIC_PRIVACY_RETENTION || publicInformation.retention).trim(),
    // Token pubblico Search Console fornito dal gestore, non una credenziale.
    googleSiteVerification: (process.env.GOOGLE_SITE_VERIFICATION || '2q3aWC9ruCDa7mf73dm9t2SW-D5yxRvlv1pL5CSBGHw').trim()
  },
  // Postgres (Supabase). Connection string in DATABASE_URL; SSL richiesto in cloud.
  databaseUrl: process.env.DATABASE_URL || '',
  databaseSsl: String(process.env.DATABASE_SSL ?? 'true').toLowerCase() === 'true',
  pgPoolMax: Number(process.env.PG_POOL_MAX || 5),
  // Supabase Storage per PDF e foto. Se non configurato, si usa il filesystem locale.
  supabase: {
    // Accetta anche l'URL della Data API copiato dalla dashboard: Auth e Storage
    // aggiungono i propri percorsi alla radice del progetto, non a /rest/v1.
    url: (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '').replace(/\/rest\/v1$/, ''),
    serviceKey: process.env.SUPABASE_SERVICE_KEY || '',
    bucket: process.env.STORAGE_BUCKET || 'rapporti'
  },
  get storageDriver() {
    return process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY ? 'supabase' : 'local';
  },
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
    : null,
  aiEnabled: String(process.env.ENABLE_AI_FEATURES || 'false').toLowerCase() === 'true',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  anthropicModel: 'claude-haiku-4-5-20251001',
  anthropicApiVersion: '2023-06-01',
  scheduledSync: {
    enabled: String(process.env.ENABLE_SCHEDULED_SYNC || 'false').toLowerCase() === 'true',
    time: SYNC_TIME_PATTERN.test(process.env.SCHEDULED_SYNC_TIME || '')
      ? process.env.SCHEDULED_SYNC_TIME
      : '13:15',
    timezone: process.env.SCHEDULED_SYNC_TIMEZONE || 'Europe/Rome',
    sourceDelayMs: Math.max(0, Number(process.env.SCHEDULED_SYNC_SOURCE_DELAY_MS || 2000)),
    pollMs: Math.max(30000, Number(process.env.SCHEDULED_SYNC_POLL_MS || 60000)),
    alertEmail: process.env.SCHEDULED_SYNC_ALERT_EMAIL || ''
  },
  // FIP Analytics (analytics.fip.it): designazioni arbitrali in anticipo con
  // l'account di un designatore. Credenziali solo da env, mai in DB o nei log.
  fipAnalytics: {
    username: (process.env.FIP_ANALYTICS_USERNAME || '').trim(),
    password: process.env.FIP_ANALYTICS_PASSWORD || '',
    syncTimes: parseSyncTimes(process.env.FIP_ANALYTICS_SYNC_TIMES, ['11:00', '21:00'])
  }
};

export function getSessionMaxAgeMs() {
  return config.sessionDays * 24 * 60 * 60 * 1000;
}
