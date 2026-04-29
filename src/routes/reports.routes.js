import express from 'express';
import fs from 'node:fs';
import {
  createReport,
  deleteReport,
  getReport,
  listRefereeNames,
  listReports,
  updateReport
} from '../services/reportService.js';
import { generateReportPdfs, getPdfFileInfo, generatePdfForRole } from '../services/pdfService.js';
import { asyncHandler, HttpError } from '../utils/httpError.js';

export const reportsRouter = express.Router();

reportsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json({
      reports: listReports({
        search: String(req.query.search || '').trim(),
        status: String(req.query.status || '').trim(),
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
    let fileInfo = getPdfFileInfo(report, role);
    if (!fs.existsSync(fileInfo.filePath)) {
      await generatePdfForRole(report, role);
      fileInfo = getPdfFileInfo(report, role);
    }

    res.download(fileInfo.filePath, fileInfo.fileName);
  })
);
