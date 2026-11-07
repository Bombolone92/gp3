import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { astToText, evaluateParts } from '../src/core/formula/print.js';
import { parseFormula } from '../src/core/formula/parser.js';

// The evaluator walks the left spine of an operator chain as a list, but the walk behind the Evaluate
// formula dialog and the check for formulas that may spill still recursed once per term: the dialog
// threw on 3,000 terms and the cell showed #ERROR! from 3,600.
describe('a formula of thousands of operator terms', () => {
  const chain = (n) => Array(n).fill('1').join('+');

  it('is taken apart for the Evaluate formula dialog, innermost first', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, `=${chain(3000)}`);
    const { error, parts } = evaluateParts(wb.getCell(id, 0, 0).f, wb.contextFor(id, 0, 0));
    expect(error).toBeNull();
    expect(parts).toHaveLength(2999);
    expect(parts[0]).toEqual({ depth: 2998, text: '1+1', value: 2 });
    expect(parts[1]).toEqual({ depth: 2997, text: '1+1+1', value: 3 });
    expect(parts[2998]).toMatchObject({ depth: 0, value: 3000 });
  });

  it('keeps the depth of a chain nested in a call', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    const { parts } = evaluateParts('SUM(1+2*3,4)', wb.contextFor(id, 0, 0));
    expect(parts).toEqual([
      { depth: 2, text: '2*3', value: 6 },
      { depth: 1, text: '1+2*3', value: 7 },
      { depth: 0, text: 'SUM(1+2*3,4)', value: 11 },
    ]);
  });

  it('prints as it was written', () => {
    expect(astToText(parseFormula(chain(3000)))).toBe(chain(3000));
    expect(astToText(parseFormula('1-(2-3)*4^2^3&"x"'))).toBe('1-(2-3)*4^2^3&"x"');
    expect(astToText(parseFormula('(1+2)*3-4/(5-6)'))).toBe('(1+2)*3-4/(5-6)');
    expect(astToText(parseFormula('2^(3^2)'))).toBe('2^(3^2)');
  });

  it('has its value in the cell and is no array formula', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    const f = chain(3600);
    expect(wb._isArrayCandidate(wb._ast(f))).toBe(false);
    wb.setInput(id, 0, 0, `=${f}`);
    expect(wb.getDisplay(id, 0, 0)).toBe('3600');
    expect(wb._isArrayCandidate(wb._ast(`SUM(${Array(3000).fill('A1:A3').join('+')})`))).toBe(false);
    expect(wb._isArrayCandidate(wb._ast(Array(3000).fill('A1:A3').join('+')))).toBe(true);
  });
});
