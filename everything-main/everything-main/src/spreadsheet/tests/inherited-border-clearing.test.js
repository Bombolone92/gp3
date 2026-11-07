import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { MAX_ROW } from '../src/core/refs.js';

const area = (r1, c1, r2 = r1, c2 = c1) => ({ r1, c1, r2, c2 });
const column = { bl: true, br: true, bc: '#2255cc', bs: 'thick', bg: '#fff0cc', font: 'arial' };
const row = { bt: true, btBorder: { bs: 'double', bc: '#aa3388' }, bold: true };
const book = () => new Workbook({ sheets: [{ name: 'Lines', rows: 2000, cols: 80,
  colStyles: { 2: column }, rowStyles: { 8: row },
  cells: { '5,2': { v: 8, s: { fmt: 'number', dec: 2, bb: true, bbBorder: { bs: 'dashed', bc: '#339944' } } },
    '6,2': { f: 'C6*3' } },
}] });
const plain = (wb, r, c) => {
  const s = wb.styleAt(wb.activeSheetId, r, c);
  for (const key of ['bt', 'bb', 'bl', 'br', 'bc', 'bs', 'btBorder', 'bbBorder', 'blBorder', 'brBorder']) expect(s?.[key], `${r},${c} ${key}`).toBeFalsy();
};

it('clears borders on stored and unallocated cells while preserving values, formulas and other formatting', () => {
  const wb = book(), id = wb.activeSheetId;
  wb.applyBorders(id, area(5, 2, 10, 3), 'none');
  for (let r = 5; r <= 10; r++) for (let c = 2; c <= 3; c++) plain(wb, r, c);
  expect(wb.getDisplay(id, 5, 2)).toBe('8.00'); expect(wb.getValue(id, 6, 2)).toBe(24);
  expect(wb.styleAt(id, 5, 2)).toMatchObject({ bg: '#fff0cc', font: 'arial' });
  expect(wb.styleAt(id, 8, 3).bold).toBe(true);
  expect(wb.styleAt(id, 4, 2).bl).toBe(true); expect(wb.styleAt(id, 8, 4).bt).toBe(true);
  expect(wb.activeSheet.cells.size).toBe(2);
  wb.undo(); expect(wb.styleAt(id, 5, 2).bbBorder.bs).toBe('dashed'); expect(wb.styleAt(id, 9, 2).bl).toBe(true);
  wb.redo(); plain(wb, 9, 2);
});

it('keeps a large finite clear sparse and idempotent through JSON, typing and copying', () => {
  const wb = book(), id = wb.activeSheetId, block = area(1, 1, 1800, 70);
  wb.applyBorders(id, block, 'none');
  plain(wb, 1800, 2); expect(wb.styleAt(id, 1801, 2).bl).toBe(true);
  expect(wb.activeSheet.cells.size).toBe(2);
  const json = wb.toJSON(); expect(JSON.stringify(json).length).toBeLessThan(4000);
  wb.applyBorders(id, block, 'none'); expect(wb.toJSON()).toEqual(json);
  wb.undo(); expect(wb.canUndo()).toBe(false); expect(wb.styleAt(id, 1800, 2).bl).toBe(true); wb.redo();
  const back = new Workbook(wb.toJSON()); plain(back, 1800, 2);
  back.setInput(back.activeSheetId, 1300, 2, '7'); plain(back, 1300, 2);
  back.pasteCells(back.activeSheetId, back.copyRange(back.activeSheetId, area(1300, 2)), 1900, 2);
  plain(back, 1900, 2);
});

