// Orders module — Surface A (blueprint §9.1, §11.2)

import { getSB } from '../core/supabase.js';
import { AppState } from '../core/state.js';
import { toast, toastError, toastWarn } from '../core/toast.js';
import {
  formatCurrency, formatRelative, formatDate, shortId, escapeHTML,
  STATUS_FLOW, STATUS_LABELS, nextStatus, el,
} from '../core/utils.js';

let mounted = false;
let paneEl = null;
let listEl = null;
let modalBackdrop = null;
let modalBody = null;

const filterState = {
  status: 'all',          // all | pending | confirmed | preparing | out_for_delivery | completed | cancelled
  dateRange: 'today',     // today | yesterday | week | all | custom
  payment: 'all',         // all | gcash | maya | bank_transfer | usdt | cod
  search: '',
  customStart: null,
  customEnd: null,
};

function dateBoundsFor(range) {
  const now = new Date();
  const startOfDay = (d) => { const x = new Date(d); x.setHours(0,0,0,0); return x; };
  const endOfDay   = (d) => { const x = new Date(d); x.setHours(23,59,59,999); return x; };
  if (range === 'today') {
    return { start: startOfDay(now), end: endOfDay(now) };
  }
  if (range === 'yesterday') {
    const y = new Date(now); y.setDate(y.getDate() - 1);
    return { start: startOfDay(y), end: endOfDay(y) };
  }
  if (range === 'week') {
    const s = new Date(now); s.setDate(s.getDate() - 6);
    return { start: startOfDay(s), end: endOfDay(now) };
  }
  if (range === 'custom' && filterState.customStart && filterState.customEnd) {
    return { start: new Date(filterState.customStart), end: new Date(filterState.customEnd) };
  }
  return null;
}

async function loadOrders() {
  const sb = getSB();
  let q = sb.from('orders').select('*').order('created_at', { ascending: false }).limit(200);

  if (filterState.status !== 'all') q = q.eq('order_status', filterState.status);
  const bounds = dateBoundsFor(filterState.dateRange);
  if (bounds) {
    q = q.gte('created_at', bounds.start.toISOString())
         .lte('created_at', bounds.end.toISOString());
  }
  if (filterState.payment !== 'all') q = q.eq('payment_method', filterState.payment);

  const { data, error } = await q;
  if (error) {
    toastError('Failed to load orders: ' + error.message);
    return [];
  }
  let rows = data || [];

  // Local search filter (name / phone / order id)
  if (filterState.search) {
    const s = filterState.search.toLowerCase();
    rows = rows.filter(o =>
      (o.customer_name || '').toLowerCase().includes(s) ||
      (o.customer_phone || o.contact || '').toLowerCase().includes(s) ||
      String(o.id || '').toLowerCase().includes(s)
    );
  }
  AppState.orders = rows;
  return rows;
}

function tierBadge(phone) {
  const tier = AppState.tiers[phone];
  if (!tier) return '';
  const names = { 1: 'Seedling', 2: 'Bronze', 3: 'Silver', 4: 'Gold', 5: 'Diamond' };
  return `<span class="tier-badge tier-${tier.tier}">${names[tier.tier]}</span>`;
}

function orderCardHTML(o) {
  const phone = o.customer_phone || o.contact || '';
  const items = Array.isArray(o.order_items) ? o.order_items : [];
  const itemCount = items.reduce((acc, it) => acc + (parseInt(it.qty, 10) || 1), 0);
  const status = o.order_status || 'pending';
  return `
    <article class="order-card" data-id="${escapeHTML(o.id)}">
      <div>
        <div class="order-id">#${shortId(o.id)} · ${escapeHTML(formatRelative(o.created_at))}</div>
        <div class="order-customer">${escapeHTML(o.customer_name || 'Walk-in')} ${tierBadge(phone)}</div>
        <div class="order-meta">
          <span>📞 ${escapeHTML(phone || '—')}</span>
          <span>${escapeHTML(o.payment_method || '—')}</span>
          <span>${itemCount} item${itemCount === 1 ? '' : 's'}</span>
          ${o.delivery_zone ? `<span>📍 ${escapeHTML(o.delivery_zone)}</span>` : ''}
        </div>
      </div>
      <div>
        <div class="order-total">${formatCurrency(o.total)}</div>
        <div style="margin-top:6px"><span class="status-badge status-${status}">${escapeHTML(STATUS_LABELS[status] || status)}</span></div>
      </div>
      <div class="order-actions" data-actions>
        ${nextStatus(status)
          ? `<button class="btn btn-sm" data-action="advance">→ ${escapeHTML(STATUS_LABELS[nextStatus(status)])}</button>`
          : ''}
        ${status !== 'cancelled' && status !== 'completed'
          ? `<button class="btn btn-sm btn-danger" data-action="cancel">Cancel</button>`
          : ''}
        ${o.payment_status !== 'paid'
          ? `<button class="btn btn-sm btn-ghost" data-action="paid">Mark Paid</button>`
          : ''}
        <button class="btn btn-sm btn-ghost" data-action="open">Details</button>
      </div>
    </article>
  `;
}

