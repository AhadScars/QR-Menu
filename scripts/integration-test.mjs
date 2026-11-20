import fs from 'fs';
import os from 'os';
import path from 'path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qrmenu-'));
process.env.QR_DB_PATH = path.join(dir, 'test.db');
process.env.QR_UPLOADS = path.join(dir, 'uploads');
process.env.QR_DATA_DIR = dir;
process.env.QR_BCRYPT_ROUNDS = '4';
process.env.QR_ADMIN_USERNAME = 'admin';
process.env.QR_ADMIN_PASSWORD = 'Admin@12345';
process.env.QR_DISABLE_RATE_LIMIT = '1';
process.env.NODE_ENV = 'test';

const { createApp } = await import('../server/index.js');
const { db } = await import('../server/db.js');

const server = createApp().listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

let passed = 0;
function check(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exitCode = 1;
    throw new Error(message);
  }
  passed += 1;
}

async function request(pathname, { method = 'GET', body, form, cookie } = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const response = await fetch(base + pathname, { method, headers, body: payload });
  const type = response.headers.get('content-type') || '';
  const data = type.includes('application/json')
    ? await response.json()
    : Buffer.from(await response.arrayBuffer());
  const baked = (response.headers.getSetCookie?.() || []).find((row) => row.startsWith('qrmenu_sid='));
  const nextCookie = baked ? baked.split(';')[0] : cookie;
  return { status: response.status, data, cookie: nextCookie, type };
}

