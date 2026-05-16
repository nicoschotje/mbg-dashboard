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

// Blueprint §10.2 — auto tier from lifetime spent
export function calcTier(lifetimeSpent) {
  const v = Number(lifetimeSpent) || 0;
  if (v >= 10000) return 5; // Diamond
  if (v >= 5000)  return 4; // Gold
  if (v >= 2000)  return 3; // Silver
  if (v >= 500)   return 2; // Bronze
  return 1;                  // Seedling
}

export const TIER_NAMES = { 1: 'Seedling', 2: 'Bronze', 3: 'Silver', 4: 'Gold', 5: 'Diamond' };

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
