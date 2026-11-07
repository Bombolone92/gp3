// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGrid } from '../src/ui/grid.js';
import { Workbook } from '../src/core/workbook.js';
import * as S from '../src/core/selection.js';

/**
 * A format applied to a whole column lives on the column (see whole-column-format.test.js), so the
 * cells below the ones the sheet had already stored carry nothing of their own. Every reader used to
 * take `cell.s` straight, so such a column was painted down to about row 102 and plain below it, and
 * a value that arrived by paste, fill or import showed unformatted between typed ones. The readers
 * ask the workbook what a cell shows instead.
 */
beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return 800; } });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return 4400; } });
  HTMLCanvasElement.prototype.getContext = () => ({ measureText: (t) => ({ width: t.length * 7 }), font: '' });
  Element.prototype.scrollTo = function scrollTo() {};
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
});
afterEach(() => { document.body.replaceChildren(); });

const flush = () => new Promise((r) => setTimeout(r, 5));
const PINK = 'rgb(255, 238, 238)';
const wholeCol = (wb, id, c) => ({ r1: 0, c1: c, r2: wb.sheet(id).rows - 1, c2: c });

async function mount(prepare) {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  prepare(wb, id);
  const grid = createGrid({ wb, sheetId: id, announce() {} });
  document.body.replaceChildren(grid.el);
  grid.setSelection(S.single(0, 0));
  await flush();
  return { wb, id, grid, node: (r, c) => grid.el.querySelector(`#gc-${r}-${c}`) };
}

describe('a fill given to a whole column', () => {
  it('paints the rows the sheet grew into, which store no cell of their own', async () => {
    const { wb, id, node } = await mount((wb2, id2) => {
      wb2.setInput(id2, 0, 0, 'Item');
      wb2.setInput(id2, 0, 1, 'Price');
      wb2.applyStyle(id2, wholeCol(wb2, id2, 1), { bg: '#ffeeee' });
      wb2.ensureSize(id2, 400, 26);
    });
    expect(wb.getCell(id, 150, 1)).toBeUndefined(); // no stored cell down there, and none wanted
    expect(node(150, 1)).toBeTruthy();
    expect(node(150, 1).style.backgroundColor).toBe(PINK);
    expect(node(20, 1).style.backgroundColor).toBe(PINK);
    expect(node(150, 0).style.backgroundColor).toBe(''); // the column beside it keeps its own look
  });

  it('is what a label from the left stops its opaque backing at, as a painted cell is', async () => {
    const { node } = await mount((wb2, id2) => {
      wb2.applyStyle(id2, wholeCol(wb2, id2, 2), { bg: '#ffeeee' });
      wb2.ensureSize(id2, 400, 26);
      wb2.setInput(id2, 150, 0, 'a title far longer than its own column can show');
    });
    expect(node(150, 0).classList.contains('spill')).toBe(true);
    expect(node(150, 0).classList.contains('spill-over-fill')).toBe(true);
  });
});

describe('a number format given to a whole column', () => {
  it('uses column formats for data entry and copied formats for Paste All', () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    wb.applyStyle(id, wholeCol(wb, id, 1), { fmt: 'currency', cur: 'USD', dec: 2 });
    wb.ensureSize(id, 400, 26);
    wb.setInput(id, 250, 1, '10');
    wb.pasteCells(id, [[{ v: 20, f: null }]], 251, 1, { r: 0, c: 0 });
    wb.setCells(id, [{ r: 252, c: 1, cell: { v: 30, f: null } }], 'Import');
    wb.pasteValues(id, [['40']], 253, 1);
    wb.fill(id, { r1: 252, c1: 1, r2: 253, c2: 1 }, { r1: 252, c1: 1, r2: 255, c2: 1 });
    expect([250, 251, 252, 253].map((r) => wb.getDisplay(id, r, 1))).toEqual(['$10.00', '20', '$30.00', '$40.00']);
    expect(wb.getDisplay(id, 254, 1)).toBe('$50.00');
    // And the column beside it is untouched.
    wb.setCells(id, [{ r: 252, c: 2, cell: { v: 30, f: null } }], 'Import');
    expect(wb.getDisplay(id, 252, 2)).toBe('30');
  });

  it('draws that format in the grid, not only in the cells that store it', async () => {
    const { node } = await mount((wb2, id2) => {
      wb2.applyStyle(id2, wholeCol(wb2, id2, 1), { fmt: 'currency', cur: 'USD', dec: 2 });
      wb2.ensureSize(id2, 400, 26);
      wb2.setCells(id2, [{ r: 150, c: 1, cell: { v: 30, f: null } }], 'Import');
    });
    expect(node(150, 1).textContent).toBe('$30.00');
  });

  it('keeps the cell\'s own format over it, reading cell over row over column', () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    wb.applyStyle(id, wholeCol(wb, id, 1), { fmt: 'currency', cur: 'USD', dec: 2 });
    wb.ensureSize(id, 400, 26);
    wb.setCells(id, [{ r: 300, c: 1, cell: { v: 0.25, f: null, s: { fmt: 'percent', dec: 0 } } }], 'Import');
    expect(wb.getDisplay(id, 300, 1)).toBe('25%');
  });
});

describe('Filter and Sort by colour', () => {
  it('see the fill a whole column carries', () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    for (const [r, v] of ['Price', 1, 2, 3].entries()) wb.setInput(id, r, 1, String(v));
    wb.applyStyle(id, wholeCol(wb, id, 1), { bg: '#ffeeee' });
    wb.setFilterRange(id, { r1: 0, c1: 1, r2: 3, c2: 1 });
    expect(wb._cellFill(wb.sheet(id), 2, 1)).toBe('#ffeeee');
    expect(wb.filterColors(id, 1)).toEqual([{ color: '#ffeeee', count: 3 }]);
  });
});

describe('the cost of drawing a sheet that has no whole-line format', () => {
  it('asks nothing about the lines: no lookup, and no styleAt for the cells drawn', { timeout: 60000 }, async () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    const entries = [];
    for (let r = 0; r < 200; r++) for (let c = 0; c < 12; c++) entries.push({ r, c, cell: { v: r * 12 + c, f: null } });
    wb.setCells(id, entries, 'fill');
    const sheet = wb.sheet(id);
    let lineLookups = 0;
    let styleAtCalls = 0;
    for (const map of [sheet.colStyles, sheet.rowStyles]) {
      const get = map.get.bind(map);
      map.get = (k) => { lineLookups++; return get(k); };
    }
    const styleAt = wb.styleAt.bind(wb);
    wb.styleAt = (...args) => { styleAtCalls++; return styleAt(...args); };
    const grid = createGrid({ wb, sheetId: id, announce() {} });
    document.body.replaceChildren(grid.el);
    grid.setSelection(S.single(0, 0));
    await flush();
    // Every drawn cell is there, and not one of them cost a line lookup.
    expect(grid.el.querySelector('#gc-100-5')?.textContent).toBe('1205');
    expect(lineLookups).toBe(0);
    expect(styleAtCalls).toBe(0);
    // The same for the readers a print or an export walks the sheet with.
    let displays = 0;
    for (let r = 0; r < 200; r++) for (let c = 0; c < 12; c++) if (wb.getDisplay(id, r, c)) displays++;
    expect(displays).toBe(200 * 12);
    expect(lineLookups).toBe(0);
    expect(styleAtCalls).toBe(0);
  });
});
