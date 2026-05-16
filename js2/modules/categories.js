// Categories module — Surface B (blueprint §9.5, §11.4)

import { getSB } from '../core/supabase.js';
import { AppState } from '../core/state.js';
import { toast, toastError, toastWarn } from '../core/toast.js';
import { escapeHTML } from '../core/utils.js';

let mounted = false;
let paneEl = null;
let listEl = null;
let modalBackdrop = null;
let modalBody = null;

const state = { categories: [], counts: {} };

async function loadAll() {
  const sb = getSB();
  // §11.4: select with product count via embedded relation
  const { data: cats, error } = await sb
    .from('categories')
    .select('*, products(count)')
    .order('sort_order', { ascending: true });
  if (error) { toastError('Categories load failed: ' + error.message); return; }
  state.categories = cats || [];
  state.counts = {};
  state.categories.forEach(c => {
    // products(count) returns [{count: n}]
    state.counts[c.id] = (Array.isArray(c.products) ? c.products[0]?.count : 0) || 0;
  });
  AppState.categories = state.categories;
}

function rowHTML(c, idx) {
  const productCount = state.counts[c.id] || 0;
  return `
    <tr data-id="${escapeHTML(c.id)}">
      <td>
        <button class="btn btn-sm btn-ghost" data-action="up"  ${idx === 0 ? 'disabled' : ''}>↑</button>
        <button class="btn btn-sm btn-ghost" data-action="dn"  ${idx === state.categories.length - 1 ? 'disabled' : ''}>↓</button>
      </td>
      <td>
        <span style="display:inline-block;width:14px;height:14px;border-radius:4px;background:${escapeHTML(c.color || '#444')};margin-right:8px;vertical-align:middle"></span>
        <span style="font-size:18px">${escapeHTML(c.icon || '')}</span>
        <span style="font-weight:600;margin-left:6px">${escapeHTML(c.name)}</span>
      </td>
      <td style="color:var(--text-muted);font-size:13px">${escapeHTML(c.description || '')}</td>
      <td style="font-family:'JetBrains Mono',monospace">${productCount}</td>
      <td>
        <span class="status-badge ${c.is_active ? 'status-completed' : 'status-cancelled'}">
          ${c.is_active ? 'Active' : 'Inactive'}
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
  listEl.innerHTML = `
    <div class="card" style="padding:0;overflow:hidden">
      <div style="overflow-x:auto">
        <table class="inv-table">
          <thead><tr><th></th><th>Name</th><th>Description</th><th>Products</th><th>Status</th><th></th></tr></thead>
          <tbody>
            ${state.categories.length
              ? state.categories.map(rowHTML).join('')
              : '<tr><td colspan="6" class="empty">No categories yet — create the first one.</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

/* ---------- Mutations ---------- */

async function moveCategory(id, dir) {
  const idx = state.categories.findIndex(c => c.id === id);
  const swapIdx = idx + (dir === 'up' ? -1 : 1);
  if (idx < 0 || swapIdx < 0 || swapIdx >= state.categories.length) return;
  const a = state.categories[idx], b = state.categories[swapIdx];
  const sb = getSB();
  // Swap sort_order values
  const updates = [
    sb.from('categories').update({ sort_order: b.sort_order }).eq('id', a.id),
    sb.from('categories').update({ sort_order: a.sort_order }).eq('id', b.id),
  ];
  const results = await Promise.all(updates);
  for (const r of results) if (r.error) return toastError(r.error.message);
  await loadAll(); render();
}

async function deleteCategory(c) {
  const count = state.counts[c.id] || 0;
  if (count > 0) {
    return toastWarn(`Cannot delete: ${count} product${count === 1 ? ' is' : 's are'} in this category. Reassign first.`);
  }
  if (!confirm(`Delete category "${c.name}"?`)) return;
  const sb = getSB();
  const { error } = await sb.from('categories').delete().eq('id', c.id);
  if (error) return toastError(error.message);
  toast(`Deleted: ${c.name}`);
  await loadAll(); render();
}

/* ---------- Edit modal ---------- */

function openForm(c) {
  const isNew = !c;
  const data = c || { name: '', description: '', color: '#00C9A7', icon: '🌿', sort_order: state.categories.length, is_active: true };
  modalBody.innerHTML = `
    <h2>${isNew ? 'New category' : 'Edit category'}</h2>
    <label class="field-label">Name *</label>
    <input class="input" id="f-name" value="${escapeHTML(data.name || '')}"/>
    <label class="field-label" style="margin-top:10px">Description</label>
    <textarea class="input" id="f-desc" rows="2">${escapeHTML(data.description || '')}</textarea>

    <div class="field-row" style="margin-top:10px">
      <div style="flex:1 1 100px">
        <label class="field-label">Icon (emoji)</label>
        <input class="input" id="f-icon" value="${escapeHTML(data.icon || '')}" maxlength="4" />
      </div>
      <div style="flex:1 1 120px">
        <label class="field-label">Color</label>
        <input class="input" id="f-color" type="color" value="${escapeHTML(data.color || '#00C9A7')}" />
      </div>
      <div style="flex:1 1 100px">
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
      if (btn.dataset.act === 'save')  await save(c);
    });
  });
}

async function save(existing) {
  const sb = getSB();
  const payload = {
    name: modalBody.querySelector('#f-name').value.trim(),
    description: modalBody.querySelector('#f-desc').value.trim() || null,
    icon: modalBody.querySelector('#f-icon').value.trim() || null,
    color: modalBody.querySelector('#f-color').value || null,
    sort_order: parseInt(modalBody.querySelector('#f-sort').value, 10) || 0,
    is_active: modalBody.querySelector('#f-active').checked,
  };
  if (!payload.name) return toastWarn('Name is required.');

  let error;
  if (existing) {
    ({ error } = await sb.from('categories').update(payload).eq('id', existing.id));
  } else {
    ({ error } = await sb.from('categories').insert([payload]));
  }
  if (error) return toastError(error.message);
  toast(existing ? `Updated ${payload.name}` : `Created ${payload.name}`);
  modalBackdrop.classList.remove('show');
  await loadAll(); render();
  AppState.emit('categories:changed');
}

/* ---------- Mount ---------- */

function buildPane() {
  paneEl.innerHTML = `
    <div class="filter-row">
      <button class="btn btn-sm" id="c-new">+ New category</button>
      <button class="btn btn-ghost btn-sm" id="c-refresh">Refresh</button>
    </div>
    <div id="c-list"></div>
  `;
  listEl = paneEl.querySelector('#c-list');

  paneEl.querySelector('#c-new').addEventListener('click', () => openForm(null));
  paneEl.querySelector('#c-refresh').addEventListener('click', async () => { await loadAll(); render(); });

  listEl.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const tr = btn.closest('tr');
    const c = state.categories.find(x => x.id === tr?.dataset.id);
    if (!c) return;
    if (btn.dataset.action === 'edit')   openForm(c);
    if (btn.dataset.action === 'delete') await deleteCategory(c);
    if (btn.dataset.action === 'up')     await moveCategory(c.id, 'up');
    if (btn.dataset.action === 'dn')     await moveCategory(c.id, 'dn');
  });
}

export async function mount(rootPaneEl, ctxIn) {
  paneEl = rootPaneEl;
  modalBackdrop = ctxIn.modalBackdrop;
  modalBody = ctxIn.modalBody;
  if (!mounted) { buildPane(); mounted = true; }
  await loadAll();
  render();
}
