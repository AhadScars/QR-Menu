import crypto from 'crypto';
import { db, nowIso, audit, getSetting } from './db.js';
import {
  PLANS,
  PLAN_LABELS,
  publicImage,
  remainingDays,
  subscriptionActive,
  nextExpiry,
  HttpError,
} from './lib.js';

const RESTAURANT_SELECT = `
  SELECT
    r.*,
    u.username,
    u.id AS user_id,
    s.id AS subscription_id,
    s.plan,
    s.duration_days,
    s.activation_date,
    s.expiry_date,
    q.id AS qr_id
  FROM restaurants r
  JOIN users u ON u.id = r.owner_user_id
  LEFT JOIN subscriptions s ON s.restaurant_id = r.id
  LEFT JOIN qr_codes q ON q.restaurant_id = r.id
`;

export function getRestaurantById(id) {
  return db.prepare(`${RESTAURANT_SELECT} WHERE r.id = ?`).get(id);
}

export function getRestaurantByOwner(userId) {
  return db.prepare(`${RESTAURANT_SELECT} WHERE r.owner_user_id = ?`).get(userId);
}

export function getRestaurantBySlug(slug) {
  return db.prepare(`${RESTAURANT_SELECT} WHERE r.slug = ?`).get(slug);
}

export function presentRestaurant(row, now = new Date()) {
  if (!row) return null;
  const activeSub = subscriptionActive(row.expiry_date, now);
  const remaining = remainingDays(row.expiry_date, now);
  let activationStatus = 'inactive';
  if (row.is_blocked) activationStatus = 'blocked';
  else if (row.approval_status === 'rejected') activationStatus = 'rejected';
  else if (row.approval_status === 'pending') activationStatus = 'pending';
  else if (row.account_status === 'deactivated') activationStatus = 'deactivated';
  else if (row.expiry_date && !activeSub) activationStatus = 'expired';
  else if (row.account_status === 'active' && activeSub) activationStatus = 'active';
  else if (row.account_status === 'active') activationStatus = 'no_plan';
  else activationStatus = 'inactive';

  const canManageMenu = row.approval_status === 'approved'
    && row.account_status === 'active'
    && !row.is_blocked
    && activeSub;

  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    username: row.username,
    description: row.description,
    phone: row.phone,
    email: row.email,
    address: row.address,
    currencySymbol: row.currency_symbol,
    logoUrl: publicImage(row.logo_path),
    coverUrl: publicImage(row.cover_path),
    approvalStatus: row.approval_status,
    accountStatus: row.account_status,
    isBlocked: Boolean(row.is_blocked),
    rejectionReason: row.rejection_reason || '',
    activationStatus,
    plan: row.plan || 'none',
    planLabel: PLAN_LABELS[row.plan || 'none'],
    durationDays: row.duration_days || 0,
    activationDate: row.activation_date,
    expiryDate: row.expiry_date,
    remainingDays: remaining,
    hasQr: Boolean(row.qr_id),
    canManageMenu,
    registeredAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function assertCanManageMenu(restaurant) {
  if (!restaurant) throw new HttpError(404, 'Restaurant not found');
  if (restaurant.is_blocked) {
    throw new HttpError(403, 'This restaurant is blocked. Contact the platform administrator.');
  }
  if (restaurant.approval_status === 'pending') {
    throw new HttpError(403, 'Your account is pending approval. Redeem an activation token or wait for the administrator.');
  }
  if (restaurant.approval_status === 'rejected') {
    throw new HttpError(403, 'This registration was rejected. Contact the platform administrator.');
  }
  if (restaurant.account_status !== 'active') {
    throw new HttpError(403, 'This account is not active. Contact the platform administrator.');
  }
  if (!subscriptionActive(restaurant.expiry_date)) {
    throw new HttpError(403, 'Your subscription has expired. Redeem a token or ask the administrator to extend validity. Your menu data is safe.');
  }
}

export function ensureQr(restaurantId) {
  const existing = db.prepare('SELECT id FROM qr_codes WHERE restaurant_id = ?').get(restaurantId);
  if (existing) return existing.id;
  const id = crypto.randomUUID();
  const now = nowIso();
  db.prepare(`
    INSERT INTO qr_codes (id, restaurant_id, created_at, updated_at)
    VALUES (?, ?, ?, ?)
  `).run(id, restaurantId, now, now);
  return id;
}

/**
 * Apply a number of subscription days.
 * Approves and activates the account unless it is blocked.
 * Creates the QR code the first time a valid subscription exists.
 */
export function grantValidity(restaurant, { days, plan, actorUserId, action, details }) {
  if (!PLANS[plan] && plan !== 'none' && plan != null) {
    throw new HttpError(400, 'Unknown subscription plan');
  }
  if (!Number.isInteger(days) || days < 1 || days > 3650) {
    throw new HttpError(400, 'Validity must be between 1 and 3650 days');
  }

  const now = new Date();
  const nowString = now.toISOString();
  const wasExpiredOrNone = !subscriptionActive(restaurant.expiry_date, now);
  const expiry = nextExpiry(restaurant.expiry_date, days, now);
  const activation = wasExpiredOrNone ? nowString : (restaurant.activation_date || nowString);
  const nextPlan = PLANS[plan] ? plan : (restaurant.plan || 'none');

  db.prepare(`
    UPDATE subscriptions
    SET plan = ?, duration_days = ?, activation_date = ?, expiry_date = ?, updated_at = ?
    WHERE restaurant_id = ?
  `).run(nextPlan, days, activation, expiry, nowString, restaurant.id);

  db.prepare(`
    UPDATE restaurants
    SET approval_status = 'approved',
        account_status = 'active',
        rejection_reason = '',
        updated_at = ?
    WHERE id = ?
  `).run(nowString, restaurant.id);

  ensureQr(restaurant.id);

  audit({
    actorUserId,
    action,
    entityType: 'restaurant',
    entityId: restaurant.id,
    restaurantId: restaurant.id,
    details: {
      ...(details || {}),
      plan: nextPlan,
      days,
      expiryDate: expiry,
      activationDate: activation,
      extendedFromExisting: !wasExpiredOrNone,
    },
  });

  return getRestaurantById(restaurant.id);
}

export function recompact(table, restaurantId) {
  if (table !== 'dishes' && table !== 'categories') throw new Error('Invalid table');
  const rows = db.prepare(
    `SELECT id FROM ${table} WHERE restaurant_id = ? ORDER BY display_order ASC, created_at ASC`,
  ).all(restaurantId);
  const update = db.prepare(`UPDATE ${table} SET display_order = ? WHERE id = ? AND restaurant_id = ?`);
  rows.forEach((row, index) => update.run(index + 1, row.id, restaurantId));
}

export function nextDisplayOrder(table, restaurantId) {
  const row = db.prepare(
    `SELECT COALESCE(MAX(display_order), 0) AS max_order FROM ${table} WHERE restaurant_id = ?`,
  ).get(restaurantId);
  return row.max_order + 1;
}

export function loadSettings() {
  const behavior = getSetting('expired_menu_behavior', 'message');
  const days = Number.parseInt(getSetting('expiring_soon_days', '7'), 10);
  return {
    expiredMenuBehavior: ['hide', 'message', 'readonly'].includes(behavior) ? behavior : 'message',
    expiringSoonDays: Number.isFinite(days) && days > 0 && days <= 90 ? days : 7,
  };
}

export function publicMenuPayload(restaurant) {
  const settings = loadSettings();
  const base = {
    restaurant: {
      name: restaurant.name,
      slug: restaurant.slug,
      description: restaurant.description,
      phone: restaurant.phone,
      address: restaurant.address,
      currencySymbol: restaurant.currency_symbol,
      logoUrl: publicImage(restaurant.logo_path),
      coverUrl: publicImage(restaurant.cover_path),
    },
    categories: [],
    behavior: settings.expiredMenuBehavior,
  };

  if (restaurant.is_blocked || restaurant.approval_status !== 'approved' || restaurant.account_status !== 'active') {
    return {
      ...base,
      state: 'unavailable',
      message: 'This menu is currently unavailable.',
    };
  }

  const active = subscriptionActive(restaurant.expiry_date);
  if (!active) {
    if (!restaurant.expiry_date) {
      return { ...base, state: 'unavailable', message: 'This menu is currently unavailable.' };
    }
    if (settings.expiredMenuBehavior === 'hide') {
      return { ...base, state: 'hidden', message: 'This menu is currently unavailable.' };
    }
    if (settings.expiredMenuBehavior === 'message') {
      return {
        ...base,
        state: 'expired',
        message: 'This restaurant’s subscription has expired. Please contact the restaurant.',
      };
    }
  }

  const categories = db.prepare(`
    SELECT * FROM categories
    WHERE restaurant_id = ? AND is_active = 1
    ORDER BY display_order ASC, created_at ASC
  `).all(restaurant.id);

  const dishes = db.prepare(`
    SELECT * FROM dishes
    WHERE restaurant_id = ?
    ORDER BY display_order ASC, created_at ASC
  `).all(restaurant.id);

  const sections = categories.map((category) => ({
    id: category.id,
    name: category.name,
    description: category.description,
    dishes: dishes
      .filter((dish) => dish.category_id === category.id)
      .map((dish) => ({
        id: dish.id,
        name: dish.name,
        description: dish.description,
        priceCents: dish.price_cents,
        discountPriceCents: dish.discount_price_cents,
        halfPriceCents: dish.half_price_cents,
        halfDiscountPriceCents: dish.half_discount_price_cents,
        dietType: dish.diet_type,
        isAvailable: Boolean(dish.is_available),
        displayOrder: dish.display_order,
      })),
  })).filter((section) => section.dishes.length > 0);

  return {
    ...base,
    state: active ? 'ok' : 'readonly',
    message: active ? '' : 'Viewing menu in read-only mode.',
    categories: sections,
  };
}

export function presentCategory(row, dishCount = 0) {
  return {
    id: row.id,
    restaurantId: row.restaurant_id,
    name: row.name,
    description: row.description,
    displayOrder: row.display_order,
    isActive: Boolean(row.is_active),
    dishCount,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function presentDish(row) {
  return {
    id: row.id,
    restaurantId: row.restaurant_id,
    categoryId: row.category_id,
    name: row.name,
    description: row.description,
    priceCents: row.price_cents,
    discountPriceCents: row.discount_price_cents,
    halfPriceCents: row.half_price_cents,
    halfDiscountPriceCents: row.half_discount_price_cents,
    dietType: row.diet_type,
    isAvailable: Boolean(row.is_available),
    displayOrder: row.display_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function presentToken(row) {
  return {
    id: row.id,
    code: row.code,
    plan: row.plan,
    planLabel: PLAN_LABELS[row.plan],
    durationDays: row.duration_days,
    status: row.status,
    restaurantId: row.redeemed_by_restaurant_id,
    restaurantName: row.redeemed_restaurant_name,
    redeemedAt: row.redeemed_at,
    createdAt: row.created_at,
  };
}
