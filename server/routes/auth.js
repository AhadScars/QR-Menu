import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { db, nowIso, transaction } from '../db.js';
import {
  HttpError,
  cleanText,
  validateUsername,
  validatePassword,
  slugify,
  bcryptRounds,
} from '../lib.js';
import {
  createSession,
  destroySession,
  setSessionCookie,
  clearSessionCookie,
  rateLimit,
  wrap,
} from '../middleware.js';
import { getRestaurantByOwner, presentRestaurant } from '../domain.js';
import { syncOwnerAccount } from '../supabaseSync.js';

const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', bcryptRounds());

function uniqueSlug(name) {
  const base = slugify(name);
  let slug = base;
  let n = 2;
  while (db.prepare('SELECT 1 FROM restaurants WHERE slug = ?').get(slug)) {
    slug = `${base}-${n}`;
    n += 1;
  }
  return slug;
}

export function authRouter(router) {
  router.post('/api/auth/register', rateLimit({ windowMs: 60 * 60 * 1000, max: 8, name: 'register' }), wrap(async (req, res) => {
    const username = cleanText(req.body?.username, 30);
    const restaurantName = cleanText(req.body?.restaurantName, 80);
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const confirmPassword = typeof req.body?.confirmPassword === 'string' ? req.body.confirmPassword : '';
    const fields = {};
    const usernameError = validateUsername(username);
    if (usernameError) fields.username = usernameError;
    if (restaurantName.length < 2) fields.restaurantName = 'Restaurant name must be at least 2 characters';
    const passwordError = validatePassword(password);
    if (passwordError) fields.password = passwordError;
    if (password !== confirmPassword) fields.confirmPassword = 'Passwords do not match';
    if (Object.keys(fields).length) throw new HttpError(400, 'Please correct the highlighted fields', fields);

    const taken = db.prepare('SELECT 1 FROM users WHERE lower(username) = lower(?)').get(username);
    if (taken) throw new HttpError(409, 'That username is already taken', { username: 'That username is already taken' });

    const passwordHash = await bcrypt.hash(password, bcryptRounds());
    const userId = crypto.randomUUID();
    const restaurantId = crypto.randomUUID();
    const now = nowIso();

    transaction(() => {
      db.prepare(`
        INSERT INTO users (id, username, password_hash, role, created_at, updated_at)
        VALUES (?, ?, ?, 'owner', ?, ?)
      `).run(userId, username, passwordHash, now, now);
      db.prepare(`
        INSERT INTO restaurants (
          id, owner_user_id, name, slug, approval_status, account_status, is_blocked, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'pending', 'inactive', 0, ?, ?)
      `).run(restaurantId, userId, restaurantName, uniqueSlug(restaurantName), now, now);
      db.prepare(`
        INSERT INTO subscriptions (id, restaurant_id, plan, duration_days, created_at, updated_at)
        VALUES (?, ?, 'none', 0, ?, ?)
      `).run(crypto.randomUUID(), restaurantId, now, now);
    });

    await syncOwnerAccount(userId, password);

    res.status(201).json({
      message: 'Registration received. Your account is pending approval. You can sign in to check status or redeem an activation token.',
    });
  }));

  router.post('/api/auth/login', rateLimit({ windowMs: 15 * 60 * 1000, max: 10, name: 'login' }), wrap(async (req, res) => {
    const username = cleanText(req.body?.username, 30);
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const portal = req.body?.portal === 'admin' ? 'admin' : 'owner';
    const user = db.prepare('SELECT * FROM users WHERE lower(username) = lower(?)').get(username);
    const hash = user?.password_hash || DUMMY_HASH;
    const matches = await bcrypt.compare(password, hash);
    const roleOk = user && ((portal === 'admin' && user.role === 'super_admin') || (portal === 'owner' && user.role === 'owner'));
    if (!user || !matches || !roleOk) {
      throw new HttpError(401, 'Invalid username or password');
    }
    if (req.sessionId) destroySession(req.sessionId);
    const sessionId = createSession(user.id);
    db.prepare('UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?').run(nowIso(), nowIso(), user.id);
    setSessionCookie(res, sessionId);
    if (user.role === 'owner') await syncOwnerAccount(user.id, password);
    const restaurant = user.role === 'owner' ? presentRestaurant(getRestaurantByOwner(user.id)) : null;
    res.json({
      user: { id: user.id, username: user.username, role: user.role, restaurant },
    });
  }));

  router.post('/api/auth/logout', wrap(async (req, res) => {
    destroySession(req.sessionId);
    clearSessionCookie(res);
    res.json({ message: 'Signed out' });
  }));

  router.post('/api/auth/password', wrap(async (req, res) => {
    if (!req.user) throw new HttpError(401, 'Please sign in');
    const currentPassword = typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';
    const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';
    const confirmPassword = typeof req.body?.confirmPassword === 'string' ? req.body.confirmPassword : '';
    const fields = {};
    const passwordError = validatePassword(newPassword);
    if (passwordError) fields.newPassword = passwordError;
    if (newPassword !== confirmPassword) fields.confirmPassword = 'Passwords do not match';
    if (Object.keys(fields).length) throw new HttpError(400, 'Please correct the highlighted fields', fields);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    const matches = await bcrypt.compare(currentPassword, user.password_hash);
    if (!matches) throw new HttpError(400, 'Current password is incorrect', { currentPassword: 'Current password is incorrect' });
    const passwordHash = await bcrypt.hash(newPassword, bcryptRounds());
    db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(passwordHash, nowIso(), user.id);
    if (user.role === 'owner') await syncOwnerAccount(user.id, newPassword);
    res.json({ message: 'Password updated' });
  }));

  router.get('/api/auth/me', wrap(async (req, res) => {
    if (!req.user) return res.json({ user: null });
    const restaurant = req.user.role === 'owner' ? presentRestaurant(getRestaurantByOwner(req.user.id)) : null;
    res.json({ user: { ...req.user, restaurant } });
  }));
}
