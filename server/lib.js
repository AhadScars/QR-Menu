import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { UPLOAD_ROOT } from './db.js';

export class HttpError extends Error {
  constructor(status, message, fields) {
    super(message);
    this.status = status;
    this.fields = fields;
  }
}

export const PLANS = {
  demo: { days: 3, label: '3-day Demo Plan', paid: false },
  monthly: { days: 30, label: '30-day Monthly Plan', paid: true },
  yearly: { days: 365, label: '365-day Yearly Plan', paid: true },
};

export const PLAN_LABELS = {
  none: 'No plan',
  demo: PLANS.demo.label,
  monthly: PLANS.monthly.label,
  yearly: PLANS.yearly.label,
};

export function bcryptRounds() {
  return Number(process.env.QR_BCRYPT_ROUNDS || 12);
}

export function cleanText(value, max) {
  if (value == null) return '';
  return String(value)
    .replace(/<[^>]*>/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .trim()
    .slice(0, max);
}

export function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function validateUsername(username) {
  if (!/^[A-Za-z0-9_]{3,30}$/.test(username)) {
    return 'Use 3–30 letters, numbers, or underscores';
  }
  return null;
}

export function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 8 || password.length > 72) {
    return 'Password must be 8–72 characters';
  }
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return 'Password must include a letter and a number';
  }
  return null;
}

export function slugify(name) {
  const slug = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || 'restaurant';
}

export function remainingDays(expiryIso, now = new Date()) {
  if (!expiryIso) return 0;
  const diff = new Date(expiryIso).getTime() - now.getTime();
  if (diff <= 0) return 0;
  return Math.ceil(diff / 86400000);
}

export function subscriptionActive(expiryIso, now = new Date()) {
  return Boolean(expiryIso) && new Date(expiryIso).getTime() > now.getTime();
}

/**
 * Extend from the current expiry when it is still in the future.
 * When the subscription is missing or already expired, start from now
 * (the activation / extension moment).
 */
export function nextExpiry(currentExpiryIso, days, now = new Date()) {
  const current = currentExpiryIso ? new Date(currentExpiryIso) : null;
  const base = current && current.getTime() > now.getTime() ? current : now;
  return new Date(base.getTime() + days * 86400000).toISOString();
}

export function likeTerm(value) {
  return `%${String(value).replace(/[\\%_]/g, '\\$&')}%`;
}

export function parsePage(query) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const pageSize = Math.min(50, Math.max(1, Number.parseInt(query.pageSize, 10) || 10));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

export function pageResult(items, total, page, pageSize) {
  return {
    items,
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export function money(cents, symbol = '₹') {
  const amount = (Number(cents) / 100).toFixed(2);
  return `${symbol}${amount}`;
}

export function toCents(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1000000) return null;
  return Math.round(number * 100);
}

const IMAGE_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
};

export function sniffImage(buffer) {
  if (!buffer || buffer.length < 12) return null;
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return '.png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return '.jpg';
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return '.webp';
  return null;
}

export function saveImage(buffer, restaurantId) {
  const ext = sniffImage(buffer);
  if (!ext) throw new HttpError(400, 'Upload a JPEG, PNG, or WebP image');
  const dir = path.join(UPLOAD_ROOT, restaurantId);
  fs.mkdirSync(dir, { recursive: true });
  const filename = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
  const full = path.join(dir, filename);
  fs.writeFileSync(full, buffer);
  return `${restaurantId}/${filename}`;
}

export function deleteUpload(relativePath) {
  if (!relativePath) return;
  const full = path.resolve(UPLOAD_ROOT, relativePath);
  const root = path.resolve(UPLOAD_ROOT) + path.sep;
  if (!full.startsWith(root)) return;
  fs.rmSync(full, { force: true });
}

export function imageContentType(relativePath) {
  const ext = path.extname(relativePath || '').toLowerCase();
  return IMAGE_TYPES[ext] || 'application/octet-stream';
}

export function publicImage(relativePath) {
  return relativePath ? `/uploads/${relativePath}` : null;
}

export function generateTokenCode(plan) {
  const prefix = { demo: 'DEMO', monthly: 'MNTH', yearly: 'YEAR' }[plan];
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let body = '';
  const bytes = crypto.randomBytes(12);
  for (let i = 0; i < 12; i += 1) body += alphabet[bytes[i] % alphabet.length];
  return `${prefix}-${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8, 12)}`;
}

export function menuUrl(req, slug) {
  const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
  const host = req.get('x-forwarded-host') || req.get('host');
  return `${proto}://${host}/menu/${slug}`;
}

export function clientIp(req) {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}
