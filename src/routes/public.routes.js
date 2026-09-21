import express from 'express';
import path from 'node:path';
import { config } from '../config.js';
import { renderPublicPage } from '../views/publicPages.js';

// Pagine informative: nessuna sessione o query DB, anche con cookie scaduti.
export const publicRouter = express.Router();
for (const [route, page] of [['/', 'home'], ['/privacy', 'privacy'], ['/termini', 'terms']]) {
  publicRouter.get(route, (_req, res) => {
    const result = renderPublicPage(page, config);
    res.set('Cache-Control', 'no-cache');
    if (!result.ready) res.set('X-Robots-Tag', 'noindex, nofollow');
    res.status(result.ready ? 200 : 503).type('html').send(result.html);
  });
}

// File già presenti nella dipendenza Montserrat, senza font o richieste esterne.
publicRouter.get('/public-font-:weight.woff2', (req, res, next) => {
  if (!['400', '600', '700'].includes(req.params.weight)) return next();
  res.sendFile(path.join(config.rootDir, 'node_modules', '@fontsource', 'montserrat', 'files', `montserrat-latin-${req.params.weight}-normal.woff2`));
});
