import express from 'express';
import { asyncHandler, HttpError } from '../utils/httpError.js';
import { getCoverage, getMatrix, getMatrixDetail, getEmployment, listStatsPhases } from '../services/statsService.js';
import { buildStatsWorkbook } from '../services/statsExportService.js';
import { REFEREE_BANDS } from '../services/refereeService.js';
import { currentSportSeason } from '../../shared/reportTemplate.js';
import { instructorCompetitionsForSeason } from '../../shared/instructorAssignments.js';

// Montato con requireAuth + requireAdminOrInstructor in server.js.
export const statsRouter = express.Router();

function seasonParam(req) {
  return String(req.query.season || '').trim() || currentSportSeason();
}

// Campionati effettivi da mostrare, applicando lo scoping del formatore:
// - admin: il campionato richiesto, oppure tutti (array vuoto);
// - formatore: solo i suoi campionati (il richiesto, se tra i suoi, altrimenti 403).
function effectiveCompetitions(req) {
  const requested = String(req.query.competition || '').trim();
  if (req.user?.role === 'instructor') {
    const allowed = instructorCompetitionsForSeason(req.user, seasonParam(req));
    if (!allowed.length) {
      throw new HttpError(403, 'Nessun campionato assegnato alla tua utenza per questa stagione.');
    }
    if (requested) {
      if (!allowed.includes(requested)) {
        throw new HttpError(403, 'Campionato non assegnato alla tua utenza.');
      }
      return [requested];
    }
    return allowed;
  }
  return requested ? [requested] : [];
}

function bandParam(req) {
  const band = String(req.query.band || '').trim();
  return REFEREE_BANDS.includes(band) ? band : '';
}

function phaseIdsParam(req) {
  const raw = req.query.phases || '';
  const values = Array.isArray(raw) ? raw : String(raw).split(',');
  return [...new Set(values.map(Number).filter((value) => Number.isInteger(value) && value > 0))];
}

statsRouter.get('/phases', asyncHandler(async (req, res) => {
  res.json({ phases: await listStatsPhases({ season: seasonParam(req), competitions: effectiveCompetitions(req) }) });
}));

statsRouter.get('/coverage', asyncHandler(async (req, res) => {
  res.json(await getCoverage({
    season: seasonParam(req),
    competitions: effectiveCompetitions(req),
    band: bandParam(req),
    phaseIds: phaseIdsParam(req)
  }));
}));

statsRouter.get('/employment', asyncHandler(async (req, res) => {
  res.json(await getEmployment({
    season: seasonParam(req),
    competitions: effectiveCompetitions(req),
    band: bandParam(req),
    phaseIds: phaseIdsParam(req)
  }));
}));

statsRouter.get('/matrix', asyncHandler(async (req, res) => {
  res.json(await getMatrix({
    season: seasonParam(req),
    competitions: effectiveCompetitions(req),
    band: bandParam(req),
    phaseIds: phaseIdsParam(req)
  }));
}));

statsRouter.get('/export', asyncHandler(async (req, res) => {
  const view = String(req.query.view || 'coverage').trim();
  const season = seasonParam(req);
  const workbook = await buildStatsWorkbook({
    view,
    season,
    competitions: effectiveCompetitions(req),
    band: bandParam(req),
    phaseIds: phaseIdsParam(req),
    search: String(req.query.search || ''),
    sortKey: String(req.query.sort || ''),
    sortDirection: String(req.query.direction || '')
  });
  const viewNames = { coverage: 'copertura', matrix: 'matrice', employment: 'impiego' };
  const fileName = `statistiche_${viewNames[view] || 'fischiolab'}_${season.replace('/', '-')}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  await workbook.xlsx.write(res);
  res.end();
}));

statsRouter.get('/matrix-detail', asyncHandler(async (req, res) => {
  res.json(
    await getMatrixDetail({
      season: seasonParam(req),
      competitions: effectiveCompetitions(req),
      phaseIds: phaseIdsParam(req),
      observerKey: String(req.query.observerKey || ''),
      refereeId: Number(req.query.refereeId)
    })
  );
}));
