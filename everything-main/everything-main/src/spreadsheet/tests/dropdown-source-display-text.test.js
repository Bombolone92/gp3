import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

// A dropdown list drawn from a range of dates, percentages or amounts offered their serials and bare
// decimals (45306, 0.125, 1500) unless the target cell happened to carry the same format.
it('labels the options of a list drawn from a range as the source cells show them, and still checks values', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  const lists = wb.addSheet('Lists').id;
  for (const [r, text] of [[0, '2024-01-15'], [1, '2024-02-20'], [2, '12.5%'], [3, '$1,500.00'], [4, '2024-01-15']]) wb.setInput(lists, r, 0, text);
  wb.addValidation(id, { range: { r1: 0, c1: 0, r2: 4, c2: 0 }, type: 'list', source: 'Lists!$A$1:$A$5' });
  const rule = wb.validationAt(id, 0, 0);
  const options = wb.listOptionsFor(id, rule, { typed: true, labels: true });
  expect(options.map((o) => o.text)).toEqual(['2024-01-15', '2024-02-20', '12.50%', '$1,500.00']);
  expect(options.map((o) => o.value)).toEqual([45306, 45342, 0.125, 1500]);
  // Without labels the list reads as before.
  expect(wb.listOptionsFor(id, rule)).toEqual(['45306', '45342', '0.125', '1500']);
  expect(wb.listOptionsFor(id, rule, { typed: true })).toEqual([45306, 45342, 0.125, 1500]);
  expect(wb.validateValue(id, 0, 0, 0.125).ok).toBe(true);
  expect(wb.validateInput(id, 0, 0, '12.5%').ok).toBe(true);
  expect(wb.validateInput(id, 0, 0, '$1,500.00').ok).toBe(true);
  expect(wb.validateInput(id, 0, 0, '13%').ok).toBe(false);
  // The labels follow the source cells' formats.
  wb.applyStyle(lists, { r1: 3, c1: 0, r2: 3, c2: 0 }, { fmt: 'currency', cur: 'EUR', dec: 0 });
  expect(wb.listOptionsFor(id, rule, { typed: true, labels: true }).at(-1).text).toBe('€1,500');
});

it('leaves an option with no cell behind it, or one its format hides, without a text of its own', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.addValidation(id, { range: { r1: 0, c1: 0, r2: 0, c2: 0 }, type: 'list', source: 'Yes, No' });
  expect(wb.listOptionsFor(id, wb.validationAt(id, 0, 0), { labels: true })).toEqual([{ value: 'Yes', text: null }, { value: 'No', text: null }]);
  wb.addValidation(id, { range: { r1: 0, c1: 1, r2: 0, c2: 1 }, type: 'list', source: [1, 'two'] });
  expect(wb.listOptionsFor(id, wb.validationAt(id, 0, 1), { typed: true, labels: true })).toEqual([{ value: 1, text: null }, { value: 'two', text: null }]);
  wb.setCells(id, [{ r: 5, c: 5, cell: { v: 7, f: null, s: { fmt: 'custom', code: ';;;' } } }, { r: 6, c: 5, cell: { v: 'seven', f: null } }]);
  wb.addValidation(id, { range: { r1: 0, c1: 2, r2: 0, c2: 2 }, type: 'list', source: 'F6:F7' });
  expect(wb.listOptionsFor(id, wb.validationAt(id, 0, 2), { typed: true, labels: true })).toEqual([{ value: 7, text: null }, { value: 'seven', text: 'seven' }]);
});
