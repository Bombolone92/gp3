import { describe, it, expect } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

function calc(formula) {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  wb.setInput(id, 0, 0, `=${formula}`);
  return wb.getValue(id, 0, 0);
}

// ADDRESS quotes a sheet name that would otherwise read as a reference, and keeps the ! for an empty name.
describe('ADDRESS sheet names', () => {
  it.each([
    ['"A1"', "'A1'!$A$1"], ['"ABC123"', "'ABC123'!$A$1"], ['"R1C1"', "'R1C1'!$A$1"], ['"RC"', "'RC'!$A$1"],
    ['"R"', "'R'!$A$1"], ['"C"', "'C'!$A$1"], ['"r[1]c[-1]"', "'r[1]c[-1]'!$A$1"], ['"2024"', "'2024'!$A$1"],
  ])('quotes %s because it reads as a reference', (sheet, expected) => {
    expect(calc(`ADDRESS(1,1,1,TRUE,${sheet})`)).toBe(expected);
  });

  it.each([['"Sheet1"', 'Sheet1!$A$1'], ['"Data2024"', 'Data2024!$A$1'], ['"Revenue"', 'Revenue!$A$1'], ['"R2D2"', 'R2D2!$A$1']])(
    'leaves %s bare', (sheet, expected) => {
      expect(calc(`ADDRESS(1,1,1,TRUE,${sheet})`)).toBe(expected);
    },
  );

  it('keeps the separator for an empty sheet name and omits it when none is given', () => {
    expect(calc('ADDRESS(2,3,1,TRUE,"")')).toBe('!$C$2');
    expect(calc('ADDRESS(2,3)')).toBe('$C$2');
  });

  it('round-trips a quoted name through INDIRECT', () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    const other = wb.addSheet('A1').id;
    wb.setInput(other, 0, 0, '42');
    wb.setInput(id, 0, 0, '=INDIRECT(ADDRESS(1,1,1,TRUE,"A1"))');
    expect(wb.getValue(id, 0, 0)).toBe(42);
  });
});
