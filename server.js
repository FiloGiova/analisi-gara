import express from 'express';
import helmet from 'helmet';
import path from 'node:path';
import fs from 'node:fs';
import { config } from './src/config.js';
import { initializeDatabase, getDb } from './src/database/connection.js';
import { attachUser, requireAdmin, requireAuth } from './src/middleware/auth.js';
import { authRouter } from './src/routes/auth.routes.js';
import { reportsRouter } from './src/routes/reports.routes.js';
import { usersRouter } from './src/routes/users.routes.js';

initializeDatabase();
getDb().prepare('DELETE FROM sessions WHERE expires_at <= ?').run(new Date().toISOString());

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

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, storageDir: config.storageDir });
});

app.use('/api/auth', authRouter);
app.use('/api/reports', requireAuth, reportsRouter);
app.use('/api/users', requireAuth, requireAdmin, usersRouter);
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
        '<h1>Rapporti Arbitrali</h1><p>Frontend non compilato. Esegui <code>npm run build</code>, poi riavvia il server.</p>'
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

app.listen(config.port, config.host, () => {
  console.log(`Rapporti Arbitrali in ascolto su http://${config.host}:${config.port}`);
  console.log(`Storage: ${config.storageDir}`);
});
