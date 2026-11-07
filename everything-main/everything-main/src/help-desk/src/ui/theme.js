/**
 * Light, dark or system appearance. System (the default) follows the
 * operating system live; an explicit choice is remembered on this device.
 */
const KEY = 'help-desk:theme';
const COLORS = { light: '#ffffff', dark: '#15171a' };

export function savedTheme() {
  try {
    const t = localStorage.getItem(KEY);
    return t === 'light' || t === 'dark' ? t : 'system';
  } catch {
    return 'system';
  }
}

function effective(mode) {
  if (mode === 'light' || mode === 'dark') return mode;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function paintMeta(mode) {
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
    meta.setAttribute('content', COLORS[effective(mode)]);
  }
}

export function applyTheme(mode) {
  const root = document.documentElement;
  if (mode === 'light' || mode === 'dark') {
    root.dataset.theme = mode;
    try { localStorage.setItem(KEY, mode); } catch { /* private mode */ }
  } else {
    delete root.dataset.theme;
    try { localStorage.removeItem(KEY); } catch { /* private mode */ }
  }
  paintMeta(mode);
  window.dispatchEvent(new CustomEvent('themechange', { detail: { mode, effective: effective(mode) } }));
}

export function initTheme() {
  applyTheme(savedTheme());
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (savedTheme() === 'system') applyTheme('system');
  });
}

export function isDark() {
  return effective(savedTheme()) === 'dark';
}
