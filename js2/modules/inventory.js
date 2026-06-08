// Inventory module — Surface A (blueprint §9.2, §11.3, §11.11)

import { getSB } from '../core/supabase.js';
import { AppState } from '../core/state.js';
import { toast, toastError, toastWarn } from '../core/toast.js';
import { formatCurrency, escapeHTML } from '../core/utils.js';
import { bumpLowBadge } from '../core/realtime.js';

let mounted = false;
let paneEl = null;
let tableBodyEl = null;
let restockEl = null;

const state = {
  products: [],
  search: '',
  showLowOnly: false,
  pendingRestocks: [], // restock_notifications rows
};

async function loadProducts() {
  const sb = getSB();
  const { data, error } = await sb
    .from('products')
    .select('*, categories(name, color, icon)')
    .order('sort_order', { ascending: true });
  if (error) { toastError('Inventory load failed: ' + error.message); return; }
  state.products = data || [];
  AppState.products = state.products;
  computeLowBadge();
}

async function loadRestocks() {
  const sb = getSB();
  const { data, error } = await sb
    .from('restock_notifications')
    .select('*, products(name, stock_qty)')
    .is('notified_at', null)
    .order('created_at', { ascending: true });
  // Don't silently swallow: a failed query here used to leave the restock list
  // mysteriously empty. Log it (non-blocking — the inventory grid still renders).
  if (error) { console.warn('[inventory] restock_notifications load failed:', error.message); return; }
  state.pendingRestocks = data || [];
}

function computeLowBadge() {
  const lowCount = state.products.filter(p =>
    p.is_active && (p.stock_qty || 0) <= (p.low_stock_threshold || 0)
  ).length;
  bumpLowBadge(lowCount);
  const k = document.getElementById('kpi-low');
  if (k) k.textContent = String(lowCount);
}

function rowClass(p) {
  const stock = p.stock_qty || 0;
  if (stock <= 0) return 'out';
  if (stock <= (p.low_stock_threshold || 0)) return 'low-stock';
  return '';
}

function marginPct(price, cost) {
  const p = Number(price) || 0;
  const c = Number(cost) || 0;
  if (p <= 0) return '—';
  return Math.round(((p - c) / p) * 100) + '%';
}

function render() {
  if (!tableBodyEl) return;
  let rows = state.products;
  if (state.search) {
    const s = state.search.toLowerCase();
    rows = rows.filter(p =>
      (p.name || '').toLowerCase().includes(s) ||
      (p.sku || '').toLowerCase().includes(s) ||
      (p.categories?.name || '').toLowerCase().includes(s)
    );
  }
  if (state.showLowOnly) {
    rows = rows.filter(p => p.is_active && (p.stock_qty || 0) <= (p.low_stock_threshold || 0));
  }

  if (!rows.length) {
    tableBodyEl.innerHTML = `<tr><td colspan="7" class="empty">No products match.</td></tr>`;
    return;
  }
  tableBodyEl.innerHTML = rows.map(p => `
    <tr class="${rowClass(p)}" data-id="${escapeHTML(p.id)}">
      <td>
        <div style="font-weight:600">${escapeHTML(p.name || '—')}</div>
        <div style="color:var(--text-muted);font-size:11px">${escapeHTML(p.sku || '')}</div>
      </td>
      <td>${escapeHTML(p.categories?.name || '—')}</td>
      <td class="stock">
        <input class="stock-edit" type="number" value="${p.stock_qty || 0}" data-field="stock_qty" min="0" />
      </td>
      <td>
        <input class="stock-edit" type="number" value="${p.low_stock_threshold || 0}" data-field="low_stock_threshold" min="0" />
      </td>
      <td style="font-family:'JetBrains Mono',monospace">${formatCurrency(p.cost_price)}</td>
      <td style="font-family:'JetBrains Mono',monospace">${formatCurrency(p.price)}</td>
      <td style="font-family:'JetBrains Mono',monospace">${marginPct(p.price, p.cost_price)}</td>
    </tr>
  `).join('');
}

function renderRestocks() {
  if (!restockEl) return;
  if (!state.pendingRestocks.length) {
    restockEl.innerHTML = `<div class="empty" style="padding:14px">No clients waiting on restocks.</div>`;
    return;
  }
  // Group by product_id
  const grouped = {};
  state.pendingRestocks.forEach(n => {
    const k = n.product_id || 'unknown';
    if (!grouped[k]) grouped[k] = { product_id: k, name: n.products?.name || n.name || 'Unknown', stock: n.products?.stock_qty || 0, customers: [] };
    grouped[k].customers.push({ contact: n.contact, type: n.contact_type });
  });
  const list = Object.values(grouped);

  restockEl.innerHTML = `
    <div style="font-weight:600;margin-bottom:8px">Restock Queue (${state.pendingRestocks.length})</div>
    ${list.map(g => `
      <div style="background:var(--bg-base);border:1px solid var(--border);border-radius:10px;padding:10px;margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div>
            <div style="font-weight:600">${escapeHTML(g.name)}</div>
            <div style="color:var(--text-muted);font-size:12px">${g.customers.length} client${g.customers.length === 1 ? '' : 's'} waiting · stock ${g.stock}</div>
          </div>
          <button class="btn btn-sm" data-restock-product="${escapeHTML(g.product_id)}"
            ${g.stock > 0 ? '' : 'disabled title="Restock product first"'}>Notify all</button>
        </div>
      </div>
    `).join('')}
  `;
}

