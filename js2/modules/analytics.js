// Sales Analytics Engine v2.0 — Surface C (blueprint §9.9, §11.10, §12)
//
// 6 tabs: Overview, P&L, Products, Customers, Forecasting, Heatmap.
// All Chart.js usage is gated through ensureChart() (Chart.js only loads
// in Surface C per §13.4).

import { getSB } from '../core/supabase.js';
import { toast, toastError } from '../core/toast.js';
import { formatCurrency, escapeHTML } from '../core/utils.js';
import { ensureChart } from '../core/chart-loader.js';

let mounted = false;
let paneEl = null;

// Live chart instances — destroy before re-render to avoid leaks
const charts = {};

const PERIODS = [
  { id: 'today',     label: 'Today',     days: 0 },
  { id: 'yesterday', label: 'Yesterday', days: 0 },
  { id: '7d',        label: '7 days',    days: 7 },
  { id: '30d',       label: '30 days',   days: 30 },
  { id: '90d',       label: '90 days',   days: 90 },
  { id: 'custom',    label: 'Custom',    days: null },
];

const CHART = {
  accent: '#26d4a8',
  accentFill: 'rgba(38,212,168,0.15)',
  text: '#f5f7f6',
  muted: '#9aa5a0',
  grid: '#1c2421',
  cardBg: '#101614',
  forecast: '#fbbf24',
  palette: ['#26d4a8', '#fb9d3c', '#60a5fa', '#fbbf24', '#f87171', '#9aa5a0', '#cd7f32', '#c0c0c0'],
};

const state = {
  period: '30d',
  customStart: null,
  customEnd: null,
  saData: emptySaData(),
  activeTab: 'overview',
};

function emptySaData() {
  return {
    orders: [], prevOrders: [], products: [], productCosts: [],
    computed: emptyComputed(),
  };
}
function emptyComputed() {
  return {
    revenue: 0, cogs: 0, profit: 0, margin: 0,
    totalDisc: 0, totalDel: 0, orderCount: 0, avgOrder: 0,
    completionRate: 0, avgDaily: 0,
    uniqueCusts: 0, repeatCusts: 0, repeatRate: 0,
    uncosted: [],
    byProduct: {}, byCategory: {}, byPayment: {},
    byDay: {}, byHour: {}, byDow: {}, heatmap: {}, byZone: {},
    peakHour: 0, peakDay: '',
    topProducts: [], topRevenue: {}, bestSelling: {}, highestRevProduct: {},
    biggestOrder: {},
    loyalName: '', loyalOrders: 0, loyalSpent: 0, loyalPhone: '',
    prevComputed: null,
  };
}

/* ---------- Period bounds ---------- */

function periodBounds() {
  const now = new Date();
  const startOfDay = (d) => { const x = new Date(d); x.setHours(0,0,0,0); return x; };
  const endOfDay   = (d) => { const x = new Date(d); x.setHours(23,59,59,999); return x; };
  let start, end;
  if (state.period === 'today') {
    start = startOfDay(now); end = endOfDay(now);
  } else if (state.period === 'yesterday') {
    const y = new Date(now); y.setDate(y.getDate() - 1);
    start = startOfDay(y); end = endOfDay(y);
  } else if (state.period === 'custom' && state.customStart && state.customEnd) {
    start = new Date(state.customStart); end = new Date(state.customEnd);
  } else {
    const days = ({ '7d': 7, '30d': 30, '90d': 90 })[state.period] ?? 30;
    start = new Date(now); start.setDate(start.getDate() - (days - 1));
    start = startOfDay(start);
    end = endOfDay(now);
  }
  return { start, end };
}

function previousBounds(bounds) {
  const dur = bounds.end.getTime() - bounds.start.getTime();
  const prevEnd = new Date(bounds.start.getTime() - 1);
  const prevStart = new Date(prevEnd.getTime() - dur);
  return { start: prevStart, end: prevEnd };
}

/* ---------- Data load (§11.10) ---------- */

