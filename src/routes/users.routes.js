import express from 'express';
import {
  createUser,
  listUsers,
  updateUser
} from '../services/userService.js';
import { createAccountLink, revokeAccountLinks, listAuthEvents } from '../services/accountService.js';
import { authWriteGuard, authRateLimit } from '../middleware/authSecurity.js';
import { asyncHandler, HttpError } from '../utils/httpError.js';

export const usersRouter = express.Router();
usersRouter.use(authWriteGuard);
usersRouter.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

usersRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json({ users: await listUsers() });
  })
);

usersRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const user = await createUser({
      username: req.body?.username,
      displayName: req.body?.displayName,
      role: req.body?.role,
      roles: req.body?.roles,
      refereeId: req.body?.refereeId,
      instructorAssignments: req.body?.instructorAssignments,
      instructorCompetition: req.body?.instructorCompetition,
      formatterCompetition: req.body?.formatterCompetition
    });
    res.status(201).json({ user });
  })
);

usersRouter.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw new HttpError(400, 'ID utente non valido.');

    const user = await updateUser({
      id,
      displayName: req.body?.displayName,
      role: req.body?.role,
      roles: req.body?.roles,
      refereeId: req.body?.refereeId,
      instructorAssignments: req.body?.instructorAssignments,
      instructorCompetition: req.body?.instructorCompetition,
      formatterCompetition: req.body?.formatterCompetition,
      active: req.body?.active
    });
    res.json({ user });
  })
);

usersRouter.post('/:id/invitation', authRateLimit('admin-invite', 60), asyncHandler(async (req, res) => {
  const userId = Number(req.params.id);
  if (!Number.isInteger(userId) || userId < 1) throw new HttpError(400, 'ID utente non valido.');
  const invitation = await createAccountLink({ userId, kind: req.body?.kind, actorId: req.user.id, resetGoogle: req.body?.resetGoogle });
  res.status(201).json({ invitation });
}));
usersRouter.delete('/:id/invitation', asyncHandler(async (req, res) => {
  await revokeAccountLinks(Number(req.params.id), req.user.id);
  res.json({ ok: true });
}));
usersRouter.get('/:id/auth-events', asyncHandler(async (req, res) => {
  res.json({ events: await listAuthEvents(Number(req.params.id)) });
}));
