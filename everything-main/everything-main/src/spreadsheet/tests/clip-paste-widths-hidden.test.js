// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';

// A copy skips hidden columns, so a copy of A1:C1 with B hidden is two columns wide. Paste
// special → Column widths pasted the bounding range's three widths instead, hidden B's
// zero width among them, so the destination got a sliver of a column between the two.
function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() };
}
Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true });

describe('paste special: column widths', () => {
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

  const item = (label) => [...document.querySelectorAll('.menu-item')].find((b) => b.querySelector('.menu-label')?.textContent === label);

  it('pastes the widths of the copied columns only, skipping a hidden one', async () => {
    const doc = new Doc({ name: 'Widths', path: 'Spreadsheets/Widths.xlsx' });
    const wb = doc.wb;
    const id = wb.activeSheetId;
    for (let c = 0; c < 3; c++) wb.setInput(id, 0, c, 'abc'[c]);
    wb.setColWidth(id, 0, 50);
    wb.setColWidth(id, 1, 200);
    wb.setColWidth(id, 2, 90);
    wb.setHidden(id, 'col', [1], true);
    wb.clearHistory();
    const untouched = wb.colWidth(id, 6);
    view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
    document.querySelector('#app').append(view.el);
    await vi.advanceTimersByTimeAsync(1);
    const viewport = view.el.querySelector('.grid-viewport');
    viewport.focus();
    view.goTo('Sheet1!A1:C1');
    const copy = new Event('copy', { bubbles: true, cancelable: true });
    const copied = {};
    Object.defineProperty(copy, 'clipboardData', { value: { getData: () => '', setData: (t, v) => { copied[t] = v; }, files: [] } });
    viewport.dispatchEvent(copy);
    expect(copied['text/plain']).toBe('a\tc');
    view.goTo('Sheet1!E1');
    view.el.querySelector('[data-menu="edit"]').click();
    item('Paste special').click();
    item('Column widths only').click();
    await vi.advanceTimersByTimeAsync(5);
    expect([4, 5, 6].map((c) => wb.colWidth(id, c))).toEqual([50, 90, untouched]);
    expect(wb.undoLabels()).toEqual(['Paste column widths']);
  });
});
