// Subcategories module — Surface B
//
// CRUD on the existing `subcategories` table (source of truth for the
// storefront, which filters products by products.subcategory_id). Rows are
// scoped to a parent category and ordered by sort_order. Writes go through the
// same admin-auth client (getSB) the Categories manager uses.

import { getSB } from '../core/supabase.js';
import { AppState } from '../core/state.js';
import { toast, toastError, toastWarn } from '../core/toast.js';
import { escapeHTML } from '../core/utils.js';

let mounted = false;
let paneEl = null;
let listEl = null;
let catSelectEl = null;
let modalBackdrop = null;
let modalBody = null;

const state = { categories: [], subcategories: [], filterCategory: '' };

async function loadAll() {
  const sb = getSB();
  const [{ data: cats, error: cErr }, { data: subs, error: sErr }] = await Promise.all([
    sb.from('categories').select('id, name, is_active').order('sort_order', { ascending: true }),
    sb.from('subcategories').select('*').order('sort_order', { ascending: true }),
  ]);
  if (cErr) { toastError('Categories load failed: ' + cErr.message); return; }
  if (sErr) { toastError('Subcategories load failed: ' + sErr.message); return; }
  state.categories = cats || [];
  state.subcategories = subs || [];
  // Default the parent-category filter to the first category once.
  if (!state.filterCategory && state.categories.length) {
    state.filterCategory = state.categories[0].id;
  }
}

function filtered() {
  return state.subcategories.filter(s => s.category_id === state.filterCategory);
}

function rowHTML(s, idx, rows) {
  return `
    <tr data-id="${escapeHTML(s.id)}">
      <td>
        <button class="btn btn-sm btn-ghost" data-action="up" ${idx === 0 ? 'disabled' : ''}>↑</button>
        <button class="btn btn-sm btn-ghost" data-action="dn" ${idx === rows.length - 1 ? 'disabled' : ''}>↓</button>
      </td>
      <td>
        <span style="display:inline-block;width:14px;height:14px;border-radius:4px;background:${escapeHTML(s.color || '#444')};margin-right:8px;vertical-align:middle"></span>
        <span style="font-size:18px">${escapeHTML(s.emoji || s.icon || '')}</span>
        <span style="font-weight:600;margin-left:6px">${escapeHTML(s.name)}</span>
      </td>
      <td style="color:var(--text-muted);font-size:13px">${escapeHTML(s.description || '')}</td>
      <td>
        <span class="status-badge ${s.is_active ? 'status-completed' : 'status-cancelled'}">
          ${s.is_active ? 'Active' : 'Inactive'}
        </span>
      </td>
      <td>
        <button class="btn btn-sm btn-ghost" data-action="edit">Edit</button>
        <button class="btn btn-sm btn-danger" data-action="delete">Delete</button>
      </td>
    </tr>
  `;
}

