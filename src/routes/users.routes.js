import express from 'express';
import {
  createUser,
  listUsers,
  resetUserPassword,
  updateUser
} from '../services/userService.js';
import { asyncHandler, HttpError } from '../utils/httpError.js';

export const usersRouter = express.Router();

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
      password: req.body?.password,
      displayName: req.body?.displayName,
      role: req.body?.role,
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
      refereeId: req.body?.refereeId,
      instructorAssignments: req.body?.instructorAssignments,
      instructorCompetition: req.body?.instructorCompetition,
      formatterCompetition: req.body?.formatterCompetition,
      active: req.body?.active
    });
    res.json({ user });
  })
);

usersRouter.post(
  '/:id/password',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw new HttpError(400, 'ID utente non valido.');

    const user = await resetUserPassword({
      id,
      password: req.body?.password
    });
    res.json({ user });
  })
);
