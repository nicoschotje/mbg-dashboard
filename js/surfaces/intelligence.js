// Surface C — Intelligence (blueprint §13.4)
//
// Lazy-loaded. Owns: Sales Analytics Engine, MBG Client Intelligence,
// Access PINs, Reports. Chart.js only loaded in this surface.

import { ensureChart } from '../core/chart-loader.js';

let initialized = false;
const moduleCache = {};
const ctx = {};

const TITLES = {
  analytics: 'Intelligence · Analytics',
  intelligence: 'Intelligence · MBG Clients',
  'access-pins': 'Intelligence · Access PINs',
  reports: 'Intelligence · Reports',
};

async function showModule(name) {
  document.querySelectorAll('.nav-item[data-imodule]').forEach(n =>
    n.classList.toggle('active', n.dataset.imodule === name));

  const surface = document.getElementById('surface-intelligence');
  surface.querySelectorAll('.module-pane').forEach(p => p.classList.remove('active'));
  const pane = document.getElementById(`pane-${name}`);
  if (pane) pane.classList.add('active');

  const titleEl = document.getElementById('header-title');
  if (titleEl) titleEl.textContent = TITLES[name] || name;

  if (!moduleCache[name]) {
    moduleCache[name] = await import(`../modules/${name}.js`);
  }
  await moduleCache[name].mount(pane, ctx);
}

export async function init(opts) {
  const titleEl = document.getElementById('header-title');
  if (titleEl) titleEl.textContent = TITLES.analytics;

  if (!initialized) {
    initialized = true;
    ctx.modalBackdrop = document.getElementById('modal-backdrop');
    ctx.modalBody     = document.getElementById('modal-body');
    ctx.role          = opts?.role || 'owner';
    ctx.ensureChart   = ensureChart;

    document.querySelectorAll('.nav-item[data-imodule]').forEach(node => {
      node.addEventListener('click', () => showModule(node.dataset.imodule));
    });

    // Pre-load Chart.js in background; analytics will await ensureChart() too
    ensureChart().catch(() => { /* surfaced when a chart actually tries to render */ });
  }

  await showModule('analytics');
}
