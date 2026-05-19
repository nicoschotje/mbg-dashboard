// Reports module — Surface C (blueprint §12.5, §13.4)
//
// Pre-built reports that aggregate Supabase data for export. Uses the §12.5
// CSV pattern (BOM + double-quote escaping) and printReport() that opens a
// new window with print-ready HTML.

import { getSB } from '../core/supabase.js';
import { toast, toastError } from '../core/toast.js';
import { formatCurrency, formatDate, escapeHTML } from '../core/utils.js';
import { AppState } from '../core/state.js';

let mounted = false;
let paneEl = null;

const state = {
  rangeKind: '30d',  // 30d | 7d | mtd | ytd | custom
  customStart: null,
  customEnd: null,
};

function bounds() {
  const now = new Date();
  const sod = (d) => { const x = new Date(d); x.setHours(0,0,0,0); return x; };
  const eod = (d) => { const x = new Date(d); x.setHours(23,59,59,999); return x; };
  if (state.rangeKind === 'custom' && state.customStart && state.customEnd) {
    return { start: new Date(state.customStart), end: new Date(state.customEnd) };
  }
  if (state.rangeKind === 'mtd') {
    return { start: sod(new Date(now.getFullYear(), now.getMonth(), 1)), end: eod(now) };
  }
  if (state.rangeKind === 'ytd') {
    return { start: sod(new Date(now.getFullYear(), 0, 1)), end: eod(now) };
  }
  const days = state.rangeKind === '7d' ? 7 : 30;
  const s = new Date(now); s.setDate(s.getDate() - (days - 1));
  return { start: sod(s), end: eod(now) };
}

/* ---------- CSV export (§12.5) ---------- */

