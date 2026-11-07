const LS_KEY = 'expenses:theme';
const LIGHT = '#f8f8f6';
const DARK = '#0e0e0d';

export function applyTheme(mode) {
  const rootEl = document.documentElement;
  if (mode === 'light' || mode === 'dark') rootEl.dataset.theme = mode;
  else delete rootEl.dataset.theme;
  try {
    if (mode === 'light' || mode === 'dark') localStorage.setItem(LS_KEY, mode);
    else localStorage.removeItem(LS_KEY);
  } catch { /* storage unavailable */ }
  updateThemeColorMeta();
}

export function currentTheme() {
  const t = document.documentElement.dataset.theme;
  return t === 'light' || t === 'dark' ? t : 'system';
}

export function isDark() {
  const t = currentTheme();
  return t === 'dark' || (t === 'system' && !!globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches);
}

function updateThemeColorMeta() {
  const color = isDark() ? DARK : LIGHT;
  for (const m of document.querySelectorAll('meta[name="theme-color"]')) m.setAttribute('content', color);
}

globalThis.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', updateThemeColorMeta);
