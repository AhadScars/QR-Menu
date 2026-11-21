import fs from 'fs';
import path from 'path';

export function resolveWebRoot(candidates) {
  return candidates.find((dir) => dir && fs.existsSync(path.join(dir, 'index.html'))) || null;
}

export function mountWeb(app, root) {
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) return next();
    if (!root) return next();

    const relative = req.path === '/' ? 'index.html' : req.path.replace(/^\/+/, '');
    if (!relative || relative.split('/').includes('..')) return next();

    const rootResolved = path.resolve(root);
    const file = path.resolve(rootResolved, relative);
    const indexFile = path.join(rootResolved, 'index.html');
    const inside = file === rootResolved || file.startsWith(`${rootResolved}${path.sep}`);
    const fileExists = inside && fs.existsSync(file) && fs.statSync(file).isFile();
    const target = fileExists ? file : indexFile;
    if (!fs.existsSync(target)) return next();
    if (path.resolve(target) === path.resolve(indexFile)) {
      res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
    }
    res.sendFile(target, (error) => {
      if (error) next(error);
    });
  });
}
