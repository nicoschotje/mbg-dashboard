// Real-time subscriptions for Operations surface (blueprint §7)
//
// Channel: greenies-dashboard-v2-rt (avoids conflict with the legacy monolith
// per blueprint §14.2). Sales role gets a limited subscription (orders only)
// per blueprint §14.4 fix #6.
//
// Retry: exponential backoff 5s -> 10s -> 20s, max 3 attempts.

import { getSB } from './supabase.js';
import { AppState } from './state.js';
import { toast } from './toast.js';

const CHANNEL_NAME = 'greenies-dashboard-v2-rt';
const RETRY_DELAYS = [5_000, 10_000, 20_000];

let _channel = null;
let _retryIdx = 0;
let _retryTimer = null;
let _statusEl = null;

function setStatus(text, color) {
  if (!_statusEl) _statusEl = document.getElementById('rt-status');
  if (_statusEl) {
    _statusEl.textContent = '●  ' + text;
    _statusEl.style.color = color || 'var(--text-muted)';
  }
}

function playOrderSound() {
  try {
    const a = document.getElementById('order-audio');
    if (a) { a.currentTime = 0; a.play().catch(() => {}); }
  } catch {}
}

function flashNavItem(moduleName) {
  const node = document.querySelector(`.nav-item[data-module="${moduleName}"]`);
  if (!node) return;
  node.style.transition = 'background 0.4s';
  node.style.background = 'var(--green-dim)';
  setTimeout(() => { node.style.background = ''; }, 800);
}

function bumpPendingBadge(delta) {
  const badge = document.getElementById('badge-pending');
  if (!badge) return;
  const next = Math.max(0, (parseInt(badge.textContent, 10) || 0) + delta);
  badge.textContent = String(next);
  badge.classList.toggle('show', next > 0);
}

function bumpLowBadge(value) {
  const badge = document.getElementById('badge-low');
  if (!badge) return;
  badge.textContent = String(value);
  badge.classList.toggle('show', value > 0);
}

export { bumpLowBadge };

/* ---------- handlers (blueprint §7) ---------- */

function newOrderRT(order) {
  playOrderSound();
  toast(`New order from ${order.customer_name || 'Customer'} — ${(order.total ? '₱' + order.total : '')}`);
  if (order.order_status === 'pending') bumpPendingBadge(+1);
  flashNavItem('orders');
  AppState.emit('order:insert', order);
  AppState.emit('kpis:dirty');
}

function updOrderRT(order) {
  AppState.emit('order:update', order);
  AppState.emit('kpis:dirty');
}

function productsRT(payload) {
  AppState.emit('products:changed', payload);
  AppState.emit('kpis:dirty');
}

function categoriesRT() {
  AppState.emit('categories:changed');
}

function restockRT(payload) {
  if (payload.eventType === 'INSERT') {
    AppState.emit('restock:new', payload.new);
  }
}

function tiersRT() {
  AppState.emit('tiers:changed');
}


function paymentVerificationInsertRT(pv) {
  // Bump the verifications badge in the sidebar (if present)
  const badge = document.getElementById('badge-verifications');
  if (badge) {
    const next = (parseInt(badge.textContent, 10) || 0) + 1;
    badge.textContent = String(next);
    badge.classList.add('show');
  }
  // Flash the orders nav item — payment verifications live under orders
  flashNavItem('orders');
  // Status-specific toast
  if (pv.status === 'verified') {
    toast(`✓ Payment verified — Order ${pv.expected_reference || ''} (₱${pv.expected_amount || ''})`);
  } else if (pv.status === 'mismatch') {
    toast(`⚠ Payment mismatch — Order ${pv.expected_reference || ''} needs review`);
  } else {
    toast(`📎 Receipt uploaded — Order ${pv.expected_reference || ''} pending review`);
  }
  AppState.emit('payment_verification:insert', pv);
  AppState.emit('kpis:dirty');
}

function paymentVerificationUpdateRT(pv) {
  AppState.emit('payment_verification:update', pv);
  AppState.emit('kpis:dirty');
}

/* ---------- subscribe / retry ---------- */

function buildChannel(role) {
  const sb = getSB();
  const ch = sb.channel(CHANNEL_NAME);

  // Orders — always on
  ch.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' },
       (payload) => newOrderRT(payload.new));
  ch.on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders' },
       (payload) => updOrderRT(payload.new));


    // Payment verifications — always on (both owner and sales can see receipt alerts)
    ch.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'payment_verifications' },
         (payload) => paymentVerificationInsertRT(payload.new));
    ch.on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'payment_verifications' },
         (payload) => paymentVerificationUpdateRT(payload.new));

  // Sales role: limited subscription (orders only) per §14.4
  if (role !== 'sales') {
    ch.on('postgres_changes', { event: '*', schema: 'public', table: 'products' },
         (payload) => productsRT(payload));
    ch.on('postgres_changes', { event: '*', schema: 'public', table: 'categories' },
         (payload) => categoriesRT(payload));
    ch.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'restock_notifications' },
         (payload) => restockRT(payload));
    ch.on('postgres_changes', { event: '*', schema: 'public', table: 'customer_tiers' },
         (payload) => tiersRT(payload));
  }
  return ch;
}

export function subscribeRealtime(role) {
  unsubscribeRealtime();
  setStatus('connecting…');
  const ch = buildChannel(role);

  ch.subscribe((status, err) => {
    if (status === 'SUBSCRIBED') {
      _retryIdx = 0;
      setStatus('live', 'var(--green)');
    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
      setStatus(status === 'CLOSED' ? 'closed' : 'error', 'var(--red)');
      scheduleRetry(role);
    }
  });

  _channel = ch;
  return ch;
}

function scheduleRetry(role) {
  if (_retryIdx >= RETRY_DELAYS.length) {
    setStatus('offline (refresh to retry)', 'var(--red)');
    return;
  }
  const delay = RETRY_DELAYS[_retryIdx++];
  setStatus(`retrying in ${delay / 1000}s…`, 'var(--orange)');
  if (_retryTimer) clearTimeout(_retryTimer);
  _retryTimer = setTimeout(() => subscribeRealtime(role), delay);
}

export function unsubscribeRealtime() {
  if (_retryTimer) { clearTimeout(_retryTimer); _retryTimer = null; }
  if (_channel) {
    try { getSB().removeChannel(_channel); } catch {}
    _channel = null;
  }
}
