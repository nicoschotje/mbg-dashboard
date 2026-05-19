// Bootstrap — login → realtime → Surface A (Operations)

import { tryLogin, getSession, clearSession, startIdleTimer } from './core/auth.js';
import { createSB, getSB } from './core/supabase.js';
import { AppState } from './core/state.js';
import { subscribeRealtime, unsubscribeRealtime } from './core/realtime.js';
import { toast, toastError } from './core/toast.js';
import { loadStoreSettings, applyBranding } from './core/settings.js';

const overlay = document.getElementById('login-overlay');
const pinInput = document.getElementById('pin-input');
const adminInput = document.getElementById('admin-secret-input');
const pinSubmit = document.getElementById('pin-submit');
const pinErr = document.getElementById('pin-error');
const lockBtn = document.getElementById('lock-btn');
const rolePill = document.getElementById('role-pill');
const storeToggle = document.getElementById('store-toggle');

// Header store open/close toggle — reflects store_settings.is_open
function renderStoreToggle() {
  const isOpen = AppState.settings?.is_open !== false;
  storeToggle.classList.toggle('open', isOpen);
  storeToggle.classList.toggle('closed', !isOpen);
  storeToggle.textContent = isOpen ? '●  OPEN' : '●  CLOSED';
}

storeToggle.addEventListener('click', async () => {
  const isOpen = AppState.settings?.is_open !== false;
  const next = !isOpen;
  const msg = next
    ? 'Open the store? Customers will be able to shop.'
    : 'Close the store? Customers will see a closed screen.';
  if (!confirm(msg)) return;
  try {
    const sb = getSB();
    const { error } = await sb
      .from('store_settings')
      .update({ is_open: next, store_online: next, updated_at: new Date().toISOString() })
      .eq('id', AppState.settings.id);
    if (error) throw error;
    AppState.settings.is_open = next;
    AppState.settings.store_online = next;
    renderStoreToggle();
    toast(next ? 'Store opened.' : 'Store closed.');
  } catch (e) {
    toastError(e.message);
  }
});

function showLogin(message) {
  document.querySelectorAll('.nav-item[data-surface]').forEach(n => { n.style.display = ''; }); wireSurfaceRouter._done = false; overlay.classList.remove('hidden');
  pinInput.value = '';
  if (message) pinErr.textContent = message;
  setTimeout(() => pinInput.focus(), 50);
}

function hideLogin() {
  overlay.classList.add('hidden');
  pinErr.textContent = '';
}

async function handleLogin(role, session) {
  rolePill.textContent = role;
  rolePill.style.color = role === 'owner' ? 'var(--green)' : 'var(--orange)';

  // Load store branding/config — owner may have rebranded since last session
  await loadStoreSettings();
  renderStoreToggle();

  // Subscribe to realtime — sales gets limited subscription
  subscribeRealtime(role);

  // Start idle timer (30 min)
  startIdleTimer((reason) => {
    unsubscribeRealtime();
    showLogin(reason === 'idle' ? 'Locked due to inactivity.' : '');
  });

  // Lazy import Surface A and wire surface router
  const surface = await import('./surfaces/operations.js');
  await surface.init({ role });
  wireSurfaceRouter(role);
}

/* ---------- Surface router (Operations / Content / Intelligence) ---------- */
const surfaceCache = {};
let _activeSurface = 'operations';

async function showSurface(name, role) {
  if (name === _activeSurface) return;

  // Sales role is allowed in Operations only (blueprint §10.10)
  if (role === 'sales' && name !== 'operations') {
    toast('Sales role: Operations only.', 'warn');
    return;
  }

  document.querySelectorAll('.nav-item[data-surface]').forEach(n =>
    n.classList.toggle('active', n.dataset.surface === name));
  document.querySelectorAll('.surface').forEach(s =>
    s.classList.toggle('active', s.id === `surface-${name}`));
  document.querySelectorAll('.nav-group[data-surface-group]').forEach(g =>
    g.classList.toggle('active', g.dataset.surfaceGroup === name));

  if (name === 'content') {
    if (!surfaceCache.content) {
      surfaceCache.content = await import('./surfaces/content.js');
    }
    await surfaceCache.content.init({ role });
  }
  if (name === 'intelligence') {
    if (!surfaceCache.intelligence) {
      surfaceCache.intelligence = await import('./surfaces/intelligence.js');
    }
    await surfaceCache.intelligence.init({ role });
  }

  _activeSurface = name;
}

function wireSurfaceRouter(role) {
  if (wireSurfaceRouter._done) return;
  wireSurfaceRouter._done = true;

  // Sales role: hide Content + Intelligence surface tabs entirely
  if (role === 'sales') {
    document.querySelectorAll('.nav-item[data-surface]').forEach(node => {
      if (node.dataset.surface !== 'operations') node.style.display = 'none';
    });
    return;
  }

  document.querySelectorAll('.nav-item[data-surface]').forEach(node => {
    if (node.classList.contains('disabled-soon')) return;
    node.addEventListener('click', () => showSurface(node.dataset.surface, role));
  });
}

async function attemptLogin() {
  pinErr.textContent = '';
  const pin = pinInput.value.trim();
  const adminSecret = adminInput.value.trim();
  pinSubmit.disabled = true;

  try {
    const result = await tryLogin(pin, adminSecret);
    if (!result.ok) {
      pinErr.textContent = result.reason;
      return;
    }
    hideLogin();
    toast(`Welcome — signed in as ${result.role}.`);
    await handleLogin(result.role, result.session);
  } catch (e) {
    toastError('Login failed: ' + (e?.message || e));
    pinErr.textContent = 'Login error. Check connection.';
  } finally {
    pinSubmit.disabled = false;
  }
}

pinSubmit.addEventListener('click', attemptLogin);
pinInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') attemptLogin(); });
adminInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') attemptLogin(); });

lockBtn.addEventListener('click', () => {
  clearSession();
  unsubscribeRealtime();
  showLogin('Locked.');
});

// Apply saved theme mode (device-local display preference)
document.documentElement.dataset.theme = localStorage.getItem('mbg-theme-mode') || 'dark';

// Paint defaults immediately so the brand never flashes blank
applyBranding();

// Resume session if still valid
(async function boot() {
  const sess = getSession();
  if (sess) {
    try {
      createSB(sess.adminSecret || '');
      hideLogin();
      await handleLogin(sess.role, sess);
      return;
    } catch (e) {
      console.warn('Session resume failed:', e);
      clearSession();
    }
  }
  // Pre-login: read store_settings with the anon key (storefront does the
  // same — it's public branding). If it fails, defaults from settings.js stay.
  try {
    createSB(''); // anon, no admin secret
    await loadStoreSettings();
  } catch (e) {
    console.warn('Pre-login settings load failed:', e?.message || e);
  }
  showLogin();
})();

/* ── Mobile preview toggle ────────────────────────────────────────────────── */
const mobilePreviewBtn = document.getElementById('mobile-preview-btn');

function setMobilePreview(on) {
  document.documentElement.classList.toggle('mobile-preview', on);
  mobilePreviewBtn.classList.toggle('active', on);
  mobilePreviewBtn.title = on ? 'Exit mobile preview' : 'Preview mobile layout';
  localStorage.setItem('mbg-mobile-preview', on ? '1' : '');
}

mobilePreviewBtn.addEventListener('click', () => {
  setMobilePreview(!document.documentElement.classList.contains('mobile-preview'));
});

if (localStorage.getItem('mbg-mobile-preview') === '1') {
  setMobilePreview(true);
}
