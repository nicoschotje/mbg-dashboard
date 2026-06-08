// Auth / PIN / session / idle timer (blueprint §8)
//
// PIN verification is done SERVER-SIDE via SECURITY DEFINER RPCs:
//   - Owner (6-digit): verify_owner_pin(p_pin) — checks dashboard_settings.OWNER_PIN_HASH
//   - Sales (4-digit): verify_sales_pin(p_pin) — checks dashboard_settings.SALES_PIN_HASH
// The PIN hashes are hidden from the anon key by RLS, so the client can NOT read
// them and must ask the server. This deliberately removes the old client-side
// "default PIN" fallback (123456 / 1234), which let those factory defaults log
// in on any fresh device. See DASHBOARD-AUDIT.md P0-1.
//
// Session in sessionStorage, 8h absolute expiry, 30min idle lock.

import { createSB, getSB } from './supabase.js';

const SESSION_KEY = 'mg_sess';
const ABS_EXPIRY_MS = 8 * 60 * 60 * 1000;
const IDLE_LOCK_MS  = 30 * 60 * 1000;

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

/**
 * Try a PIN. Returns { ok, role } on success or { ok:false, reason }.
 *
 * Verification is server-side: a 6-digit PIN is checked with verify_owner_pin,
 * a 4-digit PIN with verify_sales_pin. There is intentionally NO default-PIN
 * fallback. On owner success a Supabase client is created with the PIN as the
 * x-admin-secret (sha256(PIN) === OWNER_PIN_HASH, so is_admin() passes for the
 * whole session); sales gets no admin secret.
 */
export async function tryLogin(pin, adminSecret) {
  if (Date.now() < lockout.lockedUntil) {
    const wait = Math.ceil((lockout.lockedUntil - Date.now()) / 1000);
    return { ok: false, reason: `Locked. Try again in ${wait}s.` };
  }
  if (!/^\d{4,6}$/.test(pin)) {
    return { ok: false, reason: 'PIN must be 4 or 6 digits.' };
  }

  // The verify RPCs are SECURITY DEFINER + anon-executable, so an anon client
  // (no admin secret) is enough to verify the PIN.
  createSB(adminSecret || '');
  const sb = getSB();

  let role = null;
  try {
    if (pin.length === 6) {
      const { data, error } = await sb.rpc('verify_owner_pin', { p_pin: pin });
      if (error) throw error;
      if (data?.success) {
        role = 'owner';
      } else if (data?.totp_required) {
        return { ok: false, reason: '2FA is enabled for this account — not supported in this build.' };
      }
    } else {
      // 4-digit → sales
      const { data, error } = await sb.rpc('verify_sales_pin', { p_pin: pin });
      if (error) throw error;
      if (data?.success) role = 'sales';
    }
  } catch (e) {
    return { ok: false, reason: 'Login error. Check connection.' };
  }

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

  // Owner: the PIN doubles as the admin secret so every owner write passes
  // is_admin(). Sales role carries no admin secret (cannot perform owner writes).
  const effectiveSecret = role === 'owner' ? (adminSecret || pin) : '';
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
