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
  getBandRow,
  REFEREE_BANDS
} from '../services/refereeService.js';
import { buildRefereeRankingWorkbook, buildRefereesWorkbook } from '../services/refereesExportService.js';
import { currentSportSeason } from '../../shared/reportTemplate.js';
import {
  instructorAssignmentsForUser,
  instructorCompetitionsForSeason
} from '../../shared/instructorAssignments.js';

export const refereesRouter = express.Router();

function scopedCompetitions(req, season = '') {
  if (req.user?.role === 'instructor') {
    return instructorCompetitionsForSeason(req.user, season || String(req.query.season || '').trim() || currentSportSeason());
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
    const competitions = scopedCompetitions(req, String(season).trim());
    if (req.user?.role === 'instructor' && !competitions.length) {
      res.json({ referees: [] });
      return;
    }
    res.json({
      referees: await listReferees({
        competitions,
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
    if (req.user?.role === 'instructor' && Array.isArray(req.user.instructorAssignments)) {
      res.json({ seasons: instructorAssignmentsForUser(req.user).map((assignment) => assignment.sportSeason) });
      return;
    }
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
        competitions: scopedCompetitions(req, String(req.query.season || '').trim())
      })
    });
  })
);

refereesRouter.get(
  '/ranking/export',
  asyncHandler(async (req, res) => {
    requireRefereeInspection(req);
    const season = String(req.query.season || '').trim() || currentSportSeason();
    const workbook = await buildRefereeRankingWorkbook({
      season,
      competitions: scopedCompetitions(req, season)
    });
    const fileName = `classifica_arbitri_${season.replace('/', '-')}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    await workbook.xlsx.write(res);
    res.end();
  })
);

refereesRouter.get(
  '/export',
  asyncHandler(async (req, res) => {
    requireRefereeInspection(req);
    const season = String(req.query.season || '').trim() || currentSportSeason();
    const requestedBand = String(req.query.band || '').trim();
    const activeFilter = ['0', '1'].includes(String(req.query.active || ''))
      ? String(req.query.active)
      : '';
    const workbook = await buildRefereesWorkbook({
      season,
      competitions: scopedCompetitions(req, season),
      activeFilter,
      band: REFEREE_BANDS.includes(requestedBand) ? requestedBand : '',
      search: String(req.query.search || '')
    });
    const fileName = `anagrafica_arbitri_${season.replace('/', '-')}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    await workbook.xlsx.write(res);
    res.end();
  })
);

// Fasce (esordienti/playoff/playout). Il campionato richiesto è rispettato ma
// vincolato al perimetro del formatore.
function effectiveBandCompetitions(req) {
  const requested = String(req.query.competition || '').trim();
  if (req.user?.role === 'instructor') {
    const allowed = scopedCompetitions(req);
    if (requested) {
      if (!allowed.includes(requested)) throw new HttpError(403, 'Campionato non assegnato alla tua utenza.');
      return [requested];
    }
    return allowed;
  }
  return requested ? [requested] : [];
}

function assertBandManage(req, competition, season = '') {
  if (req.user?.role === 'admin') return;
  if (req.user?.role === 'instructor') {
    const comps = scopedCompetitions(req, season);
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
  assertBandManage(req, competition, String(req.body?.sportSeason || '').trim());
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
  assertBandManage(req, row.competition, row.sport_season);
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
    await getReferee(id, {
      season: String(req.query.season || '').trim(),
      competitions: scopedCompetitions(req, String(req.query.season || '').trim())
    });
  }
  const season = String(req.query.season || '').trim();
  res.json({
    progress: await getRefereeProgress(id, {
      season,
      competitions: req.user?.role === 'instructor' ? scopedCompetitions(req, season) : []
    })
  });
}));

refereesRouter.get('/:id', asyncHandler(async (req, res) => {
  requireRefereeInspection(req);
  res.json({
    referee: await getReferee(Number(req.params.id), {
      season: String(req.query.season || '').trim(),
      competitions: scopedCompetitions(req, String(req.query.season || '').trim())
    })
  });
}));

refereesRouter.post('/', requireAdmin, asyncHandler(async (req, res) => {
  const referee = await createReferee(req.body);
  res.status(201).json({ referee });
}));

refereesRouter.put('/:id', asyncHandler(async (req, res) => {
  if (req.user?.role !== 'admin' && req.user?.role !== 'instructor') {
    throw new HttpError(403, 'Permessi insufficienti per modificare l’arbitro.');
  }
  if (req.user.role === 'instructor') {
    const competitions = scopedCompetitions(req, String(req.body?.sportSeason || '').trim());
    await getReferee(Number(req.params.id), {
      season: String(req.body?.sportSeason || '').trim(),
      competitions
    });
    const nextCategory = String(req.body?.category || '').trim();
    if (req.body?.category !== undefined && nextCategory && !competitions.includes(nextCategory)) {
      throw new HttpError(403, 'Puoi assegnare solo uno dei tuoi campionati.');
    }
  }
  const id = Number(req.params.id);
  await updateReferee(id, req.body);
  const season = String(req.body?.sportSeason || '').trim();
  res.json({
    referee: await getReferee(id, {
      season,
      competitions: req.user?.role === 'instructor' ? scopedCompetitions(req, season) : []
    })
  });
}));

refereesRouter.get('/:id/rosters', asyncHandler(async (req, res) => {
  requireRefereeInspection(req);
  await getReferee(Number(req.params.id), {
    season: String(req.query.season || '').trim(),
    competitions: scopedCompetitions(req, String(req.query.season || '').trim())
  });
  const rosters = await listRosters(Number(req.params.id));
  if (req.user?.role === 'instructor') {
    const season = String(req.query.season || '').trim() || currentSportSeason();
    const competitions = scopedCompetitions(req, season);
    res.json({
      rosters: rosters.filter((roster) => roster.sport_season === season && competitions.includes(roster.competition))
    });
    return;
  }
  res.json({ rosters });
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