function render() {
  if (!listEl) return;
  if (!AppState.orders.length) {
    listEl.innerHTML = `<div class="empty">No orders match the current filters.</div>`;
    return;
  }
  listEl.innerHTML = AppState.orders.map(orderCardHTML).join('');
}

/* ---------- Telegram notify (§5.2, §10.1, §10.9) ---------- */

// §10.9 message templates per status. Returns null for statuses without a
// customer-facing template (e.g. 'preparing' is internal kitchen state).
function buildStatusMessage(order, newStatus) {
  const name    = order.customer_name || 'there';
  const sid     = shortId(order.id);
  const total   = formatCurrency(order.total);
  const payment = order.payment_method || '';
  const store   = AppState.settings?.store_name || "Mr. Beanie's Greenies";

  if (newStatus === 'confirmed') {
    return `Hi ${name}! Your order #${sid} has been confirmed.\n` +
           `Total: ${total}${payment ? ' via ' + payment : ''}.\n` +
           `We'll notify you when it's being prepared. Thank you! 🌿`;
  }
  if (newStatus === 'out_for_delivery') {
    return `Hi ${name}! Your order #${sid} is now out for delivery!\n` +
           `Rider is on the way. Please be ready. 🛵`;
  }
  if (newStatus === 'completed') {
    return `Hi ${name}! Your order #${sid} has been delivered.\n` +
           `Thank you for choosing ${store}! 🌱`;
  }
  if (newStatus === 'cancelled') {
    return `Hi ${name}, your order #${sid} has been cancelled.\n` +
           `If this was unexpected, please contact us. Sorry for the inconvenience.`;
  }
  return null;
}

// Fire-and-forget Telegram notify. Failure is non-blocking — surfaces as a
// warning toast but never blocks or reverts the status advance.
async function notifyCustomer(order, newStatus) {
  if (!order?.telegram_chat_id) return;            // §10.1: gate on chat ID
  const message = buildStatusMessage(order, newStatus);
  if (!message) return;                            // no template → skip

  const sb = getSB();
  const { error } = await sb.functions.invoke('notify-customer', {
    body: {
      // Edge fn `notify-customer` destructures { order_id, new_status, custom_message }.
      // Sending `status` / `message` made it 400 silently — customers received nothing.
      order_id: order.id,
      new_status: newStatus,
      custom_message: message,
      // Kept for parity; edge fn ignores unknown keys.
      telegram_chat_id: order.telegram_chat_id,
      customer_name: order.customer_name || '',
    },
  });
  if (error) throw error;
}

/* ---------- Mutations (blueprint §11.2) ---------- */

async function quickSetStatus(orderId, newStatus) {
  const sb = getSB();
  // Capture local copy before reload — needed for telegram_chat_id + name
  const order = AppState.orders.find(o => o.id === orderId);

  const { error } = await sb.from('orders')
    .update({ order_status: newStatus, updated_at: new Date().toISOString() })
    .eq('id', orderId);
  if (error) { toastError(error.message); return false; }
  toast(`Order ${shortId(orderId)} → ${STATUS_LABELS[newStatus] || newStatus}`);

  // §10.1: after status update, call notify-customer if chat ID present.
  // Run asynchronously so a failed/slow edge function never blocks the UI.
  if (order?.telegram_chat_id) {
    notifyCustomer(order, newStatus).catch(err => {
      toastWarn(`Telegram notify failed: ${err?.message || err}`);
    });
  }

  await loadOrders();
  render();
  return true;
}

async function advanceStatus(order) {
  const next = nextStatus(order.order_status);
  if (!next) return;
  await quickSetStatus(order.id, next);
}

async function cancelOrder(order) {
  if (!confirm(`Cancel order #${shortId(order.id)}?`)) return;
  await quickSetStatus(order.id, 'cancelled');
}

async function markPaid(order) {
  const sb = getSB();
  const { error } = await sb.from('orders')
    .update({ payment_status: 'paid', updated_at: new Date().toISOString() })
    .eq('id', order.id);
  if (error) { toastError(error.message); return; }
  toast(`Marked paid: #${shortId(order.id)}`);
  await loadOrders();
  render();
}

/* ---------- Detail modal ---------- */

