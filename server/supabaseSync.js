import crypto from 'crypto';
import { db } from './db.js';
import { supabaseAdmin } from './supabase.js';

function emailFor(username) {
  const safe = String(username || '').toLowerCase().replace(/[^a-z0-9._+-]/g, '');
  return `${safe || 'owner'}@owners.scanora.app`;
}

function ownerRow(userId) {
  return db.prepare(`
    SELECT u.id, u.username, u.supabase_user_id,
           r.id AS restaurant_id, r.name, r.slug, r.approval_status, r.account_status,
           s.plan
    FROM users u
    JOIN restaurants r ON r.owner_user_id = u.id
    LEFT JOIN subscriptions s ON s.restaurant_id = r.id
    WHERE u.id = ? AND u.role = 'owner'
  `).get(userId);
}

function metadata(row) {
  return {
    username: row.username,
    role: 'owner',
    restaurant_id: row.restaurant_id,
    restaurant_name: row.name,
    slug: row.slug,
    approval_status: row.approval_status,
    account_status: row.account_status,
    plan: row.plan || 'none',
  };
}

async function findUserIdByEmail(supabase, email) {
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error || !data?.users?.length) return null;
    const found = data.users.find((user) => user.email?.toLowerCase() === email);
    if (found) return found.id;
    if (data.users.length < 200) return null;
  }
  return null;
}

export async function syncOwnerAccount(userId, password) {
  if (process.env.NODE_ENV === 'test') return;
  const supabase = supabaseAdmin();
  if (!supabase || !userId) return;
  const row = ownerRow(userId);
  if (!row) return;
  const user_metadata = metadata(row);
  const email = emailFor(row.username);
  try {
    let supabaseUserId = row.supabase_user_id;
    if (supabaseUserId) {
      const update = { user_metadata };
      if (password) update.password = password;
      const { error } = await supabase.auth.admin.updateUserById(supabaseUserId, update);
      if (!error) return;
      if (!/not found/i.test(error.message || '')) {
        console.error('Supabase owner update failed:', error.message);
        return;
      }
      supabaseUserId = null;
    }
    const created = await supabase.auth.admin.createUser({
      email,
      password: password || `Scanora#${crypto.randomBytes(18).toString('base64url')}`,
      email_confirm: true,
      user_metadata,
    });
    if (created.error) {
      const existingId = /already|registered|exists/i.test(created.error.message || '')
        ? await findUserIdByEmail(supabase, email)
        : null;
      if (!existingId) {
        console.error('Supabase owner create failed:', created.error.message);
        return;
      }
      supabaseUserId = existingId;
      await supabase.auth.admin.updateUserById(existingId, { user_metadata });
    } else {
      supabaseUserId = created.data.user.id;
    }
    db.prepare('UPDATE users SET supabase_user_id = ? WHERE id = ?').run(supabaseUserId, row.id);
  } catch (error) {
    console.error('Supabase owner sync failed:', error.message);
  }
}

export async function removeSupabaseUser(supabaseUserId) {
  if (process.env.NODE_ENV === 'test' || !supabaseUserId) return;
  const supabase = supabaseAdmin();
  if (!supabase) return;
  try {
    const { error } = await supabase.auth.admin.deleteUser(supabaseUserId);
    if (error && !/not found/i.test(error.message || '')) {
      console.error('Supabase owner delete failed:', error.message);
    }
  } catch (error) {
    console.error('Supabase owner delete failed:', error.message);
  }
}

export async function syncAllOwners() {
  if (process.env.NODE_ENV === 'test' || !supabaseAdmin()) return;
  const rows = db.prepare(`SELECT id FROM users WHERE role = 'owner'`).all();
  for (const row of rows) {
    await syncOwnerAccount(row.id);
  }
}
