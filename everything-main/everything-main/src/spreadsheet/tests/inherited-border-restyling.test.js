import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { borderSnapshot } from '../src/core/border-regions.js';
import { MAX_ROW, MAX_COL } from '../src/core/refs.js';
import { xlsxResetCells } from '../src/core/xlsx-style-resets.js';

const area = (r1, c1, r2 = r1, c2 = c1) => ({ r1, c1, r2, c2 });
const column = { bl: true, br: true, bc: '#2255cc', bs: 'thick', bg: '#fff0cc' };
const row = { bt: true, btBorder: { bs: 'double', bc: '#aa3388' }, bold: true };
const book = () => new Workbook({ sheets: [{ name: 'Lines', rows: 2000, cols: 80,
  colStyles: { 2: column }, rowStyles: { 8: row },
  cells: { '5,2': { v: 8, s: { fmt: 'number', dec: 2, bb: true, bbBorder: { bs: 'dashed', bc: '#339944' } } },
    '6,2': { f: 'C6*3' }, '7,2': { v: 'Mask', s: { bl: false } } },
}] });
const edge = (wb, r, c, side) => borderSnapshot(wb.styleAt(wb.activeSheetId, r, c))[`${side}Border`];

it.each([area(5, 2, 10, 3), area(1, 1, 1800, 70)])('restyles inherited and own edges across a finite selection without allocating empty cells: %j', block => {
  const wb = book(), id = wb.activeSheetId, original = wb.toJSON();
  wb.applyBorders(id, block, 'restyle', { color: '#123456' });
  expect(edge(wb, block.r2, 2, 'br')).toEqual({ bs: 'thick', bc: '#123456' });
  expect(edge(wb, 5, 2, 'bb')).toEqual({ bs: 'dashed', bc: '#123456' });
  expect(edge(wb, 8, 2, 'bt')).toEqual({ bs: 'double', bc: '#123456' });
  expect(edge(wb, 7, 2, 'bl')).toBeNull();
  expect(edge(wb, block.r2 + 1, 2, 'br')).toEqual({ bs: 'thick', bc: '#2255cc' });
  expect(edge(wb, 8, block.c2 + 1, 'bt')).toEqual(row.btBorder);
  expect(wb.getDisplay(id, 5, 2)).toBe('8.00'); expect(wb.getValue(id, 6, 2)).toBe(24);
  expect(wb.styleAt(id, 8, 2)).toMatchObject({ bold: true, bg: column.bg });
  expect(wb.activeSheet.cells.size).toBe(3);
  const after = wb.toJSON(); wb.applyBorders(id, block, 'restyle', { color: '#123456' });
  expect(wb.toJSON()).toEqual(after); wb.undo(); expect(wb.toJSON()).toEqual(original); expect(wb.canUndo()).toBe(false);
  wb.redo(); expect(wb.toJSON()).toEqual(after);
});

it('keeps cleared holes and unrelated properties, then allows repainting and future typing', () => {
  const wb = book(), id = wb.activeSheetId;
  wb.applyBorders(id, area(10, 2, 12, 2), 'none');
  wb.applyBorders(id, area(1, 1, 1800, 70), 'restyle', { style: 'dotted' });
  expect(edge(wb, 11, 2, 'br')).toBeNull();
  expect(edge(wb, 13, 2, 'br')).toEqual({ bs: 'dotted', bc: '#2255cc' });
  wb.setInput(id, 1300, 2, '42'); expect(edge(wb, 1300, 2, 'br')).toEqual({ bs: 'dotted', bc: '#2255cc' });
  wb.applyBorders(id, area(1300, 2), 'bottom', { style: 'medium', color: '#118822' });
  expect(edge(wb, 1300, 2, 'bb')).toEqual({ bs: 'medium', bc: '#118822' });
  expect(edge(wb, 1300, 2, 'br')).toEqual({ bs: 'medium', bc: '#118822' });
  wb.applyBorders(id, area(1300, 2), 'none'); expect(edge(wb, 1300, 2, 'br')).toBeNull();
  wb.undo(); expect(edge(wb, 1300, 2, 'br').bs).toBe('medium');
});

it.each(['col', 'row', 'all'])('restyles whole %s defaults and crossing edges beyond current dimensions', axis => {
  const wb = book(), id = wb.activeSheetId;
  wb.applyBorders(id, axis === 'col' ? area(0, 2, 1999, 2) : axis === 'row' ? area(8, 0, 8, 79) : area(0, 0, 1999, 79), 'restyle', { color: '#123456', style: 'medium', scope: { col: 'columns', row: 'rows', all: 'sheet' }[axis] });
  expect(edge(wb, 8, 2, 'br')).toEqual({ bs: 'medium', bc: '#123456' });
  expect(edge(wb, 8, 2, 'bt')).toEqual({ bs: 'medium', bc: '#123456' });
  expect(edge(wb, MAX_ROW, 2, 'br').bc).toBe(axis === 'row' ? '#2255cc' : '#123456');
  expect(edge(wb, 8, MAX_COL, 'bt').bc).toBe(axis === 'col' ? '#aa3388' : '#123456');
  expect(wb.activeSheet.cells.size).toBe(3);
  expect([...xlsxResetCells(wb.activeSheet)]).toHaveLength(axis === 'col' ? 1 : 0);
  wb.undo(); expect(edge(wb, 8, 2, 'bt')).toEqual(row.btBorder);
});

