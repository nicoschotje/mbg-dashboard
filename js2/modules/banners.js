// Banners module — Surface B (blueprint §9.6, §11.9)
//
// Storefront contract (the reason this screen exists):
//   • Hero banner     — banners.category_name IS NULL. Shown on the homepage
//                       top. Only the lowest-sort active, non-expired one is
//                       served.
//   • Category banner — banners.category_name = '<category.name>'. Shown on
//                       that category's page. Only the lowest-sort active,
//                       non-expired one per category is served.
//
// The UI groups banners by placement, calls out which row is the LIVE one in
// each group, and dims the rest so it's obvious which banner is actually
// being served.

import { getSB } from '../core/supabase.js';
import { AppState } from '../core/state.js';
import { toast, toastError, toastWarn } from '../core/toast.js';
import { escapeHTML, formatDate } from '../core/utils.js';
import { uploadBannerImage } from '../core/storage.js';

let mounted = false;
let paneEl = null;
let listEl = null;
let modalBackdrop = null;
let modalBody = null;

const state = { banners: [], categories: [] };

/* ---------- Load ---------- */

async function load() {
  const sb = getSB();
  const [bannersRes, catsRes] = await Promise.all([
    sb.from('banners').select('*').order('sort_order', { ascending: true }),
    sb.from('categories').select('id,name,icon,color,is_active,sort_order')
      .order('sort_order', { ascending: true }),
  ]);
  if (bannersRes.error) { toastError('Banners load failed: ' + bannersRes.error.message); return; }
  if (catsRes.error)    { toastError('Categories load failed: ' + catsRes.error.message); return; }
  state.banners = bannersRes.data || [];
  state.categories = catsRes.data || [];
}

/* ---------- Grouping & live-resolution ---------- */

function isExpired(b) {
  return !!(b.expires_at && new Date(b.expires_at) < new Date());
}

function isServable(b) {
  return !!b.is_active && !isExpired(b);
}

// Returns the banner that the storefront would actually serve for a bucket:
// the lowest sort_order active, non-expired entry. Null if none qualify.
function liveOf(banners) {
  const candidates = banners.filter(isServable);
  if (!candidates.length) return null;
  return [...candidates].sort(
    (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)
  )[0];
}

function groupBanners() {
  const heroes  = [];
  const byCat   = new Map(); // category_name -> banner[]
  const orphans = []; // category_name set but no matching category exists

  const validNames = new Set(state.categories.map(c => c.name));

  for (const b of state.banners) {
    const cat = (b.category_name || '').trim();
    if (!cat) {
      heroes.push(b);
    } else if (validNames.has(cat)) {
      if (!byCat.has(cat)) byCat.set(cat, []);
      byCat.get(cat).push(b);
    } else {
      orphans.push(b);
    }
  }

  // Sort each bucket by sort_order ascending so live is always row 1.
  const bySort = (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0);
  heroes.sort(bySort);
  orphans.sort(bySort);
  for (const arr of byCat.values()) arr.sort(bySort);

  return { heroes, byCat, orphans };
}

/* ---------- Render ---------- */

function statusBadge(b) {
  if (isExpired(b))   return `<span class="status-badge status-cancelled">Expired</span>`;
  if (!b.is_active)   return `<span class="status-badge status-cancelled">Inactive</span>`;
  return `<span class="status-badge status-completed">Active</span>`;
}

function placementBadge(b) {
  if (!b.category_name) {
    return `<span class="status-badge" style="background:rgba(0,201,167,.15);color:var(--green)">Hero</span>`;
  }
  return `<span class="status-badge" style="background:rgba(96,165,250,.15);color:#60A5FA">Category · ${escapeHTML(b.category_name)}</span>`;
}

