/** Light, dark, or follow the system (the default). */
const KEY = 'legal.theme';
const listeners = new Set();

export function getThemeMode() {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

export function setThemeMode(mode) {
  const root = document.documentElement;
  if (mode === 'light' || mode === 'dark') root.dataset.theme = mode;
  else delete root.dataset.theme;
  try {
    if (mode === 'light' || mode === 'dark') localStorage.setItem(KEY, mode);
    else localStorage.removeItem(KEY);
  } catch {}
  syncThemeColor();
  for (const fn of listeners) fn(mode);
}

export function onThemeChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function isDark() {
  const mode = getThemeMode();
  if (mode !== 'system') return mode === 'dark';
  return matchMedia('(prefers-color-scheme: dark)').matches;
}

function syncThemeColor() {
  const color = getComputedStyle(document.documentElement).getPropertyValue('--topbar').trim();
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
    if (getThemeMode() === 'system') meta.setAttribute('content', meta.dataset.default || meta.getAttribute('content'));
    else if (color) meta.setAttribute('content', color);
  }
}

export function initTheme() {
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) meta.dataset.default = meta.getAttribute('content');
  setThemeMode(getThemeMode());
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (getThemeMode() === 'system') for (const fn of listeners) fn('system');
  });
}
