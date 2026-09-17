import express from 'express';
import { listCompetitions, createCompetition, updateCompetition } from '../services/competitionService.js';
import { requireCapability } from '../middleware/auth.js';
import { asyncHandler } from '../utils/httpError.js';

export const competitionsRouter = express.Router();

// Lettura per tutti gli utenti autenticati: serve a form e filtri.
competitionsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const activeOnly = req.query.activeOnly === 'true' || req.query.activeOnly === '1';
    res.json({ competitions: await listCompetitions({ activeOnly }) });
  })
);

competitionsRouter.post(
  '/',
  requireCapability('competitions:manage'),
  asyncHandler(async (req, res) => {
    res.status(201).json({ competition: await createCompetition(req.body || {}) });
  })
);

competitionsRouter.put(
  '/:id',
  requireCapability('competitions:manage'),
  asyncHandler(async (req, res) => {
    res.json({ competition: await updateCompetition(Number(req.params.id), req.body || {}) });
  })
);
