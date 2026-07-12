import express from 'express';
import { asyncHandler, HttpError } from '../utils/httpError.js';
import { generateJudgment, reviseJudgment } from '../services/anthropicService.js';

export const aiRouter = express.Router();

const MAX_REPORT_DATA_BYTES = 50000;
const MAX_CURRENT_JUDGMENT_CHARS = 5000;
const MAX_OBSERVER_FEEDBACK_CHARS = 2000;

aiRouter.post(
  '/generate-judgment',
  asyncHandler(async (req, res) => {
    const reportData = req.body?.reportData;
    if (!reportData || typeof reportData !== 'object' || Array.isArray(reportData)) {
      throw new HttpError(400, 'Campo reportData mancante o non valido.');
    }
    if (JSON.stringify(reportData).length > MAX_REPORT_DATA_BYTES) {
      throw new HttpError(413, 'reportData troppo grande.');
    }

    const judgment = await generateJudgment(reportData, { userId: req.user?.id });
    res.json({ judgment });
  })
);

aiRouter.post(
  '/revise-judgment',
  asyncHandler(async (req, res) => {
    const currentJudgment = String(req.body?.currentJudgment || '').trim();
    const observerFeedback = String(req.body?.observerFeedback || '').trim();
    if (!currentJudgment) {
      throw new HttpError(400, 'Giudizio attuale mancante.');
    }
    if (!observerFeedback) {
      throw new HttpError(400, 'Feedback mancante.');
    }
    if (currentJudgment.length > MAX_CURRENT_JUDGMENT_CHARS) {
      throw new HttpError(413, 'Giudizio attuale troppo lungo.');
    }
    if (observerFeedback.length > MAX_OBSERVER_FEEDBACK_CHARS) {
      throw new HttpError(413, 'Feedback troppo lungo.');
    }

    const judgment = await reviseJudgment(currentJudgment, observerFeedback, { userId: req.user?.id });
    res.json({ judgment });
  })
);
