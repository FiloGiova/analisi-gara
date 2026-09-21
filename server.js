import express from 'express';
import helmet from 'helmet';
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { config } from './src/config.js';
import { initializeDatabase } from './src/database/connection.js';
import { dbGet, dbRun } from './src/database/db.js';
import { attachUser, requireAdmin, requireAdminOrInstructor, requireAuth, requireCapability, requireReportAuthors } from './src/middleware/auth.js';
import { authRouter, googleCallback } from './src/routes/auth.routes.js';
import { reportsRouter } from './src/routes/reports.routes.js';
import { usersRouter } from './src/routes/users.routes.js';
import { accessLogsRouter } from './src/routes/accessLogs.routes.js';
import { emailLogsRouter } from './src/routes/emailLogs.routes.js';
import { reportEventsRouter } from './src/routes/reportEvents.routes.js';
import { competitionsRouter } from './src/routes/competitions.routes.js';
import { settingsRouter } from './src/routes/settings.routes.js';
import { refereesRouter } from './src/routes/referees.routes.js';
import { photosRouter, refereePhotosRouter } from './src/routes/photos.routes.js';
import { meRouter } from './src/routes/me.routes.js';
import { aiRouter } from './src/routes/ai.routes.js';
import { gamesRouter } from './src/routes/games.routes.js';
import { observersRouter } from './src/routes/observers.routes.js';
import { sourcesRouter } from './src/routes/sources.routes.js';
import { importsRouter } from './src/routes/imports.routes.js';
import { statsRouter } from './src/routes/stats.routes.js';
import { startScheduledFipSync } from './src/services/scheduledSyncService.js';
import { publicRouter } from './src/routes/public.routes.js';

export const app = express();
const clientDist = path.join(config.rootDir, 'dist', 'client');

app.disable('x-powered-by');
if (config.trustProxy) app.set('trust proxy', config.trustProxy);
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: 'no-referrer' }
  })
);
app.use(express.json({ limit: '2mb' }));
app.use(publicRouter);
if (fs.existsSync(clientDist)) app.use(express.static(clientDist, { index: false }));
app.use(attachUser);

app.get('/api/health', async (_req, res) => {
  try {
    await dbGet('SELECT 1 AS ok');
    res.json({ ok: true });
  } catch (_) {
    res.status(503).json({ ok: false });
  }
});

app.get('/auth/callback', googleCallback);
app.use('/api/auth', authRouter);
app.use('/api/reports', requireAuth, reportsRouter);
app.use('/api/users', requireAuth, requireAdmin, usersRouter);
app.use('/api/access-logs', requireAuth, requireAdmin, accessLogsRouter);
app.use('/api/email-logs', requireAuth, requireAdmin, emailLogsRouter);
app.use('/api/report-events', requireAuth, requireAdmin, reportEventsRouter);
app.use('/api/competitions', requireAuth, competitionsRouter);
app.use('/api/settings', requireAuth, requireAdmin, settingsRouter);
app.use('/api/me', requireAuth, meRouter);
app.use('/api/photos', photosRouter);
app.use('/api/referees', requireAuth, refereePhotosRouter);
app.use('/api/referees', requireAuth, refereesRouter);
app.use('/api/games', requireAuth, gamesRouter);
app.use('/api/observers', requireAuth, observersRouter);
app.use('/api/sources', requireAuth, requireCapability('sources:manage'), sourcesRouter);
app.use('/api/imports', requireAuth, requireCapability('designations:import'), importsRouter);
app.use('/api/stats', requireAuth, requireCapability('stats:view'), statsRouter);
if (config.aiEnabled) {
  app.use('/api/ai', requireAuth, requireReportAuthors, aiRouter);
}
app.use('/api', (_req, res) => {
  res.status(404).json({ message: 'Endpoint non trovato.' });
});

if (fs.existsSync(clientDist)) {
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
} else {
  app.get('*', (_req, res) => {
    res
      .status(200)
      .type('html')
      .send(
        '<h1>FischioLab</h1><p>Frontend non compilato. Esegui <code>npm run build</code>, poi riavvia il server.</p>'
      );
  });
}

app.use((err, _req, res, _next) => {
  const statusCode = err.statusCode || 500;
  if (statusCode >= 500) {
    console.error(err);
  }
  res.status(statusCode).json({
    message: err.message || 'Errore interno del server.',
    details: err.details
  });
});

async function start() {
  await initializeDatabase();
  await dbRun('DELETE FROM sessions WHERE expires_at <= ?', [new Date().toISOString()]);
  await dbRun('DELETE FROM oauth_flows WHERE expires_at <= now()');
  await dbRun('DELETE FROM auth_rate_limits WHERE expires_at <= now()');
  app.listen(config.port, config.host, () => {
    console.log(`FischioLab in ascolto su http://${config.host}:${config.port}`);
    console.log(`Storage: ${config.storageDriver} | DB: Postgres`);
    startScheduledFipSync();
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  start().catch((err) => {
    console.error('Avvio fallito:', err);
    process.exit(1);
  });
}
