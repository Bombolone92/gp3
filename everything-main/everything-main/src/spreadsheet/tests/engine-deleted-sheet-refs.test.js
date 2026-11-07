import { describe, expect, it } from 'vitest';
import { calc } from './helpers/calc.js';
import { tokenize } from '../src/core/formula/tokenizer.js';
import { parseFormula } from '../src/core/formula/parser.js';
import { astToText } from '../src/core/formula/print.js';
import { shiftFormula, extractRefs } from '../src/core/refs.js';

// Excel writes a reference to a deleted sheet as #REF!A1 or SUM(#REF!$A$1:$B$3); the cell then
// shows #REF!. Here the form was a syntax error, so the cell showed #ERROR! instead.
describe("Excel's deleted-sheet reference #REF!A1", () => {
  it('tokenizes as one reference to a sheet called #REF!', () => {
    expect(tokenize('#REF!A1+1')).toEqual([
      expect.objectContaining({ type: 'ref', sheet: '#REF!', text: 'A1', start: 0, end: 7 }),
      expect.objectContaining({ type: 'op', value: '+' }),
      expect.objectContaining({ type: 'number', value: 1 }),
    ]);
    expect(tokenize('SUM(#REF!$A$1:$B$3)')[2]).toMatchObject({ type: 'ref', sheet: '#REF!', text: '$A$1:$B$3' });
    // The bare error literal stays an error literal.
    expect(tokenize('#REF!+1')[0]).toMatchObject({ type: 'error', value: '#REF!' });
    expect(tokenize('#REF!')).toEqual([expect.objectContaining({ type: 'error', value: '#REF!', end: 5 })]);
  });

  it('evaluates to #REF!, which IFERROR can catch', () => {
    expect(calc('#REF!A1')).toEqual({ error: '#REF!' });
    expect(calc('SUM(#REF!$A$1:$B$3)')).toEqual({ error: '#REF!' });
    expect(calc('IFERROR(#REF!A1,"gone")')).toBe('gone');
    expect(calc('#REF!+1')).toEqual({ error: '#REF!' });
  });

  it("prints back in Excel's form and shifts like any reference", () => {
    expect(astToText(parseFormula('SUM(#REF!$A$1:$B$3)+#REF!A1'))).toBe('SUM(#REF!$A$1:$B$3)+#REF!A1');
    expect(shiftFormula('#REF!A1+B1', 1, 1)).toBe('#REF!B2+C2');
    expect(extractRefs('#REF!A1').map((r) => r.ref.sheet)).toEqual(['#REF!']);
  });
});