it.each(['col', 'row'])('clears a whole %s without expanding its defaults into blank cells', axis => {
  const wb = book(), id = wb.activeSheetId;
  wb.applyBorders(id, axis === 'col' ? area(0, 2, 1999, 2) : area(8, 0, 8, 79), 'none', { scope: axis === 'col' ? 'columns' : 'rows' });
  if (axis === 'col') {
    plain(wb, 8, 2); plain(wb, MAX_ROW, 2);
    expect(wb.styleAt(id, 8, 3).bt).toBe(true);
    expect(wb.activeSheet.colStyles.get(2)).toEqual({ bg: '#fff0cc', font: 'arial' });
  } else {
    plain(wb, 8, 2); expect(wb.styleAt(id, 9, 2).bl).toBe(true);
    expect(wb.activeSheet.rowStyles.get(8)).toEqual({ bold: true });
  }
  expect(wb.activeSheet.cells.size).toBe(2);
});

it('clears both line axes on Select All and preserves unrelated sparse resets', () => {
  const wb = book(), id = wb.activeSheetId;
  wb.clearRange(id, area(10, 2), { contents: false, styles: true });
  wb.applyBorders(id, area(0, 0, 1999, 79), 'none', { scope: 'sheet' });
  plain(wb, MAX_ROW, 2); plain(wb, 8, 70);
  expect(wb.styleAt(id, 10, 2).bg).toBeFalsy();
  expect(wb.styleAt(id, 11, 2).bg).toBe('#fff0cc');
  expect(wb.activeSheet.styleResets.flatMap(x => x.keys)).not.toContain('bl');
});

it('allows a later border gesture to override the cleared region without restoring unrelated sides', () => {
  const wb = book(), id = wb.activeSheetId;
  wb.applyBorders(id, area(5, 2, 10, 3), 'none');
  wb.applyBorders(id, area(9, 2), 'bottom', { color: '#123456', style: 'medium' });
  const s = wb.styleAt(id, 9, 2);
  expect(s).toMatchObject({ bb: true, bc: '#123456', bs: 'medium' });
  expect(s.bl).toBeFalsy(); expect(s.br).toBeFalsy();
  wb.undo(); plain(wb, 9, 2); wb.redo(); expect(wb.styleAt(id, 9, 2).bb).toBe(true);
});

it('refuses protected empty intersections before changing cells, line formats or reset records', () => {
  const wb = book(), id = wb.activeSheetId;
  wb.activeSheet.protectedRanges.push({ id: 'lock', range: area(1000, 4), description: 'Locked' });
  const before = wb.toJSON(); wb.applyBorders(id, area(1, 1, 1800, 70), 'none');
  expect(wb.toJSON()).toEqual(before); expect(wb.canUndo()).toBe(false);
  wb.activeSheet.protectedRanges[0].range = area(3000, 2);
  const expanded = wb.toJSON(); wb.applyBorders(id, area(0, 2, 1999, 2), 'none', { scope: 'columns' });
  expect(wb.toJSON()).toEqual(expanded);
});

it('does not scan a large cell or line map for a one-cell clear', () => {
  const wb = book(), id = wb.activeSheetId;
  for (let r = 20; r < 100; r++) { wb.activeSheet.cells.set(`${r},4`, { v: r }); wb.activeSheet.rowStyles.set(r, { bold: true }); }
  const cells = wb.activeSheet.cells, rows = wb.activeSheet.rowStyles;
  cells[Symbol.iterator] = () => { throw new Error('Scanned unrelated cells'); };
  rows[Symbol.iterator] = () => { throw new Error('Scanned unrelated rows'); };
  wb.applyBorders(id, area(10, 2), 'none'); plain(wb, 10, 2);
});

it('keeps merged perimeter borders cleared and a no-op clear out of history', () => {
  const wb = book(), id = wb.activeSheetId;
  wb.mergeCells(id, area(20, 2, 22, 3));
  wb.applyBorders(id, area(20, 2, 22, 3), 'none');
  for (let r = 20; r <= 22; r++) for (let c = 2; c <= 3; c++) plain(wb, r, c);
  const empty = new Workbook(); empty.applyBorders(empty.activeSheetId, area(1, 1), 'none');
  expect(empty.canUndo()).toBe(false); expect(empty.activeSheet.cells.size).toBe(0);
});
