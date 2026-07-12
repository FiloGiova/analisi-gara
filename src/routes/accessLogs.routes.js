import express from 'express';
import { listAccessLogs, countAccessLogs } from '../services/accessLogService.js';
import { asyncHandler } from '../utils/httpError.js';

export const accessLogsRouter = express.Router();

accessLogsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const offset = Number(req.query.offset) || 0;
    const logs = await listAccessLogs({ limit, offset });
    const total = await countAccessLogs();
    res.json({ logs, total });
  })
);
