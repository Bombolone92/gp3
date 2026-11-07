import { expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { AUTOMATIC_FORMAT } from '../src/core/format.js';
import { workbookFromFile, workbookToXlsx, workbookToOds } from '../src/core/io.js';

const cell = (r, c = 0) => ({ r1: r, c1: c, r2: r, c2: c });
function book(formula = 'SEQUENCE(4)', style = { fmt: 'currency', cur: 'USD', dec: 4 }) {
  const wb = new Workbook({ sheets: [{ name: 'Array', cells: { '0,0': { f: formula, s: style } } }] });
  wb.getValue(wb.activeSheetId, 0, 0);
  return { wb, id: wb.activeSheetId };
}

it('applies Automatic to a spilled result without changing its anchor or neighbors', () => {
  const { wb, id } = book();
  expect(wb.getDisplay(id, 1, 0)).toBe('$2.0000');
  wb.applyStyle(id, cell(1), AUTOMATIC_FORMAT);
  expect(wb.getDisplay(id, 1, 0)).toBe('2');
  expect(wb.getDisplay(id, 0, 0)).toBe('$1.0000');
  expect(wb.getDisplay(id, 2, 0)).toBe('$3.0000');
  expect(wb.getValue(id, 1, 0)).toBe(2);
  wb.undo();
  expect(wb.getDisplay(id, 1, 0)).toBe('$2.0000');
  wb.redo();
  expect(wb.getDisplay(id, 1, 0)).toBe('2');
});

it('resets individual inherited number-format properties and supports batch formatting', () => {
  const { wb, id } = book();
  wb.applyStyle(id, cell(1), { dec: null });
  expect(wb.getDisplay(id, 1, 0)).toBe('$2.00');
  const s = wb.patchedCellStyle(id, 2, 0, AUTOMATIC_FORMAT);
  wb.setCells(id, [{ r: 2, c: 0, cell: { v: null, f: null, s } }]);
  expect(wb.getDisplay(id, 2, 0)).toBe('3');
});

it('resets spill inheritance even when the destination column itself is being formatted', () => {
  const { wb, id } = book('SEQUENCE(4,2)');
  const column = { r1: 0, c1: 1, r2: wb.sheet(id).rows - 1, c2: 1 };
  wb.applyStyle(id, column, AUTOMATIC_FORMAT);
  expect(wb.getDisplay(id, 3, 1)).toBe('8');
  expect(wb.getDisplay(id, 3, 0)).toBe('$7.0000');
  wb.undo();
  expect(wb.getDisplay(id, 3, 1)).toBe('$8.0000');
});

it('keeps skipped and protected spill results unchanged', () => {
  const { wb, id } = book();
  wb.applyStyle(id, { r1: 1, c1: 0, r2: 3, c2: 0 }, AUTOMATIC_FORMAT, { skipRow: (r) => r === 2 });
  expect([1, 2, 3].map((r) => wb.getDisplay(id, r, 0))).toEqual(['2', '$3.0000', '4']);
  wb.undo();
  wb.sheet(id).protectedRanges.push({ id: 'locked', range: cell(2), description: 'Locked' });
  wb.applyStyle(id, { r1: 1, c1: 0, r2: 3, c2: 0 }, AUTOMATIC_FORMAT);
  expect([1, 2, 3].map((r) => wb.getDisplay(id, r, 0))).toEqual(['$2.0000', '$3.0000', '$4.0000']);
});

it.each(['xlsx', 'ods'])('keeps a spill format reset through %s save and reopen', async (kind) => {
  const { wb, id } = book('SEQUENCE(4)', { fmt: 'custom', code: '0.00" kg"' });
  wb.applyStyle(id, cell(1), AUTOMATIC_FORMAT);
  const blob = await (kind === 'xlsx' ? workbookToXlsx(wb) : workbookToOds(wb));
  const back = await workbookFromFile(blob, `Array.${kind}`);
  expect(back.getDisplay(back.activeSheetId, 1, 0)).toBe('2');
  expect(back.getDisplay(back.activeSheetId, 2, 0)).toBe('3.00 kg');
});

it('does not discover spills for font or fill changes', () => {
  const { wb, id } = book();
  const read = vi.spyOn(wb, 'spillAt');
  const entries = vi.spyOn(wb, 'spillEntries');
  wb.applyStyle(id, cell(1), { bold: null, bg: '#ffff00' });
  wb.patchedCellStyle(id, 1, 0, { size: null });
  expect(read).not.toHaveBeenCalled();
  expect(entries).not.toHaveBeenCalled();
});
