// Settings module — Surface B (blueprint §9.12, §11.6, §11.8)
//
// Edits the single-row store_settings table plus delivery_zones (separate
// table) and PIN hashes in dashboard_settings. Everything is owner-only;
// the surface router blocks sales role at the surface level.

import { getSB } from '../core/supabase.js';
import { AppState } from '../core/state.js';
import { toast, toastError, toastWarn } from '../core/toast.js';
import { escapeHTML, hashPIN } from '../core/utils.js';
import { loadStoreSettings } from '../core/settings.js';
import { uploadStoreLogo, uploadQR } from '../core/storage.js';

let mounted = false;
let paneEl = null;

const state = {
  settings: null,        // store_settings row
  zones: [],             // delivery_zones rows
  tiers: [],             // tier definitions (dashboard_settings TIER_CONFIG)
};

const DEFAULT_TIERS = [
  { tier_level: 5, name: 'Diamond',  icon: '💎', color: '#9B59B6', min_spend: 10000 },
  { tier_level: 4, name: 'Gold',     icon: '🥇', color: '#F39C12', min_spend: 5000  },
  { tier_level: 3, name: 'Silver',   icon: '🥈', color: '#95A5A6', min_spend: 2000  },
  { tier_level: 2, name: 'Bronze',   icon: '🥉', color: '#E67E22', min_spend: 500   },
  { tier_level: 1, name: 'Seedling', icon: '🌱', color: '#27AE60', min_spend: 0     },
];

async function loadAll() {
  const sb = getSB();

  // §11.6 single-row read
  const { data: settings, error: sErr } = await sb
    .from('store_settings').select('*').limit(1).single();
  if (sErr && sErr.code !== 'PGRST116') {
    toastError('Settings load failed: ' + sErr.message);
  }
  state.settings = settings || {
    store_name: AppState.settings?.store_name || '',
    delivery_fee: 50, free_delivery_min: 0, is_open: true,
    operating_hours: { open: '08:00', close: '22:00', days: [0,1,2,3,4,5,6] },
  };

  const { data: zones, error: zErr } = await sb
    .from('delivery_zones').select('*').order('sort_order', { ascending: true });
  if (zErr) toastError('Zones load failed: ' + zErr.message);
  state.zones = zones || [];

  const { data: tierRow, error: tErr } = await sb
    .from('dashboard_settings').select('value').eq('key', 'TIER_CONFIG').maybeSingle();
  if (tErr) toastError('Tier config load failed: ' + tErr.message);
  let parsedTiers = null;
  if (tierRow?.value) {
    try { parsedTiers = JSON.parse(tierRow.value); } catch (_) { parsedTiers = null; }
  }
  state.tiers = (Array.isArray(parsedTiers) && parsedTiers.length)
    ? parsedTiers.slice().sort((a, b) => (b.tier_level || 0) - (a.tier_level || 0))
    : DEFAULT_TIERS.slice();
}

/* ---------- store_settings save (§11.6 upsert pattern) ---------- */

async function saveSettings(payload) {
  const sb = getSB();
  const { data: existing } = await sb.from('store_settings').select('id').limit(1).single();
  const body = { ...payload, updated_at: new Date().toISOString() };
  if (existing?.id) {
    const { error } = await sb.from('store_settings').update(body).eq('id', existing.id);
    if (error) throw error;
  } else {
    const { error } = await sb.from('store_settings').insert([body]);
    if (error) throw error;
  }
  // Re-broadcast settings so brand text everywhere updates immediately
  await loadStoreSettings();
}

/* ---------- Sections render ---------- */

