const LS_KEY = 'pos:theme';

export function applyTheme(mode) {
  const rootEl = document.documentElement;
  if (mode === 'light' || mode === 'dark') {
    rootEl.dataset.theme = mode;
  } else {
    delete rootEl.dataset.theme;
  }
  try {
    if (mode === 'light' || mode === 'dark') localStorage.setItem(LS_KEY, mode);
    else localStorage.removeItem(LS_KEY);
  } catch {}
}

export function currentTheme() {
  const t = document.documentElement.dataset.theme;
  return t === 'light' || t === 'dark' ? t : 'system';
}
