import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { db, nowIso, transaction, audit } from '../db.js';
import {
  HttpError,
  PLANS,
  PLAN_LABELS,
  cleanText,
  validatePassword,
  bcryptRounds,
  likeTerm,
  parsePage,
  pageResult,
  generateTokenCode,
} from '../lib.js';
import { requireRole, wrap } from '../middleware.js';
import {
  getRestaurantById,
  presentRestaurant,
  presentToken,
  grantValidity,
  loadSettings,
} from '../domain.js';
import { setSetting } from '../db.js';
import { removeSupabaseUser, syncOwnerAccount } from '../supabaseSync.js';

function requireAdmin(req, res, next) {
  return requireRole('super_admin')(req, res, next);
}

function restaurantOr404(id) {
  const row = getRestaurantById(id);
  if (!row) throw new HttpError(404, 'Restaurant not found');
  return row;
}

export function adminRouter(router) {
  router.use('/api/admin', requireAdmin);

  router.get('/api/admin/stats', wrap(async (req, res) => {
    const now = new Date();
    const nowIsoString = now.toISOString();
    const settings = loadSettings();
    const soon = new Date(now.getTime() + settings.expiringSoonDays * 86400000).toISOString();

    const count = (sql, ...params) => db.prepare(sql).get(...params).count;

    const total = count('SELECT COUNT(*) AS count FROM restaurants');
    const pending = count(`SELECT COUNT(*) AS count FROM restaurants WHERE approval_status = 'pending'`);
    const active = count(`
      SELECT COUNT(*) AS count
      FROM restaurants r
      JOIN subscriptions s ON s.restaurant_id = r.id
      WHERE r.approval_status = 'approved'
        AND r.account_status = 'active'
        AND r.is_blocked = 0
        AND s.expiry_date > ?
    `, nowIsoString);
    const expired = count(`
      SELECT COUNT(*) AS count
      FROM restaurants r
      JOIN subscriptions s ON s.restaurant_id = r.id
      WHERE s.expiry_date IS NOT NULL AND s.expiry_date <= ?
    `, nowIsoString);
    const demo = count(`SELECT COUNT(*) AS count FROM subscriptions WHERE plan = 'demo'`);
    const paid = count(`SELECT COUNT(*) AS count FROM subscriptions WHERE plan IN ('monthly', 'yearly')`);
    const tokens = count('SELECT COUNT(*) AS count FROM activation_tokens');
    const unusedTokens = count(`SELECT COUNT(*) AS count FROM activation_tokens WHERE status = 'unused'`);
    const expiringSoon = count(`
      SELECT COUNT(*) AS count
      FROM restaurants r
      JOIN subscriptions s ON s.restaurant_id = r.id
      WHERE r.approval_status = 'approved'
        AND r.account_status = 'active'
        AND r.is_blocked = 0
        AND s.expiry_date > ?
        AND s.expiry_date <= ?
    `, nowIsoString, soon);

    const expiring = db.prepare(`
      SELECT r.id
      FROM restaurants r
      JOIN subscriptions s ON s.restaurant_id = r.id
      WHERE r.approval_status = 'approved'
        AND r.account_status = 'active'
        AND r.is_blocked = 0
        AND s.expiry_date > ?
        AND s.expiry_date <= ?
      ORDER BY s.expiry_date ASC
      LIMIT 8
    `).all(nowIsoString, soon).map((row) => presentRestaurant(getRestaurantById(row.id), now));

    const recent = db.prepare(`
      SELECT id FROM restaurants ORDER BY created_at DESC LIMIT 6
    `).all().map((row) => presentRestaurant(getRestaurantById(row.id), now));

    res.json({
      stats: {
        totalRestaurants: total,
        activeRestaurants: active,
        pendingRestaurants: pending,
        expiredRestaurants: expired,
        demoAccounts: demo,
        paidAccounts: paid,
        totalTokens: tokens,
        unusedTokens,
        expiringSoon,
        expiringSoonDays: settings.expiringSoonDays,
      },
      expiring,
      recent,
    });
  }));

  router.get('/api/admin/restaurants', wrap(async (req, res) => {
    const { page, pageSize, offset } = parsePage(req.query);
    const where = [];
    const params = [];
    const search = cleanText(req.query.search, 80);
    if (search) {
      where.push(`(r.name LIKE ? ESCAPE '\\' OR u.username LIKE ? ESCAPE '\\' OR r.slug LIKE ? ESCAPE '\\')`);
      const term = likeTerm(search);
      params.push(term, term, term);
    }
    const approval = cleanText(req.query.approval, 20);
    if (['pending', 'approved', 'rejected'].includes(approval)) {
      where.push('r.approval_status = ?');
      params.push(approval);
    }
    const account = cleanText(req.query.account, 20);
    if (account === 'blocked') where.push('r.is_blocked = 1');
    else if (['inactive', 'active', 'deactivated'].includes(account)) {
      where.push('r.account_status = ?');
      params.push(account);
    }
    const plan = cleanText(req.query.plan, 20);
    if (['none', 'demo', 'monthly', 'yearly'].includes(plan)) {
      where.push('s.plan = ?');
      params.push(plan);
    }
    const validity = cleanText(req.query.validity, 20);
    const now = new Date().toISOString();
    if (validity === 'active') where.push('s.expiry_date > ?') && params.push(now);
    if (validity === 'expired') where.push(`s.expiry_date IS NOT NULL AND s.expiry_date <= ?`) && params.push(now);
    if (validity === 'none') where.push('s.expiry_date IS NULL');

    const sorts = {
      name: 'r.name COLLATE NOCASE',
      username: 'u.username COLLATE NOCASE',
      created_at: 'r.created_at',
      plan: 's.plan',
      expiry: 's.expiry_date',
    };
    const sort = sorts[req.query.sort] || 'r.created_at';
    const dir = req.query.dir === 'asc' ? 'ASC' : 'DESC';
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = db.prepare(`
      SELECT COUNT(*) AS count
      FROM restaurants r
      JOIN users u ON u.id = r.owner_user_id
      LEFT JOIN subscriptions s ON s.restaurant_id = r.id
      ${clause}
    `).get(...params).count;
    const ids = db.prepare(`
      SELECT r.id
      FROM restaurants r
      JOIN users u ON u.id = r.owner_user_id
      LEFT JOIN subscriptions s ON s.restaurant_id = r.id
      ${clause}
      ORDER BY ${sort} ${dir}, r.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, pageSize, offset);
    const items = ids.map((row) => presentRestaurant(getRestaurantById(row.id)));
    res.json(pageResult(items, total, page, pageSize));
  }));

  router.get('/api/admin/restaurants/:id', wrap(async (req, res) => {
    const restaurant = presentRestaurant(restaurantOr404(req.params.id));
    const counts = {
      categories: db.prepare('SELECT COUNT(*) AS count FROM categories WHERE restaurant_id = ?').get(restaurant.id).count,
      dishes: db.prepare('SELECT COUNT(*) AS count FROM dishes WHERE restaurant_id = ?').get(restaurant.id).count,
    };
    const logs = db.prepare(`
      SELECT * FROM audit_logs
      WHERE restaurant_id = ?
      ORDER BY created_at DESC
      LIMIT 20
    `).all(restaurant.id).map(presentAudit);
    res.json({ restaurant, counts, logs });
  }));

  router.post('/api/admin/restaurants/:id/approve', wrap(async (req, res) => {
    const row = restaurantOr404(req.params.id);
    if (row.approval_status === 'rejected') throw new HttpError(409, 'Rejected accounts must be assigned a plan or extended to approve them again');
    db.prepare(`
      UPDATE restaurants SET approval_status = 'approved', rejection_reason = '', updated_at = ? WHERE id = ?
    `).run(nowIso(), row.id);
    audit({
      actorUserId: req.user.id,
      action: 'restaurant.approve',
      entityType: 'restaurant',
      entityId: row.id,
      restaurantId: row.id,
      details: { name: row.name },
    });
    await syncOwnerAccount(row.owner_user_id);
    res.json({ restaurant: presentRestaurant(getRestaurantById(row.id)), message: 'Restaurant approved' });
  }));

  router.post('/api/admin/restaurants/:id/reject', wrap(async (req, res) => {
    const row = restaurantOr404(req.params.id);
    const reason = cleanText(req.body?.reason, 300);
    db.prepare(`
      UPDATE restaurants
      SET approval_status = 'rejected', account_status = 'inactive', rejection_reason = ?, updated_at = ?
      WHERE id = ?
    `).run(reason, nowIso(), row.id);
    audit({
      actorUserId: req.user.id,
      action: 'restaurant.reject',
      entityType: 'restaurant',
      entityId: row.id,
      restaurantId: row.id,
      details: { name: row.name, reason },
    });
    await syncOwnerAccount(row.owner_user_id);
    res.json({ restaurant: presentRestaurant(getRestaurantById(row.id)), message: 'Restaurant rejected' });
  }));

  router.post('/api/admin/restaurants/:id/activate', wrap(async (req, res) => {
    const row = restaurantOr404(req.params.id);
    if (row.is_blocked) throw new HttpError(409, 'Unblock the restaurant before activating it');
    if (row.approval_status === 'rejected') throw new HttpError(409, 'Rejected restaurants need a plan assignment or validity extension');
    db.prepare(`
      UPDATE restaurants
      SET approval_status = 'approved', account_status = 'active', updated_at = ?
      WHERE id = ?
    `).run(nowIso(), row.id);
    audit({
      actorUserId: req.user.id,
      action: 'restaurant.activate',
      entityType: 'restaurant',
      entityId: row.id,
      restaurantId: row.id,
      details: { name: row.name },
    });
    await syncOwnerAccount(row.owner_user_id);
    res.json({ restaurant: presentRestaurant(getRestaurantById(row.id)), message: 'Account activated' });
  }));

  router.post('/api/admin/restaurants/:id/deactivate', wrap(async (req, res) => {
    const row = restaurantOr404(req.params.id);
    db.prepare(`UPDATE restaurants SET account_status = 'deactivated', updated_at = ? WHERE id = ?`).run(nowIso(), row.id);
    audit({
      actorUserId: req.user.id,
      action: 'restaurant.deactivate',
      entityType: 'restaurant',
      entityId: row.id,
      restaurantId: row.id,
      details: { name: row.name },
    });
    await syncOwnerAccount(row.owner_user_id);
    res.json({ restaurant: presentRestaurant(getRestaurantById(row.id)), message: 'Account deactivated' });
  }));

  router.post('/api/admin/restaurants/:id/block', wrap(async (req, res) => {
    const row = restaurantOr404(req.params.id);
    db.prepare('UPDATE restaurants SET is_blocked = 1, updated_at = ? WHERE id = ?').run(nowIso(), row.id);
    audit({
      actorUserId: req.user.id,
      action: 'restaurant.block',
      entityType: 'restaurant',
      entityId: row.id,
      restaurantId: row.id,
      details: { name: row.name },
    });
    await syncOwnerAccount(row.owner_user_id);
    res.json({ restaurant: presentRestaurant(getRestaurantById(row.id)), message: 'Restaurant blocked' });
  }));

  router.post('/api/admin/restaurants/:id/unblock', wrap(async (req, res) => {
    const row = restaurantOr404(req.params.id);
    db.prepare('UPDATE restaurants SET is_blocked = 0, updated_at = ? WHERE id = ?').run(nowIso(), row.id);
    audit({
      actorUserId: req.user.id,
      action: 'restaurant.unblock',
      entityType: 'restaurant',
      entityId: row.id,
      restaurantId: row.id,
      details: { name: row.name },
    });
    await syncOwnerAccount(row.owner_user_id);
    res.json({ restaurant: presentRestaurant(getRestaurantById(row.id)), message: 'Restaurant unblocked' });
  }));

  router.post('/api/admin/restaurants/:id/extend', wrap(async (req, res) => {
    const row = restaurantOr404(req.params.id);
    const days = Number.parseInt(req.body?.days, 10);
    const updated = transaction(() => grantValidity(row, {
      days,
      plan: row.plan,
      actorUserId: req.user.id,
      action: 'restaurant.extend',
      details: { name: row.name },
    }));
    await syncOwnerAccount(row.owner_user_id);
    res.json({ restaurant: presentRestaurant(updated), message: 'Subscription validity extended' });
  }));

  router.post('/api/admin/restaurants/:id/assign-plan', wrap(async (req, res) => {
    const row = restaurantOr404(req.params.id);
    const plan = cleanText(req.body?.plan, 20);
    if (!PLANS[plan]) throw new HttpError(400, 'Choose a demo, monthly, or yearly plan');
    const updated = transaction(() => grantValidity(row, {
      days: PLANS[plan].days,
      plan,
      actorUserId: req.user.id,
      action: 'restaurant.assign_plan',
      details: { name: row.name, plan },
    }));
    await syncOwnerAccount(row.owner_user_id);
    res.json({ restaurant: presentRestaurant(updated), message: `${PLAN_LABELS[plan]} assigned` });
  }));

  router.post('/api/admin/restaurants/:id/reset-password', wrap(async (req, res) => {
    const row = restaurantOr404(req.params.id);
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const passwordError = validatePassword(password);
    if (passwordError) throw new HttpError(400, passwordError, { password: passwordError });
    const passwordHash = await bcrypt.hash(password, bcryptRounds());
    db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(passwordHash, nowIso(), row.owner_user_id);
    audit({
      actorUserId: req.user.id,
      action: 'restaurant.reset_password',
      entityType: 'user',
      entityId: row.owner_user_id,
      restaurantId: row.id,
      details: { name: row.name, username: row.username },
    });
    await syncOwnerAccount(row.owner_user_id, password);
    res.json({ message: 'Password reset. Share the new password with the restaurant owner.' });
  }));

  router.delete('/api/admin/restaurants/:id', wrap(async (req, res) => {
    const row = restaurantOr404(req.params.id);
    const confirmName = cleanText(req.body?.confirmName, 80);
    if (confirmName !== row.name) {
      throw new HttpError(400, 'Type the restaurant name exactly to confirm deletion', { confirmName: 'Restaurant name does not match' });
    }
    const owner = db.prepare('SELECT supabase_user_id FROM users WHERE id = ?').get(row.owner_user_id);
    transaction(() => {
      audit({
        actorUserId: req.user.id,
        action: 'restaurant.delete',
        entityType: 'restaurant',
        entityId: row.id,
        restaurantId: null,
        details: { name: row.name, username: row.username },
      });
      db.prepare('DELETE FROM dishes WHERE restaurant_id = ?').run(row.id);
      db.prepare('DELETE FROM categories WHERE restaurant_id = ?').run(row.id);
      db.prepare('DELETE FROM qr_codes WHERE restaurant_id = ?').run(row.id);
      db.prepare('DELETE FROM subscriptions WHERE restaurant_id = ?').run(row.id);
      db.prepare('DELETE FROM restaurants WHERE id = ?').run(row.id);
      db.prepare('DELETE FROM users WHERE id = ?').run(row.owner_user_id);
    });
    await removeSupabaseUser(owner?.supabase_user_id);
    res.json({ message: 'Restaurant account deleted' });
  }));

  router.post('/api/admin/tokens', wrap(async (req, res) => {
    const plan = cleanText(req.body?.plan, 20);
    const quantity = Number.parseInt(req.body?.quantity, 10);
    if (!PLANS[plan]) throw new HttpError(400, 'Choose a demo, monthly, or yearly plan');
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
      throw new HttpError(400, 'Generate between 1 and 100 tokens at a time');
    }
    const created = transaction(() => {
      const insert = db.prepare(`
        INSERT INTO activation_tokens (id, code, plan, duration_days, status, generated_by, created_at)
        VALUES (?, ?, ?, ?, 'unused', ?, ?)
      `);
      const rows = [];
      for (let i = 0; i < quantity; i += 1) {
        let code = generateTokenCode(plan);
        while (db.prepare('SELECT 1 FROM activation_tokens WHERE code = ?').get(code)) code = generateTokenCode(plan);
        const id = crypto.randomUUID();
        const createdAt = nowIso();
        insert.run(id, code, plan, PLANS[plan].days, req.user.id, createdAt);
        rows.push({ id, code, plan, duration_days: PLANS[plan].days, status: 'unused', redeemed_by_restaurant_id: null, redeemed_restaurant_name: null, redeemed_at: null, created_at: createdAt });
      }
      audit({
        actorUserId: req.user.id,
        action: 'token.generate',
        entityType: 'activation_token',
        entityId: null,
        restaurantId: null,
        details: { plan, quantity, codes: rows.map((row) => row.code) },
      });
      return rows;
    });
    res.status(201).json({
      tokens: created.map(presentToken),
      message: `${quantity} ${PLAN_LABELS[plan]} token${quantity === 1 ? '' : 's'} generated`,
    });
  }));

  router.get('/api/admin/tokens', wrap(async (req, res) => {
    const { page, pageSize, offset } = parsePage(req.query);
    const where = [];
    const params = [];
    const search = cleanText(req.query.search, 80);
    if (search) {
      where.push(`(t.code LIKE ? ESCAPE '\\' OR IFNULL(t.redeemed_restaurant_name, '') LIKE ? ESCAPE '\\')`);
      const term = likeTerm(search);
      params.push(term, term);
    }
    const status = cleanText(req.query.status, 20);
    if (['unused', 'redeemed', 'blocked'].includes(status)) {
      where.push('t.status = ?');
      params.push(status);
    }
    const plan = cleanText(req.query.plan, 20);
    if (['demo', 'monthly', 'yearly'].includes(plan)) {
      where.push('t.plan = ?');
      params.push(plan);
    }
    const sorts = {
      created_at: 't.created_at',
      code: 't.code',
      plan: 't.plan',
      status: 't.status',
      redeemed_at: 't.redeemed_at',
    };
    const sort = sorts[req.query.sort] || 't.created_at';
    const dir = req.query.dir === 'asc' ? 'ASC' : 'DESC';
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = db.prepare(`SELECT COUNT(*) AS count FROM activation_tokens t ${clause}`).get(...params).count;
    const rows = db.prepare(`
      SELECT t.* FROM activation_tokens t
      ${clause}
      ORDER BY ${sort} ${dir}, t.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, pageSize, offset);
    res.json(pageResult(rows.map(presentToken), total, page, pageSize));
  }));

  router.post('/api/admin/tokens/:id/block', wrap(async (req, res) => {
    const token = db.prepare('SELECT * FROM activation_tokens WHERE id = ?').get(req.params.id);
    if (!token) throw new HttpError(404, 'Token not found');
    if (token.status === 'redeemed') throw new HttpError(409, 'Redeemed tokens cannot be blocked');
    db.prepare(`UPDATE activation_tokens SET status = 'blocked' WHERE id = ?`).run(token.id);
    audit({
      actorUserId: req.user.id,
      action: 'token.block',
      entityType: 'activation_token',
      entityId: token.id,
      details: { code: token.code },
    });
    res.json({ token: presentToken({ ...token, status: 'blocked' }), message: 'Token blocked' });
  }));

  router.post('/api/admin/tokens/:id/unblock', wrap(async (req, res) => {
    const token = db.prepare('SELECT * FROM activation_tokens WHERE id = ?').get(req.params.id);
    if (!token) throw new HttpError(404, 'Token not found');
    if (token.status === 'redeemed') throw new HttpError(409, 'Redeemed tokens stay redeemed');
    db.prepare(`UPDATE activation_tokens SET status = 'unused' WHERE id = ?`).run(token.id);
    audit({
      actorUserId: req.user.id,
      action: 'token.unblock',
      entityType: 'activation_token',
      entityId: token.id,
      details: { code: token.code },
    });
    res.json({ token: presentToken({ ...token, status: 'unused' }), message: 'Token unblocked' });
  }));

  router.get('/api/admin/audit', wrap(async (req, res) => {
    const { page, pageSize, offset } = parsePage(req.query);
    const where = [];
    const params = [];
    const search = cleanText(req.query.search, 80);
    if (search) {
      where.push(`(a.action LIKE ? ESCAPE '\\' OR a.details LIKE ? ESCAPE '\\')`);
      const term = likeTerm(search);
      params.push(term, term);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = db.prepare(`SELECT COUNT(*) AS count FROM audit_logs a ${clause}`).get(...params).count;
    const rows = db.prepare(`
      SELECT a.* FROM audit_logs a
      ${clause}
      ORDER BY a.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, pageSize, offset);
    res.json(pageResult(rows.map(presentAudit), total, page, pageSize));
  }));

  router.get('/api/admin/settings', wrap(async (req, res) => {
    res.json({ settings: loadSettings() });
  }));

  router.put('/api/admin/settings', wrap(async (req, res) => {
    const behavior = cleanText(req.body?.expiredMenuBehavior, 20);
    const days = Number.parseInt(req.body?.expiringSoonDays, 10);
    if (!['hide', 'message', 'readonly'].includes(behavior)) {
      throw new HttpError(400, 'Choose how expired menus behave for customers');
    }
    if (!Number.isInteger(days) || days < 1 || days > 90) {
      throw new HttpError(400, 'Expiring-soon window must be between 1 and 90 days');
    }
    setSetting('expired_menu_behavior', behavior);
    setSetting('expiring_soon_days', String(days));
    audit({
      actorUserId: req.user.id,
      action: 'settings.update',
      entityType: 'platform_settings',
      entityId: 'expired_menu_behavior',
      details: { expiredMenuBehavior: behavior, expiringSoonDays: days },
    });
    res.json({ settings: loadSettings(), message: 'Settings saved' });
  }));
}

function presentAudit(row) {
  let details = {};
  try { details = JSON.parse(row.details || '{}'); } catch { details = {}; }
  return {
    id: row.id,
    actorUserId: row.actor_user_id,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    restaurantId: row.restaurant_id,
    details,
    createdAt: row.created_at,
  };
}
