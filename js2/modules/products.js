// Products module — Surface B (blueprint §9.4, §11.3)

import { getSB } from '../core/supabase.js';
import { AppState } from '../core/state.js';
import { toast, toastError, toastWarn } from '../core/toast.js';
import { formatCurrency, escapeHTML } from '../core/utils.js';
import { uploadProductImage } from '../core/storage.js';

let mounted = false;
let paneEl = null;
let listEl = null;
let modalBackdrop = null;
let modalBody = null;

const state = {
    products: [],
    categories: [],
    search: '',
    filterCategory: 'all',
    filterActive: 'all', // all | active | inactive
    selected: new Set(),
};

// Strain types — emoji shown in the storefront variant picker.
const STRAIN_TYPES = [
    { value: '', label: 'None', emoji: '' },
    { value: 'sativa', label: 'Sativa', emoji: '☀️' },
    { value: 'hybrid', label: 'Hybrid', emoji: '⚖️' },
    { value: 'indica', label: 'Indica', emoji: '🌙' },
];
const STRAIN_EMOJI = { sativa: '☀️', hybrid: '⚖️', indica: '🌙' };

// Per-open-modal variant state. Reset every time the product editor opens.
const variantState = { productId: null, variants: [], editingId: null, loaded: false, dragId: null };

async function loadAll() {
    const sb = getSB();
    // Products with category — §11.3 exact pattern
  const [{ data: products, error: pErr }, { data: cats, error: cErr }] = await Promise.all([
        sb.from('products')
          .select('*, categories(name, color, icon)')
          .order('sort_order', { ascending: true }),
        sb.from('categories').select('id, name, color, icon, is_active').order('sort_order', { ascending: true }),
      ]);
    if (pErr) toastError('Products load failed: ' + pErr.message);
    if (cErr) toastError('Categories load failed: ' + cErr.message);
    state.products = products || [];
    state.categories = cats || [];
    AppState.products = state.products;
    AppState.categories = state.categories;
}

function filtered() {
    let rows = state.products;
    if (state.filterCategory !== 'all') {
          rows = rows.filter(p => p.category_id === state.filterCategory);
    }
    if (state.filterActive !== 'all') {
          rows = rows.filter(p => state.filterActive === 'active' ? p.is_active : !p.is_active);
    }
    if (state.search) {
          const s = state.search.toLowerCase();
          rows = rows.filter(p =>
                  (p.name || '').toLowerCase().includes(s) ||
                  (p.sku || '').toLowerCase().includes(s) ||
                  (p.description || '').toLowerCase().includes(s)
                                 );
    }
    return rows;
}

function rowHTML(p) {
    const cat = p.categories?.name || '—';
    const checked = state.selected.has(p.id) ? 'checked' : '';
    return `
    <tr data-id="${escapeHTML(p.id)}">
      <td><input type="checkbox" class="row-pick" ${checked}/></td>
        <td>
            ${p.image_url ? `<img src="${escapeHTML(p.image_url)}" style="width:40px;height:40px;object-fit:cover;border-radius:6px" alt=""/>` : '<div style="width:40px;height:40px;background:var(--bg-base);border-radius:6px"></div>'}
              </td>
                <td>
                    <div style="font-weight:600">${escapeHTML(p.name || '—')}${p.is_featured ? ' ⭐' : ''}</div>
                        <div style="color:var(--text-muted);font-size:11px">${escapeHTML(p.sku || '')}</div>
                          </td>
                            <td>${escapeHTML(cat)}</td>
                              <td style="font-family:'JetBrains Mono',monospace">${formatCurrency(p.price)}</td>
                                <td style="font-family:'JetBrains Mono',monospace">${formatCurrency(p.cost_price)}</td>
                                  <td style="font-family:'JetBrains Mono',monospace">${p.stock_qty || 0}</td>
                                    <td>
                                        <span class="status-badge ${p.is_active ? 'status-completed' : 'status-cancelled'}">
                                              ${p.is_active ? 'Active' : 'Inactive'}
                                                  </span>
                                                    </td>
                                                      <td>
                                                          <button class="btn btn-sm btn-ghost" data-action="edit" data-product-id="${escapeHTML(p.id)}">Edit</button>
                                                              <button class="btn btn-sm btn-ghost" data-action="toggle" data-product-id="${escapeHTML(p.id)}">${p.is_active ? 'Disable' : 'Enable'}</button>
                                                                </td>
                                                                </tr>
                                                                `;
}

