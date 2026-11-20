import { createClient } from '@supabase/supabase-js';

let adminClient;

export function supabaseConfig() {
  const url = process.env.SUPABASE_URL || '';
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || '';
  const secretKey = process.env.SUPABASE_SECRET_KEY || '';
  const jwksUrl = process.env.SUPABASE_JWKS_URL || '';
  return {
    url,
    publishableKey,
    secretKey,
    jwksUrl,
    configured: Boolean(url && publishableKey && secretKey),
  };
}

export function supabaseAdmin() {
  const { url, secretKey, configured } = supabaseConfig();
  if (!configured) return null;
  if (!adminClient) {
    adminClient = createClient(url, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }
  return adminClient;
}

const status = { configured: false, reachable: null, jwks: null };

export function supabaseStatus() {
  return { ...status };
}

export async function probeSupabase() {
  const config = supabaseConfig();
  status.configured = config.configured;
  status.reachable = null;
  status.jwks = null;
  if (!config.configured) return supabaseStatus();
  try {
    const health = await fetch(`${config.url}/auth/v1/health`, {
      headers: { apikey: config.publishableKey },
    });
    status.reachable = health.ok;
  } catch {
    status.reachable = false;
  }
  if (config.jwksUrl) {
    try {
      const jwks = await fetch(config.jwksUrl);
      status.jwks = jwks.ok;
    } catch {
      status.jwks = false;
    }
  }
  return supabaseStatus();
}
