// Shared helpers — formatting, hashing, tiering

export function formatCurrency(n) {
  const v = Number(n) || 0;
  return '₱' + v.toLocaleString('en-PH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export function formatDate(dt) {
  if (!dt) return '—';
  const d = new Date(dt);
  return d.toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });
}

export function formatRelative(dt) {
  if (!dt) return '—';
  const diff = (Date.now() - new Date(dt).getTime()) / 1000;
  if (diff < 60)    return Math.floor(diff) + 's ago';
  if (diff < 3600)  return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  return Math.floor(diff / 86400) + 'd ago';
}

export function shortId(uuid) {
  return uuid ? String(uuid).slice(-6).toUpperCase() : '——————';
}

export function escapeHTML(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// Tier ladder — the single source of truth is dashboard_settings.TIER_CONFIG
// (editable in Settings → Tier Configuration). DEFAULT_TIER_CONFIG mirrors the
// owner's configured ladder and is used only as a fallback when TIER_CONFIG
// can't be read. min_spend is the lifetime-spend (₱) floor for each tier level.
export const DEFAULT_TIER_CONFIG = [
  { tier_level: 1, name: 'Seedling', min_spend: 5000  },
  { tier_level: 2, name: 'Bronze',   min_spend: 10000 },
  { tier_level: 3, name: 'Silver',   min_spend: 15000 },
  { tier_level: 4, name: 'Gold',     min_spend: 25000 },
  { tier_level: 5, name: 'Diamond',  min_spend: 50000 },
];

export const TIER_NAMES = { 1: 'Seedling', 2: 'Bronze', 3: 'Silver', 4: 'Gold', 5: 'Diamond' };

// Resolve a lifetime-spend amount to a tier LEVEL using TIER_CONFIG (the caller
// loads it from dashboard_settings). The highest threshold the spend meets wins;
// below the lowest threshold it floors to the lowest configured tier.
export function tierFromConfig(lifetimeSpent, config) {
  const v = Number(lifetimeSpent) || 0;
  const ladder = (Array.isArray(config) && config.length ? config : DEFAULT_TIER_CONFIG)
    .slice()
    .sort((a, b) => (Number(a.min_spend) || 0) - (Number(b.min_spend) || 0));
  let level = ladder[0]?.tier_level ?? 1;
  for (const t of ladder) {
    if (v >= (Number(t.min_spend) || 0)) level = t.tier_level;
  }
  return level;
}

// Blueprint §10.1 — order status pipeline
export const STATUS_FLOW = ['pending', 'confirmed', 'preparing', 'out_for_delivery', 'completed'];
export const STATUS_LABELS = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  preparing: 'Preparing',
  out_for_delivery: 'Out for Delivery',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export function nextStatus(current) {
  const i = STATUS_FLOW.indexOf(current);
  if (i === -1 || i === STATUS_FLOW.length - 1) return null;
  return STATUS_FLOW[i + 1];
}

// Blueprint §8.1 — owner/sales PIN hashing (client-side SHA-256)
export async function hashPIN(pin) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pin));
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export function debounce(fn, ms = 200) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

export function todayBounds() {
  const d = new Date();
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  const date = `${y}-${m}-${day}`;
  return { startISO: `${date}T00:00:00`, endISO: `${date}T23:59:59`, date };
}
