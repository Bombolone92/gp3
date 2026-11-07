import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { MAX_ROW, MAX_COL } from '../src/core/refs.js';

it.each(['down', 'right'])('keeps imported dimensions and unrelated edge content when shifting %s', (direction) => {
  const wb = new Workbook({ sheets: [{ name: 'Imported', rows: 30001, cols: 800, cells: {
    '0,0': { v: 'Shift' }, '30000,799': { v: 'Keep visible' },
  } }] });
  const id = wb.activeSheetId;
  const before = wb.toJSON();
  expect(wb.insertCells(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, direction)).toBe(true);
  expect(wb.activeSheet.rows).toBe(30001);
  expect(wb.activeSheet.cols).toBe(800);
  expect(wb.getValue(id, 30000, 799)).toBe('Keep visible');
  const after = wb.toJSON();
  wb.undo();
  expect(wb.toJSON()).toEqual(before);
  wb.redo();
  expect(wb.toJSON()).toEqual(after);
});

it.each(['down', 'right'])('grows imported dimensions for cells at the shifted %s edge', (direction) => {
  const wb = new Workbook({ sheets: [{ name: 'Imported', rows: 30001, cols: 800, cells: {
    '30000,799': { v: 'Shift' },
  }, notes: { '30000,799': 'Keep note' } }] });
  const id = wb.activeSheetId;
  const r = direction === 'down' ? 30001 : 30000;
  const c = direction === 'right' ? 800 : 799;
  expect(wb.insertCells(id, { r1: 0, c1: 0, r2: direction === 'right' ? 30000 : 0, c2: direction === 'down' ? 799 : 0 }, direction)).toBe(true);
  expect(wb.activeSheet.rows).toBe(r + 1);
  expect(wb.activeSheet.cols).toBe(c + 1);
  expect(wb.getValue(id, r, c)).toBe('Shift');
  expect(wb.getNote(id, r, c)).toBe('Keep note');
});

it.each(['down', 'right'])('grows the grid for a shifted %s note on an otherwise empty cell', (direction) => {
  const wb = new Workbook({ sheets: [{ name: 'Notes', rows: 100, cols: 26, notes: { '99,25': 'Edge note' } }] });
  const id = wb.activeSheetId;
  expect(wb.insertCells(id, { r1: 99, c1: 25, r2: 99, c2: 25 }, direction)).toBe(true);
  const r = direction === 'down' ? 100 : 99;
  const c = direction === 'right' ? 26 : 25;
  expect(wb.activeSheet.rows).toBe(r + 1);
  expect(wb.activeSheet.cols).toBe(c + 1);
  expect(wb.getNote(id, r, c)).toBe('Edge note');
});

it('keeps the blank end of a shifted table visible', () => {
  const wb = new Workbook({ sheets: [{ name: 'Table', rows: 100, cols: 26, cells: { '98,0': { v: 'Value' } },
    tables: [{ id: 'table', name: 'Sales', range: { r1: 98, c1: 0, r2: 99, c2: 0 } }],
  }] });
  const id = wb.activeSheetId;
  wb.insertCells(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, 'down');
  expect(wb.activeSheet.rows).toBe(101);
  expect(wb.tableById(id, 'table').range.r2).toBe(100);
});

it.each(['down', 'right'])('refuses to push notes beyond the spreadsheet format boundary when shifting %s', (direction) => {
  const r = direction === 'down' ? MAX_ROW : 0;
  const c = direction === 'right' ? MAX_COL : 0;
  const wb = new Workbook({ sheets: [{ name: 'Edge', rows: r + 1, cols: c + 1, notes: { [`${r},${c}`]: 'Keep' } }] });
  const id = wb.activeSheetId;
  const before = wb.toJSON();
  expect(wb.insertCells(id, { r1: r, c1: c, r2: r, c2: c }, direction)).toBe(false);
  expect(wb.toJSON()).toEqual(before);
  expect(wb.canUndo()).toBe(false);
});
