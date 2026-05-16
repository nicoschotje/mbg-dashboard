// MBG Client Intelligence — Surface C (blueprint §9.10, §10.7-§10.8, §5.3-§5.4)
//
// Heavy lifting (9-layer RFM scoring, action tag assignment) runs server-side
// via the compute-client-intelligence edge function. This module reads the
// computed columns (rfm_score, action_tag, etc.) from mbg_client_intelligence
// and surfaces them in 5 sub-tabs.

import { getSB } from '../core/supabase.js';
import { toast, toastError, toastWarn } from '../core/toast.js';
import { formatCurrency, formatDate, escapeHTML } from '../core/utils.js';

let mounted = false;
let paneEl = null;
let modalBackdrop = null;
let modalBody = null;

const state = {
  clients: [],
  importLog: [],
  activeTab: 'dashboard',
  sortBy: 'rfm_score',
  filterTag: 'all',
};

const ACTION_LABELS = {
  reactivate_now:     'Reactivate Now',
  upsell_opportunity: 'Upsell Opportunity',
  discount_control:   'Discount Control',
  priority_service:   'Priority Service',
  maintain:           'Maintain',
  low_priority:       'Low Priority',
  do_not_chase:       'Do Not Chase',
};

const ACTION_DESCRIPTIONS = {
  reactivate_now:     'Call immediately, offer comeback deal',
  upsell_opportunity: 'Present premium products / bulk pricing',
  discount_control:   'Stop discounting, maintain margin',
  priority_service:   'White-glove service, fast responses',
  maintain:           'Regular check-ins, standard service',
  low_priority:       'Automated messages only',
  do_not_chase:       'Not worth cost of reactivation',
};

const TABS = ['dashboard', 'list', 'detail', 'import', 'scoring'];
const TAB_LABELS = {
  dashboard: 'Dashboard',
  list:      'Client List',
  detail:    'Client Detail',
  import:    'Import',
  scoring:   'Scoring Settings',
};

/* ---------- Data load ---------- */

async function loadAll() {
  const sb = getSB();
  const [clients, importLog] = await Promise.all([
    sb.from('mbg_client_intelligence').select('*').eq('is_active', true).order('rfm_score', { ascending: false }),
    sb.from('mbg_import_log').select('*').order('created_at', { ascending: false }).limit(20),
  ]);
  if (clients.error)   toastError('Clients load: ' + clients.error.message);
  if (importLog.error) toastError('Import log load: ' + importLog.error.message);
  state.clients   = clients.data   || [];
  state.importLog = importLog.data || [];
}

/* ---------- Tab shell ---------- */

function renderShell() {
  paneEl.innerHTML = `
    <div class="filter-row">
      <button class="btn btn-sm" id="i-recompute">Recompute scores</button>
      <button class="btn btn-ghost btn-sm" id="i-refresh">Refresh</button>
    </div>

    <div class="subtabs">
      ${TABS.map(t => `<button data-itab="${t}" class="${t === state.activeTab ? 'active' : ''}">${TAB_LABELS[t]}</button>`).join('')}
    </div>

    ${TABS.map(t => `<div class="subpane ${t === state.activeTab ? 'active' : ''}" id="ip-${t}"></div>`).join('')}
  `;

  paneEl.querySelector('#i-recompute').addEventListener('click', recompute);
  paneEl.querySelector('#i-refresh').addEventListener('click', async () => { await loadAll(); renderActiveTab(); });

  paneEl.querySelectorAll('[data-itab]').forEach(b => {
    b.addEventListener('click', () => {
      state.activeTab = b.dataset.itab;
      paneEl.querySelectorAll('[data-itab]').forEach(x => x.classList.toggle('active', x.dataset.itab === state.activeTab));
      paneEl.querySelectorAll('.subpane').forEach(x => x.classList.toggle('active', x.id === `ip-${state.activeTab}`));
      renderActiveTab();
    });
  });
}

