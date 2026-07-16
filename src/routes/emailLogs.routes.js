import express from 'express';
import { listEmailLogs, countEmailLogs } from '../services/emailLogService.js';
import { asyncHandler } from '../utils/httpError.js';

export const emailLogsRouter = express.Router();

emailLogsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const offset = Number(req.query.offset) || 0;
    const logs = await listEmailLogs({ limit, offset });
    const total = await countEmailLogs();
    res.json({ logs, total });
  })
);
