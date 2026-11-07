const LS_KEY = 'invoicing:theme';

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
  updateThemeColorMeta();
  // Two controls draw the theme — the sidebar's toggle and Settings' three-way
  // group — and each repaints on the store's change event, which the save
  // that follows a press emits. Offline that save is refused before it emits,
  // so the other control kept showing the theme the app had just left. The
  // stamp on the document is the truth both read; say when it moves.
  document.dispatchEvent(new Event('themechange'));
}

export function currentTheme() {
  const t = document.documentElement.dataset.theme;
  return t === 'light' || t === 'dark' ? t : 'system';
}

function updateThemeColorMeta() {
  const dark = currentTheme() === 'dark' ||
    (currentTheme() === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  for (const m of document.querySelectorAll('meta[name="theme-color"]')) {
    m.setAttribute('content', dark ? '#0d0d10' : '#f4f4f6');
  }
}

matchMedia('(prefers-color-scheme: dark)').addEventListener('change', updateThemeColorMeta);
