import { expect, it } from 'vitest';
import { formatValue } from '../src/core/format.js';
import { Workbook } from '../src/core/workbook.js';

it('displays negative zero without a sign in every format', () => {
  expect(formatValue(-0, { fmt: 'number', dec: 2 })).toBe('0.00');
  expect(formatValue(-0, { fmt: 'currency', dec: 2 })).toBe('$0.00');
  expect(formatValue(-0, { fmt: 'percent', dec: 1 })).toBe('0.0%');
  expect(formatValue(-0, { fmt: 'scientific', dec: 2 })).toBe(formatValue(0, { fmt: 'scientific', dec: 2 }));
  expect(formatValue(-0, {})).toBe('0');
  expect(formatValue(-0.004, { fmt: 'custom', code: '0.00' })).toBe(formatValue(-0.004, { fmt: 'custom', code: '0.00' }));
});

it('shows =-A1 over a zero as 0.00', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '0');
  wb.setInput(id, 1, 0, '=-A1');
  wb.applyStyle(id, { r1: 1, c1: 0, r2: 1, c2: 0 }, { fmt: 'number', dec: 2 });
  expect(wb.getDisplay(id, 1, 0)).toBe('0.00');
});
