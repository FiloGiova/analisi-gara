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
    res.json({ users: listUsers() });
  })
);

usersRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const user = createUser({
      username: req.body?.username,
      password: req.body?.password,
      displayName: req.body?.displayName,
      role: req.body?.role
    });
    res.status(201).json({ user });
  })
);

usersRouter.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw new HttpError(400, 'ID utente non valido.');

    const user = updateUser({
      id,
      displayName: req.body?.displayName,
      role: req.body?.role,
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

    const user = resetUserPassword({
      id,
      password: req.body?.password
    });
    res.json({ user });
  })
);
