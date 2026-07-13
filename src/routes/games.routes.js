import express from 'express';
import { requireAdmin, requireAdminOrInstructor } from '../middleware/auth.js';
import { asyncHandler, HttpError } from '../utils/httpError.js';
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
  gameForReportPrefill,
  assertGameCompetitionAccess
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

export const gamesRouter = express.Router();

// Le designazioni sono dati interni: la sezione gare è riservata ad admin e
// formatori. Gli osservatori possono raggiungere solo il prefill di una gara per
// compilarne il rapporto; arbitri esclusi del tutto.
gamesRouter.use((req, _res, next) => {
  const role = req.user?.role;
  if (role === 'admin' || role === 'instructor') {
    next();
    return;
  }
  if (role === 'observer' && req.method === 'GET' && /\/report-prefill$/.test(req.path)) {
    next();
    return;
  }
  next(new HttpError(403, 'Sezione gare non disponibile per questo ruolo.'));
});

// Campionati a cui il formatore è ristretto ([] = admin, nessuna restrizione).
function scopedCompetitions(req) {
  return req.user?.role === 'instructor' ? req.user.instructorCompetitions || [] : [];
}

function repeatedParam(req, name) {
  const raw = req.query[name];
  if (raw === undefined || raw === null || raw === '') return [];
  return (Array.isArray(raw) ? raw : [raw]).map((value) => String(value).trim()).filter(Boolean);
}

gamesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json({
      games: await listGames({
        season: String(req.query.season || '').trim(),
        matchday: String(req.query.matchday || '').trim(),
        status: String(req.query.status || '').trim(),
        search: String(req.query.search || '').trim(),
        refereeId: req.query.refereeId ? Number(req.query.refereeId) : null,
        observerUserId: req.query.observerUserId ? Number(req.query.observerUserId) : null,
        uncoveredOnly: req.query.uncovered === 'true',
        sourceId: req.query.sourceId ? Number(req.query.sourceId) : null,
        competitions: scopedCompetitions(req)
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
  requireAdminOrInstructor,
  asyncHandler(async (_req, res) => {
    res.json({ observers: await listAssignableObservers() });
  })
);

gamesRouter.get(
  '/export',
  requireAdminOrInstructor,
  asyncHandler(async (req, res) => {
    const season = String(req.query.season || '').trim();
    const allowedStates = new Set(['arbitri_mancanti', 'scoperta', 'rapporto_mancante']);
    const stateFilters = repeatedParam(req, 'states').filter((state) => allowedStates.has(state));
    const workbook = await buildGamesWorkbook({
      season,
      competitions: scopedCompetitions(req),
      matchday: String(req.query.matchday || '').trim(),
      stateFilters,
      sourceNames: repeatedParam(req, 'sources'),
      refereeId: req.query.refereeId ? Number(req.query.refereeId) : null,
      search: String(req.query.search || '')
    });
    const fileName = `gare_${(season || 'tutte').replace('/', '-')}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    await workbook.xlsx.write(res);
    res.end();
  })
);

gamesRouter.post('/aliases', requireAdmin, asyncHandler(async (req, res) => {
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
  requireAdminOrInstructor,
  asyncHandler(async (req, res) => {
    const name = String(req.query.name || '');
    res.json({
      candidates: req.query.type === 'observer' ? await listObserverCandidates(name) : await listRefereeCandidates(name)
    });
  })
);

gamesRouter.get('/:id', asyncHandler(async (req, res) => {
  await assertGameCompetitionAccess(Number(req.params.id), scopedCompetitions(req));
  res.json({ game: await getGame(Number(req.params.id)) });
}));

gamesRouter.get('/:id/report-prefill', asyncHandler(async (req, res) => {
  await assertGameCompetitionAccess(Number(req.params.id), scopedCompetitions(req));
  res.json({ prefill: await gameForReportPrefill(Number(req.params.id)) });
}));

gamesRouter.get('/:id/observer-suggestions', requireAdminOrInstructor, asyncHandler(async (req, res) => {
  await assertGameCompetitionAccess(Number(req.params.id), scopedCompetitions(req));
  res.json({ suggestions: await getObserverSuggestions({ gameId: Number(req.params.id) }) });
}));

gamesRouter.post('/', requireAdminOrInstructor, asyncHandler(async (req, res) => {
  // Il formatore può creare gare solo nei propri campionati.
  const comps = scopedCompetitions(req);
  if (comps.length && !comps.includes(String(req.body?.competition || '').trim())) {
    throw new HttpError(403, 'Puoi creare gare solo nei campionati assegnati alla tua utenza.');
  }
  const game = await createGame({ data: req.body || {}, user: req.user, source: 'manual' });
  res.status(201).json({ game });
}));

gamesRouter.put('/:id', requireAdminOrInstructor, asyncHandler(async (req, res) => {
  await assertGameCompetitionAccess(Number(req.params.id), scopedCompetitions(req));
  const game = await updateGame(Number(req.params.id), req.body || {}, {
    user: req.user,
    source: 'manual',
    reason: String(req.body?.reason || '').trim() || null,
    force: req.body?.force === true
  });
  res.json({ game });
}));

gamesRouter.delete('/:id', requireAdmin, asyncHandler(async (req, res) => {
  await deleteGame(Number(req.params.id), { user: req.user });
  res.json({ ok: true });
}));

gamesRouter.put('/:id/officials/:role', requireAdminOrInstructor, asyncHandler(async (req, res) => {
  await assertGameCompetitionAccess(Number(req.params.id), scopedCompetitions(req));
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

gamesRouter.delete('/:id/officials/:role', requireAdminOrInstructor, asyncHandler(async (req, res) => {
  await assertGameCompetitionAccess(Number(req.params.id), scopedCompetitions(req));
  const game = await removeOfficial(Number(req.params.id), String(req.params.role), { user: req.user });
  res.json({ game });
}));
