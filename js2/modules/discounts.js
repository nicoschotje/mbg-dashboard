// Discounts module — Surface B (blueprint §9.8, §11.7)

import { getSB } from '../core/supabase.js';
import { toast, toastError, toastWarn } from '../core/toast.js';
import { escapeHTML, formatCurrency, formatDate } from '../core/utils.js';

let mounted = false;
let paneEl = null;
let listEl = null;
let modalBackdrop = null;
let modalBody = null;

const state = { codes: [], categories: [], products: [] };

async function load() {
  const sb = getSB();
  const { data, error } = await sb
    .from('discount_rules')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) { toastError('Discount rules load failed: ' + error.message); return; }
  state.codes = data || [];
}

async function loadPickerData() {
  const sb = getSB();
  const [catRes, prodRes] = await Promise.all([
    sb.from('categories').select('id, name, emoji').order('name'),
    sb.from('products').select('id, name, category_id').eq('is_active', true).order('name').limit(500),
  ]);
  state.categories = catRes.data || [];
  state.products   = prodRes.data || [];
}

function isExpired(c) {
  return c.expires_at && new Date(c.expires_at) < new Date();
}
function notStarted(c) {
  return c.starts_at && new Date(c.starts_at) > new Date();
}
function maxedOut(c) {
  return c.max_uses != null && (c.uses_count || 0) >= c.max_uses;
}

function statusFor(c) {
  if (!c.is_active) return { label: 'Inactive', cls: 'status-cancelled' };
  if (isExpired(c)) return { label: 'Expired',  cls: 'status-cancelled' };
  if (notStarted(c)) return { label: 'Scheduled', cls: 'status-pending' };
  if (maxedOut(c))  return { label: 'Maxed out', cls: 'status-cancelled' };
  return { label: 'Active', cls: 'status-completed' };
}

function describeValue(c) {
  const t = c.discount_type;
  if (t === 'percent' || t === 'percentage') return `${c.discount_value}% off${c.max_discount_cap ? ` (max ${formatCurrency(c.max_discount_cap)})` : ''}`;
  if (t === 'fixed')         return `${formatCurrency(c.discount_value)} off`;
  if (t === 'free_delivery') return 'Free delivery';
  return t || '—';
}

function applicabilityBadge(c) {
  if (c.applicable_to === 'all' || !c.applicable_to) return '';
  const ids = Array.isArray(c.applicable_ids) ? c.applicable_ids : [];
  if (c.applicable_to === 'category') {
    const names = ids.map(id => state.categories.find(x => x.id === id)?.name || id).join(', ');
    return `<span style="font-size:11px;color:var(--green);margin-left:6px">📂 ${escapeHTML(names || 'specific categories')}</span>`;
  }
  if (c.applicable_to === 'product') {
    const names = ids.map(id => state.products.find(x => x.id === id)?.name || id).join(', ');
    return `<span style="font-size:11px;color:var(--green);margin-left:6px">📦 ${escapeHTML(names || 'specific products')}</span>`;
  }
  return '';
}

function rowHTML(c) {
  const st = statusFor(c);
  const usesPct = c.max_uses ? Math.min(100, Math.round(((c.uses_count || 0) / c.max_uses) * 100)) : 0;
  return `
    <article class="card" data-id="${escapeHTML(c.id)}" style="margin-bottom:10px">
      <div style="display:flex;gap:14px;align-items:flex-start;flex-wrap:wrap">
        <div style="flex:1;min-width:200px">
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
            <code style="background:var(--bg-base);border:1px solid var(--border);padding:4px 10px;border-radius:6px;font-family:'JetBrains Mono',monospace;font-size:14px;letter-spacing:0.05em">${escapeHTML(c.promo_code || c.code || '—')}</code>
            <span class="status-badge ${st.cls}">${st.label}</span>
          </div>
          <div style="margin-top:6px;font-size:13px">${escapeHTML(describeValue(c))}${applicabilityBadge(c)}</div>
          <div style="color:var(--text-muted);font-size:12px;margin-top:4px">
            ${escapeHTML(c.description || '')}
            ${c.min_order_amount ? ` · min order ${formatCurrency(c.min_order_amount)}` : ''}
            ${c.single_use_per_customer ? ' · single-use per client' : ''}
          </div>
          <div style="color:var(--text-muted);font-size:11px;margin-top:6px">
            uses ${c.uses_count || 0}${c.max_uses ? ` / ${c.max_uses}` : ' (unlimited)'}
            ${c.expires_at ? ` · expires ${escapeHTML(formatDate(c.expires_at))}` : ''}
          </div>
          ${c.max_uses ? `
            <div style="margin-top:6px;height:4px;background:var(--bg-base);border-radius:4px;overflow:hidden">
              <div style="width:${usesPct}%;height:100%;background:var(--green)"></div>
            </div>` : ''}
        </div>
        <div style="display:flex;gap:6px;flex-direction:column">
          <button class="btn btn-sm btn-ghost" data-action="edit">Edit</button>
          <button class="btn btn-sm btn-ghost" data-action="toggle">${c.is_active ? 'Deactivate' : 'Activate'}</button>
          <button class="btn btn-sm btn-danger" data-action="delete">Delete</button>
        </div>
      </div>
    </article>
  `;
}