async function loadAll() {
  const sb = getSB();
  const bounds = periodBounds();
  const prev = previousBounds(bounds);

  // §11.10 exact column list
  const cols = 'id, created_at, total, subtotal, delivery_fee, discount_amount, order_status, payment_method, items, customer_phone, customer_name, contact, delivery_zone';

  const [orders, prevOrders, products, costHistory] = await Promise.all([
    sb.from('orders').select(cols)
      .gte('created_at', bounds.start.toISOString())
      .lte('created_at', bounds.end.toISOString())
      .order('created_at', { ascending: true }),
    sb.from('orders').select('id, created_at, total, subtotal, order_status, customer_phone')
      .gte('created_at', prev.start.toISOString())
      .lte('created_at', prev.end.toISOString()),
    sb.from('products').select('id, name, cost_price, price, category_id'),
    sb.from('product_costs').select('product_id, cost_price, effective_date').order('effective_date', { ascending: false }),
  ]);

  for (const r of [orders, prevOrders, products, costHistory]) {
    if (r.error) toastError('Analytics load: ' + r.error.message);
  }

  // Categories — for byCategory grouping
  const { data: categories } = await sb.from('categories').select('id, name');
  const catMap = {};
  (categories || []).forEach(c => { catMap[c.id] = c.name; });

  state.saData = {
    orders: orders.data || [],
    prevOrders: prevOrders.data || [],
    products: products.data || [],
    productCosts: costHistory.data || [],
    catMap,
  };
  state.saData.computed = compute(state.saData, bounds);
  state.saData.computed.prevComputed = compute({
    orders: state.saData.prevOrders,
    products: state.saData.products,
    productCosts: state.saData.productCosts,
    catMap,
  }, prev, /*isPrev*/ true);

  // Persist snapshot (§3.8 / §14.4 #4)
  saveSnapshot().catch(() => { /* non-blocking */ });
}

/* ---------- Compute (§12.2-§12.4) ---------- */

