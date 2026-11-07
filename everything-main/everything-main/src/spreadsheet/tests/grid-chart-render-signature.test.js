// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGrid } from '../src/ui/grid.js';
import { Workbook } from '../src/core/workbook.js';
import { setLocale } from '../src/core/format.js';

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return 800; } });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return 400; } });
  HTMLCanvasElement.prototype.getContext = () => ({ measureText: (t) => ({ width: t.length * 7 }), font: '' });
  Element.prototype.scrollTo = function scrollTo() {};
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
});
afterEach(() => { setLocale('en-US'); document.body.replaceChildren(); });

const flush = () => new Promise((r) => setTimeout(r, 5));

describe('a chart over a range', () => {
  it('is drawn again only when its data, their formats or its own definition change', async () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    for (const [k, v] of Object.entries({ '0,0': 'a', '0,1': '1', '1,0': 'b', '1,1': '2' })) { const [r, c] = k.split(',').map(Number); wb.setInput(id, r, c, v); }
    const chartId = wb.addChart(id, { type: 'column', range: { r1: 0, c1: 0, r2: 1, c2: 1 }, anchor: { r: 3, c: 3 }, w: 300, h: 200 });
    const other = wb.addSheet('Other');
    const grid = createGrid({ wb, sheetId: id });
    document.body.replaceChildren(grid.el);
    await flush();
    const box = grid.el.querySelector('.chart-box');
    const svg = () => box.querySelector('svg');
    const drawn = svg();
    expect(drawn).not.toBeNull();

    // Edits outside the charted range, on this sheet or another, leave the drawing alone.
    wb.setInput(id, 3, 10, 'unrelated');
    await flush();
    expect(svg()).toBe(drawn);
    wb.setInput(other.id, 0, 0, 'elsewhere');
    await flush();
    expect(svg()).toBe(drawn);
    wb.updateChart(id, chartId, { anchor: { r: 6, c: 6 } }, 'Move chart');
    await flush();
    expect(svg()).toBe(drawn);

    // A value inside the range, a number format inside it, or the chart's own definition redraws.
    wb.setInput(id, 1, 1, '5');
    await flush();
    const afterValue = svg();
    expect(afterValue).not.toBe(drawn);
    expect(box.textContent).toContain('5');
    wb.applyStyle(id, { r1: 0, c1: 1, r2: 1, c2: 1 }, { fmt: 'currency', cur: 'USD' });
    await flush();
    const afterFormat = svg();
    expect(afterFormat).not.toBe(afterValue);
    wb.updateChart(id, chartId, { title: 'Sales' });
    await flush();
    expect(svg()).not.toBe(afterFormat);
    expect(box.textContent).toContain('Sales');
    grid.destroy();
  });

  // Hidden and filtered-out rows are left out of the picture, so hiding one changes it.
  it('is drawn again when one of its rows is hidden or shown', async () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    for (const [k, v] of Object.entries({ '0,0': 'a', '0,1': '1', '1,0': 'b', '1,1': '2', '2,0': 'c', '2,1': '3' })) { const [r, c] = k.split(',').map(Number); wb.setInput(id, r, c, v); }
    wb.addChart(id, { type: 'column', range: { r1: 0, c1: 0, r2: 2, c2: 1 }, anchor: { r: 4, c: 3 }, w: 300, h: 200 });
    const grid = createGrid({ wb, sheetId: id });
    document.body.replaceChildren(grid.el);
    await flush();
    const box = grid.el.querySelector('.chart-box');
    const drawn = box.querySelector('svg');
    wb.setHidden(id, 'row', [1], true);
    await flush();
    const hidden = box.querySelector('svg');
    expect(hidden).not.toBe(drawn);
    expect(box.textContent).not.toContain('b');
    wb.setHidden(id, 'row', [1], false);
    await flush();
    expect(box.querySelector('svg')).not.toBe(hidden);
    expect(box.textContent).toContain('b');
    grid.destroy();
  });

  // Every edit asks each chart whether its picture is stale; over 20,000 rows that must not mean
  // computing every cell of the range again. Constants are read from the store; only formulas are computed.
  it('checks a long range for changes without computing each of its cells', async () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    wb.ensureSize(id, 20100, 26);
    const entries = [];
    for (let r = 0; r < 20000; r++) { entries.push({ r, c: 0, cell: { v: `Item ${r}`, f: null, s: null } }); entries.push({ r, c: 1, cell: { v: r * 1.5, f: null, s: null } }); }
    wb.setInput(id, 0, 2, '=B1*2'); // one formula in the range, which must still be computed
    wb.setCells(id, entries);
    wb.addChart(id, { type: 'column', range: { r1: 0, c1: 0, r2: 19999, c2: 2 }, anchor: { r: 1, c: 4 }, w: 300, h: 200 });
    const grid = createGrid({ wb, sheetId: id });
    document.body.replaceChildren(grid.el);
    await flush();
    const box = grid.el.querySelector('.chart-box');
    const drawn = box.querySelector('svg');
    let computed = 0;
    const getValue = wb.getValue.bind(wb);
    wb.getValue = (...args) => { computed++; return getValue(...args); };
    wb.setInput(id, 3, 10, 'unrelated');
    await flush();
    expect(box.querySelector('svg')).toBe(drawn);
    expect(computed).toBeLessThan(1000); // the visible cells and the formula, not 60,000 cells
    wb.setInput(id, 5, 1, '99');
    await flush();
    expect(box.querySelector('svg')).not.toBe(drawn);
    grid.destroy();
  });

  // A recalculation (F9, a regional format change, an IMPORTRANGE or AI answer arriving) computes
  // every formula afresh without editing anything, so the workbook's version stands still. The
  // cells were marked stale for it and the charts were not, so a chart beside the cells that had
  // just changed kept a picture drawn from the old results.
  it('is drawn again after a recalculation, though no cell was edited', async () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    wb.setInput(id, 0, 0, '=TEXT(1234.5,"#,##0.00")'); // its text depends on the regional format
    wb.setInput(id, 0, 1, '1');
    wb.setInput(id, 1, 0, 'b');
    wb.setInput(id, 1, 1, '2');
    wb.addChart(id, { type: 'column', range: { r1: 0, c1: 0, r2: 1, c2: 1 }, anchor: { r: 4, c: 3 }, w: 300, h: 200 });
    const grid = createGrid({ wb, sheetId: id });
    document.body.replaceChildren(grid.el);
    await flush();
    const box = grid.el.querySelector('.chart-box');
    const drawn = box.querySelector('svg');
    expect(box.textContent).toContain('1,234.50');
    setLocale('de-DE');
    wb.recalculate();
    await flush();
    expect(box.querySelector('svg')).not.toBe(drawn);
    expect(box.textContent).toContain('1.234,50');
    grid.destroy();
  });

  // The signature reads each cell's value and the keys of its format, never the text drawn from
  // them, and a regional format change alters only how values are shown: over plain numbers and
  // dates it came out identical, so the chart kept the old locale's axis labels, value labels,
  // tooltips and date categories while every cell around it changed. The signature is now dropped
  // with the version, so a recalculation draws the picture again whatever the reading says.
  it('is drawn again after a regional format change over plain numbers and dates, whose values do not move', async () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    wb.setInput(id, 0, 0, 'Month');
    wb.setInput(id, 0, 1, 'Amount');
    wb.setInput(id, 1, 0, '2024-03-01');
    wb.setInput(id, 1, 1, '1234.5');
    wb.setInput(id, 2, 0, '2024-03-02');
    wb.setInput(id, 2, 1, '2345.5');
    wb.applyStyle(id, { r1: 1, c1: 0, r2: 2, c2: 0 }, { fmt: 'date', dateStyle: 'short' });
    wb.applyStyle(id, { r1: 1, c1: 1, r2: 2, c2: 1 }, { fmt: 'currency', cur: 'EUR' });
    wb.addChart(id, { type: 'column', range: { r1: 0, c1: 0, r2: 2, c2: 1 }, anchor: { r: 5, c: 4 }, w: 400, h: 260 });
    const grid = createGrid({ wb, sheetId: id });
    document.body.replaceChildren(grid.el);
    await flush();
    const box = grid.el.querySelector('.chart-box');
    const drawn = box.querySelector('svg');
    expect(box.textContent).toContain('€1,234.50'); // a tooltip
    expect(box.textContent).toContain('Mar 1, 2024'); // a category

    // A layout change is passed over, so the reading of the range the recalculation meets is the
    // one taken when the chart was first drawn.
    wb.setColWidth(id, 20, 160);
    await flush();
    expect(box.querySelector('svg')).toBe(drawn);

    // What Settings → Regional format does: no cell is edited and no value moves.
    setLocale('de-DE');
    wb.recalculate();
    await flush(); // at once, not put off to an idle moment
    expect(box.querySelector('svg')).not.toBe(drawn);
    expect(box.textContent).toMatch(/1\.234,50\s?€/u); // the space before the symbol is a narrow no-break one
    expect(box.textContent).toMatch(/2\.345,50\s?€/u);
    expect(box.textContent).toContain('01.03.2024');
    expect(box.textContent).not.toContain('€1,234.50');
    expect(box.textContent).not.toContain('Mar 1, 2024');
    grid.destroy();
  });

  // The range holds a formula, so its reading is the one put off to an idle moment: a recalculation
  // must still draw the picture on the spot rather than join the queue.
  it('is drawn again at once after a recalculation even where its range waits for an idle reading', async () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    wb.setInput(id, 0, 0, 'a');
    wb.setInput(id, 0, 1, '=1234.5');
    wb.setInput(id, 1, 0, 'b');
    wb.setInput(id, 1, 1, '=2345.5');
    wb.applyStyle(id, { r1: 0, c1: 1, r2: 1, c2: 1 }, { fmt: 'currency', cur: 'EUR' });
    wb.addChart(id, { type: 'column', range: { r1: 0, c1: 0, r2: 1, c2: 1 }, anchor: { r: 5, c: 4 }, w: 400, h: 260 });
    const grid = createGrid({ wb, sheetId: id });
    document.body.replaceChildren(grid.el);
    await flush();
    const box = grid.el.querySelector('.chart-box');
    const drawn = box.querySelector('svg');
    expect(box.textContent).toContain('€1,234.50');
    setLocale('de-DE');
    wb.recalculate();
    await flush();
    expect(box.querySelector('svg')).not.toBe(drawn);
    expect(box.textContent).toMatch(/1\.234,50\s?€/u); // the space before the symbol is a narrow no-break one
    grid.destroy();
  });
});