function openDetail(order) {
  if (!modalBackdrop) return;
  const items = Array.isArray(order.order_items) ? order.order_items : [];
  const phone = order.customer_phone || order.contact || '';
  modalBody.innerHTML = `
    <h2>Order #${shortId(order.id)}</h2>
    <div style="color:var(--text-muted);font-size:12px;margin-bottom:14px">
      ${escapeHTML(formatDate(order.created_at))}
      &middot; <span class="status-badge status-${order.order_status}">${escapeHTML(STATUS_LABELS[order.order_status] || order.order_status)}</span>
    </div>

    <div class="card" style="margin-bottom:14px">
      <div style="font-weight:600">${escapeHTML(order.customer_name || '—')} ${tierBadge(phone)}</div>
      <div style="color:var(--text-muted);font-size:13px;margin-top:4px">📞 ${escapeHTML(phone || '—')}</div>
      ${order.delivery_address ? `<div style="font-size:13px;margin-top:6px">📍 ${escapeHTML(order.delivery_address)}</div>` : ''}
      ${order.notes ? `<div style="font-size:13px;margin-top:6px;color:var(--orange)">📝 ${escapeHTML(order.notes)}</div>` : ''}
    </div>

    <div class="card" style="margin-bottom:14px">
      <div style="font-weight:600;margin-bottom:8px">Items</div>
      ${items.length ? items.map(it => `
        <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px dashed var(--border);font-size:13px">
          <span>${escapeHTML(it.name || '—')} × ${escapeHTML(String(it.qty || 1))}</span>
          <span style="font-family:'JetBrains Mono',monospace">${formatCurrency((it.price || 0) * (it.qty || 1))}</span>
        </div>
      `).join('') : '<div class="empty">No items.</div>'}
      <div style="margin-top:10px;display:flex;justify-content:space-between;font-size:13px;color:var(--text-muted)">
        <span>Subtotal</span><span>${formatCurrency(order.subtotal)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:13px;color:var(--text-muted)">
        <span>Delivery</span><span>${formatCurrency(order.delivery_fee)}</span>
      </div>
      ${order.discount_amount ? `<div style="display:flex;justify-content:space-between;font-size:13px;color:var(--text-muted)">
        <span>Discount${order.promo_code ? ' (' + escapeHTML(order.promo_code) + ')' : ''}</span><span>-${formatCurrency(order.discount_amount)}</span>
      </div>` : ''}
      <div style="display:flex;justify-content:space-between;font-weight:600;margin-top:6px;border-top:1px solid var(--border);padding-top:6px">
        <span>Total</span><span style="color:var(--green);font-family:'JetBrains Mono',monospace">${formatCurrency(order.total)}</span>
      </div>
      <div style="margin-top:8px;color:var(--text-muted);font-size:12px">
        ${escapeHTML(order.payment_method || '—')} · ${escapeHTML(order.payment_status || 'pending')}
      </div>
    </div>

    <div class="close-row">
      ${nextStatus(order.order_status) ? `<button class="btn btn-sm" data-d-action="advance">→ ${escapeHTML(STATUS_LABELS[nextStatus(order.order_status)])}</button>` : ''}
      ${order.order_status !== 'cancelled' && order.order_status !== 'completed'
        ? `<button class="btn btn-sm btn-danger" data-d-action="cancel">Cancel order</button>` : ''}
      <button class="btn btn-sm btn-ghost" data-d-action="print">Print</button>
      <button class="btn btn-sm btn-ghost" data-d-action="close">Close</button>
    </div>
  `;
  modalBackdrop.classList.add('show');

  modalBody.querySelectorAll('[data-d-action]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const action = btn.dataset.dAction;
      if (action === 'close')   modalBackdrop.classList.remove('show');
      if (action === 'advance') { await advanceStatus(order); modalBackdrop.classList.remove('show'); }
      if (action === 'cancel')  { await cancelOrder(order);   modalBackdrop.classList.remove('show'); }
      if (action === 'print')   printReceipt(order);
    });
  });
}

