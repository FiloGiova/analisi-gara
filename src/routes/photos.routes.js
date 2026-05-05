import { Router } from 'express';
import multer from 'multer';
import { requireAuth, requireAdminOrInstructor } from '../middleware/auth.js';
import { asyncHandler, HttpError } from '../utils/httpError.js';
import {
  savePhotoForReferee,
  deletePhotoForReferee,
  streamProfilePhoto
} from '../services/photoService.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      cb(new HttpError(400, 'Formato immagine non supportato. Usa JPEG, PNG o WEBP.'));
      return;
    }
    cb(null, true);
  }
});

// Streaming foto: GET /api/photos/profiles/:filename
export const photosRouter = Router();

photosRouter.get(
  '/profiles/:filename',
  requireAuth,
  asyncHandler(async (req, res) => {
    streamProfilePhoto(req.params.filename, res);
  })
);

// Foto arbitri: si monta su /api/referees prima del refereesRouter
export const refereePhotosRouter = Router();

refereePhotosRouter.post(
  '/:id/photo',
  requireAdminOrInstructor,
  upload.single('photo'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new HttpError(400, 'File mancante.');
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'ID arbitro non valido.');
    const photoPath = savePhotoForReferee(id, req.file.buffer);
    res.json({ photoPath });
  })
);

refereePhotosRouter.delete(
  '/:id/photo',
  requireAdminOrInstructor,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'ID arbitro non valido.');
    deletePhotoForReferee(id);
    res.json({ ok: true });
  })
);
