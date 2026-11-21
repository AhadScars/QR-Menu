import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DatabaseSync } from 'node:sqlite';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');

const onVercel = process.env.VERCEL === '1';
const temporaryRoot = path.join('/tmp', 'scanora');

function onTmp(target) {
  const resolved = path.resolve(target);
  const tmp = `${path.resolve('/tmp')}${path.sep}`;
  return resolved === path.resolve('/tmp') || resolved.startsWith(tmp);
}

function storagePath(envValue, fallback) {
  if (!envValue) return fallback;
  const resolved = path.resolve(envValue);
  if (!onVercel || onTmp(resolved)) return resolved;
  console.warn(`Vercel can only write to /tmp. Ignoring ${envValue}.`);
  return fallback;
}

export const DATA_DIR = storagePath(process.env.QR_DATA_DIR, onVercel ? path.join(temporaryRoot, 'data') : path.join(ROOT, 'data'));
export const UPLOAD_ROOT = storagePath(process.env.QR_UPLOADS, onVercel ? path.join(temporaryRoot, 'uploads') : path.join(ROOT, 'uploads'));
const DB_PATH = storagePath(process.env.QR_DB_PATH, path.join(DATA_DIR, 'qrmenu.db'));

if (onVercel) {
  console.warn('Vercel has no permanent disk. The menu database and uploads reset when this server instance is replaced.');
}

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
fs.mkdirSync(UPLOAD_ROOT, { recursive: true });