/* ---------- Mutations ---------- */

async function updateField(productId, field, value) {
  const sb = getSB();
  const num = parseInt(value, 10);
  if (Number.isNaN(num) || num < 0) {
    toastWarn('Value must be a non-negative integer.');
    return;
  }
  const payload = { [field]: num, updated_at: new Date().toISOString() };
  const { error } = await sb.from('products').update(payload).eq('id', productId);
  if (error) { toastError(error.message); return; }
  // Local update
  const p = state.products.find(x => x.id === productId);
  if (p) p[field] = num;
  computeLowBadge();
  // Flash row
  const row = tableBodyEl.querySelector(`tr[data-id="${productId}"]`);
  if (row) {
    row.classList.add('inv-row-flash');
    setTimeout(() => row.classList.remove('inv-row-flash'), 1500);
  }
  // If stock just went 0 -> positive, surface restock alert
  if (field === 'stock_qty' && num > 0) {
    const waiting = state.pendingRestocks.filter(n => n.product_id === productId);
    if (waiting.length) {
      toastWarn(`${waiting.length} client${waiting.length === 1 ? '' : 's'} waiting for "${p?.name}" — notify from queue.`);
    }
  }
  AppState.emit('stock:changed', { productId, field, value: num });
}

async function notifyAll(productId) {
  const sb = getSB();
  const { error } = await sb.from('restock_notifications')
    .update({ notified_at: new Date().toISOString() })
    .eq('product_id', productId)
    .is('notified_at', null);
  if (error) { toastError(error.message); return; }
  toast('Marked all waiting clients as notified.');
  await loadRestocks();
  renderRestocks();
}

/* ---------- Mount ---------- */

function buildPane() {
  paneEl.innerHTML = `
    <div class="filter-row">
      <input class="input" id="inv-search" placeholder="Search name, SKU, category…" />
      <label style="display:flex;align-items:center;gap:6px;color:var(--text-muted);font-size:13px">
        <input type="checkbox" id="inv-low-only" />
        Low stock only
      </label>
      <button class="btn btn-ghost btn-sm" id="inv-refresh">Refresh</button>
    </div>

    <div class="card" style="padding:0;overflow:hidden;margin-bottom:18px">
      <div style="overflow-x:auto">
        <table class="inv-table">
          <thead>
            <tr>
              <th>Product</th><th>Category</th><th>Stock</th><th>Threshold</th>
              <th>Cost</th><th>Price</th><th>Margin</th>
            </tr>
          </thead>
          <tbody id="inv-tbody"></tbody>
        </table>
      </div>
    </div>

    <div class="card" id="inv-restock"></div>
  `;
  tableBodyEl = paneEl.querySelector('#inv-tbody');
  restockEl   = paneEl.querySelector('#inv-restock');

  paneEl.querySelector('#inv-search').addEventListener('input', (e) => {
    state.search = e.target.value.trim();
    render();
  });
  paneEl.querySelector('#inv-low-only').addEventListener('change', (e) => {
    state.showLowOnly = !!e.target.checked;
    render();
  });
  paneEl.querySelector('#inv-refresh').addEventListener('click', async () => {
    await loadProducts(); await loadRestocks(); render(); renderRestocks();
  });

  // Inline edit listeners
  tableBodyEl.addEventListener('change', async (e) => {
    const input = e.target.closest('input.stock-edit');
    if (!input) return;
    const row = input.closest('tr');
    if (!row) return;
    await updateField(row.dataset.id, input.dataset.field, input.value);
    render();
  });

  restockEl.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-restock-product]');
    if (!btn) return;
    await notifyAll(btn.dataset.restockProduct);
  });
}

export async function mount(rootPaneEl) {
  paneEl = rootPaneEl;
  if (!mounted) {
    buildPane();
    mounted = true;
    AppState.on('products:changed', async () => { await loadProducts(); render(); });
    AppState.on('restock:new', async () => { await loadRestocks(); renderRestocks(); });
  }
  await Promise.all([loadProducts(), loadRestocks()]);
  render();
  renderRestocks();
}

export function unmount() {}
