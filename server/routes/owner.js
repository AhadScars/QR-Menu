import crypto from 'crypto';
import multer from 'multer';
import { db, nowIso, transaction } from '../db.js';
import {
  HttpError,
  cleanText,
  isEmail,
  likeTerm,
  parsePage,
  pageResult,
  toCents,
  saveImage,
  deleteUpload,
  menuUrl,
} from '../lib.js';
import { requireOwnerRestaurant, rateLimit, wrap } from '../middleware.js';
import {
  getRestaurantById,
  presentRestaurant,
  presentCategory,
  presentDish,
  grantValidity,
  assertCanManageMenu,
  recompact,
  nextDisplayOrder,
  } from '../domain.js';
import { qrPng, qrPdf } from '../qr.js';
import { syncOwnerAccount } from '../supabaseSync.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 2 },
});

function ownerGuard(req, res, next) {
  return requireOwnerRestaurant(req, res, next);
}

function freshRestaurant(req) {
  return getRestaurantById(req.restaurant.id);
}

function requireMenuAccess(req) {
  assertCanManageMenu(freshRestaurant(req));
}

function boolFlag(value, fallback = true) {
  if (value == null || value === '') return fallback;
  if (value === true || value === 'true' || value === '1' || value === 1) return true;
  if (value === false || value === 'false' || value === '0' || value === 0) return false;
  return fallback;
}

function realFile(file) {
  return file && file.buffer && file.buffer.length > 0 ? file : null;
}

function saveForRestaurant(file, restaurantId) {
  if (!file) return null;
  return saveImage(file.buffer, restaurantId);
}

