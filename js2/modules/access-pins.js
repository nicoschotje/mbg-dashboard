// Access PINs module — Surface C (blueprint §9.11, §11.12, §4)
//
// All mutations go through SECURITY DEFINER RPCs from §4. The dashboard
// never sees a raw customer PIN — `p_pin` is sent as a parameter, the
// server bcrypts it via pg_crypto. We never SELECT pin_hash.

import { getSB } from '../core/supabase.js';
import { toast, toastError, toastWarn } from '../core/toast.js';
import { escapeHTML, formatDate } from '../core/utils.js';

let mounted = false;
let paneEl = null;
let listEl = null;
let modalBackdrop = null;
let modalBody = null;

const state = {
  customers: [],
  search: '',
  filterStatus: 'all', // all | active | locked | disabled
};

async function loadAll() {
  const sb = getSB();
  // §11.12 / §4: list_store_customers returns safe fields only (no pin_hash)
  const { data, error } = await sb.rpc('list_store_customers');
  if (error) { toastError('Clients load: ' + error.message); return; }
  state.customers = data || [];
}

function statusOf(c) {
  if (!c.is_active) return 'disabled';
  if (c.locked_until && new Date(c.locked_until) > new Date()) return 'locked';
  return 'active';
}

function statusBadge(c) {
  const s = statusOf(c);
  const cls = s === 'active' ? 'status-completed' : s === 'locked' ? 'status-pending' : 'status-cancelled';
  const label = s === 'active' ? 'Active' : s === 'locked' ? 'Locked' : 'Disabled';
  return `<span class="status-badge ${cls}">${label}</span>`;
}

function rowHTML(c) {
  return `
    <tr data-id="${escapeHTML(c.id)}">
      <td>
        <div style="font-weight:600">${escapeHTML(c.display_name || '—')}</div>
        <div style="color:var(--text-muted);font-size:11px">${escapeHTML(c.email || '')}</div>
      </td>
      <td style="font-family:'JetBrains Mono',monospace">${escapeHTML(c.phone || '')}</td>
      <td>${statusBadge(c)}</td>
      <td style="font-family:'JetBrains Mono',monospace">${c.failed_attempts || 0}</td>
      <td style="color:var(--text-muted);font-size:12px">${c.last_login_at ? escapeHTML(formatDate(c.last_login_at)) : '—'}</td>
      <td style="white-space:nowrap">
        <button class="btn btn-sm btn-ghost" data-action="edit">Edit</button>
        <button class="btn btn-sm btn-ghost" data-action="reset-pin">Reset PIN</button>
        ${statusOf(c) === 'locked' ? '<button class="btn btn-sm btn-warn" data-action="unlock">Unlock</button>' : ''}
        <button class="btn btn-sm btn-ghost" data-action="toggle">${c.is_active ? 'Disable' : 'Enable'}</button>
      </td>
    </tr>
  `;
}

function filtered() {
  let rows = state.customers;
  if (state.search) {
    const s = state.search.toLowerCase();
    rows = rows.filter(c =>
      (c.display_name || '').toLowerCase().includes(s) ||
      (c.phone || '').toLowerCase().includes(s) ||
      (c.email || '').toLowerCase().includes(s)
    );
  }
  if (state.filterStatus !== 'all') rows = rows.filter(c => statusOf(c) === state.filterStatus);
  return rows;
}

