// Surface B — Content Manager (blueprint §13.3)
//
// Lazy-loaded when the user switches to Content. No real-time subscriptions
// needed (content changes are infrequent — handled by RT in operations.js
// for products/categories/banners cache invalidation).

import { AppState } from '../core/state.js';

let initialized = false;
const moduleCache = {};
const ctx = {};

async function showModule(name) {
  document.querySelectorAll('.nav-item[data-cmodule]').forEach(n =>
    n.classList.toggle('active', n.dataset.cmodule === name));

  // Hide every module pane in #surface-content, show only the target.
  const surface = document.getElementById('surface-content');
  surface.querySelectorAll('.module-pane').forEach(p => p.classList.remove('active'));
  const pane = document.getElementById(`pane-${name}`);
  if (pane) pane.classList.add('active');

  const titleEl = document.getElementById('header-title');
  if (titleEl) titleEl.textContent = 'Content';

  if (!moduleCache[name]) {
    moduleCache[name] = await import(`../modules/${name}.js`);
  }
  await moduleCache[name].mount(pane, ctx);
}

export async function init(opts) {
  // Always update title when switching to Content
  const titleEl = document.getElementById('header-title');
  if (titleEl) titleEl.textContent = 'Content';

  if (!initialized) {
    initialized = true;
    ctx.modalBackdrop = document.getElementById('modal-backdrop');
    ctx.modalBody     = document.getElementById('modal-body');
    ctx.role          = opts?.role || 'owner';

    // Only owners reach Surface B (router enforces). Wire module nav.
    document.querySelectorAll('.nav-item[data-cmodule]').forEach(node => {
      node.addEventListener('click', () => showModule(node.dataset.cmodule));
    });
  }

  // Default landing module
  await showModule('products');
  AppState.emit('content:opened');
}
