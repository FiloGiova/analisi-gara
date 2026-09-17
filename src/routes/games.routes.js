import express from 'express';
import { requireAnyCapability, requireCapability } from '../middleware/auth.js';
import { asyncHandler, HttpError } from '../utils/httpError.js';
import { buildDesignationsWorkbook, designationsFileName } from '../services/designationsExportService.js';
import { isValidIsoDate } from '../../shared/gamePeriod.js';
import {
  listGames,
  listGameSeasons,
  getGame,
  createGame,
  updateGame,
  deleteGame,
  setOfficial,
  removeOfficial,
  listAssignableObservers,
  gameForReportPrefill
} from '../services/gameService.js';
import {
  saveRefereeAlias,
  applyRefereeAliasToOfficials,
  listRefereeCandidates,
  saveObserverAlias,
  applyObserverAliasToOfficials,
  listObserverCandidates
} from '../services/nameMatching.js';
import { getObserverSuggestions } from '../services/statsService.js';
import { buildGamesWorkbook } from '../services/gamesExportService.js';
import { currentSportSeason } from '../../shared/reportTemplate.js';
import { instructorCompetitionsForSeason } from '../../shared/instructorAssignments.js';
import { can, hasRole } from '../../shared/permissions.js';

export const gamesRouter = express.Router();
const NO_INSTRUCTOR_SCOPE = '__no_instructor_scope__';

// Le designazioni sono dati interni: entra chi gestisce le gare (admin,
// operatore, formatore) o chi designa. Gli osservatori possono raggiungere solo
// il prefill di una gara per compilarne il rapporto; arbitri esclusi del tutto.
gamesRouter.use((req, _res, next) => {
  if (can(req.user, 'games:manage') || can(req.user, 'designations:assign')) {
    next();
    return;
  }
  if (can(req.user, 'reports:write') && req.method === 'GET' && /\/report-prefill$/.test(req.path)) {
    next();
    return;
  }
  next(new HttpError(403, 'Sezione gare non disponibile per questo ruolo.'));
});

// Campionati a cui il formatore è ristretto ([] = admin, nessuna restrizione).
function scopedCompetitions(req, season = '') {
  if (!hasRole(req.user, 'instructor')) return [];
  const competitions = instructorCompetitionsForSeason(req.user, season || currentSportSeason());
  return competitions.length ? competitions : [NO_INSTRUCTOR_SCOPE];
}

async function gameWithAccess(req, id) {
  const game = await getGame(id);
  if (hasRole(req.user, 'instructor')) {
    const allowed = scopedCompetitions(req, game.sportSeason);
    const isDesignatedObserver = game.officials?.observer?.userId === req.user.id;
    if (!allowed.includes(game.competition || '') && !isDesignatedObserver) {
      throw new HttpError(403, 'Gara fuori dai campionati assegnati alla tua utenza per questa stagione.');
    }
  }
  return game;
}

function repeatedParam(req, name) {
  const raw = req.query[name];
  if (raw === undefined || raw === null || raw === '') return [];
  return (Array.isArray(raw) ? raw : [raw]).map((value) => String(value).trim()).filter(Boolean);
}

gamesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const requestedSeason = String(req.query.season || '').trim();
    const season = requestedSeason || (hasRole(req.user, 'instructor') ? currentSportSeason() : '');
    res.json({
      games: await listGames({
        season,
        matchday: String(req.query.matchday || '').trim(),
        status: String(req.query.status || '').trim(),
        search: String(req.query.search || '').trim(),
        refereeId: req.query.refereeId ? Number(req.query.refereeId) : null,
        observerUserId: req.query.observerUserId ? Number(req.query.observerUserId) : null,
        uncoveredOnly: req.query.uncovered === 'true',
        sourceId: req.query.sourceId ? Number(req.query.sourceId) : null,
        competitions: scopedCompetitions(req, season)
      })
    });
  })
);

gamesRouter.get(
  '/seasons',
  asyncHandler(async (_req, res) => {
    res.json({ seasons: await listGameSeasons() });
  })
);

gamesRouter.get(
  '/observers',
  requireCapability('designations:assign'),
  asyncHandler(async (_req, res) => {
    res.json({ observers: await listAssignableObservers() });
  })
);

// Le date arrivano dai filtri del client: si accettano solo ISO valide, il
// resto equivale a "nessun limite".
function periodParam(req, name) {
  const value = String(req.query[name] || '').trim();
  return isValidIsoDate(value) ? value : '';
}

gamesRouter.get(
  '/designations/export',
  requireCapability('designations:assign'),
  asyncHandler(async (req, res) => {
    const season = String(req.query.season || '').trim() || (hasRole(req.user, 'instructor') ? currentSportSeason() : '');
    const dateFrom = periodParam(req, 'dateFrom');
    const dateTo = periodParam(req, 'dateTo');
    const competition = String(req.query.competition || '').trim();
    const workbook = await buildDesignationsWorkbook({
      season,
      competitions: scopedCompetitions(req, season),
      competition,
      sourceNames: repeatedParam(req, 'sources'),
      matchdays: repeatedParam(req, 'matchdays'),
      dateFrom,
      dateTo,
      onlyAssigned: req.query.onlyAssigned === '1' || req.query.onlyAssigned === 'true'
    });
    const fileName = designationsFileName({ season, competition, dateFrom, dateTo });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    await workbook.xlsx.write(res);
    res.end();
  })
);

