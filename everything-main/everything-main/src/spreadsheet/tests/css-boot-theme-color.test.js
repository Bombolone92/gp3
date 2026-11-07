// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { beforeEach, describe, expect, it } from 'vitest';
import { applyTheme } from '../src/ui/theme.js';

/** The page parsed with its pre-paint script run, as a browser would before any module loads. */
function boot(file, theme) {
  // Not `new URL(…, import.meta.url)`: Vite rewrites that pattern as an asset reference.
  const html = readFileSync(path.resolve(process.cwd(), file), 'utf8');
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'http://localhost/',
    beforeParse(window) { if (theme) window.localStorage.setItem('spreadsheet:theme', theme); },
  });
  return dom.window.document;
}

const themeColors = (doc) => [...doc.querySelectorAll('meta[name="theme-color"]')].map((m) => m.getAttribute('content'));

/** The colour theme.js itself writes for a mode, so the two stay in step. */
function later(mode) {
  document.head.innerHTML = '<meta name="theme-color" content="">';
  applyTheme(mode);
  return document.querySelector('meta[name="theme-color"]').getAttribute('content');
}

beforeEach(() => {
  const m = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) } });
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
});

// The theme-color metas were keyed by the OS scheme, so a phone set to dark that saved the light
// theme (or the reverse) showed the other theme's colour in the browser chrome until session.init()
// resolved and theme.js corrected it. The pre-paint script now stamps them along with the theme.
describe.each(['index.html', 'mock.html'])('%s before the app loads', (file) => {
  it('colours the browser chrome for the saved dark theme', () => {
    const doc = boot(file, 'dark');
    expect(doc.documentElement.dataset.theme).toBe('dark');
    expect(themeColors(doc).length).toBeGreaterThan(0);
    for (const c of themeColors(doc)) expect(c).toBe(later('dark'));
  });

  it('colours the browser chrome for the saved light theme', () => {
    const doc = boot(file, 'light');
    expect(doc.documentElement.dataset.theme).toBe('light');
    for (const c of themeColors(doc)) expect(c).toBe(later('light'));
  });

  it('leaves the markup alone when no theme is saved', () => {
    const doc = boot(file, null);
    expect(doc.documentElement.dataset.theme).toBeUndefined();
    const light = later('light');
    const dark = later('dark');
    for (const m of doc.querySelectorAll('meta[name="theme-color"]')) {
      expect(m.getAttribute('content')).toBe(m.getAttribute('media')?.includes('dark') ? dark : light);
    }
  });
});
