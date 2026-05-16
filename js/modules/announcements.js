// Announcements module — Surface B (blueprint §9.7, §11.9)

import { getSB } from '../core/supabase.js';
import { toast, toastError, toastWarn } from '../core/toast.js';
import { escapeHTML, formatDate } from '../core/utils.js';

let mounted = false;
let paneEl = null;
let listEl = null;
let modalBackdrop = null;
let modalBody = null;

const state = { items: [] };

const TYPES = ['info', 'warning', 'promo', 'alert'];
const TYPE_DEFAULTS = {
  info:    { bg_color: '#00204D', text_color: '#E8F5F0', icon: 'ℹ️' },
  warning: { bg_color: '#3D3300', text_color: '#FFD700', icon: '⚠️' },
  promo:   { bg_color: '#003D32', text_color: '#00C9A7', icon: '🎉' },
  alert:   { bg_color: '#3D0008', text_color: '#FF4757', icon: '🚨' },
};

async function load() {
  const sb = getSB();
  // Owner needs to see ALL announcements (active + inactive) — slight relaxation
  // of §11.9's `.eq('is_active', true)`. The storefront still filters to active-only.
  const { data, error } = await sb
    .from('announcements')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) { toastError('Announcements load failed: ' + error.message); return; }
  state.items = data || [];
}

function isLive(a) {
  if (!a.is_active) return false;
  const now = new Date();
  if (a.starts_at && new Date(a.starts_at) > now) return false;
  if (a.ends_at && new Date(a.ends_at) < now) return false;
  return true;
}

function rowHTML(a) {
  const live = isLive(a);
  const t = TYPE_DEFAULTS[a.type] || TYPE_DEFAULTS.info;
  return `
    <article class="card" data-id="${escapeHTML(a.id)}" style="margin-bottom:10px">
      <div style="display:flex;gap:14px;align-items:flex-start;flex-wrap:wrap">
        <div style="flex:1;min-width:200px">
          <div style="display:inline-block;padding:6px 14px;border-radius:8px;background:${escapeHTML(a.bg_color || t.bg_color)};color:${escapeHTML(a.text_color || t.text_color)};font-size:13px;font-weight:600;max-width:100%">
            ${escapeHTML(a.icon || t.icon)} ${escapeHTML(a.message || '')}
          </div>
          <div style="margin-top:8px;color:var(--text-muted);font-size:11px">
            ${escapeHTML(a.type || 'info')}
            ${a.starts_at ? ` · from ${escapeHTML(formatDate(a.starts_at))}` : ''}
            ${a.ends_at ? ` · until ${escapeHTML(formatDate(a.ends_at))}` : ''}
          </div>
        </div>
        <div style="display:flex;gap:6px;flex-direction:column">
          <span class="status-badge ${live ? 'status-completed' : 'status-cancelled'}">${live ? 'Live' : 'Off'}</span>
          <button class="btn btn-sm btn-ghost" data-action="edit">Edit</button>
          <button class="btn btn-sm btn-ghost" data-action="toggle">${a.is_active ? 'Disable' : 'Enable'}</button>
          <button class="btn btn-sm btn-danger" data-action="delete">Delete</button>
        </div>
      </div>
    </article>
  `;
}

function render() {
  if (!state.items.length) {
    listEl.innerHTML = `<div class="empty">No announcements yet.</div>`;
    return;
  }
  listEl.innerHTML = state.items.map(rowHTML).join('');
}

/* ---------- Mutations ---------- */

async function toggleActive(a) {
  const sb = getSB();
  const { error } = await sb.from('announcements').update({ is_active: !a.is_active }).eq('id', a.id);
  if (error) return toastError(error.message);
  await load(); render();
}

async function deleteOne(a) {
  if (!confirm('Delete this announcement?')) return;
  const sb = getSB();
  const { error } = await sb.from('announcements').delete().eq('id', a.id);
  if (error) return toastError(error.message);
  toast('Announcement deleted');
  await load(); render();
}