function bannerCardHTML(b, { live }) {
  const liveBadge = live
    ? `<span class="status-badge" style="background:#FFD60A;color:#1a1a1a;font-weight:700">LIVE</span>`
    : '';
  const dim = !live ? 'opacity:.55' : '';
  const title = b.title || '(untitled)';

  return `
    <article class="card" data-id="${escapeHTML(b.id)}" style="margin-bottom:10px;${dim}">
      <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:flex-start">
        ${b.image_url
          ? `<img src="${escapeHTML(b.image_url)}" style="width:140px;height:80px;object-fit:cover;border-radius:8px;background:var(--bg-base)" alt=""/>`
          : `<div style="width:140px;height:80px;border:1px dashed var(--border);border-radius:8px;display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-size:12px">no image</div>`}
        <div style="flex:1;min-width:200px">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <strong>${escapeHTML(title)}</strong>
            ${liveBadge}
            ${statusBadge(b)}
            ${placementBadge(b)}
          </div>
          <div style="color:var(--text-muted);font-size:13px;margin-top:4px">${escapeHTML(b.subtitle || '')}</div>
          <div style="color:var(--text-muted);font-size:11px;margin-top:6px">
            sort ${b.sort_order ?? 0}
            ${b.button_text ? ` · CTA "${escapeHTML(b.button_text)}"` : ''}
            ${b.expires_at ? ` · expires ${escapeHTML(formatDate(b.expires_at))}` : ''}
          </div>
        </div>
        <div style="display:flex;gap:6px;flex-direction:column">
          <button class="btn btn-sm btn-ghost" data-action="edit">Edit</button>
          <button class="btn btn-sm btn-ghost" data-action="toggle">${b.is_active ? 'Disable' : 'Enable'}</button>
          <button class="btn btn-sm btn-ghost" data-action="promote" ${live ? 'disabled' : ''} title="Make this the live banner">Promote</button>
          <button class="btn btn-sm btn-danger" data-action="delete">Delete</button>
        </div>
      </div>
    </article>
  `;
}

function sectionHTML({ heading, sub, banners, emptyText }) {
  const live = liveOf(banners);
  const liveId = live?.id;
  const body = banners.length
    ? banners.map(b => bannerCardHTML(b, { live: b.id === liveId })).join('')
    : `<div class="empty" style="padding:14px 4px">${emptyText}</div>`;
  return `
    <div style="margin-bottom:22px">
      <div style="display:flex;align-items:baseline;gap:10px;margin:0 0 8px 2px">
        <h3 style="margin:0;font-size:15px">${escapeHTML(heading)}</h3>
        <span style="color:var(--text-muted);font-size:12px">${escapeHTML(sub)}</span>
      </div>
      ${body}
    </div>
  `;
}

function render() {
  const { heroes, byCat, orphans } = groupBanners();

  const sections = [];

  sections.push(sectionHTML({
    heading: 'Hero — homepage top',
    sub: 'Lowest-sort active, non-expired wins.',
    banners: heroes,
    emptyText: 'No hero banner yet.',
  }));

  for (const cat of state.categories) {
    const list = byCat.get(cat.name) || [];
    sections.push(sectionHTML({
      heading: `${cat.icon ? cat.icon + ' ' : ''}${cat.name}`,
      sub: `Category banner — shown on the ${cat.name} page.`,
      banners: list,
      emptyText: `No banner for ${cat.name}.`,
    }));
  }

  if (orphans.length) {
    sections.push(`
      <div style="margin-bottom:22px">
        <div style="display:flex;align-items:baseline;gap:10px;margin:0 0 8px 2px">
          <h3 style="margin:0;font-size:15px;color:var(--red)">Orphaned</h3>
          <span style="color:var(--text-muted);font-size:12px">Category name doesn't match any category — won't render anywhere.</span>
        </div>
        ${orphans.map(b => bannerCardHTML(b, { live: false })).join('')}
      </div>
    `);
  }

  listEl.innerHTML = sections.join('');
}

/* ---------- Mutations ---------- */

async function toggleActive(b) {
  const sb = getSB();
  const { error } = await sb.from('banners').update({ is_active: !b.is_active }).eq('id', b.id);
  if (error) return toastError(error.message);
  await load(); render();
}

