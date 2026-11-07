// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';

// A pasted =ımportdata("…") (a dotless ı) resolves to IMPORTDATA in the evaluator, but the
// paste-time scan matched only the ASCII spelling: the formula fetched at once in a trusted
// document, with no "content from elsewhere" notice. The scan now folds names as the evaluator does.
function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() };
}
Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true });

describe('pasting a reaching formula spelled with folded letters', () => {
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
    const doc = new Doc({ name: 'Trusted', path: 'Spreadsheets/Trusted.xlsx' });
    const wb = doc.wb;
    expect(wb.externalAllowed).toBe(true);
    view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
    document.querySelector('#app').append(view.el);
    await vi.advanceTimersByTimeAsync(1);
    const viewport = view.el.querySelector('.grid-viewport');
    viewport.focus();
    const paste = (where, data) => {
      view.goTo(`Sheet1!${where}`);
      const e = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(e, 'clipboardData', { value: { getData: (t) => data[t] ?? '', setData() {}, files: [] } });
      viewport.dispatchEvent(e);
    };
    return { wb, id: wb.activeSheetId, paste };
  }

  it('blocks the formula and shows the notice, as the ASCII spelling does', async () => {
    const { wb, id, paste } = await mount();
    paste('A1', { 'text/plain': '=ımportdata("https://example.com/a.csv")' });
    expect(wb.externalAllowed).toBe(false);
    expect(wb.getValue(id, 0, 0)).toMatchObject({ error: '#BLOCKED!' });
    await vi.advanceTimersByTimeAsync(5);
    expect(view.el.querySelector('.notice-bar').hidden).toBe(false);
  });

  it('blocks such a formula arriving as a web table cell too', async () => {
    const { wb, id, paste } = await mount();
    paste('B2', { 'text/plain': 'x', 'text/html': '<table><tr><td>=tranſlate("hello","en","fr")</td></tr></table>' });
    expect(wb.getCell(id, 1, 1).f).toMatch(/^tranſlate/);
    expect(wb.externalAllowed).toBe(false);
  });
});
