// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import * as notifications from '../src/ui/toast.js';

// A paste that runs past the last row or column of the sheet drops what does
// not fit; the user is told how much, rather than losing it silently.
function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() };
}
Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true });

describe('pasting past the sheet edge', () => {
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

  async function mount() {
    const doc = new Doc({ name: 'Edge', path: 'Spreadsheets/Edge.xlsx' });
    const wb = doc.wb;
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, '1'); wb.setInput(id, 1, 0, '2'); wb.setInput(id, 2, 0, '3');
    wb.clearHistory();
    view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
    document.querySelector('#app').append(view.el);
    await vi.advanceTimersByTimeAsync(1);
    const viewport = view.el.querySelector('.grid-viewport');
    viewport.focus();
    const clipboardEvent = (type, data = {}) => {
      const e = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(e, 'clipboardData', { value: { getData: (t) => data[t] ?? '', setData() {}, files: [] } });
      return e;
    };
    const paste = (where, data) => { view.goTo(`Sheet1!${where}`); viewport.dispatchEvent(clipboardEvent('paste', data)); };
    const notify = vi.spyOn(notifications, 'toast');
    const told = () => notify.mock.calls.map(([message]) => message).filter((m) => /did not fit/.test(m));
    return { wb, id, viewport, clipboardEvent, paste, told, notify };
  }

  it('says how many rows or columns of pasted text were dropped', async () => {
    const { wb, id, paste, told, notify } = await mount();
    paste('A1048576', { 'text/plain': 'a\nb\nc' });
    expect(wb.getValue(id, 1048575, 0)).toBe('a');
    expect(told()).toEqual(['2 rows did not fit on the sheet']);
    paste('XFD1', { 'text/plain': 'a\tb\tc' });
    expect(wb.getValue(id, 0, 16383)).toBe('a');
    expect(told()).toEqual(['2 rows did not fit on the sheet', '2 columns did not fit on the sheet']);
    notify.mockClear();
    paste('XFC1048575', { 'text/plain': 'a\tb\tc\nd\te\tf\ng\th\ti' });
    expect(told()).toEqual(['1 row and 1 column did not fit on the sheet']);
    notify.mockClear();
    paste('A1', { 'text/plain': 'x\ny' });
    expect(told()).toEqual([]);
  });

  it('says so for cells copied here too', async () => {
    const { wb, id, viewport, clipboardEvent, paste, told } = await mount();
    view.goTo('Sheet1!A1:A3');
    viewport.dispatchEvent(clipboardEvent('copy'));
    paste('B1048576', {});
    expect(wb.getValue(id, 1048575, 1)).toBe(1);
    expect(told()).toEqual(['2 rows did not fit on the sheet']);
  });
});
