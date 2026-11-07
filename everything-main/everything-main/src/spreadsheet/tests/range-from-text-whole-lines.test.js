import { expect, it } from 'vitest';
import { Workbook, MAX_ROWS } from '../src/core/workbook.js';
import { MAX_ROW, MAX_COL } from '../src/core/refs.js';

it('reads whole-column and whole-row references the way range boxes accept them', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  const other = wb.addSheet('Lists').id;
  expect(wb.rangeFromText(id, 'A:A')).toEqual({ sheetId: id, range: { r1: 0, c1: 0, r2: MAX_ROW, c2: 0 } });
  expect(wb.rangeFromText(id, 'b:c')).toEqual({ sheetId: id, range: { r1: 0, c1: 1, r2: MAX_ROW, c2: 2 } });
  expect(wb.rangeFromText(id, '$A:$A')).toEqual({ sheetId: id, range: { r1: 0, c1: 0, r2: MAX_ROW, c2: 0 } });
  expect(wb.rangeFromText(id, '1:1')).toEqual({ sheetId: id, range: { r1: 0, c1: 0, r2: 0, c2: MAX_COL } });
  expect(wb.rangeFromText(id, '3:5')).toEqual({ sheetId: id, range: { r1: 2, c1: 0, r2: 4, c2: MAX_COL } });
  expect(wb.rangeFromText(id, 'Lists!A:B')).toEqual({ sheetId: other, range: { r1: 0, c1: 0, r2: MAX_ROW, c2: 1 } });
  expect(wb.rangeFromText(id, 'Nowhere!A:B')).toBeNull();
});

it('lets rules and validation cover a whole column and stay anchored to it as rows come and go', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  const { range } = wb.rangeFromText(id, 'A:A');
  wb.addRule(id, { range, type: 'gt', value: 10, style: { bold: true } });
  wb.addValidation(id, { range, type: 'number', min: 0, max: 100 });
  wb.setInput(id, 5000, 0, '50');
  expect(wb.conditionalStyle(id, 5000, 0, 50)).toEqual({ bold: true });
  expect(wb.conditionalStyle(id, 5000, 1, 50)).toBeNull();
  expect(wb.validateInput(id, 7000, 0, '500').ok).toBe(false);
  expect(wb.validateInput(id, 7000, 1, '500').ok).toBe(true);
  wb.insertRows(id, 10, 3);
  expect(wb.sheet(id).rules[0].range).toEqual({ r1: 0, c1: 0, r2: MAX_ROW, c2: 0 });
  expect(wb.sheet(id).validations[0].range).toEqual({ r1: 0, c1: 0, r2: MAX_ROW, c2: 0 });
  wb.deleteRows(id, 10, 3);
  // Still the whole column ($A:$A): the grid gains blank rows at its end for those deleted.
  expect(wb.sheet(id).rules[0].range).toEqual({ r1: 0, c1: 0, r2: MAX_ROWS - 1, c2: 0 });
});

it('keeps whole-column scale, duplicate and banding rules cheap by reading only stored cells', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  const { range } = wb.rangeFromText(id, 'B:B');
  for (let r = 0; r < 50; r++) wb.setInput(id, r, 1, String(r % 7));
  wb.addRule(id, { range, type: 'scale', from: '#ffffff', to: '#000000' });
  wb.addRule(id, { range, type: 'dup', style: { color: '#f00' } });
  wb.addRule(id, { range, type: 'bands', color1: '#111111', color2: '#222222', header: false });
  wb.setFilterRange(id, { r1: 0, c1: 1, r2: 49, c2: 1 });
  wb.setFilterCriteria(id, 1, { values: ['1', '2', '3', '4', '5', '6'] });
  const started = performance.now();
  for (let r = 0; r < 50; r++) wb.conditionalStyle(id, r, 1, r % 7);
  expect(performance.now() - started).toBeLessThan(500);
  expect(wb.conditionalStyle(id, 1, 1, 1)).toMatchObject({ color: '#f00' });
});
