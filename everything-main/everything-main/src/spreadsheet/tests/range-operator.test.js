import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseFormula } from '../src/core/formula/parser.js';
import { astToText } from '../src/core/formula/print.js';
import { isVolatile } from '../src/core/formula/evaluator.js';
import { calc } from './helpers/calc.js';

// The range operator between two reference-valued expressions:
// A1:INDEX(A1:A5,3) is A1:A3, OFFSET(A1,1,0):A5 is A2:A5.
const D = { A1: '1', A2: '2', A3: '3', A4: '4', A5: '5', B1: '10', B2: '20', B3: '30' };
const E = (code) => ({ error: code });

describe('the range operator between references', () => {
  it('spans a cell and an INDEX or OFFSET result', () => {
    expect(calc('SUM(A1:INDEX(A1:A5,3))', D)).toBe(6);
    expect(calc('SUM(INDEX(A1:A5,2):INDEX(A1:A5,4))', D)).toBe(9);
    expect(calc('SUM(OFFSET(A1,1,0):A5)', D)).toBe(14);
    expect(calc('SUM(A1:OFFSET(A1,2,1))', D)).toBe(66);
    expect(calc('ROWS(A1:INDEX(A1:A5,3))', D)).toBe(3);
    expect(calc('COUNT(A1:INDEX(A1:A5,MATCH(3,A1:A5,0)))', D)).toBe(3);
    expect(calc('SUM(INDEX(A1:B3,1,2):B3)', D)).toBe(60);
    // The block is the bounding box, whichever way round the corners are given.
    expect(calc('SUM(A3:INDEX(A1:A5,1))', D)).toBe(6);
    expect(calc('SUM(A1:INDEX(A1:A5,1))', D)).toBe(1);
  });

  it('parses only between references and prints back as typed', () => {
    expect(astToText(parseFormula('SUM(A1:INDEX(A1:A5,3))'))).toBe('SUM(A1:INDEX(A1:A5,3))');
    expect(astToText(parseFormula('OFFSET(A1,1,0):A5'))).toBe('OFFSET(A1,1,0):A5');
    expect(parseFormula('A1:INDEX(A1:A5,3)')).toMatchObject({ type: 'range', left: { type: 'ref' }, right: { type: 'call', name: 'INDEX' } });
    expect(() => parseFormula('A1:"x"')).toThrow();
    expect(() => parseFormula('A1:1')).toThrow();
    expect(() => parseFormula('1:A1')).toThrow();
    expect(isVolatile(parseFormula('A1:INDEX(A1:A5,RANDBETWEEN(1,3))'))).toBe(true);
    expect(isVolatile(parseFormula('A1:INDEX(A1:A5,3)'))).toBe(false);
  });

  it('is #VALUE! when a side is not a reference or the sides are on different sheets', () => {
    expect(calc('SUM(A1:ABS(1))', D)).toEqual(E('#VALUE!'));
    expect(calc('SUM(A1:INDEX({1,2,3},2))', D)).toEqual(E('#VALUE!'));
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.addSheet('Other');
    wb.setInput(id, 0, 0, '=SUM(Other!A1:INDEX(A1:A3,2))');
    expect(wb.getValue(id, 0, 0)).toEqual(E('#VALUE!'));
  });

  it('works with a defined name on either side and spills in a cell', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    const sheet = wb.sheets[0].name;
    for (let r = 0; r < 5; r++) wb.setInput(id, r, 0, String(r + 1));
    wb.defineName('Top', `=${sheet}!$A$1`);
    wb.setInput(id, 0, 2, '=SUM(Top:A3)');
    wb.setInput(id, 0, 3, '=A1:INDEX(A1:A5,3)');
    wb.setInput(id, 0, 4, '=SUM(D1:D3)');
    expect(wb.getValue(id, 0, 2)).toBe(6);
    expect([0, 1, 2].map((r) => wb.getValue(id, r, 3))).toEqual([1, 2, 3]);
    expect(wb.getValue(id, 3, 3)).toBeNull();
    expect(wb.getValue(id, 0, 4)).toBe(6);
    // The range follows its INDEX: a longer count spills further.
    wb.setInput(id, 0, 3, '=A1:INDEX(A1:A5,4)');
    expect([0, 1, 2, 3].map((r) => wb.getValue(id, r, 3))).toEqual([1, 2, 3, 4]);
  });
});
