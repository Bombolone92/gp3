const LS_KEY = 'bookkeeping:theme';

export function applyTheme(mode) {
  const root = document.documentElement;
  if (mode === 'light' || mode === 'dark') root.dataset.theme = mode;
  else delete root.dataset.theme;
  try {
    if (mode === 'light' || mode === 'dark') localStorage.setItem(LS_KEY, mode);
    else localStorage.removeItem(LS_KEY);
  } catch {}
  updateThemeColor();
  document.dispatchEvent(new Event('themechange'));
}

export function currentTheme() {
  const t = document.documentElement.dataset.theme;
  return t === 'light' || t === 'dark' ? t : 'system';
}

export function isDark() {
  const t = currentTheme();
  return t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
}

function updateThemeColor() {
  for (const m of document.querySelectorAll('meta[name="theme-color"]')) m.setAttribute('content', isDark() ? '#0e1113' : '#f3f4f7');
}

matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  updateThemeColor();
  document.dispatchEvent(new Event('themechange'));
});
