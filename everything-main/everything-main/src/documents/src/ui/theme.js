/**
 * Theme: 'system' (default, no stamp), 'light', or 'dark'. An explicit choice
 * is stamped on <html data-theme> and remembered in localStorage; the CSS in
 * tokens.css does the rest. Listeners learn about effective changes (including
 * OS switches while in system mode) through onThemeChange.
 */

const LS_KEY = 'documents:theme';
const PAGE_KEY = 'documents:dark-page';
// Keep browser chrome aligned with the manifest in every appearance mode.
const BRAND_COLOR = '#375f91';
const listeners = new Set();

export function applyTheme(mode) {
  const rootEl = document.documentElement;
  if (mode === 'light' || mode === 'dark') rootEl.dataset.theme = mode;
  else delete rootEl.dataset.theme;
  try {
    if (mode === 'light' || mode === 'dark') localStorage.setItem(LS_KEY, mode);
    else localStorage.removeItem(LS_KEY);
  } catch { /* storage unavailable */ }
  updateThemeColorMeta();
  notify();
}

export function currentTheme() {
  const t = document.documentElement.dataset.theme;
  return t === 'light' || t === 'dark' ? t : 'system';
}

export function isDark() {
  const t = currentTheme();
  const prefersDark = typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
  return t === 'dark' || (t === 'system' && prefersDark);
}

/** Whether the document page itself goes dark in dark mode (default: no). */
export function darkPage() {
  return document.documentElement.dataset.page === 'dark';
}

export function setDarkPage(on) {
  const rootEl = document.documentElement;
  if (on) rootEl.dataset.page = 'dark';
  else delete rootEl.dataset.page;
  try {
    if (on) localStorage.setItem(PAGE_KEY, '1');
    else localStorage.removeItem(PAGE_KEY);
  } catch { /* storage unavailable */ }
  notify();
}

/** Subscribe to effective theme changes. Returns an unsubscribe function. */
export function onThemeChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  const dark = isDark();
  for (const fn of listeners) fn(dark);
}

function updateThemeColorMeta() {
  for (const m of document.querySelectorAll('meta[name="theme-color"]')) {
    m.setAttribute('content', BRAND_COLOR);
  }
}

if (typeof matchMedia === 'function') {
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { updateThemeColorMeta(); notify(); });
}