function render() {
  const s = state.settings || {};
  const hours = s.operating_hours || { open: '08:00', close: '22:00', days: [0,1,2,3,4,5,6] };
  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  paneEl.innerHTML = `
    <div class="filter-row">
      <button class="btn btn-ghost btn-sm" id="s-refresh">Refresh</button>
    </div>

    <!-- Profile -->
    <div class="card" style="margin-bottom:14px">
      <h3 style="margin:0 0 10px;font-family:'Syne',sans-serif">Store Profile</h3>
      <label class="field-label">Store name</label>
      <input class="input" id="p-name" value="${escapeHTML(s.store_name || '')}"/>
      <label class="field-label" style="margin-top:10px">Tagline</label>
      <input class="input" id="p-tagline" value="${escapeHTML(s.store_tagline || '')}"/>
      <div class="field-row" style="margin-top:10px">
        <div style="flex:1 1 200px">
          <label class="field-label">Phone</label>
          <input class="input" id="p-phone" value="${escapeHTML(s.store_phone || '')}"/>
        </div>
        <div style="flex:1 1 200px">
          <label class="field-label">Email</label>
          <input class="input" id="p-email" value="${escapeHTML(s.store_email || '')}"/>
        </div>
      </div>
      <label class="field-label" style="margin-top:10px">Address</label>
      <textarea class="input" id="p-addr" rows="2">${escapeHTML(s.store_address || '')}</textarea>

      <label class="field-label" style="margin-top:10px">Logo</label>
      <div style="display:flex;gap:10px;align-items:center">
        <img id="p-logo-prev" src="${escapeHTML(s.store_logo_url || '')}" style="width:64px;height:64px;object-fit:cover;border-radius:8px;background:var(--bg-base);${s.store_logo_url ? '' : 'display:none'}"/>
        <input type="file" id="p-logo" accept="image/jpeg,image/png,image/webp"/>
        <span id="p-logo-status" style="color:var(--text-muted);font-size:12px"></span>
      </div>
      <input type="hidden" id="p-logo-url" value="${escapeHTML(s.store_logo_url || '')}"/>

      <button class="btn btn-sm" id="p-save" style="margin-top:14px">Save profile</button>
    </div>

    <!-- Payment -->
    <div class="card" style="margin-bottom:14px">
      <h3 style="margin:0 0 10px;font-family:'Syne',sans-serif">Payment</h3>

      <div style="font-weight:600;margin-bottom:6px">GCash</div>
      <div class="field-row">
        <div style="flex:1 1 180px">
          <label class="field-label">Number</label>
          <input class="input" id="pm-gcash-num" value="${escapeHTML(s.gcash_number || '')}"/>
        </div>
        <div style="flex:1 1 180px">
          <label class="field-label">Account name</label>
          <input class="input" id="pm-gcash-name" value="${escapeHTML(s.gcash_name || '')}"/>
        </div>
      </div>

      <div style="font-weight:600;margin:14px 0 6px">Bank</div>
      <div class="field-row">
        <div style="flex:1 1 180px">
          <label class="field-label">Bank name</label>
          <input class="input" id="pm-bank-name" value="${escapeHTML(s.bank_name || '')}"/>
        </div>
        <div style="flex:1 1 180px">
          <label class="field-label">Account number</label>
          <input class="input" id="pm-bank-acct" value="${escapeHTML(s.bank_account || '')}"/>
        </div>
        <div style="flex:1 1 180px">
          <label class="field-label">Account holder</label>
          <input class="input" id="pm-bank-holder" value="${escapeHTML(s.bank_account_name || '')}"/>
        </div>
      </div>

      <div style="font-weight:600;margin:14px 0 6px">USDT / Crypto</div>
      <label style="display:flex;align-items:center;gap:6px;font-size:13px;margin-bottom:6px">
        <input type="checkbox" id="pm-crypto-en" ${s.crypto_enabled ? 'checked' : ''}/> Accept USDT
      </label>
      <div class="field-row">
        <div style="flex:2 1 280px">
          <label class="field-label">Wallet address</label>
          <input class="input" id="pm-crypto-addr" value="${escapeHTML(s.crypto_usdt_address || '')}" placeholder="0x… or T…"/>
        </div>
        <div style="flex:1 1 140px">
          <label class="field-label">Network</label>
          <select class="input" id="pm-crypto-net">
            ${['', 'ERC-20', 'TRC-20', 'BEP-20', 'POLYGON'].map(n =>
              `<option value="${n}" ${s.crypto_usdt_network === n ? 'selected' : ''}>${n || '— select —'}</option>`).join('')}
          </select>
        </div>
      </div>
      <div id="pm-rate" style="color:var(--text-muted);font-size:12px;margin-top:8px">USDT/PHP rate: <span id="pm-rate-val">—</span> <button class="btn btn-ghost btn-sm" id="pm-rate-fetch">Fetch live</button></div>

      <button class="btn btn-sm" id="pm-save" style="margin-top:14px">Save payment</button>
    </div>

    <!-- Delivery -->
    <div class="card" style="margin-bottom:14px">
      <h3 style="margin:0 0 10px;font-family:'Syne',sans-serif">Delivery</h3>
      <div class="field-row">
        <div style="flex:1 1 180px">
          <label class="field-label">Default fee ₱</label>
          <input class="input" id="d-fee" type="number" min="0" step="0.01" value="${s.delivery_fee ?? 50}"/>
        </div>
        <div style="flex:1 1 180px">
          <label class="field-label">Free delivery min ₱</label>
          <input class="input" id="d-min" type="number" min="0" step="0.01" value="${s.free_delivery_min ?? 0}"/>
        </div>
        <div style="flex:1 1 180px">
          <label class="field-label">Min order ₱</label>
          <input class="input" id="d-minorder" type="number" min="0" step="0.01" value="${s.min_order_amount ?? 0}"/>
        </div>
      </div>
      <button class="btn btn-sm" id="d-save" style="margin-top:10px">Save delivery</button>

      <div style="font-weight:600;margin:18px 0 6px">Zones</div>
      <div id="zone-list">${zonesHTML()}</div>
      <div class="field-row" style="margin-top:8px">
        <input class="input" id="zn-name" placeholder="New zone name" style="flex:1 1 180px"/>
        <input class="input" id="zn-fee" type="number" min="0" step="0.01" placeholder="Fee" style="flex:1 1 100px"/>
        <button class="btn btn-sm" id="zn-add">+ Add zone</button>
      </div>
    </div>

    <!-- Hours -->
    <div class="card" style="margin-bottom:14px">
      <h3 style="margin:0 0 10px;font-family:'Syne',sans-serif">Store Hours</h3>
      <div class="field-row">
        <div style="flex:1 1 140px">
          <label class="field-label">Opens</label>
          <input class="input" id="h-open" type="time" value="${escapeHTML(hours.open || '08:00')}"/>
        </div>
        <div style="flex:1 1 140px">
          <label class="field-label">Closes</label>
          <input class="input" id="h-close" type="time" value="${escapeHTML(hours.close || '22:00')}"/>
        </div>
      </div>
      <label class="field-label" style="margin-top:10px">Operating days</label>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${days.map((d, i) => `
          <label style="display:flex;align-items:center;gap:4px;font-size:13px">
            <input type="checkbox" class="h-day" data-day="${i}" ${(hours.days || []).includes(i) ? 'checked' : ''}/> ${d}
          </label>
        `).join('')}
      </div>

      <div class="field-row" style="margin-top:10px">
        <label style="display:flex;align-items:center;gap:6px;font-size:13px;flex:1 1 200px">
          <input type="checkbox" id="h-isopen" ${s.is_open === false ? '' : 'checked'}/> Store is open (auto)
        </label>
        <div style="flex:1 1 220px">
          <label class="field-label">Manual override</label>
          <select class="input" id="h-override">
            <option value="">— follow auto schedule —</option>
            <option value="true">Force OPEN</option>
            <option value="false">Force CLOSED</option>
          </select>
        </div>
      </div>
      <button class="btn btn-sm" id="h-save" style="margin-top:10px">Save hours</button>
    </div>

    <!-- Notifications -->
    <div class="card" style="margin-bottom:14px">
      <h3 style="margin:0 0 10px;font-family:'Syne',sans-serif">Notifications</h3>
      <div class="field-row">
        <div style="flex:2 1 280px">
          <label class="field-label">Telegram bot token</label>
          <input class="input" id="n-token" type="password" value="${escapeHTML(s.telegram_bot_token || '')}" autocomplete="off"/>
        </div>
        <div style="flex:1 1 200px">
          <label class="field-label">Chat ID</label>
          <input class="input" id="n-chat" value="${escapeHTML(s.telegram_chat_id || '')}"/>
        </div>
      </div>
      <button class="btn btn-sm" id="n-save" style="margin-top:10px">Save notifications</button>
    </div>

    <!-- Tier Configuration -->
    <div class="card" style="margin-bottom:14px">
      <h3 style="margin:0 0 10px;font-family:'Syne',sans-serif">Tier Configuration</h3>
      <p style="color:var(--text-muted);font-size:13px;margin:0 0 12px">
        Tiers are assigned automatically based on customer lifetime spend (₱).
      </p>
      <div id="tier-list">${tiersHTML()}</div>
      <button class="btn btn-sm" id="tier-save" style="margin-top:10px">Save tiers</button>
    </div>

    <!-- PIN management -->
    <div class="card" style="margin-bottom:14px">
      <h3 style="margin:0 0 10px;font-family:'Syne',sans-serif">PIN Management</h3>
      <div style="font-weight:600;margin-bottom:6px">Owner PIN (6 digits)</div>
      <div class="field-row">
        <input class="input" id="pin-owner-cur" type="password" inputmode="numeric" maxlength="6" placeholder="Current owner PIN" style="flex:1 1 180px"/>
        <input class="input" id="pin-owner-new" type="password" inputmode="numeric" maxlength="6" placeholder="New 6-digit PIN" style="flex:1 1 180px"/>
        <button class="btn btn-sm" id="pin-owner-save">Update owner</button>
      </div>
      <div style="font-weight:600;margin:14px 0 6px">Sales PIN (4 digits)</div>
      <div class="field-row">
        <input class="input" id="pin-sales-owner" type="password" inputmode="numeric" maxlength="6" placeholder="Owner PIN (auth)" style="flex:1 1 180px"/>
        <input class="input" id="pin-sales-new" type="password" inputmode="numeric" maxlength="4" placeholder="New 4-digit PIN" style="flex:1 1 180px"/>
        <button class="btn btn-sm" id="pin-sales-save">Update sales</button>
      </div>
    </div>

    <!-- Danger -->
    <div class="card" style="margin-bottom:14px;border-color:var(--red)">
      <h3 style="margin:0 0 10px;font-family:'Syne',sans-serif;color:var(--red)">Danger Zone</h3>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-sm btn-ghost" id="dz-export">Export data (CSV bundle)</button>
        <button class="btn btn-sm btn-warn" id="dz-clear">Clear analytics cache</button>
      </div>
    </div>
  `;

  bindHandlers();
}

