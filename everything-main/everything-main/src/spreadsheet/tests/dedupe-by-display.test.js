import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

// Remove duplicates compared the values behind the cells, so a date and its serial, or 1.5 and 150%, were
// one row to it, while two cells that both read 0.3 were not; the tool's own description
// decides by the value displayed.
it('tells rows apart by the text they show', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  for (const [r, text] of [[0, '2024-01-15'], [1, '45306'], [2, '1.5'], [3, '150%']]) wb.setInput(id, r, 0, text);
  expect(wb.getValue(id, 0, 0)).toBe(45306);
  expect(wb.getValue(id, 3, 0)).toBe(1.5);
  expect(wb.removeDuplicates(id, { r1: 0, c1: 0, r2: 3, c2: 0 })).toBe(0);
  expect([0, 1, 2, 3].map((r) => wb.getDisplay(id, r, 0))).toEqual(['2024-01-15', '45306', '1.5', '150%']);
});

it('takes rows that read the same as duplicates, whatever lies behind them', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '=0.1+0.2');
  wb.setInput(id, 1, 0, '0.3');
  wb.setInput(id, 2, 0, "'1");
  wb.setInput(id, 3, 0, '1');
  wb.setInput(id, 4, 0, 'Apple');
  wb.setInput(id, 5, 0, 'apple');
  expect(wb.removeDuplicates(id, { r1: 0, c1: 0, r2: 5, c2: 0 })).toBe(3);
  expect([0, 1, 2].map((r) => wb.getDisplay(id, r, 0))).toEqual(['0.3', '1', 'Apple']);
  expect(wb.getCell(id, 0, 0).f).toBe('0.1+0.2');
  expect(wb.getValue(id, 3, 0)).toBeNull();
});
