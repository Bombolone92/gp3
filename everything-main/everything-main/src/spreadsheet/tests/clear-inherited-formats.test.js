import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx, workbookToOds } from '../src/core/io.js';
import { MAX_ROW } from '../src/core/refs.js';

const cell = (r, c = 1) => ({ r1: r, c1: c, r2: r, c2: c });
const area = { r1: 4, c1: 1, r2: 6, c2: 2 };
function book() {
  const wb = new Workbook({ sheets: [{ name: 'Sheet1', rows: 400, cols: 26,
    colStyles: { 1: { fmt: 'currency', cur: 'USD', bold: true, bg: '#ffff00' } },
    rowStyles: { 5: { italic: true, indent: 2 } },
    cells: { '4,1': { v: 12 }, '5,1': { f: 'B5*2' } },
  }] });
  return { wb, id: wb.activeSheetId };
}
const plain = (wb, id, r, c) => {
  for (const key of ['fmt', 'bold', 'bg', 'italic', 'indent']) expect(wb.styleAt(id, r, c)?.[key], `${r},${c} ${key}`).toBeFalsy();
};

it.each([false, true])('clears inherited formatting on values, formulas and empty cells (contents: %s)', (contents) => {
  const { wb, id } = book();
  wb.clearRange(id, area, { contents, styles: true });
  for (let r = 4; r <= 6; r++) for (let c = 1; c <= 2; c++) plain(wb, id, r, c);
  expect(wb.getValue(id, 4, 1)).toBe(contents ? null : 12);
  expect(wb.getValue(id, 5, 1)).toBe(contents ? null : 24);
  expect(wb.getDisplay(id, 4, 1)).toBe(contents ? '' : '12');
  expect(wb.styleAt(id, 3, 1)?.bg).toBe('#ffff00');
  expect(wb.styleAt(id, 5, 3)?.italic).toBe(true);
  wb.undo();
  expect(wb.getDisplay(id, 4, 1)).toBe('$12.00');
  expect(wb.styleAt(id, 6, 1)?.bold).toBe(true);
  expect(wb.canUndo()).toBe(false);
  wb.redo();
  plain(wb, id, 6, 1);
});

it('keeps cleared empty cells plain when typed into, copied and pasted', () => {
  const { wb, id } = book();
  wb.clearRange(id, area, { contents: false, styles: true });
  wb.setInput(id, 6, 1, '7');
  expect(wb.getDisplay(id, 6, 1)).toBe('7');
  wb.pasteCells(id, wb.copyRange(id, cell(4)), 10, 1);
  expect(wb.getDisplay(id, 10, 1)).toBe('12');
  plain(wb, id, 10, 1);
});

it('keeps hidden rows formatted when clearing a filtered selection', () => {
  const { wb, id } = book();
  wb.clearRange(id, area, { contents: false, styles: true, skipRow: (r) => r === 5 });
  plain(wb, id, 4, 1);
  plain(wb, id, 6, 1);
  expect(wb.getDisplay(id, 5, 1)).toBe('$24.00');
  expect(wb.styleAt(id, 5, 1)?.italic).toBe(true);
});

it('clears a whole column through a formatted row without clearing the rest of that row', () => {
  const { wb, id } = book();
  wb.clearRange(id, { r1: 0, c1: 1, r2: 399, c2: 1 }, { contents: false, styles: true });
  plain(wb, id, 5, 1);
  expect(wb.styleAt(id, 5, 2)?.italic).toBe(true);
});

it('allows later cell, row and column formatting to replace only the chosen cleared properties', () => {
  const { wb, id } = book();
  wb.clearRange(id, area, { contents: false, styles: true });
  wb.applyStyle(id, cell(4), { bg: '#00ff00' });
  expect(wb.styleAt(id, 4, 1)?.bg).toBe('#00ff00');
  wb.applyStyle(id, { r1: 0, c1: 1, r2: 399, c2: 1 }, { bold: true });
  expect(wb.styleAt(id, 6, 1)?.bold).toBe(true);
  expect(wb.styleAt(id, 6, 1)?.bg).toBeFalsy();
  expect(wb.styleAt(id, 6, 1)?.fmt).toBeFalsy();
});