function compute(d, bounds, isPrev = false) {
  const c = emptyComputed();

  // Build cost lookup: prefer products.cost_price, fall back to most recent
  // product_costs row for that product_id.
  const costLookup = {};
  (d.products || []).forEach(p => { costLookup[p.id] = parseFloat(p.cost_price) || 0; });
  (d.productCosts || []).forEach(row => {
    if (!costLookup[row.product_id] || costLookup[row.product_id] === 0) {
      costLookup[row.product_id] = parseFloat(row.cost_price) || 0;
    }
  });

  // Uncosted products list (§12.1)
  c.uncosted = (d.products || []).filter(p => !p.cost_price || parseFloat(p.cost_price) === 0);

  const productNameLookup = {};
  (d.products || []).forEach(p => { productNameLookup[p.id] = p.name; });

  const customerOrders = {}; // phone -> {name, orders, spent}
  let completed = 0, cancelled = 0;

  (d.orders || []).forEach(o => {
    const phone = o.customer_phone || o.contact || '';
    const isCancelled = o.order_status === 'cancelled';
    const isCompleted = o.order_status === 'completed';

    if (isCompleted) {
      completed += 1;
      c.revenue   += parseFloat(o.total) || 0;
      c.totalDel  += parseFloat(o.delivery_fee) || 0;
      c.totalDisc += parseFloat(o.discount_amount) || 0;
      // COGS — iterate items, multiply cost_price × qty
      (Array.isArray(o.items) ? o.items : []).forEach(item => {
        const cost = costLookup[item.product_id] || 0;
        const qty  = parseInt(item.qty, 10) || 1;
        c.cogs += cost * qty;
      });
    }
    if (isCancelled) cancelled += 1;
    if (!isCancelled) c.orderCount += 1;

    // Per-product / per-category / per-payment / time buckets — all orders
    (Array.isArray(o.items) ? o.items : []).forEach(item => {
      const name = item.name || productNameLookup[item.product_id] || 'Unknown';
      const qty  = parseInt(item.qty, 10) || 1;
      const lineRev = (parseFloat(item.price) || 0) * qty;
      if (!c.byProduct[name]) c.byProduct[name] = { qty: 0, revenue: 0, profit: 0 };
      c.byProduct[name].qty     += qty;
      c.byProduct[name].revenue += lineRev;
      const cost = costLookup[item.product_id] || 0;
      c.byProduct[name].profit  += lineRev - (cost * qty);

      // Category
      const prod = (d.products || []).find(p => p.id === item.product_id);
      const catName = prod ? (d.catMap?.[prod.category_id] || 'Uncategorized') : (item.category || 'Uncategorized');
      if (!c.byCategory[catName]) c.byCategory[catName] = { qty: 0, revenue: 0 };
      c.byCategory[catName].qty     += qty;
      c.byCategory[catName].revenue += lineRev;
    });

    if (o.payment_method) {
      c.byPayment[o.payment_method] = (c.byPayment[o.payment_method] || 0) + 1;
    }

    const dt = new Date(o.created_at);
    const dayKey = dt.toISOString().slice(0, 10);
    c.byDay[dayKey]  = (c.byDay[dayKey]  || 0) + (parseFloat(o.total) || 0);
    const hour = dt.getHours();
    c.byHour[hour] = (c.byHour[hour] || 0) + 1;
    const dow = dt.getDay();
    c.byDow[dow] = (c.byDow[dow] || 0) + 1;
    const hk = `${dow}-${hour}`;
    c.heatmap[hk] = (c.heatmap[hk] || 0) + 1;

    if (o.delivery_zone) {
      if (!c.byZone[o.delivery_zone]) c.byZone[o.delivery_zone] = { count: 0, revenue: 0 };
      c.byZone[o.delivery_zone].count   += 1;
      c.byZone[o.delivery_zone].revenue += parseFloat(o.total) || 0;
    }

    // Customer aggregation (period)
    if (phone) {
      if (!customerOrders[phone]) customerOrders[phone] = { name: o.customer_name || phone, orders: 0, spent: 0 };
      customerOrders[phone].orders += 1;
      if (!isCancelled) customerOrders[phone].spent += parseFloat(o.total) || 0;
    }

    if (!c.biggestOrder.id || (parseFloat(o.total) || 0) > (parseFloat(c.biggestOrder.total) || 0)) {
      c.biggestOrder = o;
    }
  });

  c.profit = c.revenue - c.cogs;
  c.margin = c.revenue > 0 ? (c.profit / c.revenue) * 100 : 0;
  c.avgOrder = c.orderCount > 0 ? c.revenue / c.orderCount : 0;
  c.completionRate = (completed + cancelled) > 0
    ? (completed / (completed + cancelled)) * 100 : 0;

  const days = Math.max(1, Math.ceil((bounds.end - bounds.start) / 86400000));
  c.avgDaily = c.revenue / days;

  // Customers
  const phones = Object.keys(customerOrders);
  c.uniqueCusts = phones.length;
  c.repeatCusts = phones.filter(p => customerOrders[p].orders > 1).length;
  c.repeatRate  = c.uniqueCusts > 0 ? (c.repeatCusts / c.uniqueCusts) * 100 : 0;

  // Top customer (loyal)
  const topPhone = phones.sort((a, b) => customerOrders[b].orders - customerOrders[a].orders)[0];
  if (topPhone) {
    const t = customerOrders[topPhone];
    c.loyalPhone = topPhone; c.loyalName = t.name;
    c.loyalOrders = t.orders; c.loyalSpent = t.spent;
  }
  c.topCustomers = phones
    .map(p => ({ phone: p, ...customerOrders[p] }))
    .sort((a, b) => b.spent - a.spent)
    .slice(0, 10);

  // Top products
  c.topProducts = Object.entries(c.byProduct)
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.revenue - a.revenue);
  c.topRevenue       = c.topProducts[0] || {};
  c.highestRevProduct = c.topRevenue;
  c.bestSelling = Object.entries(c.byProduct)
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.qty - a.qty)[0] || {};

  // Peaks
  let maxH = -1, peakHour = 0;
  for (const [h, v] of Object.entries(c.byHour)) { if (v > maxH) { maxH = v; peakHour = parseInt(h, 10); } }
  c.peakHour = peakHour;
  let maxD = -1, peakDow = 0;
  for (const [d2, v] of Object.entries(c.byDow)) { if (v > maxD) { maxD = v; peakDow = parseInt(d2, 10); } }
  const dowNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  c.peakDay = dowNames[peakDow] || '';

  if (isPrev) c.prevComputed = null;
  return c;
}

/* ---------- Snapshot persistence (§3.8) ---------- */

async function saveSnapshot() {
  const sb = getSB();
  const snapshot = {
    period: state.period,
    revenue: state.saData.computed.revenue,
    orders:  state.saData.computed.orderCount,
    profit:  state.saData.computed.profit,
    margin:  state.saData.computed.margin,
    saved_at: new Date().toISOString(),
  };
  await sb.from('dashboard_settings')
    .upsert({ key: 'analytics_snapshot', value: JSON.stringify(snapshot) }, { onConflict: 'key' });
  await sb.from('dashboard_settings')
    .upsert({ key: 'snapshot_date', value: new Date().toISOString() }, { onConflict: 'key' });
}

/* ---------- Linear regression (§12.3 verbatim) ---------- */

function saLinearRegression(data) {
  const n = data.length;
  if (n < 2) return { slope: 0, intercept: 0, predict: () => 0 };
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  data.forEach((y, x) => { sumX += x; sumY += y; sumXY += x * y; sumX2 += x * x; });
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept, predict: x => Math.max(0, slope * x + intercept) };
}

