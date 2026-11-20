import crypto from 'crypto';
import { db, nowIso } from './db.js';
import { HttpError, clientIp } from './lib.js';
import { getRestaurantByOwner } from './domain.js';

const COOKIE = 'qrmenu_sid';
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;

const buckets = new Map();

export function wrap(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function readCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    out[key] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return out;
}

export function setSessionCookie(res, sessionId) {
  const parts = [
    `${COOKIE}=${sessionId}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${Math.floor(SESSION_MS / 1000)}`,
  ];
  if (process.env.NODE_ENV === 'production') parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function clearSessionCookie(res) {
  const parts = [`${COOKIE}=`, 'HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=0'];
  if (process.env.NODE_ENV === 'production') parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function createSession(userId) {
  const id = crypto.randomBytes(32).toString('hex');
  const now = nowIso();
  const expires = new Date(Date.now() + SESSION_MS).toISOString();
  db.prepare(`
    INSERT INTO sessions (id, user_id, expires_at, created_at)
    VALUES (?, ?, ?, ?)
  `).run(id, userId, expires, now);
  return id;
}

export function destroySession(sessionId) {
  if (!sessionId) return;
  db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
}

export function loadSession(req, res, next) {
  const sid = readCookies(req)[COOKIE];
  req.sessionId = sid || null;
  req.user = null;
  req.restaurant = null;
  if (!sid) return next();
  const row = db.prepare(`
    SELECT s.id AS session_id, s.expires_at, u.id, u.username, u.role
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.id = ?
  `).get(sid);
  if (!row || new Date(row.expires_at).getTime() <= Date.now()) {
    if (row) db.prepare('DELETE FROM sessions WHERE id = ?').run(sid);
    clearSessionCookie(res);
    return next();
  }
  req.user = { id: row.id, username: row.username, role: row.role };
  if (row.role === 'owner') req.restaurant = getRestaurantByOwner(row.id);
  return next();
}

export function requireAuth(req, res, next) {
  if (!req.user) return next(new HttpError(401, 'Please sign in'));
  return next();
}

export function requireRole(role) {
  return (req, res, next) => {
    if (!req.user) return next(new HttpError(401, 'Please sign in'));
    if (req.user.role !== role) return next(new HttpError(403, 'You do not have access to this area'));
    return next();
  };
}

export function requireOwnerRestaurant(req, res, next) {
  if (!req.user || req.user.role !== 'owner') return next(new HttpError(403, 'You do not have access to this area'));
  if (!req.restaurant) return next(new HttpError(404, 'Restaurant not found'));
  return next();
}

export function rateLimit({ windowMs, max, name }) {
  return (req, res, next) => {
    if (process.env.QR_DISABLE_RATE_LIMIT === '1') return next();
    const key = `${name}:${clientIp(req)}`;
    const now = Date.now();
    const recent = (buckets.get(key) || []).filter((stamp) => now - stamp < windowMs);
    if (recent.length >= max) {
      return next(new HttpError(429, 'Too many requests. Please wait and try again.'));
    }
    recent.push(now);
    buckets.set(key, recent);
    if (buckets.size > 5000) {
      for (const [bucketKey, stamps] of buckets) {
        if (stamps.every((stamp) => now - stamp >= windowMs)) buckets.delete(bucketKey);
      }
    }
    return next();
  };
}

export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  const multerLimited = err?.name === 'MulterError';
  const status = multerLimited ? 400 : (err.status || 500);
  if (status >= 500) console.error(err);
  let message = status >= 500 ? 'Something went wrong. Please try again.' : err.message;
  if (multerLimited && err.code === 'LIMIT_FILE_SIZE') message = 'Image must be 5 MB or smaller';
  if (multerLimited && err.code !== 'LIMIT_FILE_SIZE') message = 'Could not upload that file';
  return res.status(status).json({ error: message, fields: err.fields || undefined });
}
