import express from 'express';
import multer from 'multer';
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
import { generateReportPdfs, getPdfFileInfo, generatePdfForRole, buildReportPdf } from '../services/pdfService.js';
import { listPendingAssignmentsForUser } from '../services/gameService.js';
import { asyncHandler, HttpError } from '../utils/httpError.js';
import { sendReportToReferee, isEmailEnabled } from '../services/emailService.js';
import { requireAdminOrInstructor } from '../middleware/auth.js';
import {
  applyFederationPdfImport,
  previewFederationPdfImport
} from '../services/federationPdfImportService.js';

export const reportsRouter = express.Router();

const pdfUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024, files: 20 },
  fileFilter: (_req, file, callback) => {
    if (file.mimetype !== 'application/pdf') {
      callback(new HttpError(400, 'Sono ammessi soltanto file PDF.'));
      return;
    }
    callback(null, true);
  }
}).array('files', 20);

function receivePdfFiles(req, _res, next) {
  pdfUpload(req, _res, (error) => {
    if (!error) {
      next();
      return;
    }
    if (error.code === 'LIMIT_FILE_SIZE') {
      next(new HttpError(413, 'Ogni PDF può pesare al massimo 4 MB.'));
      return;
    }
    if (error.code === 'LIMIT_FILE_COUNT' || error.code === 'LIMIT_UNEXPECTED_FILE') {
      next(new HttpError(413, 'Puoi caricare al massimo 20 PDF per volta.'));
      return;
    }
    next(error);
  });
}

function requirePdfFiles(req) {
  if (!Array.isArray(req.files) || !req.files.length) {
    throw new HttpError(400, 'Seleziona almeno un rapporto PDF.');
  }
}

reportsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json({
      reports: await listReports({
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
  '/pdf-import/preview',
  requireAdminOrInstructor,
  receivePdfFiles,
  asyncHandler(async (req, res) => {
    requirePdfFiles(req);
    const preview = await previewFederationPdfImport({
      files: req.files,
      contextGameId: req.body?.gameId,
      contextReportId: req.body?.reportId,
      user: req.user
    });
    res.json({ preview });
  })
);

reportsRouter.post(
  '/pdf-import/apply',
  requireAdminOrInstructor,
  receivePdfFiles,
  asyncHandler(async (req, res) => {
    requirePdfFiles(req);
    let decisions;
    try {
      decisions = JSON.parse(String(req.body?.decisions || '[]'));
    } catch (_error) {
      throw new HttpError(400, 'Conferma importazione non valida.');
    }
    const result = await applyFederationPdfImport({
      files: req.files,
      decisions,
      contextGameId: req.body?.gameId,
      contextReportId: req.body?.reportId,
      user: req.user
    });
    res.json({ result });
  })
);

reportsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const report = await createReport({
      payload: req.body?.report,
      status: req.body?.status,
      user: req.user,
      allowDuplicate: req.body?.allowDuplicate === true
    });
    res.status(201).json({ report });
  })
);

reportsRouter.get(
  '/stats',
  asyncHandler(async (req, res) => {
    res.json({
      stats: await getStats(req.user, {
        season: String(req.query.season || '').trim()
      })
    });
  })
);

reportsRouter.get('/email-enabled', (_req, res) => {
  res.json({ enabled: isEmailEnabled() });
});

reportsRouter.get(
  '/observers',
  asyncHandler(async (req, res) => {
    res.json({
      observers: await listObservers({
        season: String(req.query.season || '').trim(),
        user: req.user
      })
    });
  })
);

reportsRouter.get(
  '/referee-names',
  asyncHandler(async (req, res) => {
    res.json({ names: await listRefereeNames(req.user) });
  })
);

// Coda "da compilare" per l'utente corrente: gare dove è osservatore designato
// e non c'è ancora un rapporto. Vale per osservatori, formatori e admin.
reportsRouter.get(
  '/pending-games',
  asyncHandler(async (req, res) => {
    res.json({
      games: await listPendingAssignmentsForUser(req.user?.id, String(req.query.season || '').trim())
    });
  })
);

reportsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    res.json({ report: await getReport(Number(req.params.id), req.user) });
  })
);

reportsRouter.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const report = await updateReport({
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
    await deleteReport(Number(req.params.id), req.user);
    res.json({ ok: true });
  })
);

reportsRouter.post(
  '/:id/export',
  asyncHandler(async (req, res) => {
    const report = await getReport(Number(req.params.id), req.user);
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

    const report = await getReport(Number(req.params.id), req.user);

    if (req.user?.role === 'referee') {
      const myRefereeId = req.user.refereeId;
      const requestedRefereeId = role === 'first' ? report.firstRefereeId : report.secondRefereeId;
      if (!myRefereeId || requestedRefereeId !== myRefereeId) {
        throw new HttpError(403, 'PDF non accessibile.');
      }
    }

    const { fileName } = await getPdfFileInfo(report, role);
    const buffer = await buildReportPdf(report, role);

    const inline = req.query.inline === '1' || req.query.inline === 'true';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${fileName}"`);
    res.end(buffer);
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