function renderActiveTab() {
  if (state.activeTab === 'dashboard') return renderDashboard();
  if (state.activeTab === 'list')      return renderList();
  if (state.activeTab === 'detail')    return renderDetail();
  if (state.activeTab === 'import')    return renderImport();
  if (state.activeTab === 'scoring')   return renderScoring();
}

/* ---------- Tab: Dashboard ---------- */

function renderDashboard() {
  const host = paneEl.querySelector('#ip-dashboard');
  const total = state.clients.length;
  const totalRev = state.clients.reduce((a, c) => a + (parseFloat(c.total_revenue) || 0), 0);
  const atRisk = state.clients.filter(c => (c.days_since_last || 0) > 30).length;
  const top = [...state.clients].sort((a, b) => (parseFloat(b.total_revenue) || 0) - (parseFloat(a.total_revenue) || 0))[0];

  // Action tag distribution
  const tagCounts = {};
  state.clients.forEach(c => { if (c.action_tag) tagCounts[c.action_tag] = (tagCounts[c.action_tag] || 0) + 1; });

  host.innerHTML = `
    <div class="kpi-grid" style="margin-bottom:18px">
      <div class="kpi"><div class="kpi-label">Active B2B clients</div><div class="kpi-value">${total}</div></div>
      <div class="kpi"><div class="kpi-label">Total B2B revenue</div><div class="kpi-value">${formatCurrency(totalRev)}</div></div>
      <div class="kpi"><div class="kpi-label">At risk (30d+)</div><div class="kpi-value" style="color:${atRisk > 0 ? 'var(--orange)' : 'var(--green)'}">${atRisk}</div></div>
      <div class="kpi"><div class="kpi-label">Top client</div><div class="kpi-value" style="font-size:14px">${escapeHTML(top?.client_name || '—')}</div><div class="kpi-sub">${formatCurrency(top?.total_revenue || 0)}</div></div>
    </div>

    <div class="card">
      <div style="font-weight:600;margin-bottom:10px">Action tag distribution</div>
      ${Object.entries(tagCounts).length
        ? Object.entries(tagCounts).sort(([,a],[,b]) => b - a).map(([tag, n]) => `
          <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px dashed var(--border);font-size:13px">
            <span class="action-tag tag-${tag}">${ACTION_LABELS[tag] || tag}</span>
            <span style="font-family:'JetBrains Mono',monospace">${n}</span>
          </div>
        `).join('')
        : '<div class="empty">No scored clients. Run Recompute scores.</div>'}
    </div>
  `;
}

/* ---------- Tab: Client List ---------- */

