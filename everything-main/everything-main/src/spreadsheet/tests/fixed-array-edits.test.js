import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

const range = { r1: 3, c1: 2, r2: 5, c2: 4 };
function book() {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '7');
  expect(wb.setArrayFormula(id, range, '=A1+2')).toBe(true);
  wb.clearHistory();
  return { wb, id };
}

it.each([
  (wb, id) => wb.setInput(id, 3, 2, '5'),
  (wb, id) => wb.setInput(id, 4, 3, '5'),
  (wb, id) => wb.setCells(id, [{ r: 0, c: 0, cell: { v: 100 } }, { r: 4, c: 3, cell: { v: 5 } }]),
  (wb, id) => wb.clearRange(id, { ...range, r2: 4 }, { contents: true, styles: true }),
  (wb, id) => wb.insertRows(id, 4),
  (wb, id) => wb.insertCols(id, 3),
  (wb, id) => wb.deleteRows(id, 4),
  (wb, id) => wb.deleteCols(id, 3),
  (wb, id) => wb.insertCells(id, { r1: 1, r2: 1, c1: 2, c2: 3 }),
  (wb, id) => wb.deleteCells(id, { r1: 1, r2: 1, c1: 2, c2: 3 }),
  (wb, id) => wb.mergeCells(id, range),
  (wb, id) => wb.moveRange(id, { ...range, c2: 3 }, 10, 10),
  (wb, id) => wb.formulasToValues(id, { ...range, r2: 3, c2: 2 }),
  (wb, id) => wb.addTable(id, { r1: 2, c1: 2, r2: 5, c2: 4 }),
])('refuses partial fixed-array mutations atomically %#', (edit) => {
  const { wb, id } = book(), before = wb.toJSON(), version = wb.version;
  const events = [];
  wb.addEventListener('change', e => events.push(e.detail));
  edit(wb, id);
  expect(wb.toJSON()).toEqual(before);
  expect(wb.version).toBe(version);
  expect(wb.canUndo()).toBe(false);
  expect(events.some(e => e.type === 'array-edit')).toBe(true);
});

it('edits and clears the full array with one undo step and retains independent cell formatting', () => {
  const { wb, id } = book();
  wb.applyStyle(id, { r1: 3, r2: 3, c1: 2, c2: 2 }, { fmt: 'currency', bold: true });
  expect(wb.getCell(id, 3, 2).array).toEqual({ rows: 3, cols: 3 });
  expect(wb.getDisplay(id, 4, 3)).toBe('9');
  wb.clearRange(id, range, { contents: false, styles: true });
  expect(wb.getCell(id, 3, 2).array).toEqual({ rows: 3, cols: 3 });
  wb.clearHistory();
  expect(wb.setArrayFormula(id, range, '=A1*2')).toBe(true);
  expect(wb.getValue(id, 5, 4)).toBe(14);
  expect(wb.undoLabels()).toEqual(['Edit array formula']);
  wb.undo();
  expect(wb.getValue(id, 5, 4)).toBe(9);
  wb.redo();
  wb.clearRange(id, range);
  expect(wb.getValue(id, 5, 4)).toBeNull();
  expect(wb.fixedArrayAt(id, 5, 4)).toBeNull();
  wb.undo();
  expect(wb.getValue(id, 5, 4)).toBe(14);
});

it('moves fixed arrays with inserted lines and removes them only when all their rows are deleted', () => {
  const { wb, id } = book();
  expect(wb.insertRows(id, 3, 2)).toBe(true);
  expect(wb.fixedArrayAt(id, 7, 4)).toMatchObject({ r: 5, c: 2, rows: 3, cols: 3 });
  wb.insertCols(id, 2, 1);
  expect(wb.getValue(id, 7, 5)).toBe(9);
  wb.deleteRows(id, 5, 3);
  expect(wb.fixedArrayAt(id, 5, 3)).toBeNull();
  wb.undo();
  expect(wb.getValue(id, 7, 5)).toBe(9);
  wb.undo();
  wb.undo();
  expect(wb.fixedArrayAt(id, 5, 4)).toMatchObject({ r: 3, c: 2, rows: 3, cols: 3 });
});

