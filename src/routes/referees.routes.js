import express from 'express';
import { requireAdmin } from '../middleware/auth.js';
import { asyncHandler, HttpError } from '../utils/httpError.js';
import {
  listReferees,
  getReferee,
  createReferee,
  getRefereeRanking,
  getRefereeProgress,
  listSeasons,
  updateReferee,
  listRosters,
  addRoster,
  removeRoster,
  listBandMembers,
  addBandMember,
  removeBandMember,
  getBandRow
} from '../services/refereeService.js';

export const refereesRouter = express.Router();

function scopedCompetitions(req) {
  if (req.user?.role === 'instructor' && req.user?.instructorCompetitions?.length) {
    return req.user.instructorCompetitions;
  }
  if (req.user?.role === 'instructor' && req.user?.instructorCompetition) {
    return [req.user.instructorCompetition];
  }
  const competition = String(req.query.competition || '').trim();
  return competition ? [competition] : [];
}

function requireRefereeInspection(req) {
  if (req.user?.role === 'admin') return;
  if (req.user?.role === 'instructor' && scopedCompetitions(req).length) return;
  throw new HttpError(403, 'Sezione arbitri non abilitata per questa utenza.');
}

refereesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { season = '', activeOnly = '' } = req.query;
    if (req.user?.role === 'referee') {
      res.json({ referees: [] });
      return;
    }
    if (req.user?.role === 'observer' && !String(req.query.competition || '').trim()) {
      res.json({ referees: [] });
      return;
    }
    res.json({
      referees: await listReferees({
        competitions: scopedCompetitions(req),
        season: String(season).trim(),
        activeOnly: activeOnly === 'true'
      })
    });
  })
);

refereesRouter.get(
  '/seasons',
  asyncHandler(async (req, res) => {
    requireRefereeInspection(req);
    res.json({ seasons: await listSeasons({ competitions: scopedCompetitions(req) }) });
  })
);

refereesRouter.get(
  '/ranking',
  asyncHandler(async (req, res) => {
    requireRefereeInspection(req);
    res.json({
      ranking: await getRefereeRanking({
        season: String(req.query.season || '').trim(),
        competitions: scopedCompetitions(req)
      })
    });
  })
);

// Fasce (esordienti/playoff/playout). Il campionato richiesto è rispettato ma
// vincolato al perimetro del formatore.
function effectiveBandCompetitions(req) {
  const requested = String(req.query.competition || '').trim();
  if (req.user?.role === 'instructor') {
    const allowed = req.user.instructorCompetitions?.length
      ? req.user.instructorCompetitions
      : (req.user.instructorCompetition ? [req.user.instructorCompetition] : []);
    if (requested) {
      if (!allowed.includes(requested)) throw new HttpError(403, 'Campionato non assegnato alla tua utenza.');
      return [requested];
    }
    return allowed;
  }
  return requested ? [requested] : [];
}

function assertBandManage(req, competition) {
  if (req.user?.role === 'admin') return;
  if (req.user?.role === 'instructor') {
    const comps = req.user.instructorCompetitions || [];
    if (comps.includes(competition)) return;
    throw new HttpError(403, 'Campionato non assegnato alla tua utenza.');
  }
  throw new HttpError(403, 'Permessi insufficienti per gestire le fasce.');
}

refereesRouter.get('/bands', asyncHandler(async (req, res) => {
  requireRefereeInspection(req);
  res.json({
    members: await listBandMembers({
      competitions: effectiveBandCompetitions(req),
      season: String(req.query.season || '').trim(),
      band: String(req.query.band || '').trim()
    })
  });
}));

refereesRouter.post('/:id/bands', asyncHandler(async (req, res) => {
  const competition = String(req.body?.competition || '').trim();
  assertBandManage(req, competition);
  const members = await addBandMember({
    refereeId: Number(req.params.id),
    competition,
    sportSeason: req.body?.sportSeason,
    band: req.body?.band
  });
  res.status(201).json({ members });
}));

refereesRouter.delete('/bands/:bandId', asyncHandler(async (req, res) => {
  const row = await getBandRow(Number(req.params.bandId));
  if (!row) {
    res.json({ ok: true });
    return;
  }
  assertBandManage(req, row.competition);
  await removeBandMember(Number(req.params.bandId));
  res.json({ ok: true });
}));

refereesRouter.get('/:id/progress', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  // Auth: admin sempre; referee solo per il proprio id; instructor se ha visibilità sull'arbitro
  if (req.user?.role === 'referee') {
    if (req.user.refereeId !== id) {
      throw new HttpError(403, 'Non puoi accedere a questo andamento.');
    }
  } else {
    requireRefereeInspection(req);
    // Verifica visibilità per l'instructor
    await getReferee(id, { competitions: scopedCompetitions(req) });
  }
  res.json({ progress: await getRefereeProgress(id, { season: String(req.query.season || '').trim() }) });
}));

refereesRouter.get('/:id', asyncHandler(async (req, res) => {
  requireRefereeInspection(req);
  res.json({
    referee: await getReferee(Number(req.params.id), {
      season: String(req.query.season || '').trim(),
      competitions: scopedCompetitions(req)
    })
  });
}));

refereesRouter.post('/', requireAdmin, asyncHandler(async (req, res) => {
  const referee = await createReferee(req.body);
  res.status(201).json({ referee });
}));

refereesRouter.put('/:id', requireAdmin, asyncHandler(async (req, res) => {
  const referee = await updateReferee(Number(req.params.id), req.body);
  res.json({ referee });
}));

refereesRouter.get('/:id/rosters', asyncHandler(async (req, res) => {
  requireRefereeInspection(req);
  await getReferee(Number(req.params.id), { competitions: scopedCompetitions(req) });
  res.json({ rosters: await listRosters(Number(req.params.id)) });
}));

refereesRouter.post('/:id/rosters', requireAdmin, asyncHandler(async (req, res) => {
  const rosters = await addRoster(Number(req.params.id), {
    competition: req.body?.competition,
    sportSeason: req.body?.sportSeason
  });
  res.status(201).json({ rosters });
}));

refereesRouter.delete('/:id/rosters/:rosterId', requireAdmin, asyncHandler(async (req, res) => {
  await removeRoster(Number(req.params.id), Number(req.params.rosterId));
  res.json({ ok: true });
}));
