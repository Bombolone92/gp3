/**
 * Per-device preferences in localStorage (theme, sidebar state, last view
 * per table). The theme has its own key so index.html can apply it before
 * the first paint. Nothing here is content.
 */
const KEY = 'records:prefs';
const THEME_KEY = 'records:theme';
const DEFAULTS = { sidebarOpen: true, homeLayout: 'grid', homeSort: 'opened', lastViews: {}, lastTables: {}, noticeSeen: false };

let cache = null;

export function prefs() {
  if (cache) return cache;
  try {
    cache = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    cache = { ...DEFAULTS };
  }
  return cache;
}

export function setPref(key, value) {
  prefs()[key] = value;
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    /* private mode or full storage: preferences just do not persist */
  }
}

export function resetPrefs() {
  cache = null;
}

export const THEMES = ['system', 'light', 'dark'];

export function getTheme() {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return THEMES.includes(t) ? t : 'system';
  } catch {
    return 'system';
  }
}

const media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
const listeners = new Set();

export function resolvedTheme(theme = getTheme()) {
  if (theme === 'dark' || theme === 'light') return theme;
  return media?.matches ? 'dark' : 'light';
}

export function applyTheme(theme = getTheme()) {
  const root = document.documentElement;
  root.classList.add('theme-switching');
  root.dataset.theme = theme;
  root.dataset.themeResolved = resolvedTheme(theme);
  setTimeout(() => root.classList.remove('theme-switching'), 60);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = root.dataset.themeResolved === 'dark' ? '#17181b' : '#ffffff';
  for (const fn of listeners) fn(root.dataset.themeResolved);
}

export function setTheme(theme) {
  if (!THEMES.includes(theme)) theme = 'system';
  try {
    if (theme === 'system') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* ignore */
  }
  applyTheme(theme);
}

export function onThemeChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

media?.addEventListener?.('change', () => {
  if (getTheme() === 'system') applyTheme('system');
});
