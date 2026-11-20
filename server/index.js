import './env.js';
import fs from 'fs';
import path from 'path';
import express from 'express';
import { fileURLToPath } from 'url';
import { ROOT } from './db.js';
import { HttpError } from './lib.js';
import { loadSession, errorHandler } from './middleware.js';
import { authRouter } from './routes/auth.js';
import { adminRouter } from './routes/admin.js';
import { ownerRouter } from './routes/owner.js';
import { publicRouter } from './routes/public.js';
import { probeSupabase, supabaseStatus } from './supabase.js';
import { syncAllOwners } from './supabaseSync.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.join(ROOT, 'public');

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
  });
  app.use(express.json({ limit: '1mb' }));
  app.use(loadSession);

  const api = express.Router();
  authRouter(api);
  adminRouter(api);
  ownerRouter(api);
  publicRouter(api);
  app.use(api);

  app.get('/api/health', (req, res) => {
    const supabase = supabaseStatus();
    res.json({ ok: true, service: 'scanora', supabase: supabase.configured });
  });

  app.use('/api', (req, res, next) => {
    next(new HttpError(404, 'Not found'));
  });

  if (fs.existsSync(WEB_ROOT)) {
    app.use(express.static(WEB_ROOT, { index: false, maxAge: '1h' }));
    app.use((req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) return next();
      res.sendFile(path.join(WEB_ROOT, 'index.html'));
    });
  }

  app.use(errorHandler);
  return app;
}

export function start(port = Number(process.env.PORT || 4000)) {
  const app = createApp();
  return app.listen(port, '0.0.0.0', () => {
    console.log(`Scanora running at http://localhost:${port}`);
    console.log('Super admin (unless you changed it): admin / Admin@12345');
    probeSupabase().then(async (supabase) => {
      if (!supabase.configured) {
        console.log('Supabase is not configured');
        return;
      }
      if (supabase.reachable) console.log('Supabase connected');
      else console.log('Supabase is configured, but the project did not respond');
      await syncAllOwners();
    }).catch((error) => {
      console.log('Supabase is configured, but the project did not respond');
      console.error(error.message);
    });
  });
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__dirname, 'index.js');
if (invokedDirectly) start();