/* ---------- Render: shell + tab switching ---------- */

const TABS = ['overview', 'pl', 'products', 'customers', 'forecast', 'heatmap'];
const TAB_LABELS = {
  overview: 'Overview', pl: 'P&L', products: 'Products',
  customers: 'Customers', forecast: 'Forecasting', heatmap: 'Heatmap',
};

function renderShell() {
  paneEl.innerHTML = `
    <div class="filter-row">
      <select class="input" id="a-period">
        ${PERIODS.map(p => `<option value="${p.id}" ${p.id === state.period ? 'selected' : ''}>${p.label}</option>`).join('')}
      </select>
      <input class="input" id="a-start" type="datetime-local" style="display:${state.period === 'custom' ? 'block' : 'none'}"/>
      <input class="input" id="a-end"   type="datetime-local" style="display:${state.period === 'custom' ? 'block' : 'none'}"/>
      <button class="btn btn-sm" id="a-recompute">Recompute</button>
    </div>

    <div class="subtabs">
      ${TABS.map(t => `<button data-stab="${t}" class="${t === state.activeTab ? 'active' : ''}">${TAB_LABELS[t]}</button>`).join('')}
    </div>

    ${TABS.map(t => `<div class="subpane ${t === state.activeTab ? 'active' : ''}" id="ap-${t}"></div>`).join('')}
  `;

  paneEl.querySelector('#a-period').addEventListener('change', (e) => {
    state.period = e.target.value;
    renderShell();
    void refresh();
  });
  paneEl.querySelector('#a-start')?.addEventListener('change', (e) => { state.customStart = e.target.value; });
  paneEl.querySelector('#a-end')?.addEventListener('change',   (e) => { state.customEnd   = e.target.value; });
  paneEl.querySelector('#a-recompute').addEventListener('click', refresh);

  paneEl.querySelectorAll('[data-stab]').forEach(b => {
    b.addEventListener('click', () => {
      state.activeTab = b.dataset.stab;
      paneEl.querySelectorAll('[data-stab]').forEach(x => x.classList.toggle('active', x.dataset.stab === state.activeTab));
      paneEl.querySelectorAll('.subpane').forEach(x => x.classList.toggle('active', x.id === `ap-${state.activeTab}`));
      renderActiveTab();
    });
  });
}

async function refresh() {
  toast('Computing analytics…');
  await loadAll();
  renderActiveTab();
}

/* ---------- Tab renderers ---------- */

function destroyChart(key) {
  if (charts[key]) { try { charts[key].destroy(); } catch {} delete charts[key]; }
}

function deltaPct(cur, prev) {
  if (!prev || prev === 0) return null;
  return ((cur - prev) / prev) * 100;
}

function deltaSpan(d) {
  if (d == null) return '<span style="color:var(--text-muted)">—</span>';
  const sign = d >= 0 ? '+' : '';
  const color = d >= 0 ? 'var(--green)' : 'var(--red)';
  const arrow = d >= 0 ? '▲' : '▼';
  return `<span style="color:${color};font-size:11px;font-weight:600;font-family:'JetBrains Mono',monospace">${arrow} ${sign}${d.toFixed(1)}%</span>`;
}

function renderActiveTab() {
  const c = state.saData.computed;
  if (state.activeTab === 'overview')  return renderOverview(c);
  if (state.activeTab === 'pl')        return renderPL(c);
  if (state.activeTab === 'products')  return renderProducts(c);
  if (state.activeTab === 'customers') return renderCustomers(c);
  if (state.activeTab === 'forecast')  return renderForecast(c);
  if (state.activeTab === 'heatmap')   return renderHeatmap(c);
}

