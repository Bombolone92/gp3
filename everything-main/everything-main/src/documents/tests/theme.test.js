// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { applyTheme, currentTheme, isDark, darkPage, setDarkPage, onThemeChange } from '../src/ui/theme.js';

// Node ships a placeholder localStorage that jsdom does not replace; use a
// small in-memory one so the test exercises the code, not the runtime.
function memoryStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    clear: () => m.clear(),
  };
}

describe('theme', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true });
    globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
    localStorage.clear();
    delete document.documentElement.dataset.theme;
    delete document.documentElement.dataset.page;
    document.head.innerHTML = '<meta name="theme-color" content="">';
  });

  it('defaults to system with no stamp', () => {
    expect(currentTheme()).toBe('system');
    expect(isDark()).toBe(false);
  });

  it('stamps explicit modes and remembers them for the pre-paint script', () => {
    applyTheme('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem('documents:theme')).toBe('dark');
    expect(currentTheme()).toBe('dark');
    expect(isDark()).toBe(true);
    expect(document.querySelector('meta[name="theme-color"]').getAttribute('content')).toBe('#375f91');

    applyTheme('light');
    expect(currentTheme()).toBe('light');
    expect(document.querySelector('meta[name="theme-color"]').getAttribute('content')).toBe('#375f91');

    applyTheme('system');
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(localStorage.getItem('documents:theme')).toBeNull();
  });

  it('follows the OS in system mode', () => {
    globalThis.matchMedia = () => ({ matches: true, addEventListener() {} });
    applyTheme('system');
    expect(isDark()).toBe(true);
    applyTheme('light');
    expect(isDark()).toBe(false);
  });

  it('keeps the dark page as an opt-in preference', () => {
    expect(darkPage()).toBe(false);
    setDarkPage(true);
    expect(document.documentElement.dataset.page).toBe('dark');
    expect(localStorage.getItem('documents:dark-page')).toBe('1');
    setDarkPage(false);
    expect(darkPage()).toBe(false);
    expect(localStorage.getItem('documents:dark-page')).toBeNull();
  });

  it('notifies listeners with the effective darkness', () => {
    const seen = [];
    const off = onThemeChange((dark) => seen.push(dark));
    applyTheme('dark');
    applyTheme('light');
    off();
    applyTheme('dark');
    expect(seen).toEqual([true, false]);
  });
});