function renderList() {
  const host = paneEl.querySelector('#ip-list');
  let rows = [...state.clients];
  if (state.filterTag !== 'all') rows = rows.filter(c => c.action_tag === state.filterTag);
  if (state.sortBy === 'rfm_score')    rows.sort((a, b) => (b.rfm_score || 0) - (a.rfm_score || 0));
  if (state.sortBy === 'revenue')      rows.sort((a, b) => (b.total_revenue || 0) - (a.total_revenue || 0));
  if (state.sortBy === 'recency')      rows.sort((a, b) => (a.days_since_last || 9999) - (b.days_since_last || 9999));
  if (state.sortBy === 'frequency')    rows.sort((a, b) => (b.frequency_score || 0) - (a.frequency_score || 0));

  const tagOptions = ['all', ...Object.keys(ACTION_LABELS)];

  host.innerHTML = `
    <div class="filter-row">
      <select class="input" id="il-sort" style="max-width:180px">
        <option value="rfm_score">RFM score</option>
        <option value="revenue">Revenue</option>
        <option value="recency">Recency</option>
        <option value="frequency">Frequency</option>
      </select>
      <select class="input" id="il-tag" style="max-width:200px">
        ${tagOptions.map(t => `<option value="${t}" ${t === state.filterTag ? 'selected' : ''}>${t === 'all' ? 'All tags' : ACTION_LABELS[t] || t}</option>`).join('')}
      </select>
    </div>

    <div class="card" style="padding:0;overflow:hidden">
      <div style="overflow-x:auto">
        <table class="inv-table">
          <thead>
            <tr>
              <th>Client</th><th>Location</th><th>Action</th>
              <th>RFM</th><th>Revenue</th><th>Orders</th><th>Last</th><th></th>
            </tr>
          </thead>
          <tbody>
            ${rows.length
              ? rows.map(c => `
                <tr data-id="${escapeHTML(c.id)}">
                  <td>
                    <div style="font-weight:600">${escapeHTML(c.client_name || '—')}</div>
                    <div style="color:var(--text-muted);font-size:11px">${escapeHTML(c.contact_person || '')}</div>
                  </td>
                  <td>${escapeHTML(c.location || '—')}</td>
                  <td>${c.action_tag ? `<span class="action-tag tag-${c.action_tag}">${ACTION_LABELS[c.action_tag] || c.action_tag}</span>` : '—'}</td>
                  <td style="font-family:'JetBrains Mono',monospace">${(c.rfm_score || 0).toFixed(1)}</td>
                  <td style="font-family:'JetBrains Mono',monospace">${formatCurrency(c.total_revenue)}</td>
                  <td style="font-family:'JetBrains Mono',monospace">${c.total_orders || 0}</td>
                  <td style="color:var(--text-muted);font-size:12px">${c.days_since_last != null ? `${c.days_since_last}d` : '—'}</td>
                  <td><button class="btn btn-sm btn-ghost" data-action="view">View</button></td>
                </tr>
              `).join('')
              : '<tr><td colspan="8" class="empty">No clients match.</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  `;

  host.querySelector('#il-sort').addEventListener('change', (e) => { state.sortBy = e.target.value; renderList(); });
  host.querySelector('#il-tag').addEventListener('change',  (e) => { state.filterTag = e.target.value; renderList(); });

  host.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="view"]');
    if (!btn) return;
    const tr = btn.closest('tr');
    const c = state.clients.find(x => x.id === tr?.dataset.id);
    if (c) openClientDetail(c);
  });
}

/* ---------- Tab: Client Detail ---------- */

function renderDetail() {
  const host = paneEl.querySelector('#ip-detail');
  host.innerHTML = `<div class="empty">Select a client from the list to see their detail here.</div>`;
}

async function openClientDetail(c) {
  // Load order history
  const sb = getSB();
  const { data: orders } = await sb
    .from('mbg_orders')
    .select('id, order_date, amount, items, payment_status, notes')
    .eq('client_id', c.id)
    .order('order_date', { ascending: false })
    .limit(50);

  modalBody.innerHTML = `
    <h2>${escapeHTML(c.client_name || 'Client')}</h2>
    <div style="color:var(--text-muted);font-size:12px;margin-bottom:14px">
      ${escapeHTML(c.contact_person || '')} ${c.phone ? `· 📞 ${escapeHTML(c.phone)}` : ''} ${c.email ? `· ${escapeHTML(c.email)}` : ''}
      ${c.location ? `<br>📍 ${escapeHTML(c.location)}` : ''}
    </div>

    <div class="card" style="margin-bottom:12px">
      <div style="display:flex;flex-wrap:wrap;gap:14px">
        <div><div class="kpi-label">RFM Score</div><div class="kpi-value">${(c.rfm_score || 0).toFixed(1)}</div></div>
        <div><div class="kpi-label">Recency</div><div class="kpi-value" style="font-size:16px">${(c.recency_score || 0).toFixed(1)}</div></div>
        <div><div class="kpi-label">Frequency</div><div class="kpi-value" style="font-size:16px">${(c.frequency_score || 0).toFixed(1)}</div></div>
        <div><div class="kpi-label">Monetary</div><div class="kpi-value" style="font-size:16px">${(c.monetary_score || 0).toFixed(1)}</div></div>
      </div>
      ${c.action_tag ? `
        <div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--border)">
          <div class="kpi-label">Recommended action</div>
          <div style="margin-top:6px"><span class="action-tag tag-${c.action_tag}">${ACTION_LABELS[c.action_tag] || c.action_tag}</span></div>
          <div style="color:var(--text-muted);font-size:13px;margin-top:6px">${escapeHTML(ACTION_DESCRIPTIONS[c.action_tag] || '')}</div>
        </div>
      ` : ''}
    </div>

    <div class="card" style="margin-bottom:12px">
      <div style="font-weight:600;margin-bottom:8px">Order history (${(orders || []).length})</div>
      ${(orders || []).length ? (orders || []).map(o => `
        <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px dashed var(--border);font-size:13px">
          <span>${escapeHTML(formatDate(o.order_date))} · ${escapeHTML(o.payment_status || 'pending')}</span>
          <span style="font-family:'JetBrains Mono',monospace">${formatCurrency(o.amount)}</span>
        </div>
      `).join('') : '<div class="empty">No orders.</div>'}
    </div>

    <div class="card" style="margin-bottom:12px">
      <label class="field-label">Notes</label>
      <textarea class="input" id="cn-notes" rows="3">${escapeHTML(c.notes || '')}</textarea>
    </div>

    <div class="close-row">
      <button class="btn btn-sm" data-d-act="save">Save notes</button>
      <button class="btn btn-sm btn-ghost" data-d-act="close">Close</button>
    </div>
  `;
  modalBackdrop.classList.add('show');

  modalBody.querySelectorAll('[data-d-act]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (btn.dataset.dAct === 'close') return modalBackdrop.classList.remove('show');
      if (btn.dataset.dAct === 'save') {
        const sb = getSB();
        const { error } = await sb.from('mbg_client_intelligence')
          .update({ notes: modalBody.querySelector('#cn-notes').value, updated_at: new Date().toISOString() })
          .eq('id', c.id);
        if (error) return toastError(error.message);
        toast('Notes saved.');
        modalBackdrop.classList.remove('show');
        await loadAll(); renderActiveTab();
      }
    });
  });
}

