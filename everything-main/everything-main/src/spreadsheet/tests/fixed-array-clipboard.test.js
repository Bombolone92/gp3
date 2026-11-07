// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { cellsToHtml, parseHtmlClipboard } from '../src/core/clipboard.js';

const range = { r1: 2, c1: 3, r2: 4, c2: 4 };
function book() {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setArrayFormula(id, range, '=ROW()+COLUMN()');
  wb.applyStyle(id, { r1: 3, c1: 4, r2: 3, c2: 4 }, { bold: true });
  return { wb, id };
}

it.each([
  { r1: 2, c1: 3, r2: 2, c2: 3 },
  { r1: 2, c1: 3, r2: 3, c2: 4 },
  { r1: 3, c1: 4, r2: 4, c2: 4 },
])('copies a partial array as a smaller fixed formula: %j', area => {
  const { wb, id } = book();
  const cells = wb.copyRange(id, area);
  expect(cells[0][0]).toMatchObject({ f: 'ROW()+COLUMN()',
    array: { rows: area.r2 - area.r1 + 1, cols: area.c2 - area.c1 + 1 } });
  wb.pasteCells(id, cells, 10, 10, { r: area.r1, c: area.c1 });
  expect(wb.getValue(id, 10, 10)).toBe(22);
});

it('materializes filtered copies even when the anchor is included', () => {
  const { wb, id } = book();
  const cells = wb.copyCells(id, [2, 4], [3, 4]);
  expect(cells.map(row => row.map(cell => cell.v))).toEqual([[7, 8], [9, 10]]);
  expect(cells.flat().every(cell => cell.f == null && !cell.array)).toBe(true);
});

it('shifts a copied result cell relative to the original fixed formula anchor', () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setArrayFormula(id, { r1: 89, c1: 9, r2: 91, c2: 11 }, '=A1');
  const cells = wb.copyRange(id, { r1: 90, c1: 10, r2: 90, c2: 10 });
  expect(cells[0][0]).toMatchObject({ f: 'B2', array: { rows: 1, cols: 1 } });
  wb.pasteCells(id, cells, 94, 17, { r: 90, c: 10 });
  expect(wb.getCell(id, 94, 17)).toMatchObject({ f: 'I6', array: { rows: 1, cols: 1 } });
});

it('transposes the fixed extent while retaining the formula', () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  const source = { r1: 2, c1: 3, r2: 3, c2: 5 };
  wb.setArrayFormula(id, source, '={1,2,3;4,5,6}');
  wb.pasteCells(id, wb.copyRange(id, source), 10, 10, { r: 2, c: 3 }, null, { transpose: true });
  expect(wb.getCell(id, 10, 10)).toMatchObject({ f: '{1,2,3;4,5,6}', array: { rows: 3, cols: 2 } });
  expect(wb.rangeValues(id, { r1: 10, c1: 10, r2: 12, c2: 11 })).toEqual([[1, 2], [4, 5], [{ error: '#N/A' }, { error: '#N/A' }]]);
});

it('preserves a full array, relative formulas, and independent styles through HTML and tiled paste', () => {
  const { wb, id } = book();
  const cells = wb.copyRange(id, range);
  expect(cells[0][0]).toMatchObject({ f: 'ROW()+COLUMN()', array: { rows: 3, cols: 2 } });
  expect(cells[1][1]).toMatchObject({ s: { bold: true } });
  const values = cells.map((row, i) => row.map((_, j) => wb.getValue(id, range.r1 + i, range.c1 + j)));
  const parsed = parseHtmlClipboard(cellsToHtml(values, cells, null, values, { r: 2, c: 3 }));
  expect(parsed.cells).toEqual(cells);
  wb.clearHistory();
  wb.pasteCells(id, parsed.cells, 10, 7, parsed.origin, { r1: 10, c1: 7, r2: 15, c2: 10 });
  for (const r of [10, 13]) for (const c of [7, 9]) {
    expect(wb.getCell(id, r, c).array).toEqual({ rows: 3, cols: 2 });
    expect(wb.getValue(id, r + 2, c + 1)).toBe(r + c + 5);
    expect(wb.styleAt(id, r + 1, c + 1).bold).toBe(true);
  }
  wb.undo();
  expect(wb.fixedArrayAt(id, 10, 7)).toBeNull();
});

it.each([{ rows: 0, cols: 1 }, { rows: 1.5, cols: 1 }, { rows: 2, cols: 1 }, { rows: 1, cols: 20000 }, 'array'])
  ('ignores malformed or incomplete embedded array geometry: %j', array => {
    const html = cellsToHtml([['5']], [[{ f: '2+3', array }]]);
    const parsed = parseHtmlClipboard(html);
    expect(parsed.cells).toBeUndefined();
    expect(parsed.rows[0][0].text).toBe('5');
  });

it('drops fixed geometry when an overlong embedded formula becomes literal text', () => {
  const f = '1+'.repeat(4100) + '1';
  const parsed = parseHtmlClipboard(cellsToHtml([['1']], [[{ f, array: { rows: 1, cols: 1 } }]]));
  expect(parsed.cells[0][0]).toMatchObject({ f: null, v: `=${f}` });
  expect(parsed.cells[0][0].array).toBeUndefined();
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.pasteCells(id, parsed.cells, 2, 3, { r: 0, c: 0 });
  expect(wb.getValue(id, 2, 3)).toBe(`=${f}`);
});

it('does not allow a batch to hide new data beneath an unchanged array anchor', () => {
  const { wb, id } = book(), before = wb.toJSON();
  const cells = wb.copyRange(id, range);
  cells[1][0] = { v: 123 };
  wb.pasteCells(id, cells, range.r1, range.c1, { r: range.r1, c: range.c1 }, null,
    { notes: [['must not land', null], [null, null], [null, null]] });
  expect(wb.toJSON()).toEqual(before);
});

it.each(['merge', 'edge'])('refuses a fixed-array paste at a %s before writing cells or notes', kind => {
  const { wb, id } = book();
  const cells = wb.copyRange(id, range), r = kind === 'edge' ? 1048575 : 10, c = 10;
  if (kind === 'merge') wb.mergeCells(id, { r1: 9, c1: 9, r2: 12, c2: 12 });
  wb.clearHistory();
  const before = wb.toJSON();
  expect(wb.pasteCells(id, cells, r, c, { r: 2, c: 3 }, null, { checkOnly: true })).toBe(false);
  wb.pasteCells(id, cells, r, c, { r: 2, c: 3 }, null, { notes: [['must not land', null], [null, null], [null, null]] });
  expect(wb.toJSON()).toEqual(before);
  expect(wb.canUndo()).toBe(false);
});
