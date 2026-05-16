// Chart.js v4.4.0 lazy loader — only used by Surface C (blueprint §13.4).
// Returns the global window.Chart constructor once it's available.

let _loadPromise = null;

export function ensureChart() {
  if (window.Chart) return Promise.resolve(window.Chart);
  if (_loadPromise) return _loadPromise;
  _loadPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.0';
    s.async = true;
    s.onload = () => resolve(window.Chart);
    s.onerror = () => {
      _loadPromise = null;
      reject(new Error('Chart.js failed to load'));
    };
    document.head.appendChild(s);
  });
  return _loadPromise;
}