/* ---------- Tab: Import (Google Sheets) ---------- */

function renderImport() {
  const host = paneEl.querySelector('#ip-import');
  host.innerHTML = `
    <div class="card" style="margin-bottom:14px">
      <h3 style="margin:0 0 10px;font-family:'Syne',sans-serif">Import from Google Sheets</h3>
      <p style="color:var(--text-muted);font-size:13px;margin:0 0 12px">
        Paste a Google Sheets <strong>publish-to-CSV</strong> URL (Share → Publish to web → CSV).
        The edge function parses it and upserts into <code>mbg_client_intelligence</code>.
      </p>
      <label class="field-label">Sheet URL</label>
      <input class="input" id="im-url" placeholder="https://docs.google.com/spreadsheets/d/.../pub?output=csv"/>
      <div class="field-row" style="margin-top:10px">
        <button class="btn btn-sm" id="im-run">Run import</button>
        <span id="im-status" style="color:var(--text-muted);font-size:12px"></span>
      </div>
    </div>

    <div class="card">
      <div style="font-weight:600;margin-bottom:8px">Import history</div>
      ${state.importLog.length ? state.importLog.map(r => `
        <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px dashed var(--border);font-size:13px">
          <span>
            <span class="status-badge ${r.status === 'success' ? 'status-completed' : (r.status === 'partial' ? 'status-pending' : 'status-cancelled')}">${escapeHTML(r.status)}</span>
            ${escapeHTML(formatDate(r.created_at))}
          </span>
          <span style="font-family:'JetBrains Mono',monospace">${r.rows_imported || 0} rows</span>
        </div>
      `).join('') : '<div class="empty">No imports yet.</div>'}
    </div>
  `;

  host.querySelector('#im-run').addEventListener('click', async () => {
    const url = host.querySelector('#im-url').value.trim();
    if (!url) return toastWarn('Sheet URL required.');
    const status = host.querySelector('#im-status');
    status.textContent = 'Importing…'; status.style.color = 'var(--text-muted)';
    try {
      const sb = getSB();
      // §5.3 edge function
      const { data, error } = await sb.functions.invoke('import-sheets-data', {
        body: { sheet_url: url, sheet_id: extractSheetId(url) },
      });
      if (error) throw error;
      status.textContent = `Imported ${data?.rows_imported ?? 0} rows (${data?.status || 'success'}).`;
      status.style.color = 'var(--green)';
      toast('Import complete.');
      await loadAll(); renderActiveTab();
    } catch (e) {
      status.textContent = e.message || 'Import failed';
      status.style.color = 'var(--red)';
    }
  });
}