export function ownerRouter(router) {
  router.use('/api/owner', ownerGuard);

  router.get('/api/owner/dashboard', wrap(async (req, res) => {
    const restaurant = presentRestaurant(freshRestaurant(req));
    const counts = {
      categories: db.prepare('SELECT COUNT(*) AS count FROM categories WHERE restaurant_id = ?').get(restaurant.id).count,
      dishes: db.prepare('SELECT COUNT(*) AS count FROM dishes WHERE restaurant_id = ?').get(restaurant.id).count,
      availableDishes: db.prepare('SELECT COUNT(*) AS count FROM dishes WHERE restaurant_id = ? AND is_available = 1').get(restaurant.id).count,
      unavailableDishes: db.prepare('SELECT COUNT(*) AS count FROM dishes WHERE restaurant_id = ? AND is_available = 0').get(restaurant.id).count,
    };
    const dishes = db.prepare(`
      SELECT d.id, d.name, d.is_available, d.category_id, d.display_order, c.name AS category_name
      FROM dishes d
      JOIN categories c ON c.id = d.category_id
      WHERE d.restaurant_id = ?
      ORDER BY c.display_order ASC, d.display_order ASC, d.created_at ASC
    `).all(restaurant.id).map((row) => ({
      id: row.id,
      name: row.name,
      categoryId: row.category_id,
      categoryName: row.category_name,
      isAvailable: Boolean(row.is_available),
      displayOrder: row.display_order,
    }));
    res.json({ restaurant, counts, dishes });
  }));

  router.get('/api/owner/profile', wrap(async (req, res) => {
    res.json({ restaurant: presentRestaurant(freshRestaurant(req)) });
  }));

  router.put('/api/owner/profile', upload.fields([{ name: 'logo', maxCount: 1 }, { name: 'cover', maxCount: 1 }]), wrap(async (req, res) => {
    const current = freshRestaurant(req);
    if (current.is_blocked) throw new HttpError(403, 'This restaurant is blocked');
    if (current.approval_status === 'rejected') throw new HttpError(403, 'This registration was rejected');

    const name = cleanText(req.body?.name, 80);
    const description = cleanText(req.body?.description, 1000);
    const phone = cleanText(req.body?.phone, 30);
    const email = cleanText(req.body?.email, 120);
    const address = cleanText(req.body?.address, 240);
    const currencySymbol = cleanText(req.body?.currencySymbol, 4) || '₹';
    const fields = {};
    if (name.length < 2) fields.name = 'Restaurant name must be at least 2 characters';
    if (email && !isEmail(email)) fields.email = 'Enter a valid email address';
    if (Object.keys(fields).length) throw new HttpError(400, 'Please correct the highlighted fields', fields);

    let logoPath = current.logo_path;
    let coverPath = current.cover_path;
    const logo = realFile(req.files?.logo?.[0]);
    const cover = realFile(req.files?.cover?.[0]);
    if (logo) logoPath = saveForRestaurant(logo, current.id);
    if (cover) coverPath = saveForRestaurant(cover, current.id);
    if (boolFlag(req.body?.removeLogo, false)) logoPath = null;
    if (boolFlag(req.body?.removeCover, false)) coverPath = null;

    db.prepare(`
      UPDATE restaurants
      SET name = ?, description = ?, phone = ?, email = ?, address = ?, currency_symbol = ?,
          logo_path = ?, cover_path = ?, updated_at = ?
      WHERE id = ?
    `).run(name, description, phone, email, address, currencySymbol, logoPath, coverPath, nowIso(), current.id);

    if (logo && current.logo_path && current.logo_path !== logoPath) deleteUpload(current.logo_path);
    if (cover && current.cover_path && current.cover_path !== coverPath) deleteUpload(current.cover_path);
    if (boolFlag(req.body?.removeLogo, false)) deleteUpload(current.logo_path);
    if (boolFlag(req.body?.removeCover, false)) deleteUpload(current.cover_path);

    await syncOwnerAccount(req.user.id);
    res.json({ restaurant: presentRestaurant(getRestaurantById(current.id)), message: 'Profile saved' });
  }));

  router.get('/api/owner/subscription', wrap(async (req, res) => {
    res.json({ restaurant: presentRestaurant(freshRestaurant(req)) });
  }));

  router.post('/api/owner/redeem', rateLimit({ windowMs: 15 * 60 * 1000, max: 10, name: 'redeem' }), wrap(async (req, res) => {
    const code = cleanText(req.body?.code, 40).toUpperCase().replace(/\s+/g, '');
    if (!code) throw new HttpError(400, 'Enter an activation token', { code: 'Enter an activation token' });
    const current = freshRestaurant(req);
    if (current.is_blocked) throw new HttpError(403, 'This restaurant is blocked. Contact the platform administrator.');

    const updated = transaction(() => {
      const token = db.prepare('SELECT * FROM activation_tokens WHERE code = ?').get(code);
      if (!token || token.status === 'redeemed') {
        throw new HttpError(400, token?.status === 'redeemed' ? 'This token has already been used' : 'This token is invalid');
      }
      if (token.status === 'blocked') throw new HttpError(400, 'This token is blocked');
      if (token.status !== 'unused') throw new HttpError(400, 'This token cannot be redeemed');

      const claim = db.prepare(`
        UPDATE activation_tokens
        SET status = 'redeemed', redeemed_by_restaurant_id = ?, redeemed_restaurant_name = ?, redeemed_at = ?
        WHERE id = ? AND status = 'unused'
      `).run(current.id, current.name, nowIso(), token.id);
      if (!claim.changes) throw new HttpError(409, 'This token has already been used');

      return grantValidity(current, {
        days: token.duration_days,
        plan: token.plan,
        actorUserId: req.user.id,
        action: 'token.redeem',
        details: { code: token.code, plan: token.plan },
      });
    });

    await syncOwnerAccount(req.user.id);
    res.json({
      restaurant: presentRestaurant(updated),
      message: 'Token redeemed. Your restaurant is active.',
    });
  }));

  router.get('/api/owner/categories', wrap(async (req, res) => {
    const rows = db.prepare(`
      SELECT c.*, (
        SELECT COUNT(*) FROM dishes d WHERE d.category_id = c.id
      ) AS dish_count
      FROM categories c
      WHERE c.restaurant_id = ?
      ORDER BY c.display_order ASC, c.created_at ASC
    `).all(req.restaurant.id);
    res.json({
      categories: rows.map((row) => presentCategory(row, row.dish_count)),
      restaurant: presentRestaurant(freshRestaurant(req)),
    });
  }));

  router.post('/api/owner/categories', wrap(async (req, res) => {
    requireMenuAccess(req);
    const name = cleanText(req.body?.name, 60);
    const description = cleanText(req.body?.description, 400);
    const isActive = boolFlag(req.body?.isActive, true);
    if (name.length < 2) throw new HttpError(400, 'Category name is required', { name: 'Enter a category name' });
    const duplicate = db.prepare(`
      SELECT 1 FROM categories WHERE restaurant_id = ? AND lower(name) = lower(?)
    `).get(req.restaurant.id, name);
    if (duplicate) throw new HttpError(409, 'A category with this name already exists', { name: 'A category with this name already exists' });

    const id = crypto.randomUUID();
    const now = nowIso();
    db.prepare(`
      INSERT INTO categories (id, restaurant_id, name, description, image_path, display_order, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?)
    `).run(id, req.restaurant.id, name, description, nextDisplayOrder('categories', req.restaurant.id), isActive ? 1 : 0, now, now);
    const row = db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
    res.status(201).json({ category: presentCategory(row, 0), message: 'Category created' });
  }));

  router.put('/api/owner/categories/:id', wrap(async (req, res) => {
    requireMenuAccess(req);
    const current = db.prepare('SELECT * FROM categories WHERE id = ? AND restaurant_id = ?').get(req.params.id, req.restaurant.id);
    if (!current) throw new HttpError(404, 'Category not found');
    const name = cleanText(req.body?.name, 60);
    const description = cleanText(req.body?.description, 400);
    const isActive = boolFlag(req.body?.isActive, Boolean(current.is_active));
    if (name.length < 2) throw new HttpError(400, 'Category name is required', { name: 'Enter a category name' });
    const duplicate = db.prepare(`
      SELECT 1 FROM categories WHERE restaurant_id = ? AND lower(name) = lower(?) AND id <> ?
    `).get(req.restaurant.id, name, current.id);
    if (duplicate) throw new HttpError(409, 'A category with this name already exists', { name: 'A category with this name already exists' });

    db.prepare(`
      UPDATE categories
      SET name = ?, description = ?, image_path = NULL, is_active = ?, updated_at = ?
      WHERE id = ? AND restaurant_id = ?
    `).run(name, description, isActive ? 1 : 0, nowIso(), current.id, req.restaurant.id);
    deleteUpload(current.image_path);
    const row = db.prepare('SELECT * FROM categories WHERE id = ?').get(current.id);
    const dishCount = db.prepare('SELECT COUNT(*) AS count FROM dishes WHERE category_id = ?').get(current.id).count;
    res.json({ category: presentCategory(row, dishCount), message: 'Category updated' });
  }));

  router.delete('/api/owner/categories/:id', wrap(async (req, res) => {
    requireMenuAccess(req);
    const current = db.prepare('SELECT * FROM categories WHERE id = ? AND restaurant_id = ?').get(req.params.id, req.restaurant.id);
    if (!current) throw new HttpError(404, 'Category not found');
    const dishCount = db.prepare('SELECT COUNT(*) AS count FROM dishes WHERE category_id = ?').get(current.id).count;
    if (dishCount > 0) {
      throw new HttpError(409, 'Transfer or delete the dishes in this category before deleting it');
    }
    transaction(() => {
      db.prepare('DELETE FROM categories WHERE id = ? AND restaurant_id = ?').run(current.id, req.restaurant.id);
      recompact('categories', req.restaurant.id);
    });
    deleteUpload(current.image_path);
    res.json({ message: 'Category deleted' });
  }));

  router.post('/api/owner/categories/:id/transfer', wrap(async (req, res) => {
    requireMenuAccess(req);
    const current = db.prepare('SELECT * FROM categories WHERE id = ? AND restaurant_id = ?').get(req.params.id, req.restaurant.id);
    const targetId = cleanText(req.body?.targetId, 60);
    const target = db.prepare('SELECT * FROM categories WHERE id = ? AND restaurant_id = ?').get(targetId, req.restaurant.id);
    if (!current || !target) throw new HttpError(404, 'Category not found');
    if (current.id === target.id) throw new HttpError(400, 'Choose a different category');
    const result = db.prepare('UPDATE dishes SET category_id = ?, updated_at = ? WHERE category_id = ? AND restaurant_id = ?')
      .run(target.id, nowIso(), current.id, req.restaurant.id);
    res.json({ moved: result.changes, message: 'Dishes transferred' });
  }));

  router.post('/api/owner/categories/reorder', wrap(async (req, res) => {
    requireMenuAccess(req);
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map((id) => cleanText(id, 60)) : null;
    if (!ids) throw new HttpError(400, 'Provide the category order');
    const existing = db.prepare('SELECT id FROM categories WHERE restaurant_id = ?').all(req.restaurant.id).map((row) => row.id);
    if (ids.length !== existing.length || new Set(ids).size !== ids.length || ids.some((id) => !existing.includes(id))) {
      throw new HttpError(400, 'Category order is invalid');
    }
    transaction(() => {
      const update = db.prepare('UPDATE categories SET display_order = ?, updated_at = ? WHERE id = ? AND restaurant_id = ?');
      const now = nowIso();
      ids.forEach((id, index) => update.run(index + 1, now, id, req.restaurant.id));
    });
    res.json({ message: 'Category order saved' });
  }));

  router.get('/api/owner/dishes', wrap(async (req, res) => {
    const { page, pageSize, offset } = parsePage(req.query);
    const where = ['d.restaurant_id = ?'];
    const params = [req.restaurant.id];
    const search = cleanText(req.query.search, 80);
    if (search) {
      where.push(`(d.name LIKE ? ESCAPE '\\' OR d.description LIKE ? ESCAPE '\\')`);
      const term = likeTerm(search);
      params.push(term, term);
    }
    const categoryId = cleanText(req.query.categoryId, 60);
    if (categoryId) {
      where.push('d.category_id = ?');
      params.push(categoryId);
    }
    const availability = cleanText(req.query.availability, 20);
    if (availability === 'available') where.push('d.is_available = 1');
    if (availability === 'unavailable') where.push('d.is_available = 0');
    const diet = cleanText(req.query.diet, 20);
    if (diet === 'veg' || diet === 'non_veg') {
      where.push('d.diet_type = ?');
      params.push(diet);
    }
    const sorts = {
      display_order: 'd.display_order',
      name: 'd.name COLLATE NOCASE',
      price: 'd.price_cents',
      created_at: 'd.created_at',
    };
    const sort = sorts[req.query.sort] || 'd.display_order';
    const dir = req.query.dir === 'desc' ? 'DESC' : 'ASC';
    const clause = `WHERE ${where.join(' AND ')}`;
    const total = db.prepare(`SELECT COUNT(*) AS count FROM dishes d ${clause}`).get(...params).count;
    const rows = db.prepare(`
      SELECT d.* FROM dishes d
      ${clause}
      ORDER BY ${sort} ${dir}, d.created_at ASC
      LIMIT ? OFFSET ?
    `).all(...params, pageSize, offset);
    res.json({
      ...pageResult(rows.map(presentDish), total, page, pageSize),
      restaurant: presentRestaurant(freshRestaurant(req)),
    });
  }));

  router.post('/api/owner/dishes', wrap(async (req, res) => {
    requireMenuAccess(req);
    const payload = readDishBody(req);
    const category = db.prepare('SELECT id FROM categories WHERE id = ? AND restaurant_id = ?').get(payload.categoryId, req.restaurant.id);
    if (!category) throw new HttpError(400, 'Choose a category', { categoryId: 'Choose a category' });
    const id = crypto.randomUUID();
    const now = nowIso();
    db.prepare(`
      INSERT INTO dishes (
        id, restaurant_id, category_id, name, description, price_cents, discount_price_cents,
        half_price_cents, half_discount_price_cents,
        image_path, diet_type, is_available, display_order, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)
    `).run(
      id,
      req.restaurant.id,
      payload.categoryId,
      payload.name,
      payload.description,
      payload.priceCents,
      payload.discountPriceCents,
      payload.halfPriceCents,
      payload.halfDiscountPriceCents,
      payload.dietType,
      payload.isAvailable ? 1 : 0,
      nextDisplayOrder('dishes', req.restaurant.id),
      now,
      now,
    );
    res.status(201).json({ dish: presentDish(db.prepare('SELECT * FROM dishes WHERE id = ?').get(id)), message: 'Dish created' });
  }));

  router.put('/api/owner/dishes/:id', wrap(async (req, res) => {
    requireMenuAccess(req);
    const current = db.prepare('SELECT * FROM dishes WHERE id = ? AND restaurant_id = ?').get(req.params.id, req.restaurant.id);
    if (!current) throw new HttpError(404, 'Dish not found');
    const payload = readDishBody(req, current);
    const category = db.prepare('SELECT id FROM categories WHERE id = ? AND restaurant_id = ?').get(payload.categoryId, req.restaurant.id);
    if (!category) throw new HttpError(400, 'Choose a category', { categoryId: 'Choose a category' });
    const result = db.prepare(`
      UPDATE dishes
      SET category_id = ?, name = ?, description = ?, price_cents = ?, discount_price_cents = ?,
          half_price_cents = ?, half_discount_price_cents = ?,
          image_path = NULL, diet_type = ?, is_available = ?, updated_at = ?
      WHERE id = ? AND restaurant_id = ?
    `).run(
      payload.categoryId,
      payload.name,
      payload.description,
      payload.priceCents,
      payload.discountPriceCents,
      payload.halfPriceCents,
      payload.halfDiscountPriceCents,
      payload.dietType,
      payload.isAvailable ? 1 : 0,
      nowIso(),
      current.id,
      req.restaurant.id,
    );
    if (!result.changes) throw new HttpError(404, 'Dish not found');
    deleteUpload(current.image_path);
    res.json({ dish: presentDish(db.prepare('SELECT * FROM dishes WHERE id = ?').get(current.id)), message: 'Dish updated' });
  }));

  router.post('/api/owner/dishes/:id/availability', wrap(async (req, res) => {
    requireMenuAccess(req);
    const current = db.prepare('SELECT * FROM dishes WHERE id = ? AND restaurant_id = ?').get(req.params.id, req.restaurant.id);
    if (!current) throw new HttpError(404, 'Dish not found');
    if (req.body?.isAvailable !== true && req.body?.isAvailable !== false) {
      throw new HttpError(400, 'Choose available or sold out');
    }
    db.prepare(`
      UPDATE dishes SET is_available = ?, updated_at = ? WHERE id = ? AND restaurant_id = ?
    `).run(req.body.isAvailable ? 1 : 0, nowIso(), current.id, req.restaurant.id);
    const dish = presentDish(db.prepare('SELECT * FROM dishes WHERE id = ?').get(current.id));
    res.json({ dish, message: dish.isAvailable ? 'Dish is available' : 'Dish marked sold out' });
  }));

  router.delete('/api/owner/dishes/:id', wrap(async (req, res) => {
    requireMenuAccess(req);
    const current = db.prepare('SELECT * FROM dishes WHERE id = ? AND restaurant_id = ?').get(req.params.id, req.restaurant.id);
    if (!current) throw new HttpError(404, 'Dish not found');
    const before = db.prepare('SELECT id FROM dishes WHERE restaurant_id = ? AND id <> ?').all(req.restaurant.id, current.id).map((row) => row.id);
    transaction(() => {
      db.prepare('DELETE FROM dishes WHERE id = ? AND restaurant_id = ?').run(current.id, req.restaurant.id);
      recompact('dishes', req.restaurant.id);
    });
    deleteUpload(current.image_path);
    const afterIds = db.prepare('SELECT id FROM dishes WHERE restaurant_id = ?').all(req.restaurant.id).map((row) => row.id);
    if (afterIds.some((id) => !before.includes(id)) || before.some((id) => !afterIds.includes(id))) {
      throw new HttpError(500, 'Dish identity check failed');
    }
    res.json({ message: 'Dish deleted' });
  }));

  router.post('/api/owner/dishes/:id/move', wrap(async (req, res) => {
    requireMenuAccess(req);
    const direction = req.body?.direction === 'up' ? 'up' : req.body?.direction === 'down' ? 'down' : null;
    if (!direction) throw new HttpError(400, 'Choose up or down');
    const current = db.prepare('SELECT * FROM dishes WHERE id = ? AND restaurant_id = ?').get(req.params.id, req.restaurant.id);
    if (!current) throw new HttpError(404, 'Dish not found');
    const neighborSql = direction === 'up'
      ? 'SELECT * FROM dishes WHERE restaurant_id = ? AND display_order < ? ORDER BY display_order DESC LIMIT 1'
      : 'SELECT * FROM dishes WHERE restaurant_id = ? AND display_order > ? ORDER BY display_order ASC LIMIT 1';
    const neighbor = db.prepare(neighborSql).get(req.restaurant.id, current.display_order);
    if (!neighbor) return res.json({ message: 'Order unchanged' });
    transaction(() => {
      const update = db.prepare('UPDATE dishes SET display_order = ?, updated_at = ? WHERE id = ? AND restaurant_id = ?');
      const now = nowIso();
      update.run(neighbor.display_order, now, current.id, req.restaurant.id);
      update.run(current.display_order, now, neighbor.id, req.restaurant.id);
    });
    res.json({ message: 'Dish order updated' });
  }));

  router.get('/api/owner/qr', wrap(async (req, res) => {
    const restaurant = presentRestaurant(freshRestaurant(req));
    if (!restaurant.hasQr) {
      return res.json({ restaurant, url: null, ready: false });
    }
    res.json({ restaurant, url: menuUrl(req, restaurant.slug), ready: true });
  }));

  router.get('/api/owner/qr.png', wrap(async (req, res) => {
    const restaurant = freshRestaurant(req);
    if (!restaurant.qr_id) throw new HttpError(404, 'A QR code is created when the restaurant is activated');
    const png = await qrPng(menuUrl(req, restaurant.slug));
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-store');
    const download = req.query.download === '1';
    res.setHeader('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename="${restaurant.slug}-menu-qr.png"`);
    res.send(png);
  }));

  router.get('/api/owner/qr.pdf', wrap(async (req, res) => {
    const restaurant = freshRestaurant(req);
    if (!restaurant.qr_id) throw new HttpError(404, 'A QR code is created when the restaurant is activated');
    const url = menuUrl(req, restaurant.slug);
    const png = await qrPng(url);
    const pdf = await qrPdf({ name: restaurant.name, url, png });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${restaurant.slug}-menu-qr.pdf"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(pdf);
  }));
}

function readDishBody(req, current) {
  const name = cleanText(req.body?.name, 80);
  const description = cleanText(req.body?.description, 500);
  const categoryId = cleanText(req.body?.categoryId, 60);
  const dietType = req.body?.dietType === 'non_veg' ? 'non_veg' : req.body?.dietType === 'veg' ? 'veg' : (current?.diet_type || '');
  const priceCents = toCents(req.body?.price);
  const discountRaw = req.body?.discountPrice;
  const hasDiscount = discountRaw !== undefined && discountRaw !== null && String(discountRaw).trim() !== '';
  const discountPriceCents = hasDiscount ? toCents(discountRaw) : null;
  const offerHalf = boolFlag(req.body?.offerHalf, false);
  const halfRaw = req.body?.halfPrice;
  const hasHalf = offerHalf && halfRaw !== undefined && halfRaw !== null && String(halfRaw).trim() !== '';
  const halfPriceCents = offerHalf ? (hasHalf ? toCents(halfRaw) : null) : null;
  const halfDiscountRaw = req.body?.halfDiscountPrice;
  const hasHalfDiscount = offerHalf && halfDiscountRaw !== undefined && halfDiscountRaw !== null && String(halfDiscountRaw).trim() !== '';
  const halfDiscountPriceCents = offerHalf ? (hasHalfDiscount ? toCents(halfDiscountRaw) : null) : null;
  const isAvailable = boolFlag(req.body?.isAvailable, current ? Boolean(current.is_available) : true);
  const fields = {};
  if (name.length < 2) fields.name = 'Enter a dish name';
  if (!categoryId) fields.categoryId = 'Choose a category';
  if (dietType !== 'veg' && dietType !== 'non_veg') fields.dietType = 'Choose vegetarian or non-vegetarian';
  if (priceCents == null) fields.price = offerHalf ? 'Enter a valid full price' : 'Enter a valid price';
  if (hasDiscount && discountPriceCents == null) fields.discountPrice = 'Enter a valid discount price';
  if (discountPriceCents != null && priceCents != null && discountPriceCents >= priceCents) {
    fields.discountPrice = 'Discount price must be lower than the regular price';
  }
  if (offerHalf && halfPriceCents == null) fields.halfPrice = 'Enter a valid half price';
  if (hasHalfDiscount && halfDiscountPriceCents == null) fields.halfDiscountPrice = 'Enter a valid half discount';
  if (halfDiscountPriceCents != null && halfPriceCents != null && halfDiscountPriceCents >= halfPriceCents) {
    fields.halfDiscountPrice = 'Half discount must be lower than the half price';
  }
  if (halfPriceCents != null && priceCents != null && halfPriceCents >= priceCents) {
    fields.halfPrice = 'Half price must be lower than the full price';
  }
  const fullSell = discountPriceCents ?? priceCents;
  const halfSell = halfDiscountPriceCents ?? halfPriceCents;
  if (halfSell != null && fullSell != null && halfSell >= fullSell && !fields.halfPrice && !fields.halfDiscountPrice) {
    fields.halfPrice = 'Half price must be lower than the full price';
  }
  if (Object.keys(fields).length) throw new HttpError(400, 'Please correct the highlighted fields', fields);
  return { name, description, categoryId, dietType, priceCents, discountPriceCents, halfPriceCents, halfDiscountPriceCents, isAvailable };
}