async function deleteBanner(b) {
  if (!confirm(`Delete banner "${b.title || 'untitled'}"?`)) return;
  const sb = getSB();
  const { error } = await sb.from('banners').delete().eq('id', b.id);
  if (error) return toastError(error.message);
  toast('Banner deleted');
  await load(); render();
}

// Move this banner to sort_order = 0 within its bucket so it becomes the live
// one. Other rows in the same bucket get their sort_order bumped by 1 to keep
// the order stable.
async function promote(b) {
  const sb = getSB();
  const bucketKey = b.category_name || null;
  const peers = state.banners.filter(x =>
    (x.category_name || null) === bucketKey && x.id !== b.id
  );
  const updates = [
    sb.from('banners').update({ sort_order: 0, is_active: true }).eq('id', b.id),
    ...peers.map(p =>
      sb.from('banners').update({ sort_order: (p.sort_order ?? 0) + 1 }).eq('id', p.id)
    ),
  ];
  const results = await Promise.all(updates);
  const firstErr = results.find(r => r.error);
  if (firstErr) return toastError(firstErr.error.message);
  toast('Promoted to live');
  await load(); render();
}

/* ---------- Edit modal ---------- */

function categoryOptions(selected) {
  return state.categories
    .map(c => `<option value="${escapeHTML(c.name)}" ${selected === c.name ? 'selected' : ''}>${escapeHTML(c.name)}</option>`)
    .join('');
}

