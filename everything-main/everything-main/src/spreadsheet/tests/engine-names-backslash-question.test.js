import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { tokenize } from '../src/core/formula/tokenizer.js';
import { parseFormula } from '../src/core/formula/parser.js';
import { astToText } from '../src/core/formula/print.js';
import { calc } from './helpers/calc.js';

// A defined name may hold a backslash and a question mark (a backslash may also start
// one); a file carrying such a name lost it on loading, and it could not be typed in a formula.
describe('defined names holding \\ or ?', () => {
  it('tokenize as one name', () => {
    expect(tokenize('Sales\\2024+Ok?')).toEqual([
      expect.objectContaining({ type: 'name', value: 'SALES\\2024', start: 0, end: 10 }),
      expect.objectContaining({ type: 'op', value: '+' }),
      expect.objectContaining({ type: 'name', value: 'OK?', start: 11, end: 14 }),
    ]);
    expect(tokenize('\\Total*2')[0]).toMatchObject({ type: 'name', value: '\\TOTAL' });
    expect(() => tokenize('?x')).toThrow(); // a question mark may not start a name
    expect(astToText(parseFormula('Sales\\2024+Ok?'))).toBe('SALES\\2024+OK?');
  });

  it('can be defined, used and loaded', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, '5');
    expect(wb.defineName('Sales\\2024', 'Sheet1!$A$1')).toBeNull();
    expect(wb.defineName('Ok?', '7')).toBeNull();
    expect(wb.defineName('\\Total', 'Sales\\2024+Ok?')).toBeNull();
    expect(wb.defineName('?x', '1')).not.toBeNull();
    wb.setInput(id, 1, 0, '=\\Total*2');
    expect(wb.getValue(id, 1, 0)).toBe(24);
    const copy = new Workbook(wb.toJSON());
    expect(copy.names.map((n) => n.name).sort()).toEqual(['Ok?', 'Sales\\2024', '\\Total']);
    expect(copy.getValue(copy.activeSheetId, 1, 0)).toBe(24);
  });

  it('serve as LET and LAMBDA parameters', () => {
    expect(calc('LET(a\\b,2,ok?,3,a\\b*ok?)')).toBe(6);
    expect(calc('LAMBDA(x,[y?],IF(ISOMITTED(y?),x,x+y?))(1,2)')).toBe(3);
  });
});
