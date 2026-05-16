// Supabase client init (blueprint §1, §8.3)
//
// SUPA_URL and SUPA_KEY match the existing dashboard so we hit the same project
// without any data-layer divergence. The admin secret is captured at PIN entry
// and forwarded as x-admin-secret on every request (RLS gateway).

const SUPA_URL = 'https://ihnnipynpdtcbdfbpemq.supabase.co';
// NOTE: anon key is intentionally public — same one the storefront uses.
// Replace with the project's actual anon key when wiring to a real environment.
const SUPA_KEY = window.__MBG_SUPA_KEY__ || 'PUBLIC_ANON_KEY_PLACEHOLDER';

export const SUPA_CONFIG = { SUPA_URL, SUPA_KEY };

let _client = null;

export function createSB(adminSecret) {
  if (!window.supabase || !window.supabase.createClient) {
    throw new Error('Supabase JS SDK not loaded');
  }
  _client = window.supabase.createClient(SUPA_URL, SUPA_KEY, {
    auth: {
      storageKey: 'mg-dashboard-v2-auth',
      autoRefreshToken: true,
      persistSession: true,
    },
    global: {
      headers: adminSecret ? { 'x-admin-secret': adminSecret } : {},
    },
  });
  return _client;
}

export function getSB() {
  if (!_client) throw new Error('Supabase client not initialized — call createSB() first');
  return _client;
}
