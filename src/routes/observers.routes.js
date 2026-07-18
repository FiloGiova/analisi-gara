import express from 'express';
import { requireAdminOrInstructor } from '../middleware/auth.js';
import { asyncHandler } from '../utils/httpError.js';
import {
  createObserverAvailability,
  deleteObserverAvailability,
  getObserverAvailabilityProfile,
  listObserversWithAvailability
} from '../services/observerAvailabilityService.js';

export const observersRouter = express.Router();

observersRouter.get(
  '/',
  requireAdminOrInstructor,
  asyncHandler(async (_req, res) => {
    res.json({ observers: await listObserversWithAvailability() });
  })
);

observersRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    res.json({
      ...(await getObserverAvailabilityProfile({ observerId: req.params.id, actor: req.user }))
    });
  })
);

observersRouter.post(
  '/:id/unavailabilities',
  asyncHandler(async (req, res) => {
    const unavailability = await createObserverAvailability({
      observerId: req.params.id,
      actor: req.user,
      startDate: req.body?.startDate,
      endDate: req.body?.endDate,
      note: req.body?.note
    });
    res.status(201).json({ unavailability });
  })
);

observersRouter.delete(
  '/:observerId/unavailabilities/:availabilityId',
  asyncHandler(async (req, res) => {
    await deleteObserverAvailability({ availabilityId: req.params.availabilityId, actor: req.user });
    res.json({ ok: true });
  })
);