function exportCSV(rows, filename) {
  if (!rows.length) { toast('Nothing to export.'); return; }
  const cols = Object.keys(rows[0]);
  const BOM = '﻿';
  const csv = BOM + [cols.join(',')].concat(rows.map(r => cols.map(c => {
    let v = r[c];
    if (v == null) return '';
    if (typeof v === 'object') v = JSON.stringify(v);
    const s = String(v).replace(/"/g, '""');
    return /[,"\n]/.test(s) ? `"${s}"` : s;
  }).join(','))).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
  toast(`Downloaded ${filename}`);
}

/* ---------- Print (§12.5) ---------- */

function printReport(title, htmlBody) {
  const storeName = AppState.settings?.store_name || 'Mr. Beanie\'s Greenies';
  const w = window.open('', '_blank');
  if (!w) { toastError('Popup blocked — allow popups to print.'); return; }
  w.document.write(`
    <html><head><title>${escapeHTML(title)}</title>
    <style>
      body { font-family: system-ui, sans-serif; padding: 24px; max-width: 800px; color: #000; }
      h1 { font-size: 20px; margin: 0 0 4px; }
      h2 { font-size: 14px; margin: 18px 0 8px; }
      table { width: 100%; border-collapse: collapse; font-size: 12px; }
      th, td { padding: 6px 8px; border-bottom: 1px solid #ccc; text-align: left; }
      th { background: #f0f0f0; }
      .muted { color: #666; font-size: 11px; }
      .right { text-align: right; }
      @media print { body { padding: 12px; } }
    </style>
    </head><body>
      <h1>${escapeHTML(storeName)}</h1>
      <div class="muted">${escapeHTML(title)} · generated ${new Date().toLocaleString('en-PH')}</div>
      ${htmlBody}
    </body></html>
  `);
  w.document.close();
  setTimeout(() => w.print(), 300);
}

/* ---------- Report builders ---------- */

async function fetchOrders() {
  const sb = getSB();
  const { start, end } = bounds();
  const { data, error } = await sb.from('orders')
    .select('id, created_at, customer_name, customer_phone, contact, total, subtotal, delivery_fee, discount_amount, order_status, payment_method, payment_status, delivery_zone, items')
    .gte('created_at', start.toISOString())
    .lte('created_at', end.toISOString())
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function buildRevenueReport() {
  const orders = await fetchOrders();
  const completed = orders.filter(o => o.order_status === 'completed');
  const totals = {
    orders_total: orders.length,
    completed: completed.length,
    cancelled: orders.filter(o => o.order_status === 'cancelled').length,
    revenue: completed.reduce((a, o) => a + (parseFloat(o.total) || 0), 0),
    delivery_fees: completed.reduce((a, o) => a + (parseFloat(o.delivery_fee) || 0), 0),
    discounts:    completed.reduce((a, o) => a + (parseFloat(o.discount_amount) || 0), 0),
  };
  return { orders, totals };
}

async function exportOrdersCSV() {
  try {
    const orders = await fetchOrders();
    const rows = orders.map(o => ({
      order_id: o.id,
      created_at: o.created_at,
      customer_name: o.customer_name || '',
      customer_phone: o.customer_phone || o.contact || '',
      total: o.total,
      subtotal: o.subtotal,
      delivery_fee: o.delivery_fee,
      discount_amount: o.discount_amount,
      payment_method: o.payment_method || '',
      payment_status: o.payment_status || '',
      order_status: o.order_status || '',
      delivery_zone: o.delivery_zone || '',
      item_count: Array.isArray(o.items) ? o.items.length : 0,
    }));
    exportCSV(rows, `revenue-${Date.now()}.csv`);
  } catch (e) { toastError(e.message); }
}

async function printRevenueReport() {
  try {
    const { orders, totals } = await buildRevenueReport();
    const { start, end } = bounds();
    const html = `
      <h2>Period</h2>
      <div class="muted">${start.toLocaleDateString('en-PH')} → ${end.toLocaleDateString('en-PH')}</div>

      <h2>Totals</h2>
      <table>
        <tr><td>Orders (all)</td><td class="right">${totals.orders_total}</td></tr>
        <tr><td>Completed</td><td class="right">${totals.completed}</td></tr>
        <tr><td>Cancelled</td><td class="right">${totals.cancelled}</td></tr>
        <tr><td>Revenue (completed)</td><td class="right">${formatCurrency(totals.revenue)}</td></tr>
        <tr><td>Delivery fees</td><td class="right">${formatCurrency(totals.delivery_fees)}</td></tr>
        <tr><td>Discounts given</td><td class="right">${formatCurrency(totals.discounts)}</td></tr>
      </table>

      <h2>Orders (${orders.length})</h2>
      <table>
        <thead><tr><th>When</th><th>Customer</th><th>Status</th><th>Method</th><th class="right">Total</th></tr></thead>
        <tbody>
          ${orders.map(o => `
            <tr>
              <td>${escapeHTML(formatDate(o.created_at))}</td>
              <td>${escapeHTML(o.customer_name || '—')}</td>
              <td>${escapeHTML(o.order_status || '')}</td>
              <td>${escapeHTML(o.payment_method || '')}</td>
              <td class="right">${formatCurrency(o.total)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
    printReport('Revenue Report', html);
  } catch (e) { toastError(e.message); }
}

async function exportProductsCSV() {
  try {
    const sb = getSB();
    const { data, error } = await sb.from('products').select('id, name, sku, price, cost_price, stock_qty, low_stock_threshold, is_active, is_featured, sort_order, category_id');
    if (error) throw error;
    exportCSV(data || [], `products-${Date.now()}.csv`);
  } catch (e) { toastError(e.message); }
}

async function exportCustomersCSV() {
  try {
    const sb = getSB();
    const { data, error } = await sb.from('customer_tiers').select('customer_phone, customer_name, tier, lifetime_spent, total_orders, last_order_at, promo_opt_in, tags, notes');
    if (error) throw error;
    exportCSV(data || [], `customers-${Date.now()}.csv`);
  } catch (e) { toastError(e.message); }
}

async function exportPLCSV() {
  try {
    const sb = getSB();
    const { start, end } = bounds();
    const [ordersRes, productsRes] = await Promise.all([
      sb.from('orders').select('order_status, total, delivery_fee, discount_amount, items')
        .gte('created_at', start.toISOString()).lte('created_at', end.toISOString()),
      sb.from('products').select('id, cost_price'),
    ]);
    if (ordersRes.error)  throw ordersRes.error;
    if (productsRes.error) throw productsRes.error;

    const cost = {};
    (productsRes.data || []).forEach(p => { cost[p.id] = parseFloat(p.cost_price) || 0; });

    const completed = (ordersRes.data || []).filter(o => o.order_status === 'completed');
    const revenue = completed.reduce((a, o) => a + (parseFloat(o.total) || 0), 0);
    const totalDel = completed.reduce((a, o) => a + (parseFloat(o.delivery_fee) || 0), 0);
    const totalDisc = completed.reduce((a, o) => a + (parseFloat(o.discount_amount) || 0), 0);
    let cogs = 0;
    completed.forEach(o => {
      (Array.isArray(o.items) ? o.items : []).forEach(it => {
        cogs += (cost[it.product_id] || 0) * (parseInt(it.qty, 10) || 1);
      });
    });
    const profit = revenue - cogs;
    const margin = revenue > 0 ? (profit / revenue) * 100 : 0;

    const rows = [
      { metric: 'period_start', value: start.toISOString() },
      { metric: 'period_end',   value: end.toISOString() },
      { metric: 'revenue',      value: revenue },
      { metric: 'delivery_fees',value: totalDel },
      { metric: 'discounts',    value: totalDisc },
      { metric: 'cogs',         value: cogs },
      { metric: 'gross_profit', value: profit },
      { metric: 'margin_pct',   value: margin.toFixed(2) },
      { metric: 'completed_orders', value: completed.length },
    ];
    exportCSV(rows, `pl-${Date.now()}.csv`);
  } catch (e) { toastError(e.message); }
}

/* ---------- Mount ---------- */

function buildPane() {
  paneEl.innerHTML = `
    <div class="filter-row">
      <select class="input" id="r-range" style="max-width:200px">
        <option value="7d">Last 7 days</option>
        <option value="30d" selected>Last 30 days</option>
        <option value="mtd">Month-to-date</option>
        <option value="ytd">Year-to-date</option>
        <option value="custom">Custom range</option>
      </select>
      <input class="input" id="r-start" type="datetime-local" style="display:none"/>
      <input class="input" id="r-end"   type="datetime-local" style="display:none"/>
    </div>

    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px">
      <div class="card">
        <h3 style="margin:0 0 8px;font-family:'Syne',sans-serif">Revenue Report</h3>
        <p style="color:var(--text-muted);font-size:13px;margin:0 0 12px">Order list + totals for the selected period.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-sm" data-rep="rev-csv">Export CSV</button>
          <button class="btn btn-sm btn-ghost" data-rep="rev-print">Print</button>
        </div>
      </div>

      <div class="card">
        <h3 style="margin:0 0 8px;font-family:'Syne',sans-serif">P&L Report</h3>
        <p style="color:var(--text-muted);font-size:13px;margin:0 0 12px">Revenue, COGS, gross profit, margin for the period.</p>
        <button class="btn btn-sm" data-rep="pl-csv">Export CSV</button>
      </div>

      <div class="card">
        <h3 style="margin:0 0 8px;font-family:'Syne',sans-serif">Product Catalog</h3>
        <p style="color:var(--text-muted);font-size:13px;margin:0 0 12px">All products with prices, costs, stock.</p>
        <button class="btn btn-sm" data-rep="prod-csv">Export CSV</button>
      </div>

      <div class="card">
        <h3 style="margin:0 0 8px;font-family:'Syne',sans-serif">Customer Tiers</h3>
        <p style="color:var(--text-muted);font-size:13px;margin:0 0 12px">Lifetime spend, tier, opt-in flags, tags.</p>
        <button class="btn btn-sm" data-rep="cust-csv">Export CSV</button>
      </div>
    </div>

    <div style="color:var(--text-muted);font-size:11px;margin-top:18px">
      Exports are UTF-8 with BOM (Excel-compatible). Print opens a popup — allow popups for this domain.
    </div>
  `;

  const rangeEl = paneEl.querySelector('#r-range');
  const startEl = paneEl.querySelector('#r-start');
  const endEl   = paneEl.querySelector('#r-end');
  rangeEl.addEventListener('change', (e) => {
    state.rangeKind = e.target.value;
    const showCustom = state.rangeKind === 'custom';
    startEl.style.display = showCustom ? 'block' : 'none';
    endEl.style.display   = showCustom ? 'block' : 'none';
  });
  startEl.addEventListener('change', (e) => { state.customStart = e.target.value; });
  endEl.addEventListener('change',   (e) => { state.customEnd   = e.target.value; });

  paneEl.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-rep]');
    if (!btn) return;
    const rep = btn.dataset.rep;
    if (rep === 'rev-csv')   return exportOrdersCSV();
    if (rep === 'rev-print') return printRevenueReport();
    if (rep === 'pl-csv')    return exportPLCSV();
    if (rep === 'prod-csv')  return exportProductsCSV();
    if (rep === 'cust-csv')  return exportCustomersCSV();
  });
}

export async function mount(rootPaneEl) {
  paneEl = rootPaneEl;
  if (!mounted) { buildPane(); mounted = true; }
}
