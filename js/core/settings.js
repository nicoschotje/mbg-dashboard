// store_settings loader (blueprint §3.4, §11.6)
//
// Single-row table — always read with .limit(1).single(). The result is
// stashed in AppState.settings so any surface can read store_name, phone,
// payment config, etc. without a re-fetch.

import { getSB } from './supabase.js';
import { AppState } from './state.js';

// Sane defaults — match the SQL DEFAULT in §3.4 so the dashboard never
// renders a blank brand if store_settings is missing on first run.
export const DEFAULT_SETTINGS = {
  store_name: "Mr. Beanie's Greenies",
  store_tagline: '',
  store_phone: '',
  store_email: '',
  store_address: '',
};

export async function loadStoreSettings() {
  const sb = getSB();
  const { data, error } = await sb
    .from('store_settings')
    .select('*')
    .limit(1)
    .single();
  // PGRST116 = no rows; treat as first-run, fall back to defaults
  if (error && error.code !== 'PGRST116') {
    console.warn('store_settings load failed:', error.message);
  }
  AppState.settings = { ...DEFAULT_SETTINGS, ...(data || {}) };
  applyBranding();
  AppState.emit('settings:loaded', AppState.settings);
  return AppState.settings;
}

// Paint the store name into every shell element that displays it.
// Safe to call multiple times — idempotent.
export function applyBranding() {
  const name = AppState.settings?.store_name || DEFAULT_SETTINGS.store_name;
  document.title = `${name} — Dashboard`;
  setText('brand-name', shortBrand(name));
  setText('login-store-name', name);
}

// Sidebar brand cell is narrow — drop trailing possessive's content if too long.
function shortBrand(name) {
  if (!name) return '';
  // Heuristic: keep first apostrophe phrase, otherwise truncate at 16 chars.
  const apos = name.match(/^[^']+'s?/);
  if (apos && apos[0].length <= 18) return apos[0];
  return name.length > 18 ? name.slice(0, 16) + '…' : name;
}

function setText(id, value) {
  const node = document.getElementById(id);
  if (node) node.textContent = value;
}
