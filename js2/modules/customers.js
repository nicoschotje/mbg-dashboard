// Customers module — Surface A (blueprint §9.3, §11.5)
//
// Customers are derived from `orders` aggregated by phone (no standalone
// customers table). Tier data is read/written in customer_tiers.

import { getSB } from '../core/supabase.js';
import { AppState } from '../core/state.js';
import { toast, toastError } from '../core/toast.js';
import {
  formatCurrency, formatRelative, formatDate, escapeHTML,
  tierFromConfig, TIER_NAMES,
} from '../core/utils.js';

let mounted = false;
let paneEl = null;
let listEl = null;
let modalBackdrop = null;
let modalBody = null;

const state = {
  customers: [],   // [{ phone, name, orders, spent, lastOrder, tierRow }]
  tierConfig: [],  // dashboard_settings.TIER_CONFIG — single source of truth for thresholds
  search: '',
  sortBy: 'spent', // spent | orders | last
};

async function loadAll() {
  const sb = getSB();

  // 1) Orders to derive customers (blueprint §9.3 aggregation logic)
  const { data: orders, error: oErr } = await sb
    .from('orders')
    .select('customer_name, customer_phone, contact, total, order_status, created_at')
    .order('created_at', { ascending: false })
    .limit(2000);
  if (oErr) { toastError('Clients load failed: ' + oErr.message); return; }

  const map = {};
  (orders || []).forEach(o => {
    const phone = o.customer_phone || o.contact || 'Unknown';
    if (!map[phone]) {
      map[phone] = { phone, name: o.customer_name || '—', orders: 0, spent: 0, lastOrder: null };
    }
    map[phone].orders += 1;
    if (o.order_status !== 'cancelled') {
      map[phone].spent += parseFloat(o.total || 0);
    }
    if (!map[phone].lastOrder || o.created_at > map[phone].lastOrder) {
      map[phone].lastOrder = o.created_at;
      // Use most recent order's name (blueprint §14.4 fix #1)
      if (o.customer_name) map[phone].name = o.customer_name;
    }
  });

  // 2) Tiers
  const { data: tiers } = await sb
    .from('customer_tiers')
    .select('*')
    .order('lifetime_spent', { ascending: false });
  AppState.tiers = {};
  (tiers || []).forEach(t => { AppState.tiers[t.customer_phone] = t; });

  // Merge tier row into each customer
  state.customers = Object.values(map).map(c => ({
    ...c,
    tierRow: AppState.tiers[c.phone] || null,
  }));

  // Tier ladder — read the owner-configured thresholds (Settings → Tier
  // Configuration) so this tab agrees with Settings and the CRM instead of a
  // hardcoded ladder. TIER_CONFIG is a non-sensitive key (readable here).
  const { data: tcRow } = await sb
    .from('dashboard_settings').select('value').eq('key', 'TIER_CONFIG').maybeSingle();
  try { state.tierConfig = tcRow?.value ? JSON.parse(tcRow.value) : []; }
  catch { state.tierConfig = []; }
}

function tierFor(c) {
  if (c.tierRow) return c.tierRow.tier;
  return tierFromConfig(c.spent, state.tierConfig);
}

function sorted() {
  let rows = [...state.customers];
  if (state.search) {
    const s = state.search.toLowerCase();
    rows = rows.filter(c =>
      (c.name || '').toLowerCase().includes(s) ||
      (c.phone || '').toLowerCase().includes(s)
    );
  }
  if (state.sortBy === 'spent')  rows.sort((a, b) => b.spent - a.spent);
  if (state.sortBy === 'orders') rows.sort((a, b) => b.orders - a.orders);
  if (state.sortBy === 'last')   rows.sort((a, b) => (b.lastOrder || '').localeCompare(a.lastOrder || ''));
  return rows;
}

