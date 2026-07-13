import express from 'express';
import { asyncHandler } from '../utils/httpError.js';
import {
  listSources,
  getSource,
  createSource,
  updateSource,
  deleteSource,
  listSyncRuns,
  runFipSync
} from '../services/syncService.js';
import { getScheduledFipSyncStatus } from '../services/scheduledSyncService.js';

// Montato con requireAuth + requireAdmin in server.js.
export const sourcesRouter = express.Router();

sourcesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const [sources, scheduledSync] = await Promise.all([
      listSources({ season: String(req.query.season || '').trim() }),
      getScheduledFipSyncStatus()
    ]);
    res.json({ sources, scheduledSync });
  })
);

sourcesRouter.get('/:id', asyncHandler(async (req, res) => {
  res.json({ source: await getSource(Number(req.params.id)) });
}));

sourcesRouter.post('/', asyncHandler(async (req, res) => {
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
  const result = await runFipSync(Number(req.params.id), { user: req.user });
  res.json({ result });
}));

sourcesRouter.get('/:id/runs', asyncHandler(async (req, res) => {
  res.json({ runs: await listSyncRuns(Number(req.params.id)) });
}));