it.each([[10, 10], [4, 3]])('moves a complete fixed array to %s,%s without changing its size or precedents', (r, c) => {
  const { wb, id } = book();
  const destination = wb.moveRange(id, range, r, c);
  expect(destination).toEqual({ r1: r, c1: c, r2: r + 2, c2: c + 2 });
  expect(wb.getCell(id, r, c)).toMatchObject({ f: 'A1+2', array: { rows: 3, cols: 3 } });
  expect(wb.getValue(id, r + 2, c + 2)).toBe(9);
  wb.undo();
  expect(wb.getValue(id, 5, 4)).toBe(9);
  expect(wb.fixedArrayAt(id, 3, 2)).toMatchObject(range);
});

it.each(['merge', 'table'])('refuses a fixed-array move onto a %s before changing formulas or notes', kind => {
  const { wb, id } = book();
  const target = { r1: 10, c1: 10, r2: 12, c2: 12 };
  if (kind === 'merge') wb.mergeCells(id, target);
  else wb.addTable(id, target);
  wb.setInput(id, 0, 1, '=C4');
  wb.setNote(id, 3, 2, 'Keep with array');
  wb.clearHistory();
  const before = wb.toJSON();
  expect(wb.moveRange(id, range, 10, 10)).toBeNull();
  expect(wb.toJSON()).toEqual(before);
  expect(wb.placeMoved(id, 10, 10, wb.copyRange(id, range), { sheetId: id, range })).toBeNull();
  expect(wb.toJSON()).toEqual(before);
  expect(wb.canUndo()).toBe(false);
});

it('converts a whole fixed array to values, retaining padded errors and independent formats', () => {
  const { wb, id } = book();
  wb.setArrayFormula(id, range, '={2,4}');
  wb.applyStyle(id, { r1: 3, c1: 2, r2: 3, c2: 2 }, { fmt: 'percent' });
  expect(wb.formulasToValues(id, range)).toBe(1);
  expect(wb.fixedArrayAt(id, 3, 2)).toBeNull();
  expect(wb.getDisplay(id, 4, 2)).toBe('2');
  expect(wb.getValue(id, 5, 4)).toEqual({ error: '#N/A' });
  wb.undo();
  expect(wb.getCell(id, 3, 2).array).toEqual({ rows: 3, cols: 3 });
});

it.each([{ ...range, r2: 7 }, { ...range, r1: 1 }, { ...range, c2: 6 }])
  ('refuses a fill that would copy only part of a repeated fixed array: %j', target => {
    const { wb, id } = book(), before = wb.toJSON();
    wb.fill(id, range, target, { series: false });
    expect(wb.toJSON()).toEqual(before);
    expect(wb.canUndo()).toBe(false);
  });

it('fills complete array blocks and retains their fixed geometry', () => {
  const { wb, id } = book();
  wb.fill(id, range, { ...range, r2: 11 }, { series: false });
  expect(wb.getCell(id, 6, 2).array).toEqual({ rows: 3, cols: 3 });
  expect(wb.getCell(id, 9, 2).array).toEqual({ rows: 3, cols: 3 });
  expect(wb.getValue(id, 8, 4)).toBe(2);
  wb.undo();
  expect(wb.fixedArrayAt(id, 6, 2)).toBeNull();
});

it.each([
  (wb, id) => wb.setArrayFormula(id, range, '=A1*3'),
  (wb, id) => wb.clearRange(id, range),
  (wb, id) => wb.moveRange(id, range, 10, 10),
  (wb, id) => wb.formulasToValues(id, range),
])('protects fixed-array results even when their body cells are not stored %#', edit => {
  const { wb, id } = book();
  expect(wb.getCell(id, 4, 3)).toBeUndefined();
  wb.protectRange(id, { r1: 4, c1: 3, r2: 4, c2: 3 });
  wb.clearHistory();
  const before = wb.toJSON();
  edit(wb, id);
  expect(wb.toJSON()).toEqual(before);
  expect(wb.canUndo()).toBe(false);
});
