// Auth / PIN / session / idle timer (blueprint §8)
//
// - Owner PIN: 6-digit, hashed client-side, stored in dashboard_settings/OWNER_PIN_HASH
// - Sales PIN: 4-digit, hashed client-side, stored in dashboard_settings/SALES_PIN_HASH
// - Both fall back to localStorage (mg_owner_hash / mg_sales_hash) per blueprint
// - Session in sessionStorage, 8h absolute expiry, 30min idle lock

import { hashPIN } from './utils.js';
import { createSB, getSB } from './supabase.js';

const SESSION_KEY = 'mg_sess';
const OWNER_LS_KEY = 'mg_owner_hash';
const SALES_LS_KEY = 'mg_sales_hash';
const ABS_EXPIRY_MS = 8 * 60 * 60 * 1000;
const IDLE_LOCK_MS  = 30 * 60 * 1000;

const DEFAULT_OWNER_PIN = '123456';
const DEFAULT_SALES_PIN = '1234';

// In-memory lockout (blueprint §8.1: 5 fails -> 30s cooldown)
const lockout = { fails: 0, lockedUntil: 0 };
const MAX_FAILS = 5;
const COOLDOWN_MS = 30_000;

let _idleTimer = null;
let _onLock = null;

export function getSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const sess = JSON.parse(raw);
    if (!sess.expiresAt || Date.now() > sess.expiresAt) {
      sessionStorage.removeItem(SESSION_KEY);
      return null;
    }
    return sess;
  } catch {
    return null;
  }
}

function saveSession(sess) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(sess));
}

export function clearSession() {
  sessionStorage.removeItem(SESSION_KEY);
  if (_idleTimer) clearTimeout(_idleTimer);
}

// Pull stored hashes — DB first, localStorage fallback
async function loadStoredHashes() {
  const result = { owner: null, sales: null };
  try {
    const sb = getSB();
    const { data, error } = await sb
      .from('dashboard_settings')
      .select('key,value')
      .in('key', ['OWNER_PIN_HASH', 'SALES_PIN_HASH']);
    if (!error && Array.isArray(data)) {
      for (const row of data) {
        if (row.key === 'OWNER_PIN_HASH') result.owner = row.value;
        if (row.key === 'SALES_PIN_HASH') result.sales = row.value;
      }
    }
  } catch { /* offline / no creds — fall through to LS */ }

  if (!result.owner) result.owner = localStorage.getItem(OWNER_LS_KEY);
  if (!result.sales) result.sales = localStorage.getItem(SALES_LS_KEY);

  // First-run: seed from defaults (and persist to LS so re-launch matches)
  if (!result.owner) {
    result.owner = await hashPIN(DEFAULT_OWNER_PIN);
    localStorage.setItem(OWNER_LS_KEY, result.owner);
  }
  if (!result.sales) {
    result.sales = await hashPIN(DEFAULT_SALES_PIN);
    localStorage.setItem(SALES_LS_KEY, result.sales);
  }
  return result;
}

/**
 * Try a PIN. Returns { ok, role } on success or { ok:false, reason }.
 * On success a Supabase client is created with the captured admin secret
 * and a session is persisted in sessionStorage.
 */
export async function tryLogin(pin, adminSecret) {
  if (Date.now() < lockout.lockedUntil) {
    const wait = Math.ceil((lockout.lockedUntil - Date.now()) / 1000);
    return { ok: false, reason: `Locked. Try again in ${wait}s.` };
  }
  if (!/^\d{4,6}$/.test(pin)) {
    return { ok: false, reason: 'PIN must be 4 or 6 digits.' };
  }

  // Need a client to read stored hashes
  if (!window.__sb_temp_for_hash_read) {
    createSB(adminSecret || '');
    window.__sb_temp_for_hash_read = true;
  }

  const stored = await loadStoredHashes();
  const candidate = await hashPIN(pin);

  let role = null;
  if (candidate === stored.owner && pin.length === 6) role = 'owner';
  else if (candidate === stored.sales && pin.length === 4) role = 'sales';

  if (!role) {
    lockout.fails += 1;
    if (lockout.fails >= MAX_FAILS) {
      lockout.lockedUntil = Date.now() + COOLDOWN_MS;
      lockout.fails = 0;
      return { ok: false, reason: 'Too many failed attempts. Locked 30s.' };
    }
    return { ok: false, reason: `Incorrect PIN (${MAX_FAILS - lockout.fails} left).` };
  }

  lockout.fails = 0;
  // For owner role: if no explicit admin secret, use the PIN itself so that
  // sha256(PIN) matches OWNER_PIN_HASH in is_admin() — enables all DB writes
  // without the user having to fill in a separate "Admin secret" field.
  const effectiveSecret = adminSecret || (role === 'owner' ? pin : '');

  // Reset client so admin secret header is in place for the real session
  createSB(effectiveSecret);

  const now = Date.now();
  const sess = {
    role,
    loginAt: now,
    expiresAt: now + ABS_EXPIRY_MS,
    adminSecret: effectiveSecret,
  };
  saveSession(sess);
  return { ok: true, role, session: sess };
}

export function startIdleTimer(onLock) {
  _onLock = onLock;
  resetIdleTimer();
  ['mousemove', 'keydown', 'touchstart', 'click', 'scroll'].forEach(ev => {
    window.addEventListener(ev, resetIdleTimer, { passive: true });
  });
}

export function resetIdleTimer() {
  if (_idleTimer) clearTimeout(_idleTimer);
  _idleTimer = setTimeout(() => {
    clearSession();
    if (_onLock) _onLock('idle');
  }, IDLE_LOCK_MS);
}

export function isOwner(session) {
  return session && session.role === 'owner';
}
