// Theme: 'system' follows the operating system; 'light' and 'dark' override it.
// The resolved theme sits on <html data-theme-resolved> for CSS, and a
// 'themechange' event tells the canvases to repaint.

const KEY = 'circuits:theme';
let media = null;
let current = 'system';

export function resolvedTheme() {
  return document.documentElement.dataset.themeResolved === 'dark' ? 'dark' : 'light';
}

function resolve() {
  const dark = current === 'dark' || (current === 'system' && !!media?.matches);
  const root = document.documentElement;
  const next = dark ? 'dark' : 'light';
  root.dataset.theme = current;
  if (root.dataset.themeResolved !== next) {
    root.dataset.themeResolved = next;
    window.dispatchEvent(new CustomEvent('themechange', { detail: next }));
  }
}

export function applyTheme(theme) {
  current = ['light', 'dark'].includes(theme) ? theme : 'system';
  try { localStorage.setItem(KEY, current); } catch { /* storage unavailable */ }
  if (!media && window.matchMedia) {
    media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener?.('change', () => { if (current === 'system') resolve(); });
  }
  resolve();
}

export const currentTheme = () => current;
