import express from 'express';
import { asyncHandler } from '../utils/httpError.js';
import {
  listSources,
  getSource,
  createSource,
  createAnalyticsSources,
  listAnalyticsCampionati,
  updateSource,
  deleteSource,
  listSyncRuns,
  runSourceSync
} from '../services/syncService.js';
import { getScheduledAnalyticsSyncStatus, getScheduledFipSyncStatus } from '../services/scheduledSyncService.js';

// Montato con requireAuth + requireCapability('sources:manage') in server.js.
export const sourcesRouter = express.Router();

sourcesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const [sources, scheduledSync, analyticsSync] = await Promise.all([
      listSources({ season: String(req.query.season || '').trim() }),
      getScheduledFipSyncStatus(),
      getScheduledAnalyticsSyncStatus()
    ]);
    res.json({ sources, scheduledSync, analyticsSync });
  })
);

// Campionati che l'account FIP Analytics vede nella stagione: popolano il
// modulo di creazione, così non si digita un codice a memoria.
sourcesRouter.get('/analytics/campionati', asyncHandler(async (req, res) => {
  res.json({ campionati: await listAnalyticsCampionati({ sportSeason: String(req.query.season || '').trim() }) });
}));

sourcesRouter.get('/:id', asyncHandler(async (req, res) => {
  res.json({ source: await getSource(Number(req.params.id)) });
}));

sourcesRouter.post('/', asyncHandler(async (req, res) => {
  if (req.body?.sourceType === 'fip_analytics') {
    const { sources, skipped } = await createAnalyticsSources({
      sportSeason: req.body?.sportSeason,
      name: req.body?.name,
      competition: req.body?.competition,
      codCampionato: req.body?.codCampionato
    });
    res.status(201).json({ sources, skipped });
    return;
  }
  const { sources, skipped } = await createSource({
    sportSeason: req.body?.sportSeason,
    name: req.body?.name,
    url: req.body?.url,
    competition: req.body?.competition,
    codiceGirone: req.body?.codiceGirone
  });
  res.status(201).json({ sources, skipped });
}));

sourcesRouter.put('/:id', asyncHandler(async (req, res) => {
  const source = await updateSource(Number(req.params.id), req.body || {});
  res.json({ source });
}));

sourcesRouter.delete('/:id', asyncHandler(async (req, res) => {
  await deleteSource(Number(req.params.id));
  res.json({ ok: true });
}));

sourcesRouter.post('/:id/sync', asyncHandler(async (req, res) => {
  const result = await runSourceSync(Number(req.params.id), { user: req.user });
  res.json({ result });
}));

sourcesRouter.get('/:id/runs', asyncHandler(async (req, res) => {
  res.json({ runs: await listSyncRuns(Number(req.params.id)) });
}));