async function renderOverview(c) {
  const prev = c.prevComputed || {};
  const host = paneEl.querySelector('#ap-overview');
  host.innerHTML = `
    <div class="kpi-grid" style="margin-bottom:18px">
      <div class="kpi"><div class="kpi-label">Revenue</div>
        <div class="kpi-value">${formatCurrency(c.revenue)}</div>
        <div class="kpi-sub">${deltaSpan(deltaPct(c.revenue, prev.revenue))}</div></div>
      <div class="kpi"><div class="kpi-label">Orders</div>
        <div class="kpi-value">${c.orderCount}</div>
        <div class="kpi-sub">${deltaSpan(deltaPct(c.orderCount, prev.orderCount))}</div></div>
      <div class="kpi"><div class="kpi-label">Avg Order</div>
        <div class="kpi-value">${formatCurrency(c.avgOrder)}</div>
        <div class="kpi-sub">${deltaSpan(deltaPct(c.avgOrder, prev.avgOrder))}</div></div>
      <div class="kpi"><div class="kpi-label">Completion</div>
        <div class="kpi-value">${c.completionRate.toFixed(1)}%</div>
        <div class="kpi-sub">non-cancelled</div></div>
    </div>

    <div class="card" style="margin-bottom:14px">
      <div style="font-weight:600;margin-bottom:10px">Revenue vs COGS (daily)</div>
      <canvas id="ch-revcogs" height="100"></canvas>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;align-items:start">
      <div class="card">
        <div style="font-weight:600;margin-bottom:10px">Payment methods</div>
        <canvas id="ch-pay" height="180"></canvas>
      </div>
      <div class="card">
        <div style="font-weight:600;margin-bottom:10px">Top 5 products by revenue</div>
        ${(c.topProducts.slice(0, 5).length
          ? c.topProducts.slice(0, 5).map(p => `
            <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px dashed var(--border);font-size:13px">
              <span>${escapeHTML(p.name)}</span>
              <span style="font-family:'JetBrains Mono',monospace">${formatCurrency(p.revenue)}</span>
            </div>
          `).join('')
          : '<div class="empty">No revenue in this period.</div>')}
      </div>
    </div>
  `;

  await ensureChart();
  // Build daily series — fill missing days with 0
  const days = Object.keys(c.byDay).sort();
  const labels = days;
  const revData = days.map(d => c.byDay[d]);

  destroyChart('revcogs');
  charts.revcogs = new window.Chart(host.querySelector('#ch-revcogs'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Revenue', data: revData, borderColor: CHART.accent, backgroundColor: CHART.accentFill, tension: 0.3, fill: true },
      ],
    },
    options: { responsive: true, plugins: { legend: { labels: { color: CHART.text } } },
      scales: {
        x: {
          ticks: {
            color: CHART.muted,
            maxRotation: 0,
            autoSkip: true,
            // Show only the day-of-month number, no rotation, no ISO clutter
            callback(value) { return String(this.getLabelForValue(value)).slice(8); },
          },
          grid: { color: CHART.grid },
        },
        y: { ticks: { color: CHART.muted }, grid: { color: CHART.grid } },
      },
    },
  });

  destroyChart('pay');
  const payLabels = Object.keys(c.byPayment);
  charts.pay = new window.Chart(host.querySelector('#ch-pay'), {
    type: 'doughnut',
    data: {
      labels: payLabels,
      datasets: [{
        data: payLabels.map(k => c.byPayment[k]),
        backgroundColor: CHART.palette,
        borderColor: CHART.cardBg,
      }],
    },
    options: { responsive: true, plugins: { legend: { labels: { color: CHART.text, font: { size: 11 } } } } },
  });
}