function openForm(a) {
  const isNew = !a;
  const data = a || {
    message: '', type: 'info', is_active: true,
    starts_at: null, ends_at: null,
    bg_color: TYPE_DEFAULTS.info.bg_color, text_color: TYPE_DEFAULTS.info.text_color,
    icon: TYPE_DEFAULTS.info.icon, link_url: '', link_text: '',
  };
  modalBody.innerHTML = `
    <h2>${isNew ? 'New announcement' : 'Edit announcement'}</h2>

    <label class="field-label">Message *</label>
    <textarea class="input" id="f-msg" rows="2">${escapeHTML(data.message || '')}</textarea>

    <div class="field-row" style="margin-top:10px">
      <div style="flex:1 1 140px">
        <label class="field-label">Type</label>
        <select class="input" id="f-type">
          ${TYPES.map(t => `<option value="${t}" ${t === data.type ? 'selected' : ''}>${t}</option>`).join('')}
        </select>
      </div>
      <div style="flex:1 1 100px">
        <label class="field-label">Icon</label>
        <input class="input" id="f-icon" value="${escapeHTML(data.icon || '')}" maxlength="4"/>
      </div>
    </div>

    <div class="field-row">
      <div style="flex:1 1 120px">
        <label class="field-label">BG color</label>
        <input class="input" id="f-bg" type="color" value="${escapeHTML(data.bg_color || '#00204D')}"/>
      </div>
      <div style="flex:1 1 120px">
        <label class="field-label">Text color</label>
        <input class="input" id="f-tx" type="color" value="${escapeHTML(data.text_color || '#E8F5F0')}"/>
      </div>
    </div>

    <div class="field-row">
      <div style="flex:1 1 200px">
        <label class="field-label">Link URL (optional)</label>
        <input class="input" id="f-link" value="${escapeHTML(data.link_url || '')}" placeholder="https://…"/>
      </div>
      <div style="flex:1 1 140px">
        <label class="field-label">Link text</label>
        <input class="input" id="f-ltext" value="${escapeHTML(data.link_text || '')}"/>
      </div>
    </div>

    <div class="field-row">
      <div style="flex:1 1 160px">
        <label class="field-label">Starts at</label>
        <input class="input" id="f-start" type="datetime-local" value="${data.starts_at ? new Date(data.starts_at).toISOString().slice(0,16) : ''}"/>
      </div>
      <div style="flex:1 1 160px">
        <label class="field-label">Ends at</label>
        <input class="input" id="f-end" type="datetime-local" value="${data.ends_at ? new Date(data.ends_at).toISOString().slice(0,16) : ''}"/>
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

  // Type change auto-fills color/icon if user hasn't picked custom
  modalBody.querySelector('#f-type').addEventListener('change', (e) => {
    const def = TYPE_DEFAULTS[e.target.value];
    if (!def) return;
    modalBody.querySelector('#f-bg').value   = def.bg_color;
    modalBody.querySelector('#f-tx').value   = def.text_color;
    modalBody.querySelector('#f-icon').value = def.icon;
  });

  modalBody.querySelectorAll('[data-act]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (btn.dataset.act === 'close') return modalBackdrop.classList.remove('show');
      if (btn.dataset.act === 'save')  await save(a);
    });
  });
}

async function save(existing) {
  const sb = getSB();
  const message = modalBody.querySelector('#f-msg').value.trim();
  if (!message) return toastWarn('Message is required.');
  const startRaw = modalBody.querySelector('#f-start').value;
  const endRaw   = modalBody.querySelector('#f-end').value;
  const payload = {
    message,
    type: modalBody.querySelector('#f-type').value,
    icon: modalBody.querySelector('#f-icon').value.trim() || null,
    bg_color: modalBody.querySelector('#f-bg').value || null,
    text_color: modalBody.querySelector('#f-tx').value || null,
    link_url: modalBody.querySelector('#f-link').value.trim() || null,
    link_text: modalBody.querySelector('#f-ltext').value.trim() || null,
    starts_at: startRaw ? new Date(startRaw).toISOString() : null,
    ends_at:   endRaw   ? new Date(endRaw).toISOString()   : null,
    is_active: modalBody.querySelector('#f-active').checked,
  };
  let error;
  if (existing) ({ error } = await sb.from('announcements').update(payload).eq('id', existing.id));
  else          ({ error } = await sb.from('announcements').insert([payload]));
  if (error) return toastError(error.message);
  toast(existing ? 'Announcement updated' : 'Announcement created');
  modalBackdrop.classList.remove('show');
  await load(); render();
}

function buildPane() {
  paneEl.innerHTML = `
    <div class="filter-row">
      <button class="btn btn-sm" id="a-new">+ New announcement</button>
      <button class="btn btn-ghost btn-sm" id="a-refresh">Refresh</button>
    </div>
    <div id="a-list"></div>
  `;
  listEl = paneEl.querySelector('#a-list');
  paneEl.querySelector('#a-new').addEventListener('click', () => openForm(null));
  paneEl.querySelector('#a-refresh').addEventListener('click', async () => { await load(); render(); });

  listEl.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const card = btn.closest('article');
    const a = state.items.find(x => x.id === card?.dataset.id);
    if (!a) return;
    if (btn.dataset.action === 'edit')   openForm(a);
    if (btn.dataset.action === 'toggle') await toggleActive(a);
    if (btn.dataset.action === 'delete') await deleteOne(a);
  });
}

export async function mount(rootPaneEl, ctxIn) {
  paneEl = rootPaneEl;
  modalBackdrop = ctxIn.modalBackdrop;
  modalBody = ctxIn.modalBody;
  if (!mounted) { buildPane(); mounted = true; }
  await load(); render();
}