function customerCardHTML(c) {
  const tier = tierFor(c);
  const tags = c.tierRow?.tags?.length
    ? c.tierRow.tags.map(t => `<span style="background:var(--bg-base);border:1px solid var(--border);padding:1px 7px;border-radius:6px;font-size:10px;margin-right:4px">${escapeHTML(t)}</span>`).join('')
    : '';
  return `
    <article class="customer-card" data-phone="${escapeHTML(c.phone)}">
      <div>
        <div class="customer-name">${escapeHTML(c.name)} <span class="tier-badge tier-${tier}">${TIER_NAMES[tier]}</span></div>
        <div class="customer-meta">📞 ${escapeHTML(c.phone)} · last ${escapeHTML(formatRelative(c.lastOrder))}</div>
        <div style="margin-top:4px">${tags}</div>
      </div>
      <div class="customer-stats">
        <div class="customer-spend">${formatCurrency(c.spent)}</div>
        <div style="color:var(--text-muted);font-size:12px">${c.orders} order${c.orders === 1 ? '' : 's'}</div>
      </div>
    </article>
  `;
}

function render() {
  if (!listEl) return;
  const rows = sorted();
  if (!rows.length) { listEl.innerHTML = `<div class="empty">No clients found.</div>`; return; }
  listEl.innerHTML = rows.map(customerCardHTML).join('');
}

/* ---------- Detail modal ---------- */

async function openDetail(c) {
  // Fetch this customer's order history
  const sb = getSB();
  const { data: orders } = await sb
    .from('orders')
    .select('id, total, order_status, created_at, payment_method')
    .or(`customer_phone.eq.${c.phone},contact.eq.${c.phone}`)
    .order('created_at', { ascending: false })
    .limit(50);

  const tier = tierFor(c);
  const tierRow = c.tierRow || {};
  modalBody.innerHTML = `
    <h2>${escapeHTML(c.name)}</h2>
    <div style="color:var(--text-muted);font-size:12px;margin-bottom:14px">📞 ${escapeHTML(c.phone)}</div>

    <div class="card" style="margin-bottom:12px">
      <div style="display:flex;gap:18px;flex-wrap:wrap">
        <div><div class="kpi-label">Tier</div><div class="kpi-value" style="font-size:18px"><span class="tier-badge tier-${tier}">${TIER_NAMES[tier]}</span></div></div>
        <div><div class="kpi-label">Lifetime spend</div><div class="kpi-value" style="font-size:18px">${formatCurrency(c.spent)}</div></div>
        <div><div class="kpi-label">Orders</div><div class="kpi-value" style="font-size:18px">${c.orders}</div></div>
        <div><div class="kpi-label">Last order</div><div class="kpi-value" style="font-size:14px">${escapeHTML(formatDate(c.lastOrder))}</div></div>
      </div>
    </div>

    <div class="card" style="margin-bottom:12px">
      <label class="field-label">Notes (owner-only)</label>
      <textarea class="input" id="cust-notes" rows="3" placeholder="Add a note…">${escapeHTML(tierRow.notes || '')}</textarea>

      <label class="field-label" style="margin-top:10px">Tags (comma separated)</label>
      <input class="input" id="cust-tags" value="${escapeHTML((tierRow.tags || []).join(', '))}" placeholder="vip, corporate, problematic" />

      <div style="display:flex;gap:8px;margin-top:10px;align-items:center;flex-wrap:wrap">
        <label style="display:flex;align-items:center;gap:6px;color:var(--text-muted);font-size:13px">
          <input type="checkbox" id="cust-optin" ${tierRow.promo_opt_in === false ? '' : 'checked'} /> Promo opt-in
        </label>
        <label style="display:flex;align-items:center;gap:6px;color:var(--text-muted);font-size:13px">
          <input type="checkbox" id="cust-override" ${tierRow.tier_override ? 'checked' : ''} /> Manual tier
        </label>
        <select class="input" id="cust-tier" style="max-width:140px" ${tierRow.tier_override ? '' : 'disabled'}>
          ${[1,2,3,4,5].map(t => `<option value="${t}" ${tier === t ? 'selected' : ''}>${TIER_NAMES[t]}</option>`).join('')}
        </select>
      </div>
    </div>

    <div class="card" style="margin-bottom:12px">
      <div style="font-weight:600;margin-bottom:8px">Order history (${(orders || []).length})</div>
      ${(orders && orders.length) ? orders.map(o => `
        <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px dashed var(--border);font-size:13px">
          <span>${escapeHTML(formatDate(o.created_at))} · <span class="status-badge status-${o.order_status}">${escapeHTML(o.order_status)}</span></span>
          <span style="font-family:'JetBrains Mono',monospace">${formatCurrency(o.total)}</span>
        </div>
      `).join('') : '<div class="empty">No orders.</div>'}
    </div>

    <div class="close-row">
      <a class="btn btn-sm btn-ghost" target="_blank" rel="noopener" href="https://wa.me/${encodeURIComponent(c.phone.replace(/[^0-9+]/g,''))}">WhatsApp</a>
      <a class="btn btn-sm btn-ghost" href="tel:${encodeURIComponent(c.phone)}">Call</a>
      <button class="btn btn-sm" data-d-action="save">Save changes</button>
      <button class="btn btn-sm btn-ghost" data-d-action="close">Close</button>
    </div>
  `;
  modalBackdrop.classList.add('show');

  modalBody.querySelector('#cust-override').addEventListener('change', (e) => {
    modalBody.querySelector('#cust-tier').disabled = !e.target.checked;
  });

  modalBody.querySelectorAll('[data-d-action]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const a = btn.dataset.dAction;
      if (a === 'close') return modalBackdrop.classList.remove('show');
      if (a === 'save') {
        await saveCustomer(c, {
          notes: modalBody.querySelector('#cust-notes').value,
          tagsCSV: modalBody.querySelector('#cust-tags').value,
          optIn: modalBody.querySelector('#cust-optin').checked,
          override: modalBody.querySelector('#cust-override').checked,
          manualTier: parseInt(modalBody.querySelector('#cust-tier').value, 10),
        });
        modalBackdrop.classList.remove('show');
      }
    });
  });
}

