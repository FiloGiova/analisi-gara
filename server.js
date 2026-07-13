import express from 'express';
import helmet from 'helmet';
import path from 'node:path';
import fs from 'node:fs';
import { config } from './src/config.js';
import { initializeDatabase } from './src/database/connection.js';
import { dbGet, dbRun } from './src/database/db.js';
import { attachUser, requireAdmin, requireAdminOrInstructor, requireAuth, requireReportAuthors } from './src/middleware/auth.js';
import { authRouter } from './src/routes/auth.routes.js';
import { reportsRouter } from './src/routes/reports.routes.js';
import { usersRouter } from './src/routes/users.routes.js';
import { accessLogsRouter } from './src/routes/accessLogs.routes.js';
import { refereesRouter } from './src/routes/referees.routes.js';
import { photosRouter, refereePhotosRouter } from './src/routes/photos.routes.js';
import { meRouter } from './src/routes/me.routes.js';
import { aiRouter } from './src/routes/ai.routes.js';
import { gamesRouter } from './src/routes/games.routes.js';
import { sourcesRouter } from './src/routes/sources.routes.js';
import { importsRouter } from './src/routes/imports.routes.js';
import { statsRouter } from './src/routes/stats.routes.js';

const app = express();
const clientDist = path.join(config.rootDir, 'dist', 'client');

app.disable('x-powered-by');
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
  })
);
app.use(express.json({ limit: '2mb' }));
app.use(attachUser);

app.get('/api/health', async (_req, res) => {
  try {
    await dbGet('SELECT 1 AS ok');
    res.json({ ok: true });
  } catch (_) {
    res.status(503).json({ ok: false });
  }
});

app.use('/api/auth', authRouter);
app.use('/api/reports', requireAuth, reportsRouter);
app.use('/api/users', requireAuth, requireAdmin, usersRouter);
app.use('/api/access-logs', requireAuth, requireAdmin, accessLogsRouter);
app.use('/api/me', requireAuth, meRouter);
app.use('/api/photos', photosRouter);
app.use('/api/referees', requireAuth, refereePhotosRouter);
app.use('/api/referees', requireAuth, refereesRouter);
app.use('/api/games', requireAuth, gamesRouter);
app.use('/api/sources', requireAuth, requireAdmin, sourcesRouter);
app.use('/api/imports', requireAuth, requireAdmin, importsRouter);
app.use('/api/stats', requireAuth, requireAdminOrInstructor, statsRouter);
if (config.aiEnabled) {
  app.use('/api/ai', requireAuth, requireReportAuthors, aiRouter);
}
app.use('/api', (_req, res) => {
  res.status(404).json({ message: 'Endpoint non trovato.' });
});

if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist, { index: false }));
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
  app.listen(config.port, config.host, () => {
    console.log(`FischioLab in ascolto su http://${config.host}:${config.port}`);
    console.log(`Storage: ${config.storageDriver} | DB: Postgres`);
  });
}

start().catch((err) => {
  console.error('Avvio fallito:', err);
  process.exit(1);
});
