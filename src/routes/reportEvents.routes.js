import express from 'express';
import { listReportEvents } from '../services/reportEventService.js';
import { asyncHandler } from '../utils/httpError.js';

export const reportEventsRouter = express.Router();

reportEventsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { events, total } = await listReportEvents({
      limit: Number(req.query.limit) || 100,
      offset: Number(req.query.offset) || 0
    });
    res.json({ logs: events, total });
  })
);