function extractSheetId(url) {
  const m = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
  return m ? m[1] : '';
}

/* ---------- Tab: Scoring Settings ---------- */

function renderScoring() {
  const host = paneEl.querySelector('#ip-scoring');
  host.innerHTML = `
    <div class="card" style="margin-bottom:14px">
      <h3 style="margin:0 0 10px;font-family:'Syne',sans-serif">9-Layer RFM Scoring</h3>
      <p style="color:var(--text-muted);font-size:13px;margin:0 0 12px">
        Scoring weights and thresholds are evaluated server-side by the
        <code>compute-client-intelligence</code> edge function (§5.4).
        The dashboard reads pre-computed <code>rfm_score</code> and <code>action_tag</code>.
      </p>
      <div style="font-size:13px;line-height:1.7">
        <div><strong>L1 Recency</strong> (0–33.3) — days since last order</div>
        <div><strong>L2 Frequency</strong> (0–33.3) — orders per month</div>
        <div><strong>L3 Monetary</strong> (0–33.3) — avg order value vs cohort median</div>
        <div style="color:var(--text-muted)">L4 consistency · L5 growth · L6 diversity · L7 reliability · L8 seasonality · L9 duration</div>
      </div>
    </div>

    <div class="card">
      <h3 style="margin:0 0 10px;font-family:'Syne',sans-serif">Action Tag Reference</h3>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${Object.entries(ACTION_LABELS).map(([tag, label]) => `
          <div style="display:flex;gap:10px;align-items:center;font-size:13px">
            <span class="action-tag tag-${tag}" style="min-width:140px;text-align:center">${label}</span>
            <span style="color:var(--text-muted)">${escapeHTML(ACTION_DESCRIPTIONS[tag] || '')}</span>
          </div>
        `).join('')}
      </div>
    </div>

    <div class="card" style="margin-top:14px">
      <div style="font-weight:600;margin-bottom:10px">Recompute</div>
      <p style="color:var(--text-muted);font-size:13px;margin:0 0 10px">
        Triggers <code>compute-client-intelligence</code> for every active client.
      </p>
      <button class="btn btn-sm" id="sc-run">Recompute all scores now</button>
      <span id="sc-status" style="margin-left:10px;color:var(--text-muted);font-size:12px"></span>
    </div>
  `;
  host.querySelector('#sc-run').addEventListener('click', recompute);
}

/* ---------- Recompute (calls edge function §5.4) ---------- */

async function recompute() {
  const status = paneEl.querySelector('#sc-status');
  if (status) { status.textContent = 'Computing…'; status.style.color = 'var(--text-muted)'; }
  toast('Recomputing client scores…');
  try {
    const sb = getSB();
    const { data, error } = await sb.functions.invoke('compute-client-intelligence', { body: {} });
    if (error) throw error;
    if (status) {
      status.textContent = `Processed ${data?.clients_processed ?? '—'} clients in ${data?.computation_ms ?? '—'} ms.`;
      status.style.color = 'var(--green)';
    }
    toast('Scores recomputed.');
    await loadAll(); renderActiveTab();
  } catch (e) {
    if (status) { status.textContent = e.message || 'Recompute failed'; status.style.color = 'var(--red)'; }
    toastError(e.message || 'Recompute failed');
  }
}

/* ---------- Mount ---------- */

export async function mount(rootPaneEl, ctxIn) {
  paneEl = rootPaneEl;
  modalBackdrop = ctxIn.modalBackdrop;
  modalBody = ctxIn.modalBody;
  if (!mounted) { renderShell(); mounted = true; }
  renderShell();
  await loadAll();
  renderActiveTab();
}
