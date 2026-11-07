// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { applyTheme, currentTheme } from '../src/ui/theme.js';

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
    document.head.innerHTML = '<meta name="theme-color" content="">';
  });

  it('defaults to system with no stamp', () => {
    expect(currentTheme()).toBe('system');
  });

  it('stamps explicit modes and remembers them for the pre-paint script', () => {
    applyTheme('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem('spreadsheet:theme')).toBe('dark');
    expect(currentTheme()).toBe('dark');
    expect(document.querySelector('meta[name="theme-color"]').getAttribute('content')).toBe('#28593a');

    applyTheme('light');
    expect(currentTheme()).toBe('light');
    expect(document.querySelector('meta[name="theme-color"]').getAttribute('content')).toBe('#356d49');

    applyTheme('system');
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(localStorage.getItem('spreadsheet:theme')).toBeNull();
  });
});