function render() {
  if (!state.codes.length) {
    listEl.innerHTML = `<div class="empty">No discount codes yet.</div>`;
    return;
  }
  listEl.innerHTML = state.codes.map(rowHTML).join('');
}

/* ---------- Mutations ---------- */

async function toggleActive(c) {
  const sb = getSB();
  const { error } = await sb.from('discount_rules').update({ is_active: !c.is_active }).eq('id', c.id);
  if (error) return toastError(error.message);
  await load(); render();
}

async function deleteCode(c) {
  if (!confirm(`Delete code "${c.promo_code || c.code}"?`)) return;
  const sb = getSB();
  const { error } = await sb.from('discount_rules').delete().eq('id', c.id);
  if (error) return toastError(error.message);
  toast('Code deleted');
  await load(); render();
}

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 8; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s;
}

function openForm(c) {
  const isNew = !c;
  const data = c || {
    promo_code: '', description: '', discount_type: 'percent', discount_value: 10,
    min_order_amount: 0, max_uses: null, uses_count: 0, is_active: true,
    starts_at: null, expires_at: null,
    applicable_to: 'all', applicable_ids: [],
    max_discount_cap: null, single_use_per_customer: false,
  };
  const ids = Array.isArray(data.applicable_ids) ? data.applicable_ids : [];

  modalBody.innerHTML = `
    <h2>${isNew ? 'New discount code' : 'Edit discount code'}</h2>

    <div class="field-row" style="margin-top:6px">
      <div style="flex:2 1 200px">
        <label class="field-label">Code *</label>
        <input class="input" id="f-code" value="${escapeHTML(data.promo_code || data.code || '')}"
          placeholder="WELCOME10"
          style="text-transform:uppercase;font-family:'JetBrains Mono',monospace"/>
      </div>
      <button class="btn btn-sm btn-ghost" id="f-gen" style="align-self:flex-end">Generate</button>
    </div>

    <label class="field-label">Description</label>
    <input class="input" id="f-desc" value="${escapeHTML(data.description || '')}"/>

    <div class="field-row" style="margin-top:10px">
      <div style="flex:1 1 160px">
        <label class="field-label">Type</label>
        <select class="input" id="f-type">
          <option value="percent"        ${(data.discount_type === 'percent' || data.discount_type === 'percentage') ? 'selected' : ''}>Percentage off</option>
          <option value="fixed"          ${data.discount_type === 'fixed' ? 'selected' : ''}>Fixed amount off</option>
          <option value="free_delivery"  ${data.discount_type === 'free_delivery' ? 'selected' : ''}>Free delivery</option>
        </select>
      </div>
      <div style="flex:1 1 120px">
        <label class="field-label">Value</label>
        <input class="input" id="f-val" type="number" min="0" step="0.01" value="${data.discount_value ?? 0}"/>
      </div>
      <div style="flex:1 1 140px">
        <label class="field-label">% cap (₱)</label>
        <input class="input" id="f-cap" type="number" min="0" step="0.01"
          value="${data.max_discount_cap ?? ''}" placeholder="optional"/>
      </div>
    </div>

    <div class="field-row">
      <div style="flex:1 1 140px">
        <label class="field-label">Min order ₱</label>
        <input class="input" id="f-min" type="number" min="0" step="0.01" value="${data.min_order_amount ?? 0}"/>
      </div>
      <div style="flex:1 1 140px">
        <label class="field-label">Max uses</label>
        <input class="input" id="f-max" type="number" min="0" value="${data.max_uses ?? ''}" placeholder="unlimited"/>
      </div>
    </div>

    <div class="field-row">
      <div style="flex:1 1 160px">
        <label class="field-label">Starts at</label>
        <input class="input" id="f-start" type="datetime-local"
          value="${data.starts_at ? new Date(data.starts_at).toISOString().slice(0,16) : ''}"/>
      </div>
      <div style="flex:1 1 160px">
        <label class="field-label">Expires at</label>
        <input class="input" id="f-exp" type="datetime-local"
          value="${data.expires_at ? new Date(data.expires_at).toISOString().slice(0,16) : ''}"/>
      </div>
    </div>

    <!-- ─── Applies to ─── -->
    <div style="margin-top:14px">
      <label class="field-label">Applies to</label>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px" id="applies-pills">
        ${[
          { id: 'all',      label: '🛒 All products' },
          { id: 'category', label: '📂 Category' },
          { id: 'product',  label: '📦 Specific products' },
        ].map(o => `
          <button type="button" class="applies-pill btn btn-sm${data.applicable_to === o.id ? '' : ' btn-ghost'}"
            data-applies="${o.id}">${escapeHTML(o.label)}</button>
        `).join('')}
      </div>
    </div>

    <!-- Category picker (shown when applicable_to = 'category') -->
    <div id="f-cat-picker" style="margin-top:10px;${data.applicable_to === 'category' ? '' : 'display:none'}">
      <label class="field-label">Select categories</label>
      <div style="display:flex;flex-direction:column;gap:6px;max-height:160px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;padding:8px">
        ${state.categories.map(cat => `
          <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer">
            <input type="checkbox" class="cat-check" value="${escapeHTML(cat.id)}"
              ${ids.includes(cat.id) ? 'checked' : ''}/>
            <span>${escapeHTML(cat.emoji || '')} ${escapeHTML(cat.name)}</span>
          </label>
        `).join('')}
        ${!state.categories.length ? '<div style="color:var(--text-muted);font-size:13px">No categories found.</div>' : ''}
      </div>
    </div>

    <!-- Product picker (shown when applicable_to = 'product') -->
    <div id="f-prod-picker" style="margin-top:10px;${data.applicable_to === 'product' ? '' : 'display:none'}">
      <label class="field-label">Select products</label>
      <input class="input" id="f-prod-search" placeholder="Search products…" style="margin-bottom:6px"/>
      <div id="f-prod-list" style="display:flex;flex-direction:column;gap:6px;max-height:200px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;padding:8px">
        ${state.products.map(prod => `
          <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer" data-prod-name="${escapeHTML(prod.name.toLowerCase())}">
            <input type="checkbox" class="prod-check" value="${escapeHTML(prod.id)}"
              ${ids.includes(prod.id) ? 'checked' : ''}/>
            <span>${escapeHTML(prod.name)}</span>
          </label>
        `).join('')}
        ${!state.products.length ? '<div style="color:var(--text-muted);font-size:13px">No products found.</div>' : ''}
      </div>
    </div>

    <div style="display:flex;gap:14px;margin-top:10px;flex-wrap:wrap">
      <label style="display:flex;align-items:center;gap:6px;font-size:13px">
        <input type="checkbox" id="f-active" ${data.is_active ? 'checked' : ''}/> Active
      </label>
      <label style="display:flex;align-items:center;gap:6px;font-size:13px">
        <input type="checkbox" id="f-single" ${data.single_use_per_customer ? 'checked' : ''}/> Single use per client
      </label>
    </div>

    <div class="close-row">
      <button class="btn btn-sm btn-ghost" data-act="close">Cancel</button>
      <button class="btn btn-sm" data-act="save">${isNew ? 'Create' : 'Save'}</button>
    </div>
  `;
  modalBackdrop.classList.add('show');

  // Generate button
  modalBody.querySelector('#f-gen').addEventListener('click', () => {
    modalBody.querySelector('#f-code').value = generateCode();
  });

  // Applies-to pills toggle
  let currentAppliesTo = data.applicable_to || 'all';
  modalBody.querySelectorAll('.applies-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      currentAppliesTo = pill.dataset.applies;
      modalBody.querySelectorAll('.applies-pill').forEach(p =>
        p.classList.toggle('btn-ghost', p.dataset.applies !== currentAppliesTo));
      modalBody.querySelector('#f-cat-picker').style.display  = currentAppliesTo === 'category' ? '' : 'none';
      modalBody.querySelector('#f-prod-picker').style.display = currentAppliesTo === 'product'  ? '' : 'none';
    });
  });

  // Product search filter
  modalBody.querySelector('#f-prod-search')?.addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    modalBody.querySelectorAll('#f-prod-list label[data-prod-name]').forEach(label => {
      label.style.display = label.dataset.prodName.includes(q) ? '' : 'none';
    });
  });

  // Save / cancel
  modalBody.querySelectorAll('[data-act]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (btn.dataset.act === 'close') return modalBackdrop.classList.remove('show');
      if (btn.dataset.act === 'save')  await save(c, currentAppliesTo);
    });
  });
}