it('preserves mixed colors when changing only weight and supports default color and weight', () => {
  const wb = book(), id = wb.activeSheetId;
  wb.applyBorders(id, area(5, 2, 8, 2), 'restyle', { style: 'double' });
  expect(edge(wb, 5, 2, 'bb')).toEqual({ bs: 'double', bc: '#339944' });
  expect(edge(wb, 8, 2, 'bt')).toEqual({ bs: 'double', bc: '#aa3388' });
  wb.applyBorders(id, area(5, 2, 8, 2), 'restyle', { style: null, color: null });
  expect(edge(wb, 5, 2, 'bb')).toEqual({ bs: 'thin', bc: null });
  expect(edge(wb, 8, 2, 'bt')).toEqual({ bs: 'thin', bc: null });
});

it('refuses protected empty intersections before touching cells or defaults', () => {
  const wb = book(), id = wb.activeSheetId;
  wb.activeSheet.protectedRanges.push({ id: 'lock', range: area(3000, 2) });
  const before = wb.toJSON(); wb.applyBorders(id, area(0, 2, 1999, 2), 'restyle', { style: 'double', scope: 'columns' });
  expect(wb.toJSON()).toEqual(before); expect(wb.canUndo()).toBe(false);
});

it('does not scan unrelated cell or line maps for a one-cell restyle, or store an empty no-op', () => {
  const wb = book(), id = wb.activeSheetId;
  for (let r = 20; r < 100; r++) { wb.activeSheet.cells.set(`${r},4`, { v: r }); wb.activeSheet.rowStyles.set(r, { bold: true }); }
  wb.activeSheet.cells[Symbol.iterator] = () => { throw new Error('Scanned unrelated cells'); };
  wb.activeSheet.rowStyles[Symbol.iterator] = () => { throw new Error('Scanned unrelated rows'); };
  wb.applyBorders(id, area(10, 2), 'restyle', { style: 'double' }); expect(edge(wb, 10, 2, 'br').bs).toBe('double');
  const empty = new Workbook(); empty.applyBorders(empty.activeSheetId, area(1, 1), 'restyle', { color: '#123456' });
  expect(empty.canUndo()).toBe(false); expect(empty.activeSheet.cells.size).toBe(0);
});

it('keeps own shared colors and weights above converted inherited descriptors, even when that cell already matches the requested weight', () => {
  const wb = new Workbook({ sheets: [{ name: 'Mixed', colStyles: { 3: { bt: true, bs: 'double', bc: '#112233' } },
    cells: { '5,3': { v: 8, s: { bb: true, bs: 'thin', bc: '#336699' } } } }] }), id = wb.activeSheetId;
  wb.applyBorders(id, area(4, 3, 8, 3), 'restyle', { style: null });
  expect(edge(wb, 5, 3, 'bt')).toEqual({ bs: 'thin', bc: '#336699' });
  expect(edge(wb, 5, 3, 'bb')).toEqual({ bs: 'thin', bc: '#336699' });
  expect(edge(wb, 6, 3, 'bt')).toEqual({ bs: 'thin', bc: '#112233' });
  wb.undo(); expect(edge(wb, 5, 3, 'bt')).toEqual({ bs: 'thin', bc: '#336699' });
  expect(edge(wb, 6, 3, 'bt')).toEqual({ bs: 'double', bc: '#112233' });
});

it('preserves merged perimeter gaps and side ownership while restyling covered cells', () => {
  const wb = new Workbook({ sheets: [{ name: 'Merged', merges: [area(3, 2, 5, 4)],
    colStyles: { 2: { bl: true, bs: 'thin', bc: '#112233' } },
    cells: { '3,2': { v: 'Merged', s: { bt: true, bs: 'dashed' } },
      '5,2': { s: { bb: true, bs: 'thick' } }, '5,4': { s: { bb: true, br: true, bs: 'double' } } } }] }), id = wb.activeSheetId;
  const expected = Array.from({ length: 3 }, (_, i) => Array.from({ length: 3 }, (_, j) => borderSnapshot(wb.styleAt(id, i + 3, j + 2), { color: '#118855' })));
  wb.applyBorders(id, area(3, 2, 5, 4), 'restyle', { color: '#118855' });
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) expect(borderSnapshot(wb.styleAt(id, i + 3, j + 2))).toEqual(expected[i][j]);
  expect(edge(wb, 5, 3, 'bb')).toBeNull();
  expect(wb.activeSheet.merges).toEqual([area(3, 2, 5, 4)]);
});

it('coalesces adjacent equivalent line formats independently of unrelated fields', () => {
  const wb = new Workbook({ sheets: [{ name: 'Runs', rows: 2000, cols: 80,
    colStyles: Object.fromEntries(Array.from({ length: 50 }, (_, i) => [i + 1, { ...column, bold: !!(i % 2) }])),
    rowStyles: Object.fromEntries(Array.from({ length: 1800 }, (_, i) => [i + 1, { ...row, bg: i % 2 ? '#ffeecc' : '#ffffff' }])) }] });
  const id = wb.activeSheetId, range = area(1, 1, 1800, 50);
  wb.applyBorders(id, range, 'restyle', { color: '#118855' });
  expect(wb.activeSheet.cells.size).toBe(0); expect(wb.activeSheet.styleResets).toHaveLength(1);
  expect(edge(wb, 1799, 49, 'bt')).toEqual({ bs: 'double', bc: '#118855' });
  expect(edge(wb, 1799, 49, 'br')).toEqual({ bs: 'thick', bc: '#118855' });
  for (let i = 0; i < 25; i++) wb.applyBorders(id, range, 'restyle', { color: '#118855' });
  expect(wb.activeSheet.styleResets).toHaveLength(1); wb.undo(); expect(wb.canUndo()).toBe(false);
});
