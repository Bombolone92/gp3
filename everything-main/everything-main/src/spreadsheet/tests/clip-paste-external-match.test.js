// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';

// The internal clipboard is recognised by its text. Text copied from another
// app can match it by chance ("10" when the copied formula showed 10): the
// HTML that app puts alongside lacks the cells this app embeds, and tells
// the two apart.
function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() };
}
Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true });

describe('foreign text that matches the last copy', () => {
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
    const doc = new Doc({ name: 'Match', path: 'Spreadsheets/Match.xlsx' });
    const wb = doc.wb;
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 1, '5');
    wb.setInput(id, 0, 0, '=B1*2');
    wb.clearHistory();
    view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
    document.querySelector('#app').append(view.el);
    await vi.advanceTimersByTimeAsync(1);
    const viewport = view.el.querySelector('.grid-viewport');
    viewport.focus();
    let copied = {};
    const clipboardEvent = (type, data = {}) => {
      const e = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(e, 'clipboardData', { value: { getData: (t) => data[t] ?? '', setData: (t, v) => { copied[t] = v; }, files: [] } });
      return e;
    };
    const copy = (where) => { copied = {}; view.goTo(`Sheet1!${where}`); viewport.dispatchEvent(clipboardEvent('copy')); return copied; };
    const paste = (where, data) => { view.goTo(`Sheet1!${where}`); viewport.dispatchEvent(clipboardEvent('paste', data)); };
    return { wb, id, copy, paste };
  }

  it('pastes the other app\'s text rather than the copied formula', async () => {
    const { wb, id, copy, paste } = await mount();
    const own = copy('A1');
    expect(own['text/plain']).toBe('10');
    paste('D1', { 'text/plain': '10', 'text/html': '<meta charset="utf-8"><span style="color:#333">10</span>' });
    expect(wb.getCell(id, 0, 3)).toMatchObject({ v: 10, f: null });
    // The same text with this app's own HTML, or with none, is still the internal copy.
    paste('E1', { 'text/plain': '10', 'text/html': own['text/html'] });
    expect(wb.getCell(id, 0, 4).f).toBe('F1*2');
    paste('F1', { 'text/plain': '10' });
    expect(wb.getCell(id, 0, 5).f).toBe('G1*2');
  });
});
