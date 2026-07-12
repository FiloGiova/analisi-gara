import express from 'express';
import { asyncHandler, HttpError } from '../utils/httpError.js';
import { getCoverage, getMatrix, getMatrixDetail, getEmployment } from '../services/statsService.js';
import { REFEREE_BANDS } from '../services/refereeService.js';
import { currentSportSeason } from '../../shared/reportTemplate.js';

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
    const allowed = req.user.instructorCompetitions || [];
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

statsRouter.get('/coverage', asyncHandler(async (req, res) => {
  res.json(await getCoverage({ season: seasonParam(req), competitions: effectiveCompetitions(req), band: bandParam(req) }));
}));

statsRouter.get('/employment', asyncHandler(async (req, res) => {
  res.json(await getEmployment({ season: seasonParam(req), competitions: effectiveCompetitions(req), band: bandParam(req) }));
}));

statsRouter.get('/matrix', asyncHandler(async (req, res) => {
  res.json(await getMatrix({ season: seasonParam(req), competitions: effectiveCompetitions(req), band: bandParam(req) }));
}));

statsRouter.get('/matrix-detail', asyncHandler(async (req, res) => {
  res.json(
    await getMatrixDetail({
      season: seasonParam(req),
      competitions: effectiveCompetitions(req),
      observerKey: String(req.query.observerKey || ''),
      refereeId: Number(req.query.refereeId)
    })
  );
}));
