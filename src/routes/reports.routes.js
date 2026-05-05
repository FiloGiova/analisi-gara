import express from 'express';
import fs from 'node:fs';
import {
  createReport,
  deleteReport,
  getReport,
  getStats,
  listObservers,
  listRefereeNames,
  listReports,
  updateReport
} from '../services/reportService.js';
import { generateReportPdfs, getPdfFileInfo, generatePdfForRole } from '../services/pdfService.js';
import { asyncHandler, HttpError } from '../utils/httpError.js';
import { sendReportToReferee, isEmailEnabled } from '../services/emailService.js';

export const reportsRouter = express.Router();

reportsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json({
      reports: listReports({
        search: String(req.query.search || '').trim(),
        status: String(req.query.status || '').trim(),
        season: String(req.query.season || '').trim(),
        observer: String(req.query.observer || '').trim(),
        user: req.user
      })
    });
  })
);

reportsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const report = createReport({
      payload: req.body?.report,
      status: req.body?.status,
      user: req.user
    });
    res.status(201).json({ report });
  })
);

reportsRouter.get('/stats', (req, res) => {
  res.json({
    stats: getStats(req.user, {
      season: String(req.query.season || '').trim()
    })
  });
});

reportsRouter.get('/email-enabled', (_req, res) => {
  res.json({ enabled: isEmailEnabled() });
});

reportsRouter.get(
  '/observers',
  asyncHandler(async (req, res) => {
    res.json({
      observers: listObservers({
        season: String(req.query.season || '').trim(),
        user: req.user
      })
    });
  })
);

reportsRouter.get(
  '/referee-names',
  asyncHandler(async (req, res) => {
    res.json({ names: listRefereeNames(req.user) });
  })
);

reportsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    res.json({ report: getReport(Number(req.params.id), req.user) });
  })
);

reportsRouter.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const report = updateReport({
      id: Number(req.params.id),
      payload: req.body?.report,
      status: req.body?.status,
      user: req.user
    });
    res.json({ report });
  })
);

reportsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    deleteReport(Number(req.params.id), req.user);
    res.json({ ok: true });
  })
);

reportsRouter.post(
  '/:id/export',
  asyncHandler(async (req, res) => {
    const report = getReport(Number(req.params.id), req.user);
    if (req.user?.role === 'referee') {
      const role = report.firstRefereeId === req.user.refereeId ? 'first'
        : report.secondRefereeId === req.user.refereeId ? 'second'
        : null;
      if (!role) throw new HttpError(403, 'PDF non accessibile.');
      const item = await generatePdfForRole(report, role);
      res.json({
        exports: [{
          role: item.role,
          fileName: item.fileName,
          downloadUrl: `/api/reports/${report.id}/export/${item.role}/download`
        }]
      });
      return;
    }
    const exports = await generateReportPdfs(report);
    res.json({
      exports: exports.map((item) => ({
        role: item.role,
        fileName: item.fileName,
        downloadUrl: `/api/reports/${report.id}/export/${item.role}/download`
      }))
    });
  })
);

reportsRouter.get(
  '/:id/export/:role/download',
  asyncHandler(async (req, res) => {
    const role = req.params.role;
    if (!['first', 'second'].includes(role)) {
      throw new HttpError(404, 'Export non trovato.');
    }

    const report = getReport(Number(req.params.id), req.user);

    if (req.user?.role === 'referee') {
      const myRefereeId = req.user.refereeId;
      const requestedRefereeId = role === 'first' ? report.firstRefereeId : report.secondRefereeId;
      if (!myRefereeId || requestedRefereeId !== myRefereeId) {
        throw new HttpError(403, 'PDF non accessibile.');
      }
    }

    let fileInfo = getPdfFileInfo(report, role);
    if (!fs.existsSync(fileInfo.filePath)) {
      await generatePdfForRole(report, role);
      fileInfo = getPdfFileInfo(report, role);
    }

    const inline = req.query.inline === '1' || req.query.inline === 'true';
    if (inline) {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${fileInfo.fileName}"`);
      fs.createReadStream(fileInfo.filePath).pipe(res);
    } else {
      res.download(fileInfo.filePath, fileInfo.fileName);
    }
  })
);

reportsRouter.post(
  '/:id/send-email/:role',
  asyncHandler(async (req, res) => {
    const role = req.params.role;
    const result = await sendReportToReferee(Number(req.params.id), role, req.user);
    res.json({ ok: true, sentAt: result.sentAt, refereeEmail: result.refereeEmail });
  })
);