function openForm(b) {
  const isNew = !b;
  const data = b || {
    title: '', subtitle: '', image_url: '', link_url: '', button_text: '',
    is_active: true, sort_order: 0,
    bg_color: '#0F1614', text_color: '#E8F5F0', expires_at: null,
    category_name: null,
  };
  const placement = data.category_name ? 'category' : 'hero';

  modalBody.innerHTML = `
    <h2>${isNew ? 'New banner' : 'Edit banner'}</h2>

    <label class="field-label">Placement</label>
    <div style="display:flex;gap:14px;flex-wrap:wrap;font-size:13px">
      <label style="display:flex;align-items:center;gap:6px">
        <input type="radio" name="f-placement" value="hero" ${placement === 'hero' ? 'checked' : ''}/>
        Hero (homepage top)
      </label>
      <label style="display:flex;align-items:center;gap:6px">
        <input type="radio" name="f-placement" value="category" ${placement === 'category' ? 'checked' : ''}/>
        Category page
      </label>
    </div>
    <div id="f-cat-wrap" style="margin-top:8px;${placement === 'category' ? '' : 'display:none'}">
      <label class="field-label">Category</label>
      <select class="input" id="f-cat">
        <option value="">— pick a category —</option>
        ${categoryOptions(data.category_name)}
      </select>
      <div style="color:var(--text-muted);font-size:11px;margin-top:4px">
        The storefront matches by category name. Renaming a category will orphan its banners.
      </div>
    </div>

    <label class="field-label" style="margin-top:12px">Title</label>
    <input class="input" id="f-title" value="${escapeHTML(data.title || '')}"/>

    <label class="field-label" style="margin-top:10px">Subtitle</label>
    <input class="input" id="f-sub" value="${escapeHTML(data.subtitle || '')}"/>

    <label class="field-label" style="margin-top:10px">Image *</label>
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
      <img id="f-img-prev" src="${escapeHTML(data.image_url || '')}" style="width:100px;height:60px;object-fit:cover;border-radius:6px;background:var(--bg-base);${data.image_url ? '' : 'display:none'}" alt=""/>
      <input type="file" id="f-img" accept="image/jpeg,image/png,image/webp,image/gif"/>
      <span id="f-img-status" style="color:var(--text-muted);font-size:12px"></span>
    </div>
    <input type="hidden" id="f-img-url" value="${escapeHTML(data.image_url || '')}"/>

    <div class="field-row" style="margin-top:10px">
      <div style="flex:1 1 200px">
        <label class="field-label">Link URL</label>
        <input class="input" id="f-link" value="${escapeHTML(data.link_url || '')}" placeholder="https://…"/>
      </div>
      <div style="flex:1 1 140px">
        <label class="field-label">Button text</label>
        <input class="input" id="f-btn" value="${escapeHTML(data.button_text || '')}"/>
      </div>
    </div>

    <div class="field-row">
      <div style="flex:1 1 120px">
        <label class="field-label">BG color</label>
        <input class="input" id="f-bg" type="color" value="${escapeHTML(data.bg_color || '#0F1614')}"/>
      </div>
      <div style="flex:1 1 120px">
        <label class="field-label">Text color</label>
        <input class="input" id="f-text" type="color" value="${escapeHTML(data.text_color || '#E8F5F0')}"/>
      </div>
      <div style="flex:1 1 100px">
        <label class="field-label">Sort</label>
        <input class="input" id="f-sort" type="number" value="${data.sort_order ?? 0}"/>
        <div style="color:var(--text-muted);font-size:11px;margin-top:4px">Lower = served first.</div>
      </div>
    </div>

    <label class="field-label" style="margin-top:10px">Expires at (optional)</label>
    <input class="input" id="f-exp" type="datetime-local" value="${data.expires_at ? new Date(data.expires_at).toISOString().slice(0,16) : ''}"/>

    <label style="display:flex;align-items:center;gap:6px;margin-top:10px;font-size:13px">
      <input type="checkbox" id="f-active" ${data.is_active ? 'checked' : ''}/> Active
    </label>

    <div class="card" style="margin-top:14px;padding:0;overflow:hidden">
      <div style="font-size:11px;color:var(--text-muted);padding:6px 10px;border-bottom:1px solid var(--border)">PREVIEW</div>
      <div id="f-preview" style="padding:18px;background:${escapeHTML(data.bg_color || '#0F1614')};color:${escapeHTML(data.text_color || '#E8F5F0')}">
        <div style="font-weight:700;font-size:18px">${escapeHTML(data.title || 'Title')}</div>
        <div style="font-size:13px;margin-top:4px;opacity:0.85">${escapeHTML(data.subtitle || 'Subtitle')}</div>
        ${data.button_text ? `<button class="btn btn-sm" style="margin-top:8px">${escapeHTML(data.button_text)}</button>` : ''}
      </div>
    </div>

    <div class="close-row">
      <button class="btn btn-sm btn-ghost" data-act="close">Cancel</button>
      <button class="btn btn-sm" data-act="save">${isNew ? 'Create' : 'Save'}</button>
    </div>
  `;
  modalBackdrop.classList.add('show');

  // Placement radio toggles category select visibility
  const catWrap = modalBody.querySelector('#f-cat-wrap');
  modalBody.querySelectorAll('input[name="f-placement"]').forEach(r => {
    r.addEventListener('change', () => {
      const v = modalBody.querySelector('input[name="f-placement"]:checked').value;
      catWrap.style.display = v === 'category' ? '' : 'none';
    });
  });

  // Live preview wiring
  const preview = modalBody.querySelector('#f-preview');
  const refreshPreview = () => {
    const t = modalBody.querySelector('#f-title').value;
    const s = modalBody.querySelector('#f-sub').value;
    const bg = modalBody.querySelector('#f-bg').value;
    const tx = modalBody.querySelector('#f-text').value;
    const btn = modalBody.querySelector('#f-btn').value;
    preview.style.background = bg; preview.style.color = tx;
    preview.innerHTML = `
      <div style="font-weight:700;font-size:18px">${escapeHTML(t || 'Title')}</div>
      <div style="font-size:13px;margin-top:4px;opacity:0.85">${escapeHTML(s || 'Subtitle')}</div>
      ${btn ? `<button class="btn btn-sm" style="margin-top:8px">${escapeHTML(btn)}</button>` : ''}
    `;
  };
  ['f-title','f-sub','f-bg','f-text','f-btn'].forEach(id =>
    modalBody.querySelector('#' + id).addEventListener('input', refreshPreview));

  // Image upload — gates the Save button so a failed upload can't be saved
  // silently with a stale or missing image_url.
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
      const url = await uploadBannerImage(file);
      urlField.value = url;
      const img = modalBody.querySelector('#f-img-prev');
      img.src = url; img.style.display = '';
      status.textContent = 'Uploaded ✓'; status.style.color = 'var(--green)';
      saveBtn.disabled = false;
    } catch (err) {
      status.textContent = err.message || 'Upload failed';
      status.style.color = 'var(--red)';
      // urlField stays empty; saveBtn stays disabled until a successful retry.
    }
  });

  modalBody.querySelectorAll('[data-act]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (btn.dataset.act === 'close') return modalBackdrop.classList.remove('show');
      if (btn.dataset.act === 'save')  await save(b);
    });
  });
}

