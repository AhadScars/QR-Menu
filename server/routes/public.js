import fs from 'fs';
import path from 'path';
import { UPLOAD_ROOT } from '../db.js';
import { getRestaurantBySlug, publicMenuPayload } from '../domain.js';
import { HttpError, imageContentType } from '../lib.js';
import { wrap } from '../middleware.js';

export function publicRouter(router) {
  router.use('/uploads', (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const raw = decodeURIComponent(req.path.replace(/^\/+/, ''));
    const segments = raw.split('/').filter(Boolean);
    if (!segments.length || segments.some((segment) => segment === '..' || segment.startsWith('.'))) {
      return next(new HttpError(404, 'Not found'));
    }
    const full = path.resolve(UPLOAD_ROOT, ...segments);
    const root = path.resolve(UPLOAD_ROOT) + path.sep;
    if (!full.startsWith(root) || !fs.existsSync(full) || !fs.statSync(full).isFile()) {
      return next(new HttpError(404, 'Not found'));
    }
    const stat = fs.statSync(full);
    res.setHeader('Content-Type', imageContentType(full));
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Cache-Control', 'public, max-age=604800');
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(full).pipe(res);
  });

  router.get('/api/public/menu/:slug', wrap(async (req, res) => {
    const slug = path.basename(String(req.params.slug || '')).slice(0, 80);
    const restaurant = getRestaurantBySlug(slug);
    if (!restaurant) throw new HttpError(404, 'Menu not found');
    res.setHeader('Cache-Control', 'no-store');
    res.json(publicMenuPayload(restaurant));
  }));
}
