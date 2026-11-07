import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

function column(values) {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, 'Header');
  values.forEach((t, i) => wb.setInput(id, i + 1, 0, t));
  wb.setFilterRange(id, { r1: 0, c1: 0, r2: values.length, c2: 0 });
  return wb.filterValues(id, 0).map((v) => v.value);
}

it('orders dates shown in words by their date, not their spelling', () => {
  expect(column(['Dec 1, 2023', 'Feb 1, 2024', 'Jan 15, 2024', 'Mar 3, 2024'])).toEqual(['Dec 1, 2023', 'Jan 15, 2024', 'Feb 1, 2024', 'Mar 3, 2024']);
});

it('orders currency amounts by their value whatever the symbol', () => {
  expect(column(['-€50', '€1,000,000', '€1,500', '€200'])).toEqual(['-€50', '€200', '€1,500', '€1,000,000']);
  expect(column(['£3', '£1,200', '£45'])).toEqual(['£3', '£45', '£1,200']);
});

it('keeps numbers before text, numeric-looking text among the numbers, and blanks last', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, 'Mixed');
  ['pear', "'12", '3', '', 'Apple', '2024-01-05'].forEach((t, i) => t !== '' && wb.setInput(id, i + 1, 0, t));
  wb.setFilterRange(id, { r1: 0, c1: 0, r2: 6, c2: 0 });
  expect(wb.filterValues(id, 0).map((v) => v.value)).toEqual(['3', '12', '2024-01-05', 'Apple', 'pear', '']);
});

it('counts every row showing the same text once per row', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, 'When');
  ['2024-01-05', '2024-01-05', '2024-02-01'].forEach((t, i) => wb.setInput(id, i + 1, 0, t));
  wb.setFilterRange(id, { r1: 0, c1: 0, r2: 3, c2: 0 });
  expect(wb.filterValues(id, 0)).toEqual([{ value: '2024-01-05', count: 2 }, { value: '2024-02-01', count: 1 }]);
});