it.each(['xlsx', 'ods'])('preserves the cleared block through %s save and reopen', async (ext) => {
  const { wb, id } = book();
  wb.clearRange(id, area, { contents: false, styles: true });
  const blob = await (ext === 'xlsx' ? workbookToXlsx(wb) : workbookToOds(wb));
  const back = await workbookFromFile(await blob.arrayBuffer(), `Plain.${ext}`);
  expect(back.getDisplay(back.activeSheetId, 4, 1)).toBe('12');
  plain(back, back.activeSheetId, 6, 1);
  expect(back.styleAt(back.activeSheetId, 7, 1)?.bg).toBe('#ffff00');
});

it('keeps a million-cell cleared rectangle sparse, including its far edge', () => {
  const wb = new Workbook({ sheets: [{ name: 'Large', rows: 20000, cols: 120,
    colStyles: Object.fromEntries(Array.from({ length: 100 }, (_, c) => [c, { bg: '#ffff00' }])),
    cells: { '9999,99': { v: 'kept' } },
  }] });
  const id = wb.activeSheetId;
  wb.clearRange(id, { r1: 1, c1: 0, r2: 10000, c2: 99 }, { contents: false, styles: true });
  expect(wb.styleAt(id, 10000, 99)?.bg).toBeFalsy();
  expect(wb.styleAt(id, 0, 99)?.bg).toBe('#ffff00');
  expect(wb.styleAt(id, 10001, 99)?.bg).toBe('#ffff00');
  expect(wb.sheet(id).cells.size).toBe(1);
  expect(JSON.stringify(wb.toJSON()).length).toBeLessThan(12000);
});

it('leaves protected blank cells and their neighbors untouched, but permits skipping protected rows', () => {
  const { wb, id } = book();
  wb.sheet(id).protectedRanges.push({ id: 'locked', range: cell(6), description: 'Do not format' });
  wb.clearRange(id, area, { contents: true, styles: true });
  expect(wb.canUndo()).toBe(false);
  expect(wb.getDisplay(id, 4, 1)).toBe('$12.00');
  expect(wb.styleAt(id, 6, 1)?.bold).toBe(true);
  wb.clearRange(id, area, { contents: false, styles: true, skipRow: (r) => r === 6 });
  plain(wb, id, 4, 1);
  expect(wb.styleAt(id, 6, 1)?.bold).toBe(true);
});

it('does not grow the saved exceptions or history when the same filtered selection is cleared again', () => {
  const { wb, id } = book();
  const options = { contents: false, styles: true, skipRow: (r) => r % 2 === 1 };
  wb.clearRange(id, { ...area, r2: 399 }, options);
  const before = JSON.stringify(wb.toJSON());
  wb.clearRange(id, { ...area, r2: 399 }, options);
  expect(JSON.stringify(wb.toJSON())).toBe(before);
  wb.undo();
  expect(wb.canUndo()).toBe(false);
});

it('removes all sparse exceptions when the whole sheet is cleared', () => {
  const { wb, id } = book();
  wb.clearRange(id, area, { contents: false, styles: true });
  wb.clearRange(id, { r1: 0, c1: 0, r2: 399, c2: 25 }, { contents: false, styles: true });
  expect(wb.sheet(id).styleResets).toEqual([]);
  expect(wb.styleAt(id, 5, 1)).toBeUndefined();
  wb.undo();
  plain(wb, id, 5, 1);
  expect(wb.styleAt(id, 7, 1)?.bg).toBe('#ffff00');
});