function renderPL(c) {
  const host = paneEl.querySelector('#ap-pl');
  const prev = c.prevComputed || {};
  host.innerHTML = `
    <div class="kpi-grid" style="margin-bottom:18px">
      <div class="kpi"><div class="kpi-label">Revenue</div><div class="kpi-value">${formatCurrency(c.revenue)}</div></div>
      <div class="kpi"><div class="kpi-label">COGS</div><div class="kpi-value">${formatCurrency(c.cogs)}</div></div>
      <div class="kpi"><div class="kpi-label">Gross profit</div><div class="kpi-value" style="color:var(--green)">${formatCurrency(c.profit)}</div></div>
      <div class="kpi"><div class="kpi-label">Margin</div><div class="kpi-value">${c.margin.toFixed(1)}%</div></div>
    </div>

    <div class="card" style="margin-bottom:14px">
      <div style="font-weight:600;margin-bottom:10px">Breakdown</div>
      <table class="inv-table">
        <tr><td>Subtotals (revenue)</td><td style="text-align:right;font-family:'JetBrains Mono',monospace">${formatCurrency(c.revenue)}</td></tr>
        <tr><td>Delivery fees collected</td><td style="text-align:right;font-family:'JetBrains Mono',monospace">${formatCurrency(c.totalDel)}</td></tr>
        <tr><td>Discounts given</td><td style="text-align:right;font-family:'JetBrains Mono',monospace;color:var(--orange)">-${formatCurrency(c.totalDisc)}</td></tr>
        <tr><td>COGS</td><td style="text-align:right;font-family:'JetBrains Mono',monospace;color:var(--red)">-${formatCurrency(c.cogs)}</td></tr>
        <tr style="border-top:2px solid var(--border)"><td><strong>Gross profit</strong></td><td style="text-align:right;font-family:'JetBrains Mono',monospace;color:var(--green);font-weight:600">${formatCurrency(c.profit)}</td></tr>
      </table>
    </div>

    ${c.uncosted.length ? `
      <div class="card" style="margin-bottom:14px;border-color:var(--orange)">
        <div style="font-weight:600;color:var(--orange);margin-bottom:6px">⚠️ ${c.uncosted.length} uncosted product${c.uncosted.length === 1 ? '' : 's'}</div>
        <div style="color:var(--text-muted);font-size:12px;margin-bottom:8px">These products have no cost_price set — COGS undercounts. Set cost in Inventory or Products.</div>
        <div style="font-size:13px;display:flex;flex-wrap:wrap;gap:6px">
          ${c.uncosted.slice(0, 30).map(p => `<span style="background:var(--bg-base);border:1px solid var(--border);padding:2px 8px;border-radius:6px">${escapeHTML(p.name)}</span>`).join('')}
          ${c.uncosted.length > 30 ? `<span style="color:var(--text-muted)">+${c.uncosted.length - 30} more</span>` : ''}
        </div>
      </div>
    ` : ''}

    <div class="card">
      <div style="font-weight:600;margin-bottom:10px">vs previous period</div>
      <table class="inv-table">
        <thead><tr><th></th><th>Current</th><th>Previous</th><th>Δ</th></tr></thead>
        <tr><td>Revenue</td><td>${formatCurrency(c.revenue)}</td><td>${formatCurrency(prev.revenue || 0)}</td><td>${deltaSpan(deltaPct(c.revenue, prev.revenue))}</td></tr>
        <tr><td>Profit</td><td>${formatCurrency(c.profit)}</td><td>${formatCurrency(prev.profit || 0)}</td><td>${deltaSpan(deltaPct(c.profit, prev.profit))}</td></tr>
        <tr><td>Orders</td><td>${c.orderCount}</td><td>${prev.orderCount || 0}</td><td>${deltaSpan(deltaPct(c.orderCount, prev.orderCount))}</td></tr>
        <tr><td>Margin</td><td>${c.margin.toFixed(1)}%</td><td>${(prev.margin || 0).toFixed(1)}%</td><td>${deltaSpan((c.margin || 0) - (prev.margin || 0))}</td></tr>
      </table>
    </div>
  `;
}

async function renderProducts(c) {
  const host = paneEl.querySelector('#ap-products');
  const top = c.topProducts.slice(0, 12);
  const catLabels = Object.keys(c.byCategory);
  const catHasSpread = catLabels.length > 1;

  // Ranked bar list — no rotated/overlapping axis labels
  const maxRev = top.length ? (top[0].revenue || 0) : 0;
  const barList = top.length
    ? `<div class="bar-list">${top.map(p => {
        const pct = maxRev > 0 ? Math.max(2, (p.revenue / maxRev) * 100) : 0;
        return `<div class="bar-row">
          <span class="bar-name">${escapeHTML(p.name)}</span>
          <span class="bar-value">${formatCurrency(p.revenue)}</span>
          <span class="bar-track"><span class="bar-fill" style="width:${pct}%"></span></span>
        </div>`;
      }).join('')}</div>`
    : '<div class="empty">No product revenue in this period.</div>';

  const categoryCard = catHasSpread
    ? `<div class="card">
        <div class="card-title">By category</div>
        <canvas id="ch-cat" height="180"></canvas>
      </div>`
    : `<div class="card">
        <div class="card-title">By category</div>
        <div class="empty-state">
          <div class="empty-icon">🗂️</div>
          <div class="empty-title">Not enough category data</div>
          <div class="empty-sub">Sales in this period only span one category, so a breakdown chart adds nothing. Assign categories to products to see a split.</div>
        </div>
      </div>`;

  host.innerHTML = `
    <div class="kpi-grid" style="margin-bottom:18px">
      <div class="kpi"><div class="kpi-label">Best seller (units)</div><div class="kpi-value" style="font-size:18px">${escapeHTML(c.bestSelling.name || '—')}</div><div class="kpi-sub">${c.bestSelling.qty || 0} units</div></div>
      <div class="kpi"><div class="kpi-label">Highest revenue</div><div class="kpi-value" style="font-size:18px">${escapeHTML(c.highestRevProduct.name || '—')}</div><div class="kpi-sub">${formatCurrency(c.highestRevProduct.revenue || 0)}</div></div>
      <div class="kpi"><div class="kpi-label">Categories</div><div class="kpi-value">${catLabels.length}</div><div class="kpi-sub">in period</div></div>
    </div>

    <div class="card" style="margin-bottom:14px">
      <div class="card-title">Revenue per product (top 12)</div>
      ${barList}
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
      ${categoryCard}
      <div class="card">
        <div class="card-title">Margin per product</div>
        ${(c.topProducts.slice(0, 10).length
          ? c.topProducts.slice(0, 10).map(p => {
              const m = p.revenue > 0 ? ((p.profit / p.revenue) * 100).toFixed(0) : '—';
              return `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);font-size:13px">
                <span>${escapeHTML(p.name)}</span>
                <span style="font-family:'JetBrains Mono',monospace">${m}${m === '—' ? '' : '%'}</span>
              </div>`;
            }).join('')
          : '<div class="empty">No data.</div>')}
      </div>
    </div>
  `;

  destroyChart('prod');

  if (catHasSpread) {
    await ensureChart();
    destroyChart('cat');
    charts.cat = new window.Chart(host.querySelector('#ch-cat'), {
      type: 'pie',
      data: { labels: catLabels, datasets: [{
        data: catLabels.map(k => c.byCategory[k].revenue),
        backgroundColor: CHART.palette,
        borderColor: CHART.cardBg,
      }] },
      options: { responsive: true, plugins: { legend: { labels: { color: CHART.text, font: { size: 11 } } } } },
    });
  } else {
    destroyChart('cat');
  }
}

