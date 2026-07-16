import express from 'express';
import { getSetting, setSetting } from '../services/settingsService.js';
import {
  DEFAULT_EMAIL_BODY_TEMPLATE,
  EMAIL_TEMPLATE_KEY,
  EMAIL_TEMPLATE_PLACEHOLDERS,
  unknownPlaceholders
} from '../services/emailTemplate.js';
import { asyncHandler, HttpError } from '../utils/httpError.js';

export const settingsRouter = express.Router();

settingsRouter.get(
  '/email-template',
  asyncHandler(async (_req, res) => {
    const saved = await getSetting(EMAIL_TEMPLATE_KEY);
    res.json({
      template: saved || DEFAULT_EMAIL_BODY_TEMPLATE,
      isDefault: !saved,
      defaultTemplate: DEFAULT_EMAIL_BODY_TEMPLATE,
      placeholders: EMAIL_TEMPLATE_PLACEHOLDERS
    });
  })
);

settingsRouter.put(
  '/email-template',
  asyncHandler(async (req, res) => {
    // Stringa vuota = torna al template di default nel codice.
    const template = String(req.body?.template ?? '').trim();
    const unknown = unknownPlaceholders(template);
    if (unknown.length) {
      throw new HttpError(400, `Segnaposto non riconosciuti: ${unknown.map((key) => `{{${key}}}`).join(', ')}`);
    }
    await setSetting(EMAIL_TEMPLATE_KEY, template, req.user?.id || null);
    res.json({
      template: template || DEFAULT_EMAIL_BODY_TEMPLATE,
      isDefault: !template
    });
  })
);
