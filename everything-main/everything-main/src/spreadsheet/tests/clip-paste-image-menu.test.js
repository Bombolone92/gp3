// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import * as notifications from '../src/ui/toast.js';

// Paste from the menu or toolbar reads the system clipboard itself. A
// picture alone there (a screenshot, an image copied from a page) lands as a
// floating image, as it does from the keyboard shortcut, rather than the
// empty text being taken for the cells last copied here.
function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() };
}
Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true });

describe('menu paste with a picture on the clipboard', () => {
  let view;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
    vi.stubGlobal('requestAnimationFrame', (fn) => setTimeout(fn, 0));
    vi.stubGlobal('cancelAnimationFrame', clearTimeout);
    Element.prototype.scrollIntoView = () => {};
    Element.prototype.scrollTo = () => {};
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 400 });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ measureText: (t) => ({ width: t.length * 7 }), font: '' });
    document.body.innerHTML = '<div id="app"></div>';
  });
  afterEach(() => { view?.destroy(); view = null; vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

  it('inserts the picture at the active cell instead of pasting stale cells', async () => {
    const readers = [];
    vi.stubGlobal('FileReader', class { readAsDataURL() { readers.push(this); } });
    vi.stubGlobal('Image', class { naturalWidth = 100; naturalHeight = 60; set src(value) { this.onload?.(); } });
    const picture = new Blob(['image'], { type: 'image/png' });
    vi.stubGlobal('navigator', { onLine: true, clipboard: { read: async () => [{ types: ['image/png'], getType: async () => picture }] } });
    const doc = new Doc({ name: 'Picture', path: 'Spreadsheets/Picture.xlsx' });
    const wb = doc.wb;
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, 'stale');
    wb.clearHistory();
    view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
    document.querySelector('#app').append(view.el);
    await vi.advanceTimersByTimeAsync(1);
    const viewport = view.el.querySelector('.grid-viewport');
    viewport.focus();
    // Something was copied here earlier; the picture copied since is what the clipboard holds now.
    const copy = new Event('copy', { bubbles: true, cancelable: true });
    Object.defineProperty(copy, 'clipboardData', { value: { getData: () => '', setData() {}, files: [] } });
    viewport.dispatchEvent(copy);
    view.goTo('Sheet1!C3');
    const notify = vi.spyOn(notifications, 'toast');
    view.el.querySelector('[data-menu="edit"]').click();
    [...document.querySelectorAll('.menu-item')].find((b) => b.querySelector('.menu-label')?.textContent === 'Paste').click();
    await vi.advanceTimersByTimeAsync(5);
    expect(readers).toHaveLength(1);
    readers[0].result = 'data:image/png;base64,bmV3';
    readers[0].onload();
    await vi.advanceTimersByTimeAsync(5);
    expect(wb.getCell(id, 2, 2)).toBeFalsy();
    expect(wb.sheet(id).charts).toHaveLength(1);
    expect(wb.sheet(id).charts[0]).toMatchObject({ type: 'image', src: 'data:image/png;base64,bmV3', anchor: { r: 2, c: 2 } });
    expect(notify.mock.calls.some(([message]) => /^Image inserted/.test(message))).toBe(true);
  });
});
