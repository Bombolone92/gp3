// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { closeAllModals } from '../src/ui/modal.js';

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
afterEach(() => { closeAllModals(); view?.destroy(); view = null; vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

// More decimal places stepped a yen cell without a count of its own from the two places every currency
// used to show, so the first press gave three where the cell had been showing none.
it('steps a yen cell from the no decimals it shows, and a dollar cell from its two', async () => {
  const doc = new Doc({ name: 'Yen', path: 'Spreadsheets/Yen.xlsx' });
  const wb = doc.wb;
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '1000');
  wb.setInput(id, 1, 0, '1000');
  wb.applyStyle(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, { fmt: 'currency', cur: 'JPY' });
  wb.applyStyle(id, { r1: 1, c1: 0, r2: 1, c2: 0 }, { fmt: 'currency', cur: 'USD' });
  wb.clearHistory();
  view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
  document.querySelector('#app').append(view.el);
  await vi.advanceTimersByTimeAsync(1);
  view.goTo('Sheet1!A1:A2');
  await vi.advanceTimersByTimeAsync(1);
  expect([wb.getDisplay(id, 0, 0), wb.getDisplay(id, 1, 0)]).toEqual(['¥1,000', '$1,000.00']);
  view.el.querySelector('[aria-label="More decimal places"]').click();
  await vi.advanceTimersByTimeAsync(1);
  expect([wb.getCell(id, 0, 0).s.dec, wb.getCell(id, 1, 0).s.dec]).toEqual([1, 3]);
  expect([wb.getDisplay(id, 0, 0), wb.getDisplay(id, 1, 0)]).toEqual(['¥1,000.0', '$1,000.000']);
});
