/**
 * Light, dark, or follow the system (the default). The choice is applied as
 * [data-theme] on <html> (absent in system mode, so the CSS media query
 * decides), remembered in localStorage for a flash-free first paint (see the
 * inline script in index.html), and synced to the account settings by the app.
 */
export const THEME_KEY = 'sv:theme';
export const THEMES = ['system', 'light', 'dark'];

const listeners = new Set();

export function currentTheme() {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return THEMES.includes(t) ? t : 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(theme) {
  const t = THEMES.includes(theme) ? theme : 'system';
  const root = document.documentElement;
  if (t === 'system') delete root.dataset.theme;
  else root.dataset.theme = t;
  try {
    if (t === 'system') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, t);
  } catch {
    /* private mode */
  }
  // Browser and installed-app chrome. The page has one theme-color per
  // color scheme: a chosen theme sets both to its color, system mode gives
  // each its own scheme's color back.
  const BAR = { light: '#f6f5f3', dark: '#111110' };
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
    const scheme = /dark/.test(meta.media || '') ? 'dark' : meta.media ? 'light' : isDark() ? 'dark' : 'light';
    meta.content = BAR[t === 'system' ? scheme : t];
  }
  for (const fn of listeners) fn(t);
  return t;
}

export function isDark() {
  const t = document.documentElement.dataset.theme;
  if (t === 'dark') return true;
  if (t === 'light') return false;
  return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
}

export function onThemeChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
