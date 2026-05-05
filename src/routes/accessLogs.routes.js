import express from 'express';
import { listAccessLogs, countAccessLogs } from '../services/accessLogService.js';

export const accessLogsRouter = express.Router();

accessLogsRouter.get('/', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const offset = Number(req.query.offset) || 0;
  const logs = listAccessLogs({ limit, offset });
  const total = countAccessLogs();
  res.json({ logs, total });
});
