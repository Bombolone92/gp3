const LS_KEY = 'spreadsheet:theme';
const LIGHT_THEME_COLOR = '#356d49';
const DARK_THEME_COLOR = '#28593a';

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
  const prefersDark = typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
  return t === 'dark' || (t === 'system' && prefersDark);
}

function updateThemeColorMeta() {
  for (const m of document.querySelectorAll('meta[name="theme-color"]')) {
    m.setAttribute('content', isDark() ? DARK_THEME_COLOR : LIGHT_THEME_COLOR);
  }
}

if (typeof matchMedia === 'function') {
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', updateThemeColorMeta);
}
