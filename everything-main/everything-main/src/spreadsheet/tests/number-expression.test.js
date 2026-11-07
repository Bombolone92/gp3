import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { numberExpression } from '../src/core/formula/number-expression.js';

it('preserves binary precision across the native arithmetic range', () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  const values = [0, -0, 0.1, 1.0000000000000002, 1.2345678901234567,
    Number.MAX_VALUE, 9007199254740991, 1.5e308, 1.2345678901234567e-200];
  for (const exponent of [-1022, -1021, -665, -100, -1, 0, 1, 52, 100, 665, 1022, 1023]) {
    for (const fraction of [1, 1.0000000000000002, 1.2345678901234567, 1.9999999999999998]) {
      values.push(fraction * 2 ** exponent);
    }
  }
  for (const value of values) for (const signed of [value, -value]) {
    wb.setInput(id, 0, 0, `=${numberExpression(signed)}`);
    expect(wb.getValue(id, 0, 0), String(signed)).toBe(signed || 0);
  }
});

it('retains native underflow behavior and rejects nonfinite constants', () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  for (const value of [Number.MIN_VALUE, -Number.MIN_VALUE, 2 ** -1023, -(2 ** -1023)]) {
    wb.setInput(id, 0, 0, `=${numberExpression(value)}`);
    expect(wb.getValue(id, 0, 0)).toBe(0);
  }
  for (const value of [NaN, Infinity, -Infinity]) expect(() => numberExpression(value)).toThrow(RangeError);
});