it.each([
  ['insert rows', (wb, id) => wb.insertRows(id, 5, 2)],
  ['insert rows after the cleared block', (wb, id) => wb.insertRows(id, 7, 2)],
  ['insert columns', (wb, id) => wb.insertCols(id, 2, 2)],
  ['delete rows', (wb, id) => wb.deleteRows(id, 5, 1)],
  ['delete columns', (wb, id) => wb.deleteCols(id, 1, 1)],
  ['insert cells down', (wb, id) => wb.insertCells(id, cell(5), 'down')],
  ['insert cells right', (wb, id) => wb.insertCells(id, cell(5), 'right')],
  ['delete cells up', (wb, id) => wb.deleteCells(id, cell(5), 'up')],
  ['delete cells left', (wb, id) => wb.deleteCells(id, cell(5), 'left')],
  ['move rows', (wb, id) => wb.moveRows(id, 4, 2, 9)],
  ['move columns', (wb, id) => wb.moveCols(id, 1, 1, 5)],
  ['move overlapping cells', (wb, id) => wb.moveRange(id, area, 5, 2)],
  ['sort rows', (wb, id) => wb.sortRangeBy(id, { ...area, r2: 8 }, [{ col: 1, ascending: false }])],
  ['sort columns', (wb, id) => wb.sortColumnsBy(id, { ...area, c2: 4 }, [{ row: 4, ascending: false }])],
  ['shuffle rows', (wb, id) => wb.shuffleRows(id, { ...area, r2: 8 }, { random: () => 0.5 })],
])('keeps sparse clearing equivalent to explicit cell overrides through %s and undo', (_, edit) => {
  const { wb, id } = book();
  const reference = new Workbook(wb.toJSON());
  const keys = ['fmt', 'cur', 'bold', 'bg', 'italic', 'indent'];
  const entries = [];
  for (let r = area.r1; r <= area.r2; r++) for (let c = area.c1; c <= area.c2; c++) {
    entries.push({ r, c, cell: { ...reference.getCell(id, r, c), s: Object.fromEntries(keys.map((k) => [k, null])) } });
  }
  reference.setCells(id, entries);
  wb.clearRange(id, area, { contents: false, styles: true });
  const matches = () => {
    for (let r = 0; r < 14; r++) for (let c = 0; c < 8; c++) {
      for (const key of keys) expect(wb.styleAt(id, r, c)?.[key] ?? null, `${r},${c} ${key}`).toEqual(reference.styleAt(id, r, c)?.[key] ?? null);
      expect(wb.getDisplay(id, r, c), `${r},${c} text`).toBe(reference.getDisplay(id, r, c));
    }
  };
  edit(wb, id); edit(reference, id); matches();
  wb.undo(); reference.undo(); matches();
  wb.redo(); reference.redo(); matches();
});

it('discards malformed or unknown reset metadata when opening a document', () => {
  const wb = new Workbook({ sheets: [{ name: 'Untrusted', styleResets: [
    { range: cell(0), keys: ['bg', 'unknown', '__proto__'] },
    { range: { r1: -1, r2: 0, c1: 0, c2: 0 }, keys: ['bold'] },
    { range: cell(1), keys: 'fmt' }, null,
  ] }] });
  expect(wb.sheet(wb.activeSheetId).styleResets).toEqual([{ range: cell(0), keys: ['bg'] }]);
});

it('moves the cleared formatting with kept rows when removing duplicates', () => {
  const { wb, id } = book();
  wb.setCells(id, ['A', 'A', 'B', 'C'].flatMap((v, i) => [
    { r: 4 + i, c: 0, cell: { v } }, { r: 4 + i, c: 1, cell: { v: i + 1 } },
  ]));
  wb.clearRange(id, cell(6), { contents: false, styles: true });
  expect(wb.removeDuplicates(id, { r1: 4, c1: 0, r2: 7, c2: 1 }, { columns: [0] })).toBe(1);
  expect(wb.getValue(id, 5, 0)).toBe('B');
  expect(wb.styleAt(id, 5, 1)?.bg).toBeFalsy();
  expect(wb.getValue(id, 6, 0)).toBe('C');
  expect(wb.styleAt(id, 6, 1)?.bg).toBe('#ffff00');
  wb.undo();
  expect(wb.styleAt(id, 6, 1)?.bg).toBeFalsy();
  expect(wb.getValue(id, 5, 0)).toBe('A');
});

