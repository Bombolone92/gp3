import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { tokenize } from '../src/core/formula/tokenizer.js';
import { parseFormula } from '../src/core/formula/parser.js';
import { astToText } from '../src/core/formula/print.js';
import { quoteSheet } from '../src/core/refs.js';
import { completionContext } from '../src/core/formula/hints.js';
import { calc } from './helpers/calc.js';

// Scripts such as Devanagari write vowels as combining marks, and macOS spells accented file names
// with decomposed marks; a name holding one could not be typed, referenced or defined.
describe('names and sheet names with combining marks', () => {
  const nfd = 'Ünïcode'.normalize('NFD');

  it('tokenize as one name or one sheet qualifier', () => {
    expect(tokenize('राशि')).toEqual([expect.objectContaining({ type: 'name', value: 'राशि', start: 0, end: 4 })]);
    expect(tokenize('हिन्दी!A1')[0]).toMatchObject({ type: 'ref', sheet: 'हिन्दी', text: 'A1' });
    expect(tokenize(`${nfd}!A1+${nfd}`).map((t) => t.type)).toEqual(['ref', 'op', 'name']);
    expect(tokenize('A1̈')).toHaveLength(1); // a mark glued to a cell reference is not a reference
    expect(tokenize('A1̈')[0].type).toBe('name');
  });

  it('print such a sheet name unquoted and round-trip it', () => {
    expect(quoteSheet('हिन्दी')).toBe('हिन्दी');
    expect(quoteSheet(nfd)).toBe(nfd);
    expect(astToText(parseFormula('हिन्दी!A1:B2*राशि'))).toBe('हिन्दी!A1:B2*राशि');
    expect(parseFormula(astToText(parseFormula(`${nfd}!A1`))).ref.sheet).toBe(nfd);
  });

  it('evaluate through a sheet reference, a defined name, LET and an optional LAMBDA parameter', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.addSheet('हिन्दी');
    const hi = wb.sheetByName('हिन्दी').id;
    wb.setInput(hi, 0, 0, '7');
    wb.setInput(id, 0, 0, '=हिन्दी!A1*2');
    expect(wb.getValue(id, 0, 0)).toBe(14);
    expect(wb.defineName('राशि', 'हिन्दी!$A$1')).toBeNull();
    wb.setInput(id, 1, 0, '=राशि+1');
    expect(wb.getValue(id, 1, 0)).toBe(8);
    expect(calc('LET(राशि,2,राशि*3)')).toBe(6);
    expect(calc('LAMBDA(x,[राशि],IF(ISOMITTED(राशि),x,x+राशि))(1)')).toBe(1);
    expect(calc('LAMBDA(x,[राशि],IF(ISOMITTED(राशि),x,x+राशि))(1,5)')).toBe(6);
  });

  it('offer the name being typed to the autocomplete', () => {
    expect(completionContext('=SUM(राशि')).toMatchObject({ kind: 'name', prefix: 'राशि' });
    expect(completionContext('=हिन्दी!')).toMatchObject({ kind: 'name', sheet: 'हिन्दी', prefix: '' });
    expect(completionContext(`=${nfd}!`)).toMatchObject({ kind: 'name', sheet: nfd });
  });
});