async function saveCustomer(c, payload) {
  const sb = getSB();
  const tags = payload.tagsCSV.split(',').map(s => s.trim()).filter(Boolean);
  const tier = payload.override ? payload.manualTier : tierFromConfig(c.spent, state.tierConfig);

  const row = {
    customer_phone: c.phone,
    customer_name: c.name,
    tier,
    tier_override: !!payload.override,
    lifetime_spent: c.spent,
    total_orders: c.orders,
    last_order_at: c.lastOrder,
    notes: payload.notes || null,
    tags,
    promo_opt_in: !!payload.optIn,
    updated_at: new Date().toISOString(),
  };
  const { error } = await sb.from('customer_tiers')
    .upsert(row, { onConflict: 'customer_phone' });
  if (error) { toastError(error.message); return; }
  toast(`Saved ${c.name}.`);
  await loadAll();
  render();
}

/* ---------- Mount ---------- */

function buildPane() {
  paneEl.innerHTML = `
    <div class="filter-row">
      <input class="input" id="cust-search" placeholder="Search name or phone…" />
      <select class="input" id="cust-sort">
        <option value="spent">Top spenders</option>
        <option value="orders">Most orders</option>
        <option value="last">Most recent</option>
      </select>
      <button class="btn btn-ghost btn-sm" id="cust-refresh">Refresh</button>
    </div>
    <div id="cust-list"></div>
  `;
  listEl = paneEl.querySelector('#cust-list');

  paneEl.querySelector('#cust-search').addEventListener('input', (e) => {
    state.search = e.target.value.trim(); render();
  });
  paneEl.querySelector('#cust-sort').addEventListener('change', (e) => {
    state.sortBy = e.target.value; render();
  });
  paneEl.querySelector('#cust-refresh').addEventListener('click', async () => {
    await loadAll(); render();
  });

  listEl.addEventListener('click', (e) => {
    const card = e.target.closest('.customer-card');
    if (!card) return;
    const c = state.customers.find(x => x.phone === card.dataset.phone);
    if (c) openDetail(c);
  });
}

export async function mount(rootPaneEl, ctx) {
  paneEl = rootPaneEl;
  modalBackdrop = ctx.modalBackdrop;
  modalBody = ctx.modalBody;
  if (!mounted) {
    buildPane();
    mounted = true;
    AppState.on('order:insert', async () => { await loadAll(); render(); });
    AppState.on('order:update', async () => { await loadAll(); render(); });
    AppState.on('tiers:changed', async () => { await loadAll(); render(); });
  }
  await loadAll();
  render();
}

export function unmount() {}