it('copies the cleared appearance with a sheet and keeps the two sheets independent', () => {
  const { wb, id } = book();
  wb.clearRange(id, area, { contents: false, styles: true });
  const duplicate = wb.duplicateSheet(id);
  plain(wb, duplicate.id, 5, 1);
  wb.applyStyle(duplicate.id, { r1: 0, c1: 1, r2: 399, c2: 1 }, { bg: '#00ff00' });
  expect(wb.styleAt(duplicate.id, 5, 1)?.bg).toBe('#00ff00');
  plain(wb, id, 5, 1);
});

it.each(['fill', 'fillSeries'])('carries the cleared number format into %s results', (method) => {
  const { wb, id } = book();
  wb.clearRange(id, cell(4), { contents: false, styles: true });
  const target = { r1: 4, c1: 1, r2: 8, c2: 1 };
  if (method === 'fill') wb.fill(id, cell(4), target);
  else wb.fillSeries(id, target);
  expect(wb.getValue(id, 8, 1)).toBe(method === 'fill' ? 12 : 16);
  expect(wb.getDisplay(id, 8, 1)).toBe(method === 'fill' ? '12' : '16');
  expect(wb.styleAt(id, 8, 1)?.bg).toBeFalsy();
});

it('keeps cleared calculated columns plain when a table grows', () => {
  const { wb, id } = book();
  wb.setCells(id, [
    { r: 0, c: 0, cell: { v: 'Qty' } }, { r: 0, c: 1, cell: { v: 'Amount' } },
    { r: 1, c: 0, cell: { v: 2 } }, { r: 2, c: 0, cell: { v: 3 } },
  ]);
  const table = wb.addTable(id, { r1: 0, c1: 0, r2: 2, c2: 1 }, { name: 'Sales' });
  wb.setInput(id, 1, 1, '=[@Qty]*2');
  wb.clearRange(id, { r1: 1, c1: 1, r2: 2, c2: 1 }, { contents: false, styles: true });
  const r = wb.addTableRow(id, table);
  wb.setInput(id, r, 0, '4');
  expect(wb.getDisplay(id, r, 1)).toBe('8');
  expect(wb.styleAt(id, r, 1)?.bg).toBeFalsy();
});

it('moves sparse exceptions with a table footer during a resize', () => {
  const { wb, id } = book();
  wb.setCells(id, [
    { r: 0, c: 0, cell: { v: 'Qty' } }, { r: 0, c: 1, cell: { v: 'Amount' } },
    { r: 1, c: 0, cell: { v: 2 } }, { r: 1, c: 1, cell: { v: 12 } },
    { r: 2, c: 0, cell: { v: 3 } }, { r: 2, c: 1, cell: { v: 15 } },
  ]);
  const table = wb.addTable(id, { r1: 0, c1: 0, r2: 2, c2: 1 }, { name: 'Sales' });
  wb.setTableTotals(id, table, true);
  wb.clearRange(id, cell(3), { contents: false, styles: true });
  wb.resizeTable(id, table, { r1: 0, c1: 0, r2: 6, c2: 1 });
  expect(wb.getCell(id, 6, 1).f).toMatch(/SUBTOTAL/);
  expect(wb.styleAt(id, 6, 1)?.bg).toBeFalsy();
  expect(wb.styleAt(id, 3, 1)?.bg).toBe('#ffff00');
  wb.undo();
  expect(wb.getCell(id, 3, 1).f).toMatch(/SUBTOTAL/);
  expect(wb.styleAt(id, 3, 1)?.bg).toBeFalsy();
});

it.each(['rows', 'cells'])('refuses inserting %s that would discard a finite cleared block at the grid edge', (kind) => {
  const wb = new Workbook({ sheets: [{ name: 'Edge', rows: MAX_ROW + 1, cols: 26, colStyles: { 1: { bg: '#ffff00' } } }] });
  const id = wb.activeSheetId, r = kind === 'rows' ? MAX_ROW - 1 : MAX_ROW;
  wb.clearRange(id, cell(r), { contents: false, styles: true });
  wb.clearHistory();
  const before = wb.toJSON();
  const ok = kind === 'rows' ? wb.insertRows(id, 0, 2) : wb.insertCells(id, cell(MAX_ROW - 1), 'down');
  expect(ok).toBe(false);
  expect(wb.toJSON()).toEqual(before);
  expect(wb.canUndo()).toBe(false);
});