async function renderCustomers(c) {
  const host = paneEl.querySelector('#ap-customers');
  host.innerHTML = `
    <div class="kpi-grid" style="margin-bottom:18px">
      <div class="kpi"><div class="kpi-label">Unique customers</div><div class="kpi-value">${c.uniqueCusts}</div></div>
      <div class="kpi"><div class="kpi-label">Repeat rate</div><div class="kpi-value">${c.repeatRate.toFixed(1)}%</div><div class="kpi-sub">${c.repeatCusts} repeat</div></div>
      <div class="kpi"><div class="kpi-label">Top spender</div><div class="kpi-value" style="font-size:16px">${escapeHTML(c.loyalName || '—')}</div><div class="kpi-sub">${formatCurrency(c.loyalSpent)} · ${c.loyalOrders} orders</div></div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
      <div class="card">
        <div style="font-weight:600;margin-bottom:10px">Top customers</div>
        ${(c.topCustomers || []).slice(0, 10).map(cu => `
          <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px dashed var(--border);font-size:13px">
            <span>${escapeHTML(cu.name)} <span style="color:var(--text-muted)">${escapeHTML(cu.phone)}</span></span>
            <span style="font-family:'JetBrains Mono',monospace">${formatCurrency(cu.spent)}</span>
          </div>
        `).join('') || '<div class="empty">No data.</div>'}
      </div>

      <div class="card">
        <div style="font-weight:600;margin-bottom:10px">By delivery zone</div>
        ${Object.entries(c.byZone).length ? Object.entries(c.byZone)
          .sort(([,a],[,b]) => b.revenue - a.revenue)
          .map(([zone, v]) => `
            <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px dashed var(--border);font-size:13px">
              <span>${escapeHTML(zone)} (${v.count})</span>
              <span style="font-family:'JetBrains Mono',monospace">${formatCurrency(v.revenue)}</span>
            </div>
          `).join('') : '<div class="empty">No zone data.</div>'}
      </div>
    </div>
  `;
}