async function save(existing, applicableTo) {
  const sb = getSB();
  const code = modalBody.querySelector('#f-code').value.trim().toUpperCase();
  if (!code) return toastWarn('Code is required.');
  const value = parseFloat(modalBody.querySelector('#f-val').value);
  if (Number.isNaN(value) || value < 0) return toastWarn('Value must be a non-negative number.');

  let applicableIds = [];
  if (applicableTo === 'category') {
    applicableIds = [...modalBody.querySelectorAll('.cat-check:checked')].map(el => el.value);
  } else if (applicableTo === 'product') {
    applicableIds = [...modalBody.querySelectorAll('.prod-check:checked')].map(el => el.value);
  }

  const startRaw = modalBody.querySelector('#f-start').value;
  const expRaw   = modalBody.querySelector('#f-exp').value;
  const max      = modalBody.querySelector('#f-max').value;
  const cap      = modalBody.querySelector('#f-cap').value;

  const payload = {
    promo_code:              code,
    description:             modalBody.querySelector('#f-desc').value.trim() || null,
    discount_type:           modalBody.querySelector('#f-type').value,
    discount_value:          value,
    min_order_amount:        parseFloat(modalBody.querySelector('#f-min').value) || 0,
    max_uses:                max === '' ? null : parseInt(max, 10),
    starts_at:               startRaw ? new Date(startRaw).toISOString() : null,
    expires_at:              expRaw  ? new Date(expRaw).toISOString()   : null,
    is_active:               modalBody.querySelector('#f-active').checked,
    single_use_per_customer: modalBody.querySelector('#f-single').checked,
    max_discount_cap:        cap === '' ? null : parseFloat(cap),
    applicable_to:           applicableTo || 'all',
    applicable_ids:          applicableIds,
  };

  let error;
  if (existing) ({ error } = await sb.from('discount_rules').update(payload).eq('id', existing.id));
  else          ({ error } = await sb.from('discount_rules').insert([payload]));
  if (error) return toastError(error.message);
  toast(existing ? `Updated ${code}` : `Created ${code}`);
  modalBackdrop.classList.remove('show');
  await load(); render();
}

function buildPane() {
  paneEl.innerHTML = `
    <div class="filter-row">
      <button class="btn btn-sm" id="d-new">+ New code</button>
      <button class="btn btn-ghost btn-sm" id="d-refresh">Refresh</button>
    </div>
    <div id="d-list"></div>
  `;
  listEl = paneEl.querySelector('#d-list');
  paneEl.querySelector('#d-new').addEventListener('click', () => openForm(null));
  paneEl.querySelector('#d-refresh').addEventListener('click', async () => { await load(); render(); });

  listEl.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const card = btn.closest('article');
    const c = state.codes.find(x => x.id === card?.dataset.id);
    if (!c) return;
    if (btn.dataset.action === 'edit')   openForm(c);
    if (btn.dataset.action === 'toggle') await toggleActive(c);
    if (btn.dataset.action === 'delete') await deleteCode(c);
  });
}

export async function mount(rootPaneEl, ctxIn) {
  paneEl = rootPaneEl;
  modalBackdrop = ctxIn.modalBackdrop;
  modalBody = ctxIn.modalBody;
  if (!mounted) { buildPane(); mounted = true; }
  await Promise.all([load(), loadPickerData()]);
  render();
}
