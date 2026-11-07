import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

it('lists filter values with numbers in order, text sorted by locale, and blanks last', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  ['Value', '$1,200', 'pear', '', 'Apple', '900', 'apple', '10%', 'Éclair', 'banana'].forEach((t, r) => t !== '' && wb.setInput(id, r, 0, t));
  wb.setFilterRange(id, { r1: 0, c1: 0, r2: 9, c2: 0 });
  const values = wb.filterValues(id, 0).map((v) => v.value);
  expect(values.at(-1)).toBe('');
  const texts = values.filter((v) => v && Number.isNaN(Number(v.replace(/[,$%]/g, ''))));
  expect(texts).toEqual(['Apple', 'apple', 'banana', 'Éclair', 'pear']);
  const nums = values.filter((v) => v && !Number.isNaN(Number(v.replace(/[,$%]/g, ''))));
  expect(nums).toEqual(['10%', '900', '$1,200']);
  expect(wb.filterValues(id, 0).find((v) => v.value === 'apple').count).toBe(1);
});

it('keeps text that merely parses as a number, like 1e3 or 0x10, among the words', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, [{ v: 'V' }, { v: 5 }, { v: '1e3' }, { v: '0x10' }, { v: 'apple' }, { v: 900 }, { v: '1,200' }, { v: 'Infinity' }].map((cell, r) => ({ r, c: 0, cell })));
  wb.setFilterRange(id, { r1: 0, c1: 0, r2: 7, c2: 0 });
  expect(wb.filterValues(id, 0).map((v) => v.value)).toEqual(['5', '900', '1,200', '0x10', '1e3', 'apple', 'Infinity']);
});

// Errors sorted among the text by their spelling, so #DIV/0! came before b; they now sort after the text, before the blanks.
it('lists errors after the text and before the blanks', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  ['Mixed', 'h', '=1/0', 'b', '2024-02-01', '2023-12-31', '10', '9', '', '=NA()'].forEach((t, r) => t !== '' && wb.setInput(id, r, 0, t));
  wb.setFilterRange(id, { r1: 0, c1: 0, r2: 9, c2: 0 });
  expect(wb.filterValues(id, 0).map((v) => v.value)).toEqual(['9', '10', '2023-12-31', '2024-02-01', 'b', 'h', '#DIV/0!', '#N/A', '']);
});

it('keeps a large distinct list quick to build', () => {
  const rows = 20000;
  const wb = new Workbook({ sheets: [{ name: 'S', rows: rows + 1, cols: 1, cells: Object.fromEntries(
    [['0,0', { v: 'Name' }], ...Array.from({ length: rows }, (_, r) => [`${r + 1},0`, { v: `name ${(r * 7919) % rows}` }])],
  ) }] });
  const id = wb.activeSheetId;
  wb.setFilterRange(id, { r1: 0, c1: 0, r2: rows, c2: 0 });
  const values = wb.filterValues(id, 0);
  expect(values).toHaveLength(rows);
  expect(values[0].value).toBe('name 0');
});