async function renderForecast(c) {
  const host = paneEl.querySelector('#ap-forecast');
  // Build last 30 days series — fill missing days with 0
  const days = [];
  const today = new Date();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today); d.setDate(today.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    days.push({ key, val: c.byDay[key] || 0 });
  }
  const series = days.map(d => d.val);
  const reg = saLinearRegression(series);
  const forecast = [1, 2, 3, 4, 5, 6, 7].map((_, i) => reg.predict(series.length + i));

  const trend = reg.slope > 0.5 ? 'up' : reg.slope < -0.5 ? 'down' : 'flat';
  const trendArrow = trend === 'up' ? '↗' : trend === 'down' ? '↘' : '→';
  const trendColor = trend === 'up' ? 'var(--green)' : trend === 'down' ? 'var(--red)' : 'var(--text-muted)';

  let peakIdx = 0; let peak = forecast[0];
  forecast.forEach((v, i) => { if (v > peak) { peak = v; peakIdx = i; }});
  const peakDate = new Date(today); peakDate.setDate(today.getDate() + peakIdx + 1);

  host.innerHTML = `
    <div class="kpi-grid" style="margin-bottom:18px">
      <div class="kpi"><div class="kpi-label">Trend</div><div class="kpi-value" style="color:${trendColor}">${trendArrow} ${trend.toUpperCase()}</div><div class="kpi-sub">slope ${reg.slope.toFixed(2)}</div></div>
      <div class="kpi"><div class="kpi-label">7-day forecast (sum)</div><div class="kpi-value">${formatCurrency(forecast.reduce((a,b)=>a+b,0))}</div></div>
      <div class="kpi"><div class="kpi-label">Predicted peak</div><div class="kpi-value" style="font-size:14px">${peakDate.toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric' })}</div><div class="kpi-sub">${formatCurrency(peak)}</div></div>
    </div>

    <div class="card">
      <div style="font-weight:600;margin-bottom:10px">Daily revenue (last 30) + 7-day forecast</div>
      <canvas id="ch-fc" height="120"></canvas>
      <div style="color:var(--text-muted);font-size:11px;margin-top:8px">Linear regression on last 30 days. Forecast confidence drops with gaps in data.</div>
    </div>
  `;

  await ensureChart();
  const labels = days.map(d => d.key).concat([1,2,3,4,5,6,7].map(i => {
    const d = new Date(today); d.setDate(today.getDate() + i);
    return d.toISOString().slice(0, 10);
  }));
  const histData = series.concat([null, null, null, null, null, null, null]);
  const fcData = Array(series.length).fill(null).concat(forecast);

  destroyChart('fc');
  charts.fc = new window.Chart(host.querySelector('#ch-fc'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Actual', data: histData, borderColor: CHART.accent, backgroundColor: CHART.accentFill, tension: 0.3, fill: true },
        { label: 'Forecast', data: fcData, borderColor: CHART.forecast, borderDash: [4, 4], tension: 0.3, fill: false },
      ],
    },
    options: { responsive: true, plugins: { legend: { labels: { color: CHART.text } } },
      scales: {
        x: {
          ticks: {
            color: CHART.muted,
            maxRotation: 0,
            autoSkip: true,
            callback(value) { return String(this.getLabelForValue(value)).slice(8); },
          },
          grid: { color: CHART.grid },
        },
        y: { ticks: { color: CHART.muted }, grid: { color: CHART.grid } },
      },
    },
  });
}

function renderHeatmap(c) {
  const host = paneEl.querySelector('#ap-heatmap');
  // Find max
  let max = 0;
  Object.values(c.heatmap).forEach(v => { if (v > max) max = v; });

  const dowNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const cells = [];
  // Header row: hours 0-23
  cells.push('<div class="hm-label" style="background:transparent;border:none"></div>');
  for (let h = 0; h < 24; h++) cells.push(`<div class="hm-label">${h}</div>`);
  // Body rows: 7 days × 24 hours
  for (let d = 0; d < 7; d++) {
    cells.push(`<div class="hm-label">${dowNames[d]}</div>`);
    for (let h = 0; h < 24; h++) {
      const v = c.heatmap[`${d}-${h}`] || 0;
      const intensity = max > 0 ? v / max : 0;
      // Interpolate #070B0A → #00C9A7 by intensity
      const bg = intensity === 0
        ? 'var(--bg-base)'
        : `rgba(38, 212, 168, ${0.15 + intensity * 0.85})`;
      cells.push(`<div class="hm-cell" style="background:${bg}" data-tip="${dowNames[d]} ${h}:00 — ${v} order${v === 1 ? '' : 's'}"></div>`);
    }
  }

  host.innerHTML = `
    <div class="card" style="margin-bottom:14px">
      <div style="font-weight:600;margin-bottom:10px">Order density by day-of-week × hour</div>
      <div class="heatmap-grid">${cells.join('')}</div>
      <div style="display:flex;justify-content:space-between;color:var(--text-muted);font-size:11px;margin-top:10px">
        <span>Peak: ${escapeHTML(c.peakDay)} ${c.peakHour}:00</span>
        <span>Max ${max} order${max === 1 ? '' : 's'} in a single hour</span>
      </div>
    </div>
  `;
}

/* ---------- Mount ---------- */

export async function mount(rootPaneEl) {
  paneEl = rootPaneEl;
  if (!mounted) { renderShell(); mounted = true; }
  // Always re-render shell to refresh control state
  renderShell();
  await refresh();
}
