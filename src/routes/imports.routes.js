import express from 'express';
import multer from 'multer';
import { asyncHandler, HttpError } from '../utils/httpError.js';
import {
  buildDesignationsTemplate,
  parseDesignationsWorkbook,
  previewDesignationsImport,
  applyDesignationsImport
} from '../services/xlsxService.js';
import { currentSportSeason } from '../../shared/reportTemplate.js';

// Montato con requireAuth + requireAdmin in server.js.
export const importsRouter = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024 }
});

function seasonParam(req) {
  return String(req.query.season || req.body?.sportSeason || '').trim() || currentSportSeason();
}

function phaseIdsParam(req) {
  const raw = req.query.phases || '';
  const values = Array.isArray(raw) ? raw : String(raw).split(',');
  return [...new Set(values.map(Number).filter((value) => Number.isInteger(value) && value > 0))];
}

// Template XLSX per il designatore: un foglio per giornata, sempre rigenerato
// con i dati correnti (quindi riscaricabile dopo ogni modifica).
importsRouter.get('/template', asyncHandler(async (req, res) => {
  const season = seasonParam(req);
  const phaseIds = phaseIdsParam(req);
  const workbook = await buildDesignationsTemplate(season, { phaseIds });
  const phaseSuffix = phaseIds.length ? `_fasi-${phaseIds.join('-')}` : '';
  const fileName = `designazioni_${season.replace('/', '-')}${phaseSuffix}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  await workbook.xlsx.write(res);
  res.end();
}));

importsRouter.post('/preview', upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file?.buffer) throw new HttpError(400, 'Nessun file caricato.');
  const rows = await parseDesignationsWorkbook(req.file.buffer);
  const preview = await previewDesignationsImport({ sportSeason: seasonParam(req), rows });
  res.json({ sportSeason: seasonParam(req), ...preview });
}));

importsRouter.post('/apply', asyncHandler(async (req, res) => {
  const result = await applyDesignationsImport({
    sportSeason: String(req.body?.sportSeason || '').trim() || currentSportSeason(),
    rows: req.body?.rows,
    user: req.user
  });
  res.json({ result });
}));