function render() {
    const rows = filtered();
    const allSelected = rows.length > 0 && rows.every(r => state.selected.has(r.id));
    listEl.innerHTML = `
    <div class="card" style="padding:0;overflow:hidden">
      <div style="overflow-x:auto">
          <table class="inv-table">
                <thead>
                        <tr>
                                  <th><input type="checkbox" id="pick-all" ${allSelected && rows.length ? 'checked' : ''}/></th>
                                            <th></th><th>Name</th><th>Category</th>
                                                      <th>Price</th><th>Cost</th><th>Stock</th><th>Status</th><th></th>
                                                              </tr>
                                                                    </thead>
                                                                          <tbody>
                                                                                  ${rows.length ? rows.map(rowHTML).join('') : '<tr><td colspan="9" class="empty">No products match.</td></tr>'}
                                                                                        </tbody>
                                                                                            </table>
                                                                                              </div>
                                                                                              </div>
                                                                                              `;
}

/* ---------- Mutations (§11.3) ---------- */

async function toggleActive(p) {
    const sb = getSB();
    const { error } = await sb.from('products')
      .update({ is_active: !p.is_active }).eq('id', p.id);
    if (error) { toastError(error.message); return; }
    await loadAll(); render();
    toast(`${p.name} → ${!p.is_active ? 'active' : 'inactive'}`);
}

async function deleteProduct(p) {
    if (!confirm(`Delete "${p.name}" permanently?`)) return;
    const sb = getSB();
    const { error } = await sb.from('products').delete().eq('id', p.id);
    if (error) { toastError(error.message); return; }
    toast(`Deleted: ${p.name}`);
    await loadAll(); render();
}

async function bulkToggle(active) {
    if (!state.selected.size) return;
    const sb = getSB();
    const ids = [...state.selected];
    const { error } = await sb.from('products')
      .update({ is_active: active }).in('id', ids);
    if (error) { toastError(error.message); return; }
    toast(`Updated ${ids.length} product${ids.length === 1 ? '' : 's'}`);
    state.selected.clear();
    await loadAll(); render();
}

async function bulkDelete() {
    if (!state.selected.size) return;
    if (!confirm(`Delete ${state.selected.size} products permanently?`)) return;
    const sb = getSB();
    const ids = [...state.selected];
    const { error } = await sb.from('products').delete().in('id', ids);
    if (error) { toastError(error.message); return; }
    toast(`Deleted ${ids.length} products`);
    state.selected.clear();
    await loadAll(); render();
}

