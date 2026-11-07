// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGrid } from '../src/ui/grid.js';
import { Workbook } from '../src/core/workbook.js';

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return 800; } });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return 400; } });
  HTMLCanvasElement.prototype.getContext = () => ({ measureText: (t) => ({ width: t.length * 7 }), font: '' });
  Element.prototype.scrollTo = function scrollTo() {};
  Element.prototype.setPointerCapture = function setPointerCapture() {};
  Element.prototype.releasePointerCapture = function releasePointerCapture() {};
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
});
afterEach(() => { document.body.replaceChildren(); });

const flush = () => new Promise((r) => setTimeout(r, 5));
const N = 2000;

/** N rows of wrapped text in column C, fitted by the grid, beside a colour scale over column A whose statistics the workbook caches. */
async function mount() {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  wb.ensureSize(id, N, 26);
  wb.transaction('Seed', () => {
    for (let r = 0; r < N; r++) { wb.setInput(id, r, 0, String(r)); wb.setInput(id, r, 2, 'a few words that wrap in a narrow column here'); }
  });
  wb.applyStyle(id, { r1: 0, c1: 2, r2: N - 1, c2: 2 }, { wrap: true });
  wb.addRule(id, { range: { r1: 0, c1: 0, r2: N - 1, c2: 0 }, type: 'scale', from: '#000000', to: '#ffffff' });
  const grid = createGrid({ wb, sheetId: id, announce() {} });
  document.body.replaceChildren(grid.el);
  await flush();
  grid.autoFitRows(0, N - 1);
  await flush();
  wb.clearHistory();
  // Every rebuild of the spill index stands for the workbook's caches being dropped and built again.
  let rebuilds = 0;
  const ensure = wb._ensureSpills.bind(wb);
  wb._ensureSpills = (sheet) => { if (!wb._spills.has(sheet.id)) rebuilds++; return ensure(sheet); };
  return { wb, id, grid, rebuilds: () => rebuilds };
}

// The rows a column resize refits were measured and written one row at a time inside the step,
// and every write dropped the workbook's caches, so the next row's reads rebuilt the spill index
// and the rule statistics: with a colour scale on the sheet, two thousand wrapped rows took seconds
// and four thousand half a minute. The reads now all come before the writes.
describe('refitting the wrapped rows of a resized column', () => {
  it('rebuilds the workbook\'s caches a bounded number of times, not once per row', { timeout: 60000 }, async () => {
    const { wb, id, rebuilds } = await mount();
    const tall = wb.rowHeight(id, 0);
    expect(tall).toBeGreaterThan(26);
    wb.setColWidth(id, 2, 300); // a bare width, with no transaction for the fit to join
    await flush();
    expect(wb.rowHeight(id, 0)).toBeLessThan(tall);
    expect(wb.rowHeight(id, N - 1)).toBe(wb.rowHeight(id, 0));
    // The width announces itself before its own step is recorded, so the fit it answers with goes first.
    expect(wb.undoLabels()).toEqual(['Resize column', 'Fit row height']);
    expect(rebuilds()).toBeLessThanOrEqual(6);
  });

  it('does so within a dragged column\'s own step too', { timeout: 60000 }, async () => {
    const { wb, id, grid, rebuilds } = await mount();
    const clip = grid.el.querySelector('.grid-colhead-clip');
    const pe = (target, type, x) => target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: 10, pointerId: 1, button: 0, pointerType: 'mouse' }));
    pe(clip.querySelector('.col-resizer[data-c="2"]'), 'pointerdown', 348);
    pe(clip, 'pointermove', 548);
    pe(clip, 'pointerup', 548);
    expect(wb.sheet(id).colWidths.get(2)).toBe(300);
    expect(wb.rowHeight(id, N - 1)).toBe(wb.rowHeight(id, 0));
    expect(wb.undoLabels()).toEqual(['Resize column']);
    expect(rebuilds()).toBeLessThanOrEqual(6);
  });
});
