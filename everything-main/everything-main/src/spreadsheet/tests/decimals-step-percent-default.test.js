// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';

// More decimal places stepped a percent cell without a count of its own from none, while the cell,
// Format cells and the exported code all showed two, so one press on a 50.00% cell turned it into
// 50.0% — a button labelled "More" showing fewer places than the cell already had.
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

async function setup() {
  const doc = new Doc({ name: 'Percent', path: 'Spreadsheets/Percent.xlsx' });
  const wb = doc.wb;
  const id = wb.activeSheetId;
  // A1 takes its percent format from the formula it holds (impliedFormulaStyle names no decimals);
  // A2 gets exactly what Format cells → Percentage → Apply writes when the field is left alone.
  wb.setInput(id, 0, 0, '=50%');
  wb.setInput(id, 1, 0, '0.5');
  wb.applyStyle(id, { r1: 1, c1: 0, r2: 1, c2: 0 }, { fmt: 'percent', dec: null });
  wb.clearHistory();
  view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
  document.querySelector('#app').append(view.el);
  await vi.advanceTimersByTimeAsync(1);
  view.goTo('Sheet1!A1:A2');
  await vi.advanceTimersByTimeAsync(1);
  const click = (label) => { view.el.querySelector(`[aria-label="${label}"]`).click(); return vi.advanceTimersByTimeAsync(1); };
  const shown = () => [wb.getDisplay(id, 0, 0), wb.getDisplay(id, 1, 0)];
  const decs = () => [wb.getCell(id, 0, 0).s.dec ?? null, wb.getCell(id, 1, 0).s.dec ?? null];
  return { wb, id, click, shown, decs };
}

it('steps a percent cell with no count of its own from the two places it shows', async () => {
  const { click, shown, decs } = await setup();
  expect(shown()).toEqual(['50.00%', '50.00%']);
  expect(decs()).toEqual([null, null]);
  await click('More decimal places');
  expect(decs()).toEqual([3, 3]);
  expect(shown()).toEqual(['50.000%', '50.000%']);
});

it('takes one place off such a cell when Fewer decimal places is pressed', async () => {
  const { click, shown, decs } = await setup();
  await click('Fewer decimal places');
  expect(decs()).toEqual([1, 1]);
  expect(shown()).toEqual(['50.0%', '50.0%']);
});