export const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = DELETE;
  PRAGMA busy_timeout = 5000;
  PRAGMA synchronous = FULL;
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('super_admin', 'owner')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_login_at TEXT
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_lower ON users(lower(username));

  CREATE TABLE IF NOT EXISTS restaurants (
    id TEXT PRIMARY KEY,
    owner_user_id TEXT NOT NULL UNIQUE REFERENCES users(id),
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    currency_symbol TEXT NOT NULL DEFAULT '₹',
    logo_path TEXT,
    cover_path TEXT,
    approval_status TEXT NOT NULL DEFAULT 'pending' CHECK (approval_status IN ('pending', 'approved', 'rejected')),
    account_status TEXT NOT NULL DEFAULT 'inactive' CHECK (account_status IN ('inactive', 'active', 'deactivated')),
    is_blocked INTEGER NOT NULL DEFAULT 0 CHECK (is_blocked IN (0, 1)),
    rejection_reason TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_restaurants_approval ON restaurants(approval_status);
  CREATE INDEX IF NOT EXISTS idx_restaurants_account ON restaurants(account_status);
  CREATE INDEX IF NOT EXISTS idx_restaurants_blocked ON restaurants(is_blocked);

  CREATE TABLE IF NOT EXISTS subscriptions (
    id TEXT PRIMARY KEY,
    restaurant_id TEXT NOT NULL UNIQUE REFERENCES restaurants(id) ON DELETE CASCADE,
    plan TEXT NOT NULL DEFAULT 'none' CHECK (plan IN ('none', 'demo', 'monthly', 'yearly')),
    duration_days INTEGER NOT NULL DEFAULT 0,
    activation_date TEXT,
    expiry_date TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_subscriptions_expiry ON subscriptions(expiry_date);
  CREATE INDEX IF NOT EXISTS idx_subscriptions_plan ON subscriptions(plan);

  CREATE TABLE IF NOT EXISTS activation_tokens (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    plan TEXT NOT NULL CHECK (plan IN ('demo', 'monthly', 'yearly')),
    duration_days INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'unused' CHECK (status IN ('unused', 'redeemed', 'blocked')),
    generated_by TEXT,
    redeemed_by_restaurant_id TEXT REFERENCES restaurants(id) ON DELETE SET NULL,
    redeemed_restaurant_name TEXT,
    redeemed_at TEXT,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_tokens_status ON activation_tokens(status);
  CREATE INDEX IF NOT EXISTS idx_tokens_plan ON activation_tokens(plan);

  CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    restaurant_id TEXT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    image_path TEXT,
    display_order INTEGER NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_categories_restaurant ON categories(restaurant_id, display_order);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_name ON categories(restaurant_id, lower(name));

  CREATE TABLE IF NOT EXISTS dishes (
    id TEXT PRIMARY KEY,
    restaurant_id TEXT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    category_id TEXT NOT NULL REFERENCES categories(id),
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
    discount_price_cents INTEGER CHECK (discount_price_cents IS NULL OR discount_price_cents >= 0),
    half_price_cents INTEGER CHECK (half_price_cents IS NULL OR half_price_cents >= 0),
    half_discount_price_cents INTEGER CHECK (half_discount_price_cents IS NULL OR half_discount_price_cents >= 0),
    image_path TEXT,
    diet_type TEXT NOT NULL CHECK (diet_type IN ('veg', 'non_veg')),
    is_available INTEGER NOT NULL DEFAULT 1 CHECK (is_available IN (0, 1)),
    display_order INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_dishes_restaurant ON dishes(restaurant_id, display_order);
  CREATE INDEX IF NOT EXISTS idx_dishes_category ON dishes(category_id);

  CREATE TABLE IF NOT EXISTS qr_codes (
    id TEXT PRIMARY KEY,
    restaurant_id TEXT NOT NULL UNIQUE REFERENCES restaurants(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    actor_user_id TEXT,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT,
    restaurant_id TEXT,
    details TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_audit_restaurant ON audit_logs(restaurant_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS platform_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
`);

export function nowIso() {
  return new Date().toISOString();
}

export function transaction(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* already rolled back */ }
    throw error;
  }
}

export function audit({ actorUserId, action, entityType, entityId, restaurantId, details }) {
  db.prepare(`
    INSERT INTO audit_logs (id, actor_user_id, action, entity_type, entity_id, restaurant_id, details, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    crypto.randomUUID(),
    actorUserId || null,
    action,
    entityType,
    entityId || null,
    restaurantId || null,
    JSON.stringify(details || {}),
    nowIso(),
  );
}

export function getSetting(key, fallback) {
  const row = db.prepare('SELECT value FROM platform_settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

export function setSetting(key, value) {
  const now = nowIso();
  db.prepare(`
    INSERT INTO platform_settings (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(key, String(value), now);
}

function seed() {
  const now = nowIso();
  const defaults = {
    expired_menu_behavior: 'message',
    expiring_soon_days: '7',
  };
  const insert = db.prepare(`
    INSERT INTO platform_settings (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO NOTHING
  `);
  for (const [key, value] of Object.entries(defaults)) insert.run(key, value, now);

  const admin = db.prepare(`SELECT id FROM users WHERE role = 'super_admin' LIMIT 1`).get();
  if (!admin) {
    const username = process.env.QR_ADMIN_USERNAME || 'admin';
    const password = process.env.QR_ADMIN_PASSWORD || 'Admin@12345';
    const rounds = Number(process.env.QR_BCRYPT_ROUNDS || 12);
    const hash = bcrypt.hashSync(password, rounds);
    db.prepare(`
      INSERT INTO users (id, username, password_hash, role, created_at, updated_at)
      VALUES (?, ?, ?, 'super_admin', ?, ?)
    `).run(crypto.randomUUID(), username, hash, now, now);
  }
}

function forgetMenuImages() {
  const rows = [
    ...db.prepare('SELECT image_path FROM categories WHERE image_path IS NOT NULL').all(),
    ...db.prepare('SELECT image_path FROM dishes WHERE image_path IS NOT NULL').all(),
  ];
  const root = path.resolve(UPLOAD_ROOT) + path.sep;
  for (const row of rows) {
    const full = path.resolve(UPLOAD_ROOT, row.image_path);
    if (full.startsWith(root)) fs.rmSync(full, { force: true });
  }
  db.prepare('UPDATE categories SET image_path = NULL WHERE image_path IS NOT NULL').run();
  db.prepare('UPDATE dishes SET image_path = NULL WHERE image_path IS NOT NULL').run();
}

function ensureSupabaseLink() {
  const columns = new Set(db.prepare('PRAGMA table_info(users)').all().map((column) => column.name));
  if (!columns.has('supabase_user_id')) {
    db.exec('ALTER TABLE users ADD COLUMN supabase_user_id TEXT');
  }
}

function ensureDishPortions() {
  const columns = new Set(db.prepare('PRAGMA table_info(dishes)').all().map((column) => column.name));
  if (!columns.has('half_price_cents')) {
    db.exec('ALTER TABLE dishes ADD COLUMN half_price_cents INTEGER CHECK (half_price_cents IS NULL OR half_price_cents >= 0)');
  }
  if (!columns.has('half_discount_price_cents')) {
    db.exec('ALTER TABLE dishes ADD COLUMN half_discount_price_cents INTEGER CHECK (half_discount_price_cents IS NULL OR half_discount_price_cents >= 0)');
  }
}

ensureSupabaseLink();
ensureDishPortions();
seed();
forgetMenuImages();