try {
  const health = await request('/api/health');
  check(health.status === 200 && health.data.ok, 'health');

  const badRegister = await request('/api/auth/register', {
    method: 'POST',
    body: { username: 'ab', restaurantName: 'A', password: 'short', confirmPassword: 'other' },
  });
  check(badRegister.status === 400 && badRegister.data.fields.confirmPassword, 'register validation');

  const registerA = await request('/api/auth/register', {
    method: 'POST',
    body: { username: 'spicehub', restaurantName: 'Spice Hub', password: 'Owner@123', confirmPassword: 'Owner@123' },
  });
  check(registerA.status === 201, 'register owner A');

  const duplicate = await request('/api/auth/register', {
    method: 'POST',
    body: { username: 'SpiceHub', restaurantName: 'Other', password: 'Owner@123', confirmPassword: 'Owner@123' },
  });
  check(duplicate.status === 409, 'username unique case-insensitive');

  let owner = await request('/api/auth/login', { method: 'POST', body: { username: 'spicehub', password: 'Owner@123', portal: 'owner' } });
  check(owner.status === 200 && owner.data.user.role === 'owner', 'owner login');
  let ownerCookie = owner.cookie;

  const earlyDish = await request('/api/owner/categories', { method: 'POST', cookie: ownerCookie, body: { name: 'Starters', description: 'Small plates', isActive: true } });
  check(earlyDish.status === 403, 'pending owner cannot manage menu');
  const earlyToggle = await request('/api/owner/dishes/00000000-0000-0000-0000-000000000000/availability', { method: 'POST', cookie: ownerCookie, body: { isAvailable: false } });
  check(earlyToggle.status === 403, 'pending owner cannot mark a dish sold out');

  const me = await request('/api/auth/me', { cookie: ownerCookie });
  check(me.data.user.restaurant.activationStatus === 'pending', 'pending status');

  const wrongAdmin = await request('/api/auth/login', { method: 'POST', body: { username: 'spicehub', password: 'Owner@123', portal: 'admin' } });
  check(wrongAdmin.status === 401, 'owner cannot use admin portal');

  let admin = await request('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'wrong-password', portal: 'admin' } });
  check(admin.status === 401, 'bad admin password');
  admin = await request('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'Admin@12345', portal: 'admin' } });
  check(admin.status === 200 && admin.data.user.role === 'super_admin', 'admin login');
  const adminCookie = admin.cookie;

  const stats = await request('/api/admin/stats', { cookie: adminCookie });
  check(stats.data.stats.pendingRestaurants >= 1 && stats.data.stats.totalTokens === 0, 'dashboard stats');

  const listed = await request('/api/admin/restaurants?search=spice&sort=name&dir=asc', { cookie: adminCookie });
  check(listed.data.items.some((item) => item.username === 'spicehub'), 'restaurant search');
  const restaurantA = listed.data.items.find((item) => item.username === 'spicehub');

  const guestAdmin = await request('/api/admin/stats');
  check(guestAdmin.status === 401, 'guest blocked from admin');
  const ownerAdmin = await request('/api/admin/stats', { cookie: ownerCookie });
  check(ownerAdmin.status === 403, 'owner blocked from admin');
  const adminOwner = await request('/api/owner/dashboard', { cookie: adminCookie });
  check(adminOwner.status === 403, 'admin blocked from owner menu');

  const tokens = await request('/api/admin/tokens', {
    method: 'POST',
    cookie: adminCookie,
    body: { plan: 'monthly', quantity: 2 },
  });
  const demoTokens = await request('/api/admin/tokens', {
    method: 'POST',
    cookie: adminCookie,
    body: { plan: 'demo', quantity: 1 },
  });
  const yearlyTokens = await request('/api/admin/tokens', {
    method: 'POST',
    cookie: adminCookie,
    body: { plan: 'yearly', quantity: 1 },
  });
  check(tokens.status === 201 && demoTokens.status === 201 && yearlyTokens.status === 201, 'generate tokens');
  const codes = [...tokens.data.tokens, ...demoTokens.data.tokens, ...yearlyTokens.data.tokens].map((token) => token.code);
  check(new Set(codes).size === codes.length, 'tokens are unique');
  check(codes[0].startsWith('MNTH-') && demoTokens.data.tokens[0].code.startsWith('DEMO-') && yearlyTokens.data.tokens[0].code.startsWith('YEAR-'), 'token prefixes');

  const blocked = tokens.data.tokens[1];
  const block = await request(`/api/admin/tokens/${blocked.id}/block`, { method: 'POST', cookie: adminCookie, body: {} });
  check(block.data.token.status === 'blocked', 'block token');
  const blockedRedeem = await request('/api/owner/redeem', { method: 'POST', cookie: ownerCookie, body: { code: blocked.code } });
  check(blockedRedeem.status === 400, 'blocked token rejected');
  await request(`/api/admin/tokens/${blocked.id}/unblock`, { method: 'POST', cookie: adminCookie, body: {} });

  const badToken = await request('/api/owner/redeem', { method: 'POST', cookie: ownerCookie, body: { code: 'NOPE-0000-0000-0000' } });
  check(badToken.status === 400, 'invalid token rejected');

  const redeemed = await request('/api/owner/redeem', { method: 'POST', cookie: ownerCookie, body: { code: tokens.data.tokens[0].code } });
  check(redeemed.status === 200 && redeemed.data.restaurant.canManageMenu && redeemed.data.restaurant.plan === 'monthly', 'redeem activates account');
  check(redeemed.data.restaurant.remainingDays >= 29 && redeemed.data.restaurant.remainingDays <= 30, 'monthly remaining days');
  const again = await request('/api/owner/redeem', { method: 'POST', cookie: ownerCookie, body: { code: tokens.data.tokens[0].code } });
  check(again.status === 400, 'token cannot be reused');

  const tokenList = await request('/api/admin/tokens?status=redeemed&search=Spice', { cookie: adminCookie });
  check(tokenList.data.items.some((token) => token.restaurantName === 'Spice Hub' && token.redeemedAt), 'redeemed token shows restaurant and date');

  const starters = await request('/api/owner/categories', { method: 'POST', cookie: ownerCookie, body: { name: 'Starters', description: 'To begin', isActive: true } });
  const mains = await request('/api/owner/categories', { method: 'POST', cookie: ownerCookie, body: { name: 'Main Course', description: 'Plates', isActive: true } });
  const emptyCategory = await request('/api/owner/categories', { method: 'POST', cookie: ownerCookie, body: { name: 'Empty Section', description: '', isActive: true } });
  check(starters.status === 201 && mains.status === 201 && starters.data.category.imageUrl == null, 'categories are stored without images');

  const dishIds = [];
  for (let index = 1; index <= 7; index += 1) {
    const created = await request('/api/owner/dishes', {
      method: 'POST',
      cookie: ownerCookie,
      body: {
        name: `Dish ${index}`,
        description: `Number ${index}`,
        categoryId: starters.data.category.id,
        price: 10 + index,
        discountPrice: index === 1 ? 9 : '',
        dietType: index % 2 ? 'veg' : 'non_veg',
        isAvailable: index !== 7,
      },
    });
    check(created.status === 201, `create dish ${index}`);
    dishIds.push({ id: created.data.dish.id, displayOrder: created.data.dish.displayOrder });
  }
  check(dishIds.map((dish) => dish.displayOrder).join() === '1,2,3,4,5,6,7', 'initial serial numbers');

  const soup = await request('/api/owner/dishes', {
    method: 'POST',
    cookie: ownerCookie,
    body: {
      name: 'Tomato Soup',
      description: 'Warm bowl',
      categoryId: mains.data.category.id,
      price: '180',
      discountPrice: '150',
      dietType: 'veg',
      isAvailable: true,
    },
  });
  check(soup.status === 201 && soup.data.dish.imageUrl == null && soup.data.dish.halfPriceCents == null, 'dishes are stored without images or a half price');

  const hidden = await request(`/api/owner/categories/${mains.data.category.id}`, {
    method: 'PUT',
    cookie: ownerCookie,
    body: { name: 'Main Course', description: 'Plates', isActive: false },
  });
  check(hidden.status === 200 && hidden.data.category.isActive === false, 'deactivate category');

  const menu = await request(`/api/public/menu/${redeemed.data.restaurant.slug}`);
  check(menu.status === 200 && menu.data.state === 'ok', 'public menu');
  check(
    menu.data.categories.every((category) => category.imageUrl == null && category.dishes.every((dish) => dish.imageUrl == null)),
    'public menu has no category or dish images',
  );
  check(menu.data.restaurant.username === undefined && menu.data.restaurant.email === undefined, 'public menu hides private fields');
  check(!menu.data.categories.some((category) => category.name === 'Empty Section'), 'empty category hidden');
  check(!menu.data.categories.some((category) => category.name === 'Main Course'), 'inactive category hidden');
  const starterSection = menu.data.categories.find((category) => category.name === 'Starters');
  check(starterSection.dishes.length === 7, 'starter dishes published');
  check(starterSection.dishes.some((dish) => dish.isAvailable === false && dish.name === 'Dish 7'), 'unavailable dish still visible');
  check(starterSection.dishes[0].discountPriceCents === 900, 'discount price stored in cents');

  const victim = dishIds.find((dish) => dish.displayOrder === 5);
  const removed = await request(`/api/owner/dishes/${victim.id}`, { method: 'DELETE', cookie: ownerCookie });
  check(removed.status === 200, 'delete dish');
  const afterDelete = await request('/api/owner/dishes?sort=display_order&dir=asc&pageSize=20', { cookie: ownerCookie });
  const serials = afterDelete.data.items.filter((dish) => dish.categoryId === starters.data.category.id).map((dish) => dish.displayOrder);
  check(serials.join() === '1,2,3,4,5,6', 'serial numbers close up after delete');
  const survivingIds = dishIds.filter((dish) => dish.id !== victim.id).map((dish) => dish.id);
  const currentIds = afterDelete.data.items.map((dish) => dish.id);
  check(survivingIds.every((id) => currentIds.includes(id)) && !currentIds.includes(victim.id), 'primary keys stay put');

  const biryani = await request('/api/owner/dishes', {
    method: 'POST',
    cookie: ownerCookie,
    body: {
      name: 'Biryani',
      description: 'Half or full',
      categoryId: starters.data.category.id,
      price: '320',
      discountPrice: '280',
      offerHalf: true,
      halfPrice: '180',
      halfDiscountPrice: '160',
      dietType: 'non_veg',
      isAvailable: true,
    },
  });
  check(
    biryani.status === 201
      && biryani.data.dish.priceCents === 32000
      && biryani.data.dish.discountPriceCents === 28000
      && biryani.data.dish.halfPriceCents === 18000
      && biryani.data.dish.halfDiscountPriceCents === 16000,
    'half and full prices are stored in cents',
  );
  const expensiveHalf = await request('/api/owner/dishes', {
    method: 'POST',
    cookie: ownerCookie,
    body: {
      name: 'Too big half',
      categoryId: starters.data.category.id,
      price: '100',
      offerHalf: true,
      halfPrice: '100',
      dietType: 'veg',
      isAvailable: true,
    },
  });
  check(expensiveHalf.status === 400, 'half price must be lower than the full price');
  const soldOut = await request(`/api/owner/dishes/${biryani.data.dish.id}/availability`, {
    method: 'POST',
    cookie: ownerCookie,
    body: { isAvailable: false },
  });
  check(soldOut.status === 200 && soldOut.data.dish.isAvailable === false && soldOut.data.dish.halfPriceCents === 18000, 'one tap marks a dish sold out');
  const board = await request('/api/owner/dashboard', { cookie: ownerCookie });
  check(board.data.dishes.some((dish) => dish.id === biryani.data.dish.id && dish.isAvailable === false), 'dashboard lists dishes for the sold-out switch');
  const withHalf = await request(`/api/public/menu/${redeemed.data.restaurant.slug}`);
  const published = withHalf.data.categories.flatMap((category) => category.dishes).find((dish) => dish.name === 'Biryani');
  check(published && published.halfPriceCents === 18000 && published.halfDiscountPriceCents === 16000 && published.isAvailable === false, 'public menu shows half price and sold out');
  const cleared = await request(`/api/owner/dishes/${biryani.data.dish.id}`, {
    method: 'PUT',
    cookie: ownerCookie,
    body: {
      name: 'Biryani',
      description: 'Full only',
      categoryId: starters.data.category.id,
      price: '320',
      discountPrice: '280',
      offerHalf: false,
      dietType: 'non_veg',
      isAvailable: false,
    },
  });
  check(cleared.status === 200 && cleared.data.dish.halfPriceCents == null && cleared.data.dish.halfDiscountPriceCents == null, 'turning off half portion clears the half price');

  const blockedDelete = await request(`/api/owner/categories/${starters.data.category.id}`, { method: 'DELETE', cookie: ownerCookie });
  check(blockedDelete.status === 409, 'category with dishes cannot be deleted');
  const transferred = await request(`/api/owner/categories/${starters.data.category.id}/transfer`, {
    method: 'POST',
    cookie: ownerCookie,
    body: { targetId: emptyCategory.data.category.id },
  });
  check(transferred.data.moved >= 6, 'transfer dishes');
  const deletedCategory = await request(`/api/owner/categories/${starters.data.category.id}`, { method: 'DELETE', cookie: ownerCookie });
  check(deletedCategory.status === 200, 'delete empty category');

  const reordered = await request('/api/owner/categories/reorder', {
    method: 'POST',
    cookie: ownerCookie,
    body: { ids: [emptyCategory.data.category.id, mains.data.category.id] },
  });
  check(reordered.status === 200, 'reorder categories');

  const qr = await request('/api/owner/qr', { cookie: ownerCookie });
  check(qr.data.ready && qr.data.url.endsWith(`/menu/${redeemed.data.restaurant.slug}`), 'qr url');
  const qrPng = await request('/api/owner/qr.png', { cookie: ownerCookie });
  check(qrPng.status === 200 && qrPng.data[0] === 0x89 && qrPng.data[1] === 0x50, 'qr png');
  const qrPdf = await request('/api/owner/qr.pdf', { cookie: ownerCookie });
  check(qrPdf.status === 200 && qrPdf.data.subarray(0, 4).toString() === '%PDF', 'qr pdf');
  const originalQrId = db.prepare('SELECT id FROM qr_codes WHERE restaurant_id = ?').get(restaurantA.id).id;

  const registerB = await request('/api/auth/register', {
    method: 'POST',
    body: { username: 'nightowl', restaurantName: 'Night Owl', password: 'Owner@123', confirmPassword: 'Owner@123' },
  });
  check(registerB.status === 201, 'register owner B');
  const ownerBLogin = await request('/api/auth/login', { method: 'POST', body: { username: 'nightowl', password: 'Owner@123', portal: 'owner' } });
  const ownerBCookie = ownerBLogin.cookie;
  const listB = await request('/api/admin/restaurants?search=nightowl', { cookie: adminCookie });
  const restaurantB = listB.data.items[0];
  const assigned = await request(`/api/admin/restaurants/${restaurantB.id}/assign-plan`, { method: 'POST', cookie: adminCookie, body: { plan: 'yearly' } });
  check(assigned.data.restaurant.canManageMenu && assigned.data.restaurant.plan === 'yearly', 'admin assigns yearly plan');
  const dishB = await request('/api/owner/dishes', {
    method: 'POST',
    cookie: ownerBCookie,
    body: { name: 'Secret Bowl', description: 'Private', categoryId: 'missing', price: 5, dietType: 'veg', isAvailable: true },
  });
  check(dishB.status === 400, 'dish needs a real category');
  const categoryB = await request('/api/owner/categories', { method: 'POST', cookie: ownerBCookie, body: { name: 'Late Plates', isActive: true } });
  const secret = await request('/api/owner/dishes', {
    method: 'POST',
    cookie: ownerBCookie,
    body: { name: 'Secret Bowl', description: 'Private', categoryId: categoryB.data.category.id, price: 12, dietType: 'non_veg', isAvailable: true },
  });
  check(secret.status === 201, 'owner B creates a dish');
  const ownerASees = await request('/api/owner/dishes?search=Secret', { cookie: ownerCookie });
  check(ownerASees.data.items.length === 0, 'owner A cannot see owner B dishes');
  const crossEdit = await request(`/api/owner/dishes/${secret.data.dish.id}`, {
    method: 'PUT',
    cookie: ownerCookie,
    body: { name: 'Hacked', description: 'no', categoryId: emptyCategory.data.category.id, price: 1, dietType: 'veg', isAvailable: true },
  });
  check(crossEdit.status === 404, 'cross-restaurant edit blocked');
  const menuB = await request(`/api/public/menu/${restaurantB.slug}`);
  check(menuB.data.categories.some((category) => category.dishes.some((dish) => dish.name === 'Secret Bowl')), 'public menu is per restaurant');
  check(!menu.data.categories.some((category) => category.dishes.some((dish) => dish.name === 'Secret Bowl')), 'first menu did not leak');

  const injection = await request(`/api/admin/restaurants?search=${encodeURIComponent("' OR 1=1 --")}`, { cookie: adminCookie });
  check(injection.status === 200 && injection.data.items.length === 0, 'search injection is safe');

  db.prepare('UPDATE subscriptions SET expiry_date = ? WHERE restaurant_id = ?').run(new Date(Date.now() - 3600_000).toISOString(), restaurantA.id);
  const expiredCreate = await request('/api/owner/categories', { method: 'POST', cookie: ownerCookie, body: { name: 'Should Fail', isActive: true } });
  check(expiredCreate.status === 403 && /expired/i.test(expiredCreate.data.error), 'expired owner cannot edit');
  const stillThere = await request('/api/owner/dishes?pageSize=20', { cookie: ownerCookie });
  check(stillThere.data.items.length >= 7, 'expired data is retained');

  let expiredMenu = await request(`/api/public/menu/${redeemed.data.restaurant.slug}`);
  check(expiredMenu.data.state === 'expired' && expiredMenu.data.categories.length === 0, 'default expired message hides dishes');
  await request('/api/admin/settings', { method: 'PUT', cookie: adminCookie, body: { expiredMenuBehavior: 'readonly', expiringSoonDays: 7 } });
  expiredMenu = await request(`/api/public/menu/${redeemed.data.restaurant.slug}`);
  check(expiredMenu.data.state === 'readonly' && expiredMenu.data.categories.length > 0, 'readonly expired menu');
  await request('/api/admin/settings', { method: 'PUT', cookie: adminCookie, body: { expiredMenuBehavior: 'hide', expiringSoonDays: 7 } });
  expiredMenu = await request(`/api/public/menu/${redeemed.data.restaurant.slug}`);
  check(expiredMenu.data.state === 'hidden' && expiredMenu.data.categories.length === 0, 'hidden expired menu');
  await request('/api/admin/settings', { method: 'PUT', cookie: adminCookie, body: { expiredMenuBehavior: 'message', expiringSoonDays: 5 } });

  const beforeExtend = new Date();
  const extended = await request(`/api/admin/restaurants/${restaurantA.id}/extend`, { method: 'POST', cookie: adminCookie, body: { days: 5 } });
  const expiry = new Date(extended.data.restaurant.expiryDate);
  check(extended.data.restaurant.canManageMenu, 'extend restores access');
  check(Math.abs(expiry.getTime() - (beforeExtend.getTime() + 5 * 86400000)) < 15000, 'expired extension starts from now');
  const restored = await request('/api/owner/categories', { method: 'POST', cookie: ownerCookie, body: { name: 'Desserts', description: 'Sweet', isActive: true } });
  check(restored.status === 201, 'owner can edit after extension');
  const kept = await request('/api/owner/dishes?pageSize=50', { cookie: ownerCookie });
  check(kept.data.items.some((dish) => dish.name === 'Dish 1'), 'previous dishes survived renewal');
  const qrAfter = db.prepare('SELECT id FROM qr_codes WHERE restaurant_id = ?').get(restaurantA.id).id;
  check(qrAfter === originalQrId, 'qr code is not regenerated');

  const activeBefore = extended.data.restaurant;
  const stacked = await request(`/api/admin/restaurants/${restaurantA.id}/extend`, { method: 'POST', cookie: adminCookie, body: { days: 10 } });
  const delta = new Date(stacked.data.restaurant.expiryDate).getTime() - new Date(activeBefore.expiryDate).getTime();
  check(Math.abs(delta - 10 * 86400000) < 5000, 'extension before expiry adds to current expiry');
  check(stacked.data.restaurant.activationDate === activeBefore.activationDate, 'activation date stays while subscription is current');

  const reset = await request(`/api/admin/restaurants/${restaurantA.id}/reset-password`, { method: 'POST', cookie: adminCookie, body: { password: 'Newpass@9' } });
  check(reset.status === 200, 'password reset');
  const oldLogin = await request('/api/auth/login', { method: 'POST', body: { username: 'spicehub', password: 'Owner@123', portal: 'owner' } });
  check(oldLogin.status === 401, 'old password rejected');
  owner = await request('/api/auth/login', { method: 'POST', body: { username: 'spicehub', password: 'Newpass@9', portal: 'owner' } });
  check(owner.status === 200, 'new password works');
  ownerCookie = owner.cookie;

  const registerC = await request('/api/auth/register', {
    method: 'POST',
    body: { username: 'rejectedcafe', restaurantName: 'Rejected Cafe', password: 'Owner@123', confirmPassword: 'Owner@123' },
  });
  check(registerC.status === 201, 'register owner C');
  const foundC = await request('/api/admin/restaurants?search=rejectedcafe', { cookie: adminCookie });
  const restaurantC = foundC.data.items[0];
  const rejected = await request(`/api/admin/restaurants/${restaurantC.id}/reject`, { method: 'POST', cookie: adminCookie, body: { reason: 'Incomplete profile' } });
  check(rejected.data.restaurant.activationStatus === 'rejected', 'reject registration');
  const ownerC = await request('/api/auth/login', { method: 'POST', body: { username: 'rejectedcafe', password: 'Owner@123', portal: 'owner' } });
  const recovered = await request('/api/owner/redeem', { method: 'POST', cookie: ownerC.cookie, body: { code: demoTokens.data.tokens[0].code } });
  check(recovered.status === 200 && recovered.data.restaurant.canManageMenu && recovered.data.restaurant.plan === 'demo', 'token overrides rejection and activates');
  check(recovered.data.restaurant.remainingDays >= 2 && recovered.data.restaurant.remainingDays <= 3, 'demo is 3 days');

  const deactivated = await request(`/api/admin/restaurants/${restaurantB.id}/deactivate`, { method: 'POST', cookie: adminCookie, body: {} });
  check(deactivated.data.restaurant.activationStatus === 'deactivated', 'deactivate');
  const deactivatedEdit = await request('/api/owner/categories', { method: 'POST', cookie: ownerBCookie, body: { name: 'Nope', isActive: true } });
  check(deactivatedEdit.status === 403, 'deactivated owner cannot edit');
  const deactivatedMenu = await request(`/api/public/menu/${restaurantB.slug}`);
  check(deactivatedMenu.data.state === 'unavailable', 'deactivated menu hidden');
  await request(`/api/admin/restaurants/${restaurantB.id}/activate`, { method: 'POST', cookie: adminCookie, body: {} });
  const back = await request(`/api/public/menu/${restaurantB.slug}`);
  check(back.data.state === 'ok', 'reactivate restores public menu');

  await request(`/api/admin/restaurants/${restaurantB.id}/block`, { method: 'POST', cookie: adminCookie, body: {} });
  const blockedMenu = await request(`/api/public/menu/${restaurantB.slug}`);
  check(blockedMenu.data.state === 'unavailable', 'blocked menu hidden');
  const blockedEdit = await request('/api/owner/categories', { method: 'POST', cookie: ownerBCookie, body: { name: 'Nope', isActive: true } });
  check(blockedEdit.status === 403, 'blocked owner cannot edit');
  await request(`/api/admin/restaurants/${restaurantB.id}/unblock`, { method: 'POST', cookie: adminCookie, body: {} });
  const unblocked = await request(`/api/public/menu/${restaurantB.slug}`);
  check(unblocked.data.state === 'ok', 'unblock restores menu');

  const audit = await request('/api/admin/audit?search=token.redeem', { cookie: adminCookie });
  check(audit.data.items.some((item) => item.action === 'token.redeem'), 'audit log records redemption');

  const missing = await request('/api/public/menu/does-not-exist');
  check(missing.status === 404, 'unknown menu');

  const tooMany = await request('/api/admin/tokens', { method: 'POST', cookie: adminCookie, body: { plan: 'demo', quantity: 500 } });
  check(tooMany.status === 400, 'token quantity limited');

  const page2 = await request('/api/owner/dishes?page=2&pageSize=10&sort=display_order&dir=asc', { cookie: ownerCookie });
  check(page2.status === 200 && page2.data.page === 2, 'dish pagination');

  console.log(`Passed ${passed} checks`);
} finally {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(dir, { recursive: true, force: true });
}