async function save(existing) {
  const sb = getSB();
  const url = modalBody.querySelector('#f-img-url').value.trim();
  // Required only when creating; edits may legitimately have no image yet
  // (e.g. legacy rows where image_url is null) and only tweak title/sort/etc.
  if (!existing && !url) return toastWarn('Image is required.');

  const placement = modalBody.querySelector('input[name="f-placement"]:checked').value;
  let category_name = null;
  if (placement === 'category') {
    category_name = modalBody.querySelector('#f-cat').value || '';
    if (!category_name) return toastWarn('Pick a category for this banner.');
  }

  const expRaw = modalBody.querySelector('#f-exp').value;
  const payload = {
    title: modalBody.querySelector('#f-title').value.trim() || null,
    subtitle: modalBody.querySelector('#f-sub').value.trim() || null,
    image_url: url || null,
    link_url: modalBody.querySelector('#f-link').value.trim() || null,
    button_text: modalBody.querySelector('#f-btn').value.trim() || null,
    bg_color: modalBody.querySelector('#f-bg').value || null,
    text_color: modalBody.querySelector('#f-text').value || null,
    sort_order: parseInt(modalBody.querySelector('#f-sort').value, 10) || 0,
    is_active: modalBody.querySelector('#f-active').checked,
    expires_at: expRaw ? new Date(expRaw).toISOString() : null,
    category_name,
  };
  let error;
  if (existing) ({ error } = await sb.from('banners').update(payload).eq('id', existing.id));
  else          ({ error } = await sb.from('banners').insert([payload]));
  if (error) return toastError(error.message);
  toast(existing ? 'Banner updated' : 'Banner created');
  modalBackdrop.classList.remove('show');
  await load(); render();
}

/* ---------- Mount ---------- */

function buildPane() {
  paneEl.innerHTML = `
    <div class="filter-row">
      <button class="btn btn-sm" id="b-new">+ New banner</button>
      <button class="btn btn-ghost btn-sm" id="b-refresh">Refresh</button>
      <span style="color:var(--text-muted);font-size:12px;margin-left:6px">
        Storefront serves the lowest-sort active banner per slot.
      </span>
    </div>
    <div id="b-list"></div>
  `;
  listEl = paneEl.querySelector('#b-list');
  paneEl.querySelector('#b-new').addEventListener('click', () => openForm(null));
  paneEl.querySelector('#b-refresh').addEventListener('click', async () => { await load(); render(); });

  listEl.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const card = btn.closest('article');
    const b = state.banners.find(x => x.id === card?.dataset.id);
    if (!b) return;
    if (btn.dataset.action === 'edit')    openForm(b);
    if (btn.dataset.action === 'toggle')  await toggleActive(b);
    if (btn.dataset.action === 'delete')  await deleteBanner(b);
    if (btn.dataset.action === 'promote') await promote(b);
  });

  // Re-render when categories change so groupings stay in sync.
  AppState.on('categories:changed', async () => { await load(); render(); });
}

export async function mount(rootPaneEl, ctxIn) {
  paneEl = rootPaneEl;
  modalBackdrop = ctxIn.modalBackdrop;
  modalBody = ctxIn.modalBody;
  if (!mounted) { buildPane(); mounted = true; }
  await load(); render();
}
