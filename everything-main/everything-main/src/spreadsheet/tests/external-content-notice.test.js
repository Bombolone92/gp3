// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { Doc } from '../src/lib/doc.js';
import { editorView } from '../src/views/editor.js';

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() };
}
Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true });

describe('editor notice', () => {
  let view;
  const canvas = { font: '', measureText: (text) => ({ width: text.length * 7 }) };
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
    vi.stubGlobal('requestAnimationFrame', (fn) => setTimeout(fn, 0));
    vi.stubGlobal('cancelAnimationFrame', clearTimeout);
    Element.prototype.scrollIntoView = () => {};
    Element.prototype.scrollTo = () => {};
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 400 });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(canvas);
    document.body.innerHTML = '<div id="app"></div>';
  });
  afterEach(() => {
    view?.destroy();
    view = null;
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it('shows the notice for a distrusted file and loads the content on Allow', async () => {
    const wb = new Workbook();
    wb.setInput(wb.activeSheetId, 0, 0, '=IMPORTDATA("https://example.com/a.csv")');
    const doc = new Doc({ wb, name: 'Shared', path: 'Desktop/Shared.xlsx', trusted: false });
    view = editorView({ doc, goHome() {}, openPath() {}, newDoc() {}, importFile() {} });
    document.querySelector('#app').append(view.el);
    await vi.advanceTimersByTimeAsync(5);
    const notice = view.el.querySelector('.notice-bar');
    expect(notice.hidden).toBe(false);
    expect(wb.getValue(wb.activeSheetId, 0, 0)).toEqual({ error: '#BLOCKED!' });
    [...notice.querySelectorAll('button')].find((b) => b.textContent === 'Allow').click();
    expect(notice.hidden).toBe(true);
    expect(wb.externalAllowed).toBe(true);
    expect(wb.getValue(wb.activeSheetId, 0, 0)).not.toEqual({ error: '#BLOCKED!' });
  });

  it('keeps the notice hidden for a trusted document', async () => {
    const wb = new Workbook();
    wb.setInput(wb.activeSheetId, 0, 0, '=IMPORTDATA("https://example.com/a.csv")');
    const doc = new Doc({ wb, name: 'Mine', path: 'Spreadsheets/Mine.xlsx' });
    view = editorView({ doc, goHome() {}, openPath() {}, newDoc() {}, importFile() {} });
    document.querySelector('#app').append(view.el);
    await vi.advanceTimersByTimeAsync(5);
    expect(view.el.querySelector('.notice-bar').hidden).toBe(true);
  });
});
