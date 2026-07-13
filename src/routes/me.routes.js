import { Router } from 'express';
import multer from 'multer';
import { listReports, getStats } from '../services/reportService.js';
import { savePhotoForUser, deletePhotoForUser } from '../services/photoService.js';
import { updateOwnProfile } from '../services/userService.js';
import { listAvailableSeasons } from '../services/seasonService.js';
import { asyncHandler, HttpError } from '../utils/httpError.js';

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

export const meRouter = Router();

meRouter.get('/', (req, res) => {
  res.json({ user: req.user || null });
});

meRouter.get('/profile', (req, res) => {
  res.json({ user: req.user || null });
});

meRouter.get(
  '/seasons',
  asyncHandler(async (_req, res) => {
    res.json({ seasons: await listAvailableSeasons() });
  })
);

meRouter.patch(
  '/profile',
  asyncHandler(async (req, res) => {
    const user = await updateOwnProfile({
      userId: req.user.id,
      displayName: req.body?.displayName
    });
    res.json({ user });
  })
);

meRouter.get(
  '/reports',
  asyncHandler(async (req, res) => {
    const reports = await listReports({
      search: req.query.search || '',
      status: req.query.status || '',
      season: req.query.season || '',
      user: req.user
    });
    res.json({ reports });
  })
);

meRouter.get(
  '/stats',
  asyncHandler(async (req, res) => {
    const stats = await getStats(req.user, { season: req.query.season || '' });
    res.json({ stats });
  })
);

meRouter.post(
  '/photo',
  upload.single('photo'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new HttpError(400, 'File mancante.');
    const photoPath = await savePhotoForUser(req.user.id, req.file.buffer);
    res.json({ photoPath });
  })
);

meRouter.delete(
  '/photo',
  asyncHandler(async (req, res) => {
    await deletePhotoForUser(req.user.id);
    res.json({ ok: true });
  })
);
