import { describe, it, expect } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

function calc(formula) {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  wb.setInput(id, 0, 0, `=${formula}`);
  return wb.getValue(id, 0, 0);
}

const VALUE = { error: '#VALUE!' };

// NUMBERVALUE: the separators must differ, the decimal separator must not be empty, and no group
// separator may follow the decimal separator.
describe('NUMBERVALUE separators', () => {
  it('rejects the same decimal and group separator', () => {
    expect(calc('NUMBERVALUE("1,5",",",",")')).toEqual(VALUE);
    expect(calc('NUMBERVALUE("1.5",".",".")')).toEqual(VALUE);
  });

  it('rejects an empty decimal separator', () => {
    expect(calc('NUMBERVALUE("1.5","")')).toEqual(VALUE);
    expect(calc('NUMBERVALUE("15","",",")')).toEqual(VALUE);
  });

  it('rejects a group separator after the decimal separator, or a second decimal separator', () => {
    expect(calc('NUMBERVALUE("3.5,2")')).toEqual(VALUE);
    expect(calc('NUMBERVALUE("3,5.2",",",".")')).toEqual(VALUE);
    expect(calc('NUMBERVALUE("1.5.2")')).toEqual(VALUE);
  });

  it('still reads grouped and localized numbers, percentages and spaces', () => {
    expect(calc('NUMBERVALUE("1.234,56",",",".")')).toBe(1234.56);
    expect(calc('NUMBERVALUE("1,234.5")')).toBe(1234.5);
    expect(calc('NUMBERVALUE("10,15",",")')).toBe(10.15);
    expect(calc('NUMBERVALUE("1.000,5",",")')).toBe(1000.5);
    expect(calc('NUMBERVALUE("12%")')).toBe(0.12);
    expect(calc('NUMBERVALUE("5%%")')).toBeCloseTo(0.0005, 12);
    expect(calc('NUMBERVALUE(" 1 234 ")')).toBe(1234);
    expect(calc('NUMBERVALUE("")')).toBe(0);
  });
});
