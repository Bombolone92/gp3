// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import * as notifications from '../src/ui/toast.js';

// "Copy image" in a browser puts an <img> HTML fragment on the clipboard beside the bitmap. The
// paste took the picture only when the clipboard held nothing but the picture, so such a paste
// did nothing at all, from the shortcut and from the menu alike. A picture with HTML that holds
// no table is a picture; cells from Excel, which come with a picture too, still paste as cells.
function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() };
}
Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true });

const IMG_HTML = '<meta charset="utf-8"><img src="https://example.com/a.png" alt="">';

describe('pasting a picture that comes with an HTML fragment', () => {
  let view;
  let readers;
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
    readers = [];
    vi.stubGlobal('FileReader', class { readAsDataURL() { readers.push(this); } });
    vi.stubGlobal('Image', class { naturalWidth = 100; naturalHeight = 60; set src(value) { this.onload?.(); } });
    document.body.innerHTML = '<div id="app"></div>';
  });
  afterEach(() => { view?.destroy(); view = null; vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

  async function mount() {
    const doc = new Doc({ name: 'Picture', path: 'Spreadsheets/Picture.xlsx' });
    const wb = doc.wb;
    const id = wb.activeSheetId;
    view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
    document.querySelector('#app').append(view.el);
    await vi.advanceTimersByTimeAsync(1);
    const viewport = view.el.querySelector('.grid-viewport');
    viewport.focus();
    const paste = (where, data, files = []) => {
      view.goTo(`Sheet1!${where}`);
      const e = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(e, 'clipboardData', { value: { getData: (t) => data[t] ?? '', setData() {}, files } });
      viewport.dispatchEvent(e);
    };
    return { wb, id, paste };
  }

  /** Let the stubbed FileReader deliver the picture. */
  async function deliver() {
    await vi.advanceTimersByTimeAsync(5);
    expect(readers).toHaveLength(1);
    readers[0].result = 'data:image/png;base64,bmV3';
    readers[0].onload();
    await vi.advanceTimersByTimeAsync(5);
  }

  it('inserts the picture from the shortcut when the HTML beside it holds no table', async () => {
    const { wb, id, paste } = await mount();
    const notify = vi.spyOn(notifications, 'toast');
    paste('C3', { 'text/plain': '', 'text/html': IMG_HTML }, [new File(['image'], 'a.png', { type: 'image/png' })]);
    await deliver();
    expect(wb.getCell(id, 2, 2)).toBeFalsy();
    expect(wb.sheet(id).charts).toHaveLength(1);
    expect(wb.sheet(id).charts[0]).toMatchObject({ type: 'image', src: 'data:image/png;base64,bmV3', anchor: { r: 2, c: 2 } });
    expect(notify.mock.calls.some(([message]) => /^Image inserted/.test(message))).toBe(true);
  });

  it('still pastes cells, not the picture, when a table and its text come with one, as from Excel', async () => {
    const { wb, id, paste } = await mount();
    paste('A1', { 'text/plain': '1\t2', 'text/html': '<table><tr><td>1</td><td>2</td></tr></table>' }, [new File(['image'], 'a.png', { type: 'image/png' })]);
    await vi.advanceTimersByTimeAsync(5);
    expect(readers).toHaveLength(0);
    expect(wb.sheet(id).charts).toHaveLength(0);
    expect(wb.rangeValues(id, { r1: 0, c1: 0, r2: 0, c2: 1 })).toEqual([[1, 2]]);
  });

  it('inserts the picture from the Edit menu too', async () => {
    const picture = new Blob(['image'], { type: 'image/png' });
    vi.stubGlobal('navigator', { onLine: true, clipboard: { read: async () => [{ types: ['text/html', 'image/png'], getType: async (type) => (type === 'text/html' ? { text: async () => IMG_HTML } : picture) }] } });
    const { wb, id } = await mount();
    view.goTo('Sheet1!B2');
    view.el.querySelector('[data-menu="edit"]').click();
    [...document.querySelectorAll('.menu-item')].find((b) => b.querySelector('.menu-label')?.textContent === 'Paste').click();
    await deliver();
    expect(wb.getCell(id, 1, 1)).toBeFalsy();
    expect(wb.sheet(id).charts).toHaveLength(1);
    expect(wb.sheet(id).charts[0]).toMatchObject({ type: 'image', anchor: { r: 1, c: 1 } });
  });
});