gamesRouter.get(
  '/export',
  requireCapability('games:manage'),
  asyncHandler(async (req, res) => {
    const season = String(req.query.season || '').trim() || (hasRole(req.user, 'instructor') ? currentSportSeason() : '');
    const workbook = await buildGamesWorkbook({
      season,
      competitions: scopedCompetitions(req, season),
      competition: String(req.query.competition || '').trim(),
      matchday: String(req.query.matchday || '').trim(),
      sourceNames: repeatedParam(req, 'sources'),
      refereeId: req.query.refereeId ? Number(req.query.refereeId) : null,
      search: String(req.query.search || ''),
      dateFrom: periodParam(req, 'dateFrom'),
      dateTo: periodParam(req, 'dateTo')
    });
    const fileName = `gare_${(season || 'tutte').replace('/', '-')}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    await workbook.xlsx.write(res);
    res.end();
  })
);

gamesRouter.post('/aliases', requireCapability('aliases:manage'), asyncHandler(async (req, res) => {
  const { source, externalName, refereeId, userId } = req.body || {};
  if (!['fip_public', 'xlsx'].includes(String(source))) {
    throw new HttpError(400, 'Origine alias non valida.');
  }
  if (userId) {
    const alias = await saveObserverAlias({
      source: String(source),
      externalName: String(externalName || ''),
      userId: Number(userId),
      verifiedBy: req.user?.id || null
    });
    const updatedOfficials = await applyObserverAliasToOfficials({
      source: String(source),
      externalName: String(externalName || ''),
      userId: Number(userId),
      user: req.user
    });
    res.status(201).json({ alias, updatedOfficials });
    return;
  }
  const alias = await saveRefereeAlias({
    source: String(source),
    externalName: String(externalName || ''),
    refereeId: Number(refereeId),
    verifiedBy: req.user?.id || null
  });
  const updatedOfficials = await applyRefereeAliasToOfficials({
    source: String(source),
    externalName: String(externalName || ''),
    refereeId: Number(refereeId),
    user: req.user
  });
  res.status(201).json({ alias, updatedOfficials });
}));

gamesRouter.get(
  '/alias-candidates',
  requireAnyCapability('aliases:manage', 'designations:assign'),
  asyncHandler(async (req, res) => {
    const name = String(req.query.name || '');
    res.json({
      candidates: req.query.type === 'observer' ? await listObserverCandidates(name) : await listRefereeCandidates(name)
    });
  })
);

gamesRouter.get('/:id', asyncHandler(async (req, res) => {
  res.json({ game: await gameWithAccess(req, Number(req.params.id)) });
}));

gamesRouter.get('/:id/report-prefill', asyncHandler(async (req, res) => {
  await gameWithAccess(req, Number(req.params.id));
  res.json({ prefill: await gameForReportPrefill(Number(req.params.id)) });
}));

gamesRouter.get('/:id/observer-suggestions', requireCapability('designations:assign'), asyncHandler(async (req, res) => {
  await gameWithAccess(req, Number(req.params.id));
  res.json({ suggestions: await getObserverSuggestions({ gameId: Number(req.params.id) }) });
}));

gamesRouter.post('/', requireCapability('games:manage'), asyncHandler(async (req, res) => {
  // Il formatore può creare gare solo nei propri campionati.
  const comps = scopedCompetitions(req, String(req.body?.sportSeason || '').trim());
  if (comps.length && !comps.includes(String(req.body?.competition || '').trim())) {
    throw new HttpError(403, 'Puoi creare gare solo nei campionati assegnati alla tua utenza.');
  }
  const game = await createGame({ data: req.body || {}, user: req.user, source: 'manual' });
  res.status(201).json({ game });
}));

gamesRouter.put('/:id', requireCapability('games:manage'), asyncHandler(async (req, res) => {
  await gameWithAccess(req, Number(req.params.id));
  const game = await updateGame(Number(req.params.id), req.body || {}, {
    user: req.user,
    source: 'manual',
    reason: String(req.body?.reason || '').trim() || null,
    force: req.body?.force === true
  });
  res.json({ game });
}));

gamesRouter.delete('/:id', requireCapability('games:delete'), asyncHandler(async (req, res) => {
  await deleteGame(Number(req.params.id), { user: req.user });
  res.json({ ok: true });
}));

gamesRouter.put('/:id/officials/:role', requireCapability('designations:assign'), asyncHandler(async (req, res) => {
  await gameWithAccess(req, Number(req.params.id));
  const game = await setOfficial(
    Number(req.params.id),
    {
      role: String(req.params.role),
      refereeId: req.body?.refereeId ?? null,
      userId: req.body?.userId ?? null,
      externalName: String(req.body?.externalName || ''),
      source: 'manual',
      status: req.body?.status === 'provisional' ? 'provisional' : 'confirmed',
      manualLock: req.body?.manualLock === true
    },
    { user: req.user, reason: String(req.body?.reason || '').trim() || null }
  );
  res.json({ game });
}));

gamesRouter.delete('/:id/officials/:role', requireCapability('designations:assign'), asyncHandler(async (req, res) => {
  await gameWithAccess(req, Number(req.params.id));
  const game = await removeOfficial(Number(req.params.id), String(req.params.role), { user: req.user });
  res.json({ game });
}));
