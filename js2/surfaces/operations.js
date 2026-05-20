// Surface A — Operations Center (blueprint §13.2)
//
// Loaded immediately on login. Owns Orders, Inventory, Customers, and the
// shared KPI bar.

import { getSB } from '../core/supabase.js';
import { AppState } from '../core/state.js';
import { todayBounds, formatCurrency } from '../core/utils.js';

let initialized = false;
const moduleCache = {}; // moduleName -> module exports
const ctx = {};

const KPI_REFRESH_DEBOUNCE = 800;
let kpiTimer = null;

async function refreshKPIs() {
  const sb = getSB();
  const { startISO, endISO } = todayBounds();

  // Today's orders summary
  const { data: todayOrders } = await sb
    .from('orders')
    .select('id, total, order_status, customer_phone, contact')
    .gte('created_at', startISO)
    .lte('created_at', endISO);

  const orders = todayOrders || [];
  const revenue = orders
    .filter(o => o.order_status !== 'cancelled')
    .reduce((acc, o) => acc + (parseFloat(o.total) || 0), 0);
  const phones = new Set(orders.map(o => o.customer_phone || o.contact).filter(Boolean));

  // Pending count (separate query — across all dates)
  const { count: pendingCount } = await sb
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('order_status', 'pending');

  // Low stock count — emulate the "<= threshold" comparison without ref()
  const { data: products } = await sb
    .from('products')
    .select('stock_qty, low_stock_threshold, is_active');
  const lowCount = (products || []).filter(p =>
    p.is_active && (p.stock_qty || 0) <= (p.low_stock_threshold || 0)
  ).length;

  // Paint
  setText('kpi-revenue', formatCurrency(revenue));
  setText('kpi-revenue-sub', `${orders.length} order${orders.length === 1 ? '' : 's'}`);
  setText('kpi-pending', String(pendingCount ?? 0));
  setText('kpi-low', String(lowCount));
  setText('kpi-cust', String(phones.size));

  // Sidebar badges
  const pBadge = document.getElementById('badge-pending');
  if (pBadge) {
    pBadge.textContent = String(pendingCount ?? 0);
    pBadge.classList.toggle('show', (pendingCount ?? 0) > 0);
  }
  const lBadge = document.getElementById('badge-low');
  if (lBadge) {
    lBadge.textContent = String(lowCount);
    lBadge.classList.toggle('show', lowCount > 0);
  }
}

function setText(id, val) {
  const node = document.getElementById(id);
  if (node) node.textContent = val;
}

function debouncedKPIRefresh() {
  if (kpiTimer) clearTimeout(kpiTimer);
  kpiTimer = setTimeout(refreshKPIs, KPI_REFRESH_DEBOUNCE);
}

async function showModule(name) {
  // Tab visuals
  document.querySelectorAll('.nav-item[data-module]').forEach(n => {
    n.classList.toggle('active', n.dataset.module === name);
  });
  document.querySelectorAll('.module-pane').forEach(p => p.classList.remove('active'));
  const pane = document.getElementById(`pane-${name}`);
  if (pane) pane.classList.add('active');

  const titleMap = { orders: 'Orders', inventory: 'Inventory', customers: 'Clients' };
  const titleEl = document.getElementById('header-title');
  if (titleEl) titleEl.textContent = `Operations · ${titleMap[name] || name}`;

  // Lazy import the module on first access
  if (!moduleCache[name]) {
    moduleCache[name] = await import(`../modules/${name}.js`);
  }
  await moduleCache[name].mount(pane, ctx);
}

export async function init(opts) {
  if (initialized) return;
  initialized = true;

  ctx.modalBackdrop = document.getElementById('modal-backdrop');
  ctx.modalBody     = document.getElementById('modal-body');
  ctx.role          = opts?.role || 'owner';

  // Modal close-on-backdrop
  ctx.modalBackdrop.addEventListener('click', (e) => {
    if (e.target === ctx.modalBackdrop) ctx.modalBackdrop.classList.remove('show');
  });

  // Sales role: hide non-orders modules per blueprint §10.10
  if (ctx.role === 'sales') {
    document.querySelectorAll('.nav-item[data-module]').forEach(node => {
      if (node.dataset.module !== 'orders') node.style.display = 'none';
    });
  }

  // Module nav
  document.querySelectorAll('.nav-item[data-module]').forEach(node => {
    node.addEventListener('click', () => showModule(node.dataset.module));
  });

  // KPI refresh on data changes
  AppState.on('kpis:dirty', debouncedKPIRefresh);
  AppState.on('stock:changed', debouncedKPIRefresh);

  // Initial paint
  await refreshKPIs();
  await showModule('orders');
}
