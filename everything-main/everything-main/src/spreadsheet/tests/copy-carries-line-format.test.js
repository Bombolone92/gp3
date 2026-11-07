import { describe, it, expect } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

/**
 * A format applied to a whole column or row lives on the line (e88116e), not on each cell, so a copy
 * that read `cell.s` alone carried nothing: a cell in an imported sheet's Currency column arrived
 * plain wherever it was pasted. copyRange and copyCells are the source of the clipboard's copy, so
 * they hand on what the cell shows — its own style over its column's and row's default.
 */
function currencyColumn() {
  const wb = new Workbook({ sheets: [{ name: 'S',
    cells: { '0,1': { v: 5, f: null }, '1,1': { v: 7, f: null, s: { bold: true } } },
    colStyles: { 1: { fmt: 'currency', cur: 'USD' } } }] });
  return { wb, id: wb.sheets[0].id };
}

describe('copying out of a column formatted as a whole', () => {
  it('carries the column format for a stored cell that has a style of its own', () => {
    const { wb, id } = currencyColumn();
    const [[cell]] = wb.copyRange(id, { r1: 1, c1: 1, r2: 1, c2: 1 });
    expect(cell).toEqual({ v: 7, f: null, s: { fmt: 'currency', cur: 'USD', bold: true } });
  });

  it('carries it for a cell whose format is only the column\'s', () => {
    const { wb, id } = currencyColumn();
    const [[cell]] = wb.copyRange(id, { r1: 0, c1: 1, r2: 0, c2: 1 });
    expect(cell).toEqual({ v: 5, f: null, s: { fmt: 'currency', cur: 'USD' } });
  });

  it('carries it for a blank cell of the column', () => {
    const { wb, id } = currencyColumn();
    const [[cell]] = wb.copyRange(id, { r1: 40, c1: 1, r2: 40, c2: 1 });
    expect(cell).toEqual({ v: null, f: null, s: { fmt: 'currency', cur: 'USD' } });
  });

  it('pastes the format where the copy lands', () => {
    const { wb, id } = currencyColumn();
    wb.pasteCells(id, wb.copyRange(id, { r1: 0, c1: 1, r2: 1, c2: 1 }), 0, 4);
    expect(wb.getDisplay(id, 0, 4)).toBe('$5.00');
    expect(wb.getCell(id, 1, 4).s).toMatchObject({ fmt: 'currency', cur: 'USD', bold: true });
  });

  it('lets the cell\'s own keys win over the column\'s, and the row\'s over the column\'s', () => {
    const wb = new Workbook({ sheets: [{ name: 'S',
      cells: { '2,1': { v: 1, f: null, s: { bg: '#00ff00' } } },
      colStyles: { 1: { bg: '#eeeeee', bold: true } }, rowStyles: { 2: { bg: '#ffff00', italic: true } } }] });
    const id = wb.sheets[0].id;
    const [[cell]] = wb.copyRange(id, { r1: 2, c1: 1, r2: 2, c2: 1 });
    expect(cell.s).toEqual({ bg: '#00ff00', bold: true, italic: true });
  });

  it('carries it through copyCells, which a filtered or multi-range copy uses', () => {
    const { wb, id } = currencyColumn();
    const out = wb.copyCells(id, [0, 1], [1]);
    expect(out.map(([cell]) => cell.s)).toEqual([
      { fmt: 'currency', cur: 'USD' }, { fmt: 'currency', cur: 'USD', bold: true },
    ]);
  });

  it('carries it under a spilled value copied without its formula', () => {
    const wb = new Workbook({ sheets: [{ name: 'S',
      cells: { '0,0': { v: 1, f: null }, '1,0': { v: 2, f: null }, '0,1': { v: null, f: 'SORT(A1:A2)' } },
      colStyles: { 1: { bold: true } } }] });
    const id = wb.sheets[0].id;
    expect(wb.getValue(id, 1, 1)).toBe(2);
    const [[cell]] = wb.copyRange(id, { r1: 1, c1: 1, r2: 1, c2: 1 }); // the spilled cell, not its anchor
    expect(cell).toMatchObject({ v: 2, f: null, s: { bold: true } });
  });

  it('copies a sheet with no line format exactly as before', () => {
    const wb = new Workbook({ sheets: [{ name: 'S', cells: { '0,0': { v: 1, f: null, s: { bold: true } } } }] });
    const id = wb.sheets[0].id;
    expect(wb.copyRange(id, { r1: 0, c1: 0, r2: 1, c2: 1 })).toEqual([
      [{ v: 1, f: null, s: { bold: true } }, null],
      [null, null],
    ]);
  });
});

describe('the cost of the line-format lookup', () => {
  it('asks the line maps nothing at all on a sheet that has no line format', { timeout: 60000 }, () => {
    const cells = {};
    for (let r = 0; r < 200; r++) for (let c = 0; c < 26; c++) cells[`${r},${c}`] = { v: r * 26 + c, f: null };
    const wb = new Workbook({ sheets: [{ name: 'S', rows: 200, cols: 26, cells }] });
    const id = wb.sheets[0].id;
    const sheet = wb.sheet(id);
    let gets = 0;
    for (const map of [sheet.colStyles, sheet.rowStyles]) {
      const get = map.get.bind(map);
      map.get = (k) => { gets++; return get(k); };
    }
    const block = { r1: 0, c1: 0, r2: 199, c2: 25 }; // 5,200 cells
    expect(wb.copyRange(id, block)).toHaveLength(200);
    expect(wb.copyCells(id, [...Array(200).keys()], [...Array(26).keys()])).toHaveLength(200);
    // Two size reads per cell and no lookup: the helper stops before it asks.
    expect(gets).toBe(0);
    // And the lookup is reached once a line does carry a format, so the count above is no dead branch.
    wb.applyStyle(id, { r1: 0, c1: 3, r2: 199, c2: 3 }, { bold: true });
    wb.copyRange(id, block);
    expect(gets).toBeGreaterThan(0);
  });
});