function exportCSV() {
    const rows = filtered();
    if (!rows.length) return toastWarn('Nothing to export.');
    const cols = ['id','name','sku','price','cost_price','stock_qty','low_stock_threshold','is_active','is_featured','category'];
    const BOM = '\uFEFF';
    const csv = BOM + [cols.join(',')].concat(rows.map(p => cols.map(c => {
          const v = c === 'category' ? (p.categories?.name || '') : (p[c] ?? '');
          const s = String(v).replace(/"/g, '""');
          return /[,"\n]/.test(s) ? `"${s}"` : s;
    }).join(','))).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = `products-${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
}

/* ---------- Edit / create modal ---------- */

function openForm(p) {
    const isNew = !p;
    const data = p ? { ...p } : {
          name: '', description: '', price: 0, cost_price: 0,
          category_id: state.categories[0]?.id || null,
          stock_qty: 0, low_stock_threshold: 10, is_active: true, is_featured: false,
          sort_order: 0, sku: '', tags: [], image_url: '', has_variants: false,
    };

  modalBody.innerHTML = `
  <h2>${isNew ? 'New product' : 'Edit product'}</h2>

  <label class="field-label">Name *</label>
  <input class="input" id="f-name" value="${escapeHTML(data.name || '')}" />

  <label class="field-label" style="margin-top:10px">Description</label>
  <textarea class="input" id="f-desc" rows="3">${escapeHTML(data.description || '')}</textarea>

  <div class="field-row" style="margin-top:10px">
    <div style="flex:1 1 140px">
        <label class="field-label">Price *</label>
            <input class="input" id="f-price" type="number" step="0.01" min="0" value="${data.price ?? 0}" />
              </div>
                <div style="flex:1 1 140px">
                    <label class="field-label">Cost</label>
                        <input class="input" id="f-cost" type="number" step="0.01" min="0" value="${data.cost_price ?? 0}" />
                          </div>
                          </div>

                          <div class="field-row">
                            <div style="flex:1 1 140px">
                                <label class="field-label">Stock</label>
                                    <input class="input" id="f-stock" type="number" min="0" value="${data.stock_qty ?? 0}" />
                                      </div>
                                        <div style="flex:1 1 140px">
                                            <label class="field-label">Low threshold</label>
                                                <input class="input" id="f-thr" type="number" min="0" value="${data.low_stock_threshold ?? 10}" />
                                                  </div>
                                                  </div>

                                                  <label class="field-label">Category</label>
                                                  <select class="input" id="f-cat">
                                                    ${state.categories.map(c => `<option value="${c.id}" ${c.id === data.category_id ? 'selected' : ''}>${escapeHTML(c.name)}</option>`).join('')}
                                                    </select>

                                                    <div class="field-row" style="margin-top:10px">
                                                      <div style="flex:1 1 140px">
                                                          <label class="field-label">SKU</label>
                                                              <input class="input" id="f-sku" value="${escapeHTML(data.sku || '')}" />
                                                                </div>
                                                                  <div style="flex:1 1 140px">
                                                                      <label class="field-label">Sort order</label>
                                                                          <input class="input" id="f-sort" type="number" value="${data.sort_order ?? 0}" />
                                                                            </div>
                                                                            </div>

                                                                            <label class="field-label">Tags (comma separated)</label>
                                                                            <input class="input" id="f-tags" value="${escapeHTML((data.tags || []).join(', '))}" />

                                                                            <label class="field-label" style="margin-top:10px">Image</label>
                                                                            <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
                                                                              <img id="f-img-preview" src="${escapeHTML(data.image_url || '')}" style="width:64px;height:64px;object-fit:cover;border-radius:8px;background:var(--bg-base);${data.image_url ? '' : 'display:none'}"/>
                                                                                <input type="file" id="f-img" accept="image/jpeg,image/png,image/webp,image/gif" />
                                                                                  <span id="f-img-status" style="color:var(--text-muted);font-size:12px"></span>
                                                                                  </div>
                                                                                  <input type="hidden" id="f-img-url" value="${escapeHTML(data.image_url || '')}"/>

                                                                                  <div style="display:flex;gap:14px;margin-top:14px;flex-wrap:wrap">
                                                                                    <label style="display:flex;align-items:center;gap:6px;font-size:13px">
                                                                                        <input type="checkbox" id="f-active" ${data.is_active ? 'checked' : ''}/> Active
                                                                                          </label>
                                                                                            <label style="display:flex;align-items:center;gap:6px;font-size:13px">
                                                                                                <input type="checkbox" id="f-featured" ${data.is_featured ? 'checked' : ''}/> Featured
                                                                                                  </label>
                                                                                                    <label style="display:flex;align-items:center;gap:6px;font-size:13px">
                                                                                                        <input type="checkbox" id="f-has-variants" ${data.has_variants ? 'checked' : ''}/> Has variants
                                                                                                          </label>
                                                                                                  </div>

                                                                                                  <div id="f-variants-wrap"${data.has_variants ? '' : ' style="display:none"'}></div>

                                                                                                  <div class="close-row">
                                                                                                    ${!isNew ? '<button class="btn btn-sm btn-danger" data-act="delete">Delete</button>' : ''}
                                                                                                      <button class="btn btn-sm btn-ghost" data-act="close">Cancel</button>
                                                                                                        <button class="btn btn-sm" data-act="save">${isNew ? 'Create' : 'Save'}</button>
                                                                                                        </div>
                                                                                                        `;
    modalBackdrop.classList.add('show');

  setupVariants(p, isNew);

  // Image upload handler — gates the Save button so the user can't submit
  // while the upload is still in flight (which would save with image_url=null
  // for a new product, or the previous URL when editing).
  const saveBtn = modalBody.querySelector('[data-act="save"]');
    modalBody.querySelector('#f-img').addEventListener('change', async (e) => {
          const file = e.target.files[0];
          if (!file) return;
          const status = modalBody.querySelector('#f-img-status');
          const urlField = modalBody.querySelector('#f-img-url');
          status.textContent = 'Uploading…';
          status.style.color = 'var(--text-muted)';
          urlField.value = '';
          saveBtn.disabled = true;
          try {
                  const url = await uploadProductImage(file);
                  urlField.value = url;
                  const img = modalBody.querySelector('#f-img-preview');
                  img.src = url; img.style.display = '';
                  status.textContent = 'Uploaded ✓';
                  status.style.color = 'var(--green)';
          } catch (err) {
                  status.textContent = err.message || 'Upload failed';
                  status.style.color = 'var(--red)';
                  // Image is optional for products — re-enable Save so the user can
            // still create the row without an image, or pick a different file.
          } finally {
                  saveBtn.disabled = false;
          }
    });

  modalBody.querySelectorAll('[data-act]').forEach(btn => {
        btn.addEventListener('click', async () => {
                const act = btn.dataset.act;
                if (act === 'close') return modalBackdrop.classList.remove('show');
                if (act === 'delete') { await deleteProduct(p); return modalBackdrop.classList.remove('show'); }
                if (act === 'save') { await save(p); }
        });
  });
}

async function save(existing) {
    const sb = getSB();
    const catSelect = modalBody.querySelector('#f-cat');
    const payload = {
          name: modalBody.querySelector('#f-name').value.trim(),
          description: modalBody.querySelector('#f-desc').value.trim() || null,
          price: parseFloat(modalBody.querySelector('#f-price').value) || 0,
          cost_price: parseFloat(modalBody.querySelector('#f-cost').value) || 0,
          stock_qty: parseInt(modalBody.querySelector('#f-stock').value, 10) || 0,
          low_stock_threshold: parseInt(modalBody.querySelector('#f-thr').value, 10) || 0,
          category_id: catSelect.value || null,
          sku: modalBody.querySelector('#f-sku').value.trim() || null,
          sort_order: parseInt(modalBody.querySelector('#f-sort').value, 10) || 0,
          tags: modalBody.querySelector('#f-tags').value.split(',').map(s => s.trim()).filter(Boolean),
          image_url: modalBody.querySelector('#f-img-url').value || null,
          is_active: modalBody.querySelector('#f-active').checked,
          is_featured: modalBody.querySelector('#f-featured').checked,
          has_variants: modalBody.querySelector('#f-has-variants').checked,
          updated_at: new Date().toISOString(),
    };
    if (!payload.name) return toastWarn('Name is required.');
    if (payload.price < 0) return toastWarn('Price must be non-negative.');

  let error;
    if (existing) {
          ({ error } = await sb.from('products').update(payload).eq('id', existing.id));
    } else {
          ({ error } = await sb.from('products').insert([payload]));
    }
    if (error) return toastError(error.message);
    toast(existing ? `Updated ${payload.name}` : `Created ${payload.name}`);
    modalBackdrop.classList.remove('show');
    await loadAll(); render();
}

/* ---------- Variant manager (Phase 2) ---------- */

function strainPill(type) {
    if (!type) return '';
    const emoji = STRAIN_EMOJI[type] || '';
    const label = type.charAt(0).toUpperCase() + type.slice(1);
    return `<span class="strain-pill">${emoji ? emoji + ' ' : ''}${escapeHTML(label)}</span>`;
}

function strainOptions(selected) {
    return STRAIN_TYPES.map(s =>
        `<option value="${s.value}" ${s.value === (selected || '') ? 'selected' : ''}>${s.emoji ? s.emoji + ' ' : ''}${s.label}</option>`
    ).join('');
}

function variantRowHTML(v) {
    if (variantState.editingId === v.id) {
        return `
        <div class="variant-row" data-id="${escapeHTML(v.id)}">
          <span class="variant-handle">⠿</span>
          <div class="variant-edit-grid">
            <input class="input" data-f="name" value="${escapeHTML(v.name || '')}" placeholder="Variant name" />
            <select class="input" data-f="strain">${strainOptions(v.strain_type)}</select>
            <input class="input" data-f="price" type="number" step="0.01" min="0" value="${v.price_override ?? ''}" placeholder="Price override" />
            <label class="toggle-switch" title="Available"><input type="checkbox" data-f="avail" ${v.is_available ? 'checked' : ''}/><span class="toggle-slider"></span></label>
            <button class="btn btn-sm" data-action="save">Save</button>
            <button class="btn btn-sm btn-ghost" data-action="cancel">Cancel</button>
          </div>
        </div>`;
    }
    const price = v.price_override != null ? formatCurrency(v.price_override) : 'Parent price';
    return `
    <div class="variant-row ${v.is_available ? '' : 'sold-out'}" draggable="true" data-id="${escapeHTML(v.id)}">
      <span class="variant-handle" title="Drag to reorder">⠿</span>
      <div class="variant-main" data-action="edit" title="Click to edit">
        <span class="variant-name">${escapeHTML(v.name || '—')}</span>${strainPill(v.strain_type)}
      </div>
      <span class="variant-price">${price}</span>
      <label class="toggle-switch" title="Available"><input type="checkbox" class="va-avail" ${v.is_available ? 'checked' : ''}/><span class="toggle-slider"></span></label>
      <button class="btn btn-sm btn-danger" data-action="delete" title="Delete variant">✕</button>
    </div>`;
}

function variantSectionHTML(parentActive) {
    return `
    <div class="variants-section">
      <div class="variants-activate">
        <div class="setting-toggle-row" style="border-bottom:none;margin-bottom:0;padding:0">
          <label class="toggle-label">Show as grouped product in storefront</label>
          <label class="toggle-switch">
            <input type="checkbox" id="v-parent-active" ${parentActive ? 'checked' : ''}/>
            <span class="toggle-slider"></span>
          </label>
        </div>
        <div class="variants-warning">Activating this will hide the individual variant products. Make sure all variants are set up first.</div>
      </div>

      <h3 class="variants-heading">Variants</h3>
      <div id="variants-list"><div class="empty">Loading…</div></div>

      <div class="variant-add">
        <div class="variant-add-grid">
          <div style="flex:2 1 160px">
            <label class="field-label">Variant name</label>
            <input class="input" id="va-name" placeholder="e.g. Northern Lights" />
          </div>
          <div>
            <label class="field-label">Strain type</label>
            <select class="input" id="va-strain">${strainOptions('')}</select>
          </div>
          <div>
            <label class="field-label">Price override</label>
            <input class="input" id="va-price" type="number" step="0.01" min="0" placeholder="Optional" />
          </div>
          <div style="flex:0 0 auto;display:flex;align-items:center;gap:6px;padding-bottom:8px">
            <label class="toggle-switch" title="Available"><input type="checkbox" id="va-avail" checked /><span class="toggle-slider"></span></label>
            <span style="font-size:12px;color:var(--text-muted)">Available</span>
          </div>
        </div>
        <button class="btn btn-sm" id="va-add" style="margin-top:10px">Add Variant</button>
      </div>
    </div>`;
}

function renderVariantsList() {
    const listEl = modalBody.querySelector('#variants-list');
    if (!listEl) return;
    const rows = variantState.variants;
    listEl.innerHTML = rows.length
        ? rows.map(variantRowHTML).join('')
        : '<div class="empty">No variants yet. Add one below.</div>';
}

function setupVariants(p, isNew) {
    variantState.productId = p?.id || null;
    variantState.variants = [];
    variantState.editingId = null;
    variantState.loaded = false;
    variantState.dragId = null;

    const wrap = modalBody.querySelector('#f-variants-wrap');
    const hasCb = modalBody.querySelector('#f-has-variants');
    const activeCb = modalBody.querySelector('#f-active');
    if (!wrap || !hasCb) return;

    const sb = getSB();

    async function loadVariants() {
        const queryId = variantState.productId;
        const listEl = modalBody.querySelector('#variants-list');
        if (!queryId) {
            if (listEl) listEl.innerHTML = '<div class="empty">Variant manager: missing product id. Close and re-open the editor.</div>';
            return;
        }
        const { data, error } = await sb.from('product_variants')
            .select('*')
            .eq('parent_product_id', queryId)
            .order('sort_order', { ascending: true });
        // Stale-promise guard — the modal may have switched products while in flight.
        if (variantState.productId !== queryId) return;
        if (error) {
            toastError('Variants load failed: ' + error.message);
            if (listEl) listEl.innerHTML = `<div class="empty">Failed to load variants: ${escapeHTML(error.message)}</div>`;
            return;
        }
        variantState.variants = data || [];
        variantState.loaded = true;
        renderVariantsList();
    }

    async function addVariant() {
        const name = modalBody.querySelector('#va-name').value.trim();
        if (!name) return toastWarn('Variant name is required.');
        const strain = modalBody.querySelector('#va-strain').value || null;
        const priceRaw = modalBody.querySelector('#va-price').value;
        const priceOverride = priceRaw === '' ? null : parseFloat(priceRaw);
        const available = modalBody.querySelector('#va-avail').checked;
        const nextOrder = variantState.variants.reduce((m, v) => Math.max(m, v.sort_order ?? 0), -1) + 1;

        const { data, error } = await sb.from('product_variants').insert([{
            parent_product_id: variantState.productId,
            name, strain_type: strain, price_override: priceOverride,
            is_available: available, sort_order: nextOrder,
        }]).select().single();
        if (error) return toastError(error.message);
        variantState.variants.push(data);
        renderVariantsList();
        modalBody.querySelector('#va-name').value = '';
        modalBody.querySelector('#va-price').value = '';
        modalBody.querySelector('#va-strain').value = '';
        modalBody.querySelector('#va-avail').checked = true;
        toast(`Added variant: ${name}`);
    }

    async function saveVariantEdit(id, rowEl) {
        const name = rowEl.querySelector('[data-f="name"]').value.trim();
        if (!name) return toastWarn('Variant name is required.');
        const strain = rowEl.querySelector('[data-f="strain"]').value || null;
        const priceRaw = rowEl.querySelector('[data-f="price"]').value;
        const priceOverride = priceRaw === '' ? null : parseFloat(priceRaw);
        const available = rowEl.querySelector('[data-f="avail"]').checked;

        const { error } = await sb.from('product_variants').update({
            name, strain_type: strain, price_override: priceOverride,
            is_available: available, updated_at: new Date().toISOString(),
        }).eq('id', id);
        if (error) return toastError(error.message);
        const v = variantState.variants.find(x => x.id === id);
        if (v) Object.assign(v, { name, strain_type: strain, price_override: priceOverride, is_available: available });
        variantState.editingId = null;
        renderVariantsList();
        toast('Variant updated');
    }

    async function toggleAvailable(id, available) {
        const { error } = await sb.from('product_variants').update({
            is_available: available, updated_at: new Date().toISOString(),
        }).eq('id', id);
        if (error) { toastError(error.message); renderVariantsList(); return; }
        const v = variantState.variants.find(x => x.id === id);
        if (v) v.is_available = available;
        renderVariantsList();
    }

    async function deleteVariant(id) {
        const v = variantState.variants.find(x => x.id === id);
        if (!confirm(`Delete variant "${v?.name || ''}"?`)) return;
        const { error } = await sb.from('product_variants').delete().eq('id', id);
        if (error) return toastError(error.message);
        variantState.variants = variantState.variants.filter(x => x.id !== id);
        if (variantState.editingId === id) variantState.editingId = null;
        renderVariantsList();
        toast('Variant deleted');
    }

    async function persistOrder() {
        const updates = variantState.variants.map((v, i) => {
            v.sort_order = i;
            return sb.from('product_variants').update({ sort_order: i }).eq('id', v.id);
        });
        const results = await Promise.all(updates);
        const failed = results.find(r => r.error);
        if (failed) toastError('Reorder failed: ' + failed.error.message);
    }

    async function setParentActive(active) {
        const { error } = await sb.from('products').update({ is_active: active }).eq('id', variantState.productId);
        if (error) { toastError(error.message); return false; }
        if (activeCb) activeCb.checked = active;
        if (p) p.is_active = active;
        const row = state.products.find(x => x.id === variantState.productId);
        if (row) row.is_active = active;
        render();
        toast(active ? 'Shown as grouped product' : 'Grouped product hidden');
        return true;
    }

    function wireSection() {
        modalBody.querySelector('#va-add').addEventListener('click', addVariant);
        modalBody.querySelector('#v-parent-active').addEventListener('change', async (e) => {
            const ok = await setParentActive(e.target.checked);
            if (!ok) e.target.checked = !e.target.checked;
        });

        const listEl = modalBody.querySelector('#variants-list');

        listEl.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-action]');
            if (!btn) return;
            const row = btn.closest('.variant-row');
            const id = row?.dataset.id;
            if (!id) return;
            const act = btn.dataset.action;
            if (act === 'edit') { variantState.editingId = id; renderVariantsList(); }
            else if (act === 'cancel') { variantState.editingId = null; renderVariantsList(); }
            else if (act === 'save') saveVariantEdit(id, row);
            else if (act === 'delete') deleteVariant(id);
        });

        listEl.addEventListener('change', (e) => {
            if (!e.target.classList.contains('va-avail')) return;
            const row = e.target.closest('.variant-row');
            if (row) toggleAvailable(row.dataset.id, e.target.checked);
        });

        // Drag to reorder
        listEl.addEventListener('dragstart', (e) => {
            const row = e.target.closest('.variant-row');
            if (!row) return;
            variantState.dragId = row.dataset.id;
            row.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
        });
        listEl.addEventListener('dragover', (e) => {
            e.preventDefault();
            const row = e.target.closest('.variant-row');
            listEl.querySelectorAll('.drop-target').forEach(r => r.classList.remove('drop-target'));
            if (row && row.dataset.id !== variantState.dragId) row.classList.add('drop-target');
        });
        listEl.addEventListener('drop', async (e) => {
            e.preventDefault();
            const row = e.target.closest('.variant-row');
            const targetId = row?.dataset.id;
            const dragId = variantState.dragId;
            if (!targetId || !dragId || targetId === dragId) return;
            const arr = variantState.variants;
            const from = arr.findIndex(v => v.id === dragId);
            const dragged = arr.splice(from, 1)[0];
            const to = arr.findIndex(v => v.id === targetId);
            arr.splice(to, 0, dragged);
            renderVariantsList();
            await persistOrder();
        });
        listEl.addEventListener('dragend', () => {
            variantState.dragId = null;
            listEl.querySelectorAll('.dragging, .drop-target').forEach(r => r.classList.remove('dragging', 'drop-target'));
        });
    }

    function paint() {
        if (!hasCb.checked) { wrap.style.display = 'none'; wrap.innerHTML = ''; return; }
        wrap.style.display = '';
        if (isNew) {
            wrap.innerHTML = `<div class="variants-section"><h3 class="variants-heading">Variants</h3><div class="variant-hint">Save the product first, then re-open it to add and manage variants.</div></div>`;
            return;
        }
        wrap.innerHTML = variantSectionHTML(activeCb ? activeCb.checked : false);
        wireSection();
        if (!variantState.loaded) loadVariants();
        else renderVariantsList();
    }

    hasCb.addEventListener('change', paint);
    if (hasCb.checked) paint();
}

/* ---------- Mount ---------- */

function buildPane() {
    paneEl.innerHTML = `
    <div class="filter-row">
      <input class="input" id="p-search" placeholder="Search name, SKU, description…" />
        <select class="input" id="p-cat">
            <option value="all">All categories</option>
              </select>
                <select class="input" id="p-active">
                    <option value="all">All</option>
                        <option value="active">Active only</option>
                            <option value="inactive">Inactive only</option>
                              </select>
                                <button class="btn btn-sm" id="p-new">+ New</button>
                                  <button class="btn btn-ghost btn-sm" id="p-export">Export CSV</button>
                                    <button class="btn btn-ghost btn-sm" id="p-refresh">Refresh</button>
                                    </div>

                                    <div id="p-bulk" style="display:none;background:var(--bg-card);border:1px solid var(--border);border-radius:10px;padding:8px 12px;margin-bottom:10px;align-items:center;gap:10px">
                                      <span style="color:var(--text-muted);font-size:13px"><span id="p-bulk-count">0</span> selected</span>
                                        <button class="btn btn-sm" data-bulk="enable">Enable</button>
                                          <button class="btn btn-sm btn-warn" data-bulk="disable">Disable</button>
                                            <button class="btn btn-sm btn-danger" data-bulk="delete">Delete</button>
                                              <button class="btn btn-ghost btn-sm" data-bulk="clear">Clear</button>
                                              </div>

                                              <div id="p-list"></div>
                                              `;
    listEl = paneEl.querySelector('#p-list');

  paneEl.querySelector('#p-search').addEventListener('input', (e) => { state.search = e.target.value.trim(); render(); });
    paneEl.querySelector('#p-cat').addEventListener('change', (e) => { state.filterCategory = e.target.value; render(); });
    paneEl.querySelector('#p-active').addEventListener('change', (e) => { state.filterActive = e.target.value; render(); });
    paneEl.querySelector('#p-new').addEventListener('click', () => openForm(null));
    paneEl.querySelector('#p-export').addEventListener('click', exportCSV);
    paneEl.querySelector('#p-refresh').addEventListener('click', async () => { await loadAll(); render(); });

  paneEl.querySelector('#p-bulk').addEventListener('click', async (e) => {
        const b = e.target.dataset.bulk;
        if (b === 'enable') await bulkToggle(true);
        if (b === 'disable') await bulkToggle(false);
        if (b === 'delete') await bulkDelete();
        if (b === 'clear') { state.selected.clear(); refreshBulkBar(); render(); }
  });

  // Delegated row actions
  listEl.addEventListener('change', (e) => {
        if (e.target.id === 'pick-all') {
                const rows = filtered();
                if (e.target.checked) rows.forEach(r => state.selected.add(r.id));
                else rows.forEach(r => state.selected.delete(r.id));
                refreshBulkBar(); render();
                return;
        }
        if (e.target.classList.contains('row-pick')) {
                const tr = e.target.closest('tr');
                const id = tr?.dataset.id;
                if (!id) return;
                if (e.target.checked) state.selected.add(id);
                else state.selected.delete(id);
                refreshBulkBar();
        }
  });

  listEl.addEventListener('click', async (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        // Resolve the product by the id stamped on the button itself, not by
        // climbing the DOM. closest('tr') would still be correct under normal
        // markup, but reading from data-product-id removes a class of bugs
        // where row HTML changes (or a future wrapper element) makes the
        // ancestor lookup return the wrong row. Fall back to the row's
        // data-id so older renders keep working through one refresh cycle.
        const productId = btn.dataset.productId || btn.closest('tr')?.dataset.id;
        if (!productId) return;
        const p = state.products.find(x => x.id === productId);
        if (!p) return;
        if (btn.dataset.action === 'edit') openForm(p);
        if (btn.dataset.action === 'toggle') await toggleActive(p);
  });
}

function refreshBulkBar() {
    const bar = paneEl.querySelector('#p-bulk');
    const count = state.selected.size;
    paneEl.querySelector('#p-bulk-count').textContent = String(count);
    bar.style.display = count ? 'flex' : 'none';
}

function refreshCategoryFilter() {
    const sel = paneEl.querySelector('#p-cat');
    const current = sel.value;
    sel.innerHTML = `<option value="all">All categories</option>` +
          state.categories.map(c => `<option value="${c.id}" ${c.id === current ? 'selected' : ''}>${escapeHTML(c.name)}</option>`).join('');
}

export async function mount(rootPaneEl, ctxIn) {
    paneEl = rootPaneEl;
    modalBackdrop = ctxIn.modalBackdrop;
    modalBody = ctxIn.modalBody;
    if (!mounted) {
          buildPane();
          mounted = true;
          AppState.on('categories:changed', async () => { await loadAll(); refreshCategoryFilter(); render(); });
    }
    await loadAll();
    refreshCategoryFilter();
    render();
}
