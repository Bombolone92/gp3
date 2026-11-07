import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { matchesRule } from '../src/core/condformat.js';

const r = (type, value) => ({ type, value });

it('reads a number as the fifteen significant digits a formula would show, not as float noise', () => {
  expect(matchesRule(r('endsWith', '4'), 0.1 + 0.2)).toBe(false);
  expect(matchesRule(r('endsWith', '3'), 0.1 + 0.2)).toBe(true);
  expect(matchesRule(r('contains', '0.3'), 0.1 + 0.2)).toBe(true);
  expect(matchesRule(r('notContains', '4'), 0.1 + 0.2)).toBe(true);
  expect(matchesRule(r('beginsWith', '1E+21'), 1e21)).toBe(true);
  expect(matchesRule(r('endsWith', '23460000'), 1234567890123456789)).toBe(true); // rounded decimal digits fit the native twenty-character field
  expect(matchesRule(r('endsWith', '2346E+18'), 1234567890123456789)).toBe(false);
  expect(matchesRule(r('contains', '0123456'), 1234567890123456789)).toBe(false); // the sixteenth digit is not shown
  expect(matchesRule(r('endsWith', 'e'), true)).toBe(true);
  expect(matchesRule(r('beginsWith', '-0.5'), -0.5)).toBe(true);
});

it('applies text rules to computed numbers the same way', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '=0.1+0.2');
  wb.setInput(id, 1, 0, '=1/3');
  wb.addRule(id, { range: { r1: 0, c1: 0, r2: 1, c2: 0 }, type: 'endsWith', value: '4', style: { bold: true } });
  wb.addRule(id, { range: { r1: 0, c1: 0, r2: 1, c2: 0 }, type: 'endsWith', value: '3', style: { color: '#f00' } });
  expect(wb.conditionalStyle(id, 0, 0, wb.getValue(id, 0, 0))).toEqual({ color: '#f00' });
  expect(wb.conditionalStyle(id, 1, 0, wb.getValue(id, 1, 0))).toEqual({ color: '#f00' });
});
