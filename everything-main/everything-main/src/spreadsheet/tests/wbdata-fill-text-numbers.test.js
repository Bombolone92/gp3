import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';

const column = (wb, id, rows, c = 0) => rows.map((r) => wb.getValue(id, r, c));

it('counts text with a trailing number down past zero when filled upward, instead of repeating zero', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 4, 0, 'Item1');
  wb.fill(id, parseRange('A5'), parseRange('A2:A5'));
  expect(column(wb, id, [1, 2, 3, 4])).toEqual(['Item-2', 'Item-1', 'Item0', 'Item1']);
});

it('keeps a zero-padded width when the count passes zero', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 3, 0, 'Item002');
  wb.fill(id, parseRange('A4'), parseRange('A1:A4'));
  expect(column(wb, id, [0, 1, 2, 3])).toEqual(['Item-001', 'Item000', 'Item001', 'Item002']);
  wb.fill(id, parseRange('A4'), parseRange('A4:A6'));
  expect(column(wb, id, [4, 5])).toEqual(['Item003', 'Item004']);
});

it('repeats text whose trailing number is too long to count exactly', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, 'X99999999999999999999');
  wb.fill(id, parseRange('A1'), parseRange('A1:A3'));
  expect(column(wb, id, [0, 1, 2])).toEqual(['X99999999999999999999', 'X99999999999999999999', 'X99999999999999999999']);
});