function render() {
  const rows = filtered();
  listEl.innerHTML = `
    <div class="card" style="padding:0;overflow:hidden">
      <div style="overflow-x:auto">
        <table class="inv-table">
          <thead><tr><th></th><th>Name</th><th>Description</th><th>Status</th><th></th></tr></thead>
          <tbody>
            ${rows.length
              ? rows.map((s, i) => rowHTML(s, i, rows)).join('')
              : '<tr><td colspan="5" class="empty">No subcategories in this category yet.</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

/* ---------- Mutations ---------- */

async function moveSub(id, dir) {
  const rows = filtered();
  const idx = rows.findIndex(s => s.id === id);
  const swapIdx = idx + (dir === 'up' ? -1 : 1);
  if (idx < 0 || swapIdx < 0 || swapIdx >= rows.length) return;
  const a = rows[idx], b = rows[swapIdx];
  const sb = getSB();
  const results = await Promise.all([
    sb.from('subcategories').update({ sort_order: b.sort_order }).eq('id', a.id),
    sb.from('subcategories').update({ sort_order: a.sort_order }).eq('id', b.id),
  ]);
  for (const r of results) if (r.error) return toastError(r.error.message);
  await loadAll(); render();
  AppState.emit('categories:changed');
}

async function deleteSub(s) {
  if (!confirm(`Delete subcategory "${s.name}"?`)) return;
  const sb = getSB();
  const { error } = await sb.from('subcategories').delete().eq('id', s.id);
  if (error) return toastError(error.message);
  toast(`Deleted: ${s.name}`);
  await loadAll(); render();
  AppState.emit('categories:changed');
}

/* ---------- Edit modal ---------- */

function openForm(s) {
  const isNew = !s;
  const data = s || {
    name: '', description: '', emoji: '', icon: '', color: '#00C9A7',
    category_id: state.filterCategory,
    sort_order: filtered().length, is_active: true,
  };
  modalBody.innerHTML = `
    <h2>${isNew ? 'New subcategory' : 'Edit subcategory'}</h2>

    <label class="field-label">Parent category *</label>
    <select class="input" id="f-cat">
      ${state.categories.map(c => `<option value="${c.id}" ${c.id === data.category_id ? 'selected' : ''}>${escapeHTML(c.name)}</option>`).join('')}
    </select>

    <label class="field-label" style="margin-top:10px">Name *</label>
    <input class="input" id="f-name" value="${escapeHTML(data.name || '')}"/>

    <label class="field-label" style="margin-top:10px">Description</label>
    <textarea class="input" id="f-desc" rows="2">${escapeHTML(data.description || '')}</textarea>

    <div class="field-row" style="margin-top:10px">
      <div style="flex:1 1 90px">
        <label class="field-label">Emoji</label>
        <input class="input" id="f-emoji" value="${escapeHTML(data.emoji || '')}" maxlength="4" />
      </div>
      <div style="flex:1 1 90px">
        <label class="field-label">Icon</label>
        <input class="input" id="f-icon" value="${escapeHTML(data.icon || '')}" maxlength="32" />
      </div>
      <div style="flex:1 1 110px">
        <label class="field-label">Color</label>
        <input class="input" id="f-color" type="color" value="${escapeHTML(data.color || '#00C9A7')}" />
      </div>
      <div style="flex:1 1 90px">
        <label class="field-label">Sort</label>
        <input class="input" id="f-sort" type="number" value="${data.sort_order ?? 0}" />
      </div>
    </div>

    <label style="display:flex;align-items:center;gap:6px;margin-top:10px;font-size:13px">
      <input type="checkbox" id="f-active" ${data.is_active ? 'checked' : ''}/> Active
    </label>

    <div class="close-row">
      <button class="btn btn-sm btn-ghost" data-act="close">Cancel</button>
      <button class="btn btn-sm" data-act="save">${isNew ? 'Create' : 'Save'}</button>
    </div>
  `;
  modalBackdrop.classList.add('show');

  modalBody.querySelectorAll('[data-act]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (btn.dataset.act === 'close') return modalBackdrop.classList.remove('show');
      if (btn.dataset.act === 'save')  await save(s);
    });
  });
}

async function save(existing) {
  const sb = getSB();
  const payload = {
    category_id: modalBody.querySelector('#f-cat').value || null,
    name: modalBody.querySelector('#f-name').value.trim(),
    description: modalBody.querySelector('#f-desc').value.trim() || null,
    emoji: modalBody.querySelector('#f-emoji').value.trim() || null,
    icon: modalBody.querySelector('#f-icon').value.trim() || null,
    color: modalBody.querySelector('#f-color').value || null,
    sort_order: parseInt(modalBody.querySelector('#f-sort').value, 10) || 0,
    is_active: modalBody.querySelector('#f-active').checked,
  };
  if (!payload.category_id) return toastWarn('Parent category is required.');
  if (!payload.name) return toastWarn('Name is required.');

  let error;
  if (existing) {
    ({ error } = await sb.from('subcategories').update(payload).eq('id', existing.id));
  } else {
    ({ error } = await sb.from('subcategories').insert([payload]));
  }
  if (error) return toastError(error.message);
  toast(existing ? `Updated ${payload.name}` : `Created ${payload.name}`);
  modalBackdrop.classList.remove('show');
  // Keep the filter on the category the row now belongs to.
  state.filterCategory = payload.category_id;
  await loadAll(); render(); syncCatSelect();
  AppState.emit('categories:changed');
}

/* ---------- Mount ---------- */

function syncCatSelect() {
  if (!catSelectEl) return;
  catSelectEl.innerHTML = state.categories
    .map(c => `<option value="${c.id}" ${c.id === state.filterCategory ? 'selected' : ''}>${escapeHTML(c.name)}</option>`)
    .join('');
}

function buildPane() {
  paneEl.innerHTML = `
    <div class="filter-row">
      <label class="field-label" style="margin:0 6px 0 0">Category</label>
      <select class="input" id="sc-cat" style="max-width:220px"></select>
      <button class="btn btn-sm" id="sc-new">+ New subcategory</button>
      <button class="btn btn-ghost btn-sm" id="sc-refresh">Refresh</button>
    </div>
    <div id="sc-list"></div>
  `;
  listEl = paneEl.querySelector('#sc-list');
  catSelectEl = paneEl.querySelector('#sc-cat');

  catSelectEl.addEventListener('change', () => {
    state.filterCategory = catSelectEl.value;
    render();
  });
  paneEl.querySelector('#sc-new').addEventListener('click', () => openForm(null));
  paneEl.querySelector('#sc-refresh').addEventListener('click', async () => { await loadAll(); render(); syncCatSelect(); });

  listEl.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const tr = btn.closest('tr');
    const s = state.subcategories.find(x => x.id === tr?.dataset.id);
    if (!s) return;
    if (btn.dataset.action === 'edit')   openForm(s);
    if (btn.dataset.action === 'delete') await deleteSub(s);
    if (btn.dataset.action === 'up')     await moveSub(s.id, 'up');
    if (btn.dataset.action === 'dn')     await moveSub(s.id, 'dn');
  });
}

export async function mount(rootPaneEl, ctxIn) {
  paneEl = rootPaneEl;
  modalBackdrop = ctxIn.modalBackdrop;
  modalBody = ctxIn.modalBody;
  if (!mounted) { buildPane(); mounted = true; }
  await loadAll();
  syncCatSelect();
  render();
}