function render() {
  const rows = filtered();
  listEl.innerHTML = `
    <div class="card" style="padding:0;overflow:hidden">
      <div style="overflow-x:auto">
        <table class="inv-table">
          <thead><tr><th>Name</th><th>Phone</th><th>Status</th><th>Fails</th><th>Last login</th><th></th></tr></thead>
          <tbody>
            ${rows.length ? rows.map(rowHTML).join('')
              : '<tr><td colspan="6" class="empty">No client accounts.</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

/* ---------- RPC mutations (§11.12) ---------- */

async function createCustomer({ display_name, phone, email, pin, address, notes }) {
  const sb = getSB();
  const { data, error } = await sb.rpc('create_store_customer', {
    p_display_name: display_name,
    p_phone: phone,
    p_email: email || null,
    p_pin: pin,            // raw PIN goes only to the SECURITY DEFINER RPC
    p_notes: notes || null,
    p_address: address || null,
  });
  if (error) throw error;
  return data;
}

async function resetPin(customerId, newPin) {
  const sb = getSB();
  const { error } = await sb.rpc('reset_customer_pin', {
    p_customer_id: customerId,
    p_new_pin: newPin,
  });
  if (error) throw error;
}

async function updateAddress(customerId, address) {
  const sb = getSB();
  const { error } = await sb.rpc('update_customer_address', {
    p_customer_id: customerId,
    p_address: address,
  });
  if (error) throw error;
}

async function toggleActive(customer) {
  const sb = getSB();
  const { error } = await sb.rpc('toggle_customer_active', {
    p_customer_id: customer.id,
    p_active: !customer.is_active,
  });
  if (error) throw error;
}

async function unlockAccount(customerId) {
  const sb = getSB();
  const { error } = await sb.rpc('unlock_store_customer', { p_customer_id: customerId });
  if (error) throw error;
}

async function deleteAccount(customerId) {
  const sb = getSB();
  const { error } = await sb.rpc('delete_store_customer', { p_customer_id: customerId });
  if (error) throw error;
}

/* ---------- Modals ---------- */

function openCreateForm() {
  modalBody.innerHTML = `
    <h2>New client account</h2>
    <p style="color:var(--text-muted);font-size:12px;margin:0 0 14px">
      The PIN is hashed server-side via <code>pg_crypto</code> (bcrypt). Raw PIN is never stored.
    </p>

    <label class="field-label">Display name *</label>
    <input class="input" id="ac-name"/>

    <div class="field-row" style="margin-top:10px">
      <div style="flex:1 1 200px">
        <label class="field-label">Phone *</label>
        <input class="input" id="ac-phone" inputmode="tel"/>
      </div>
      <div style="flex:1 1 200px">
        <label class="field-label">Email</label>
        <input class="input" id="ac-email" type="email"/>
      </div>
    </div>

    <label class="field-label" style="margin-top:10px">PIN * (4–6 digits)</label>
    <input class="input" id="ac-pin" type="password" inputmode="numeric" maxlength="6" autocomplete="off"/>

    <label class="field-label" style="margin-top:10px">Address</label>
    <textarea class="input" id="ac-addr" rows="2"></textarea>

    <label class="field-label" style="margin-top:10px">Notes (owner only)</label>
    <textarea class="input" id="ac-notes" rows="2"></textarea>

    <div class="close-row">
      <button class="btn btn-sm btn-ghost" data-act="close">Cancel</button>
      <button class="btn btn-sm" data-act="create">Create account</button>
    </div>
  `;
  modalBackdrop.classList.add('show');

  modalBody.querySelectorAll('[data-act]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (btn.dataset.act === 'close') return modalBackdrop.classList.remove('show');
      const display_name = modalBody.querySelector('#ac-name').value.trim();
      const phone        = modalBody.querySelector('#ac-phone').value.trim();
      const email        = modalBody.querySelector('#ac-email').value.trim();
      const pin          = modalBody.querySelector('#ac-pin').value.trim();
      const address      = modalBody.querySelector('#ac-addr').value.trim();
      const notes        = modalBody.querySelector('#ac-notes').value.trim();
      if (!display_name || !phone) return toastWarn('Name and phone are required.');
      if (!/^\d{4,6}$/.test(pin)) return toastWarn('PIN must be 4–6 digits.');
      try {
        await createCustomer({ display_name, phone, email, pin, address, notes });
        toast('Client account created.');
        modalBackdrop.classList.remove('show');
        await loadAll(); render();
      } catch (e) { toastError(e.message); }
    });
  });
}

function openEditForm(c) {
  modalBody.innerHTML = `
    <h2>${escapeHTML(c.display_name)}</h2>
    <div style="color:var(--text-muted);font-size:12px;margin-bottom:14px">📞 ${escapeHTML(c.phone || '')}${c.email ? ` · ${escapeHTML(c.email)}` : ''}</div>

    <label class="field-label">Address</label>
    <textarea class="input" id="ed-addr" rows="2">${escapeHTML(c.address || '')}</textarea>

    <div class="close-row">
      <button class="btn btn-sm btn-danger" data-act="delete">Delete account</button>
      <button class="btn btn-sm btn-ghost" data-act="close">Cancel</button>
      <button class="btn btn-sm" data-act="save">Save address</button>
    </div>
  `;
  modalBackdrop.classList.add('show');

  modalBody.querySelectorAll('[data-act]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const a = btn.dataset.act;
      if (a === 'close') return modalBackdrop.classList.remove('show');
      if (a === 'save') {
        try {
          await updateAddress(c.id, modalBody.querySelector('#ed-addr').value);
          toast('Address updated.');
          modalBackdrop.classList.remove('show');
          await loadAll(); render();
        } catch (e) { toastError(e.message); }
      }
      if (a === 'delete') {
        if (!confirm(`Permanently delete account for ${c.display_name}? This cannot be undone.`)) return;
        try {
          await deleteAccount(c.id);
          toast('Account deleted.');
          modalBackdrop.classList.remove('show');
          await loadAll(); render();
        } catch (e) { toastError(e.message); }
      }
    });
  });
}

function openResetPin(c) {
  modalBody.innerHTML = `
    <h2>Reset PIN — ${escapeHTML(c.display_name)}</h2>
    <p style="color:var(--text-muted);font-size:12px;margin:0 0 14px">
      Sets a new PIN for this customer. The PIN is hashed server-side via bcrypt.
    </p>
    <label class="field-label">New PIN (4–6 digits) *</label>
    <input class="input" id="rp-pin" type="password" inputmode="numeric" maxlength="6" autocomplete="off"/>
    <div class="close-row">
      <button class="btn btn-sm btn-ghost" data-act="close">Cancel</button>
      <button class="btn btn-sm" data-act="save">Reset PIN</button>
    </div>
  `;
  modalBackdrop.classList.add('show');
  modalBody.querySelectorAll('[data-act]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (btn.dataset.act === 'close') return modalBackdrop.classList.remove('show');
      const pin = modalBody.querySelector('#rp-pin').value.trim();
      if (!/^\d{4,6}$/.test(pin)) return toastWarn('PIN must be 4–6 digits.');
      try {
        await resetPin(c.id, pin);
        toast('PIN reset. Notify the client of their new PIN.');
        modalBackdrop.classList.remove('show');
        await loadAll(); render();
      } catch (e) { toastError(e.message); }
    });
  });
}

/* ---------- Mount ---------- */

function buildPane() {
  paneEl.innerHTML = `
    <div class="filter-row">
      <input class="input" id="ap-search" placeholder="Search name, phone, email…"/>
      <select class="input" id="ap-status" style="max-width:180px">
        <option value="all">All accounts</option>
        <option value="active">Active</option>
        <option value="locked">Locked</option>
        <option value="disabled">Disabled</option>
      </select>
      <button class="btn btn-sm" id="ap-new">+ New account</button>
      <button class="btn btn-ghost btn-sm" id="ap-refresh">Refresh</button>
    </div>
    <div id="ap-list"></div>
  `;
  listEl = paneEl.querySelector('#ap-list');

  paneEl.querySelector('#ap-search').addEventListener('input', (e) => { state.search = e.target.value.trim(); render(); });
  paneEl.querySelector('#ap-status').addEventListener('change', (e) => { state.filterStatus = e.target.value; render(); });
  paneEl.querySelector('#ap-new').addEventListener('click', openCreateForm);
  paneEl.querySelector('#ap-refresh').addEventListener('click', async () => { await loadAll(); render(); });

  listEl.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const tr = btn.closest('tr');
    const c = state.customers.find(x => x.id === tr?.dataset.id);
    if (!c) return;
    const action = btn.dataset.action;
    try {
      if (action === 'edit')      openEditForm(c);
      if (action === 'reset-pin') openResetPin(c);
      if (action === 'toggle')    { await toggleActive(c); toast(`${c.display_name} → ${!c.is_active ? 'enabled' : 'disabled'}`); await loadAll(); render(); }
      if (action === 'unlock')    { await unlockAccount(c.id); toast('Account unlocked.'); await loadAll(); render(); }
    } catch (err) { toastError(err.message); }
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