function printReceipt(order) {
  const items = Array.isArray(order.order_items) ? order.order_items : [];
  const settings = AppState.settings || {};
  const storeName = settings.store_name || "Mr. Beanie's Greenies";
  const storeFooter = [settings.store_phone, settings.store_address].filter(Boolean).join(' · ');
  const html = `
    <html><head><title>Receipt #${shortId(order.id)}</title>
    <style>
      body{font-family:system-ui,sans-serif;padding:24px;max-width:480px}
      h1{font-size:18px;margin:0 0 4px} .muted{color:#666;font-size:12px}
      table{width:100%;border-collapse:collapse;margin-top:12px}
      td{padding:4px 0;border-bottom:1px dashed #ccc;font-size:13px}
      .total{font-weight:700;border-top:2px solid #000;padding-top:6px}
    </style></head><body>
      <h1>${escapeHTML(storeName)}</h1>
      ${storeFooter ? `<div class="muted">${escapeHTML(storeFooter)}</div>` : ''}
      <div class="muted">Order #${shortId(order.id)} · ${escapeHTML(formatDate(order.created_at))}</div>
      <p>${escapeHTML(order.customer_name || '')}<br>${escapeHTML(order.customer_phone || order.contact || '')}<br>${escapeHTML(order.delivery_address || '')}</p>
      <table>
        ${items.map(it => `
          <tr><td>${escapeHTML(it.name || '')} × ${escapeHTML(String(it.qty || 1))}</td>
              <td style="text-align:right">${formatCurrency((it.price || 0) * (it.qty || 1))}</td></tr>
        `).join('')}
        <tr><td>Subtotal</td><td style="text-align:right">${formatCurrency(order.subtotal)}</td></tr>
        <tr><td>Delivery</td><td style="text-align:right">${formatCurrency(order.delivery_fee)}</td></tr>
        ${order.discount_amount ? `<tr><td>Discount</td><td style="text-align:right">-${formatCurrency(order.discount_amount)}</td></tr>` : ''}
        <tr class="total"><td>Total</td><td style="text-align:right">${formatCurrency(order.total)}</td></tr>
      </table>
    </body></html>
  `;
  const w = window.open('', '_blank');
  w.document.write(html); w.document.close(); w.print();
}

/* ---------- Mount ---------- */

function buildPane() {
  paneEl.innerHTML = `
    <div class="filter-row">
      <input class="input" id="orders-search" placeholder="Search name, phone, order id…" />
      <select class="input" id="orders-status">
        <option value="all">All statuses</option>
        ${STATUS_FLOW.concat(['cancelled']).map(s => `<option value="${s}">${STATUS_LABELS[s]}</option>`).join('')}
      </select>
      <select class="input" id="orders-date">
        <option value="today">Today</option>
        <option value="yesterday">Yesterday</option>
        <option value="week">Last 7 days</option>
        <option value="all">All time</option>
      </select>
      <select class="input" id="orders-payment">
        <option value="all">All payments</option>
        <option value="gcash">GCash</option>
        <option value="maya">Maya</option>
        <option value="bank_transfer">Bank transfer</option>
        <option value="usdt">USDT</option>
        <option value="cod">COD (legacy)</option>
      </select>
      <button class="btn btn-ghost btn-sm" id="orders-refresh">Refresh</button>
    </div>
    <div id="orders-list"></div>
  `;
  listEl = paneEl.querySelector('#orders-list');

  paneEl.querySelector('#orders-search').addEventListener('input', async (e) => {
    filterState.search = e.target.value.trim();
    render();
  });
  paneEl.querySelector('#orders-status').addEventListener('change', async (e) => {
    filterState.status = e.target.value;
    await loadOrders(); render();
  });
  paneEl.querySelector('#orders-date').addEventListener('change', async (e) => {
    filterState.dateRange = e.target.value;
    await loadOrders(); render();
  });
  paneEl.querySelector('#orders-payment').addEventListener('change', async (e) => {
    filterState.payment = e.target.value;
    await loadOrders(); render();
  });
  paneEl.querySelector('#orders-refresh').addEventListener('click', async () => {
    await loadOrders(); render();
  });

  // Event delegation for order card actions
  listEl.addEventListener('click', async (e) => {
    const card = e.target.closest('.order-card');
    if (!card) return;
    const id = card.dataset.id;
    const order = AppState.orders.find(o => o.id === id);
    if (!order) return;
    const actionBtn = e.target.closest('[data-action]');
    if (!actionBtn) {
      openDetail(order);
      return;
    }
    e.stopPropagation();
    const action = actionBtn.dataset.action;
    if (action === 'advance') await advanceStatus(order);
    else if (action === 'cancel') await cancelOrder(order);
    else if (action === 'paid')   await markPaid(order);
    else if (action === 'open')   openDetail(order);
  });
}

export async function mount(rootPaneEl, ctx) {
  paneEl = rootPaneEl;
  modalBackdrop = ctx.modalBackdrop;
  modalBody = ctx.modalBody;
  if (!mounted) {
    buildPane();
    mounted = true;

    AppState.on('order:insert', async () => { await loadOrders(); render(); });
    AppState.on('order:update', async () => { await loadOrders(); render(); });
    AppState.on('tiers:changed', () => render());
  }
  await loadOrders();
  render();
}

export function unmount() { /* persistent — no teardown needed */ }