function zonesHTML() {
  if (!state.zones.length) return `<div class="empty" style="padding:14px">No zones yet.</div>`;
  return state.zones.map(z => `
    <div data-zone-id="${escapeHTML(z.id)}" style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px dashed var(--border)">
      <span style="flex:1;font-size:13px">${escapeHTML(z.name)}</span>
      <span style="font-family:'JetBrains Mono',monospace;font-size:13px">₱${z.base_fee ?? 0}</span>
      <button class="btn btn-sm btn-danger" data-zn-del>Delete</button>
    </div>
  `).join('');
}

function tiersHTML() {
  if (!state.tiers.length) return `<div class="empty" style="padding:14px">No tiers configured.</div>`;
  return state.tiers.map(t => `
    <div data-tier-level="${t.tier_level}" style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px dashed var(--border);flex-wrap:wrap">
      <span style="font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--text-muted);width:18px">L${t.tier_level}</span>
      <input class="input tc-icon" value="${escapeHTML(t.icon || '')}" maxlength="4" placeholder="Icon" style="flex:0 0 56px;text-align:center"/>
      <input class="input tc-name" value="${escapeHTML(t.name || '')}" placeholder="Name" style="flex:1 1 110px"/>
      <input class="input tc-spend" type="number" min="0" step="0.01" value="${t.min_spend ?? 0}" placeholder="Min ₱" style="flex:1 1 100px"/>
      <input class="tc-color" type="color" value="${escapeHTML(t.color || '#888888')}" style="flex:0 0 40px;height:34px;padding:2px;border:1px solid var(--border);border-radius:6px;background:var(--bg-base)"/>
    </div>
  `).join('');
}

