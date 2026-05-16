// Lightweight toast notifications

const container = () => document.getElementById('toast-container');

export function toast(msg, kind = '', ttl = 3500) {
  const c = container();
  if (!c) return;
  const node = document.createElement('div');
  node.className = 'toast' + (kind ? ' ' + kind : '');
  node.textContent = msg;
  c.appendChild(node);
  setTimeout(() => {
    node.style.opacity = '0';
    node.style.transition = 'opacity 0.2s';
    setTimeout(() => node.remove(), 220);
  }, ttl);
}

export const toastError = (m) => toast(m, 'error', 4500);
export const toastWarn  = (m) => toast(m, 'warn', 4000);