/* ---------- Handlers ---------- */

function bindHandlers() {
  paneEl.querySelector('#s-refresh').addEventListener('click', async () => { await loadAll(); render(); });

  // Logo upload
  paneEl.querySelector('#p-logo').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const status = paneEl.querySelector('#p-logo-status');
    status.textContent = 'Uploading…';
    try {
      const url = await uploadStoreLogo(f);
      paneEl.querySelector('#p-logo-url').value = url;
      const img = paneEl.querySelector('#p-logo-prev');
      img.src = url; img.style.display = '';
      status.textContent = 'Uploaded ✓'; status.style.color = 'var(--green)';
    } catch (err) { status.textContent = err.message || 'Upload failed'; status.style.color = 'var(--red)'; }
  });

  // Profile save
  paneEl.querySelector('#p-save').addEventListener('click', async () => {
    try {
      await saveSettings({
        store_name:    paneEl.querySelector('#p-name').value.trim() || null,
        store_tagline: paneEl.querySelector('#p-tagline').value.trim() || null,
        store_phone:   paneEl.querySelector('#p-phone').value.trim() || null,
        store_email:   paneEl.querySelector('#p-email').value.trim() || null,
        store_address: paneEl.querySelector('#p-addr').value.trim() || null,
        store_logo_url: paneEl.querySelector('#p-logo-url').value || null,
      });
      toast('Profile saved'); await loadAll();
    } catch (e) { toastError(e.message); }
  });

  // Payment save
  paneEl.querySelector('#pm-save').addEventListener('click', async () => {
    const addr = paneEl.querySelector('#pm-crypto-addr').value.trim();
    if (paneEl.querySelector('#pm-crypto-en').checked && addr) {
      // §10.6 ERC-20 quick-validate when network is ERC-20
      const net = paneEl.querySelector('#pm-crypto-net').value;
      if (net === 'ERC-20' && !/^0x[0-9a-fA-F]{40}$/.test(addr)) {
        return toastWarn('Invalid ERC-20 address.');
      }
    }
    try {
      await saveSettings({
        gcash_number:        paneEl.querySelector('#pm-gcash-num').value.trim() || null,
        gcash_name:          paneEl.querySelector('#pm-gcash-name').value.trim() || null,
        bank_name:           paneEl.querySelector('#pm-bank-name').value.trim() || null,
        bank_account:        paneEl.querySelector('#pm-bank-acct').value.trim() || null,
        bank_account_name:   paneEl.querySelector('#pm-bank-holder').value.trim() || null,
        crypto_enabled:      paneEl.querySelector('#pm-crypto-en').checked,
        crypto_usdt_address: addr || null,
        crypto_usdt_network: paneEl.querySelector('#pm-crypto-net').value || null,
      });
      toast('Payment saved'); await loadAll();
    } catch (e) { toastError(e.message); }
  });

  // CoinGecko rate (§10.6)
  paneEl.querySelector('#pm-rate-fetch').addEventListener('click', async () => {
    const out = paneEl.querySelector('#pm-rate-val');
    out.textContent = '…';
    try {
      const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=php');
      const j = await r.json();
      out.textContent = '₱' + (j.tether?.php ?? '—');
    } catch (e) {
      out.textContent = 'fetch failed';
    }
  });

  // Delivery save
  paneEl.querySelector('#d-save').addEventListener('click', async () => {
    try {
      await saveSettings({
        delivery_fee:      parseFloat(paneEl.querySelector('#d-fee').value) || 0,
        free_delivery_min: parseFloat(paneEl.querySelector('#d-min').value) || 0,
        min_order_amount:  parseFloat(paneEl.querySelector('#d-minorder').value) || 0,
      });
      toast('Delivery saved'); await loadAll();
    } catch (e) { toastError(e.message); }
  });

  // Zones
  paneEl.querySelector('#zn-add').addEventListener('click', async () => {
    const name = paneEl.querySelector('#zn-name').value.trim();
    const fee  = parseFloat(paneEl.querySelector('#zn-fee').value);
    if (!name) return toastWarn('Zone name required.');
    if (Number.isNaN(fee) || fee < 0) return toastWarn('Fee must be a non-negative number.');
    const sb = getSB();
    const { error } = await sb.from('delivery_zones')
      .insert([{ name, base_fee: fee, sort_order: state.zones.length, is_active: true }]);
    if (error) return toastError(error.message);
    toast('Zone added');
    await loadAll(); render();
  });
  paneEl.querySelectorAll('[data-zn-del]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const row = btn.closest('[data-zone-id]');
      if (!row) return;
      if (!confirm('Delete this zone?')) return;
      const sb = getSB();
      const { error } = await sb.from('delivery_zones').delete().eq('id', row.dataset.zoneId);
      if (error) return toastError(error.message);
      toast('Zone deleted');
      await loadAll(); render();
    });
  });

  // Tier configuration
  paneEl.querySelector('#tier-save').addEventListener('click', async () => {
    const btn = paneEl.querySelector('#tier-save');
    const rows = [...paneEl.querySelectorAll('#tier-list [data-tier-level]')];
    const tiers = [];
    for (const row of rows) {
      const level = parseInt(row.dataset.tierLevel, 10);
      const name = row.querySelector('.tc-name').value.trim();
      if (!name) return toastWarn(`Tier L${level}: name required.`);
      const spend = parseFloat(row.querySelector('.tc-spend').value);
      if (Number.isNaN(spend) || spend < 0) return toastWarn(`Tier L${level}: min spend must be a non-negative number.`);
      tiers.push({
        tier_level: level,
        name,
        icon:  row.querySelector('.tc-icon').value.trim() || null,
        min_spend: spend,
        color: row.querySelector('.tc-color').value,
      });
    }
    btn.disabled = true;
    const sb = getSB();
    const { error } = await sb.from('dashboard_settings').upsert({
      key: 'TIER_CONFIG',
      value: JSON.stringify(tiers),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'key' });
    btn.disabled = false;
    if (error) return toastError(error.message);
    toast('Tiers saved.');
    await loadAll();
  });

  // Hours
  paneEl.querySelector('#h-save').addEventListener('click', async () => {
    const days = [];
    paneEl.querySelectorAll('.h-day').forEach(box => {
      if (box.checked) days.push(parseInt(box.dataset.day, 10));
    });
    const operating_hours = {
      open:  paneEl.querySelector('#h-open').value || '08:00',
      close: paneEl.querySelector('#h-close').value || '22:00',
      days,
    };
    const overrideVal = paneEl.querySelector('#h-override').value;
    try {
      await saveSettings({
        operating_hours,
        is_open: paneEl.querySelector('#h-isopen').checked,
      });
      // Manual override goes into dashboard_settings (§3.8 known key)
      const sb = getSB();
      if (overrideVal === '') {
        await sb.from('dashboard_settings').delete().eq('key', 'store_open_override');
      } else {
        await sb.from('dashboard_settings')
          .upsert({ key: 'store_open_override', value: overrideVal, updated_at: new Date().toISOString() },
                  { onConflict: 'key' });
      }
      toast('Hours saved'); await loadAll();
    } catch (e) { toastError(e.message); }
  });

  // Notifications
  paneEl.querySelector('#n-save').addEventListener('click', async () => {
    try {
      await saveSettings({
        telegram_bot_token: paneEl.querySelector('#n-token').value.trim() || null,
        telegram_chat_id:   paneEl.querySelector('#n-chat').value.trim() || null,
      });
      toast('Notifications saved'); await loadAll();
    } catch (e) { toastError(e.message); }
  });

  // PIN updates (§8.1, §11.8 dashboard_settings upsert)
  paneEl.querySelector('#pin-owner-save').addEventListener('click', async () => {
    const cur = paneEl.querySelector('#pin-owner-cur').value.trim();
    const nw  = paneEl.querySelector('#pin-owner-new').value.trim();
    if (!/^\d{6}$/.test(nw)) return toastWarn('New owner PIN must be 6 digits.');
    if (!await verifyOwnerPIN(cur)) return toastWarn('Current owner PIN incorrect.');
    const hash = await hashPIN(nw);
    const sb = getSB();
    const { error } = await sb.from('dashboard_settings')
      .upsert({ key: 'OWNER_PIN_HASH', value: hash, updated_at: new Date().toISOString() },
              { onConflict: 'key' });
    if (error) return toastError(error.message);
    localStorage.setItem('mg_owner_hash', hash);
    toast('Owner PIN updated. Will apply on next login.');
    paneEl.querySelector('#pin-owner-cur').value = '';
    paneEl.querySelector('#pin-owner-new').value = '';
  });

  paneEl.querySelector('#pin-sales-save').addEventListener('click', async () => {
    const owner = paneEl.querySelector('#pin-sales-owner').value.trim();
    const nw    = paneEl.querySelector('#pin-sales-new').value.trim();
    if (!/^\d{4}$/.test(nw)) return toastWarn('New sales PIN must be 4 digits.');
    if (!await verifyOwnerPIN(owner)) return toastWarn('Owner PIN required to change sales PIN.');
    const hash = await hashPIN(nw);
    const sb = getSB();
    const { error } = await sb.from('dashboard_settings')
      .upsert({ key: 'SALES_PIN_HASH', value: hash, updated_at: new Date().toISOString() },
              { onConflict: 'key' });
    if (error) return toastError(error.message);
    localStorage.setItem('mg_sales_hash', hash);
    toast('Sales PIN updated.');
    paneEl.querySelector('#pin-sales-owner').value = '';
    paneEl.querySelector('#pin-sales-new').value = '';
  });

  // Danger
  paneEl.querySelector('#dz-export').addEventListener('click', exportBundle);
  paneEl.querySelector('#dz-clear').addEventListener('click', async () => {
    if (!confirm('Clear cached analytics snapshot?')) return;
    const sb = getSB();
    await sb.from('dashboard_settings').delete().in('key', ['analytics_snapshot', 'snapshot_date']);
    toast('Analytics cache cleared.');
  });
}

async function verifyOwnerPIN(pin) {
  if (!/^\d{6}$/.test(pin)) return false;
  const sb = getSB();
  const candidate = await hashPIN(pin);
  const { data } = await sb.from('dashboard_settings')
    .select('value').eq('key', 'OWNER_PIN_HASH').single();
  const stored = data?.value || localStorage.getItem('mg_owner_hash');
  return stored && candidate === stored;
}

/* ---------- Export bundle ---------- */

async function exportBundle() {
  const sb = getSB();
  toast('Building CSV bundle…');
  try {
    const tables = ['orders', 'products', 'categories', 'customer_tiers', 'discount_codes'];
    for (const t of tables) {
      const { data, error } = await sb.from(t).select('*');
      if (error) { toastError(`${t}: ${error.message}`); continue; }
      downloadCSV(data || [], `${t}-${Date.now()}.csv`);
    }
    toast('Export complete (5 files).');
  } catch (e) { toastError(e.message); }
}

function downloadCSV(rows, filename) {
  if (!rows.length) return;
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
}

/* ---------- Mount ---------- */

export async function mount(rootPaneEl) {
  paneEl = rootPaneEl;
  if (!mounted) mounted = true;
  await loadAll();
  render();
}
