import { describe, expect, it } from 'vitest';
import { quoteSheet, refToText, parseRefText, renameSheetInFormula } from '../src/core/refs.js';
import { tokenize } from '../src/core/formula/tokenizer.js';
import { parseFormula } from '../src/core/formula/parser.js';
import { astToText } from '../src/core/formula/print.js';

// A sheet name is quoted when it would otherwise read as a cell reference, an R1C1 reference,
// TRUE or FALSE: 'A1'!A2. Written bare, A1!A2 is not a reference Excel accepts.
describe('quoting a sheet name that reads as something else', () => {
  it.each(['A1', 'a1', 'Q1', 'XFD1048576', 'ZZZ9999999', 'R1C1', 'r1c1', 'RC', 'R', 'C', 'R2', 'C3', 'R[1]C[-1]', 'TRUE', 'true', 'FALSE', '1abc', '#REF!'])
    ('quotes %s', (name) => {
      expect(quoteSheet(name)).toBe(`'${name}'`);
    });

  it.each(['Sheet1', 'Data2024', 'a.b', '_x', 'Übersicht', 'シート1', 'TRUEX', 'A1B', 'RC1X', 'R1C1X', 'Row', 'Col', 'Q1.2'])
    ('leaves %s bare', (name) => {
      expect(quoteSheet(name)).toBe(name);
    });

  it.each(['A1', 'R1C1', 'TRUE', 'RC', 'Sheet1', 'Q1', 'Data 2024', "Jan's"])('round-trips %s through the tokenizer and printer', (name) => {
    const text = refToText(parseRefText('B2:C3', name));
    expect(tokenize(text)).toEqual([expect.objectContaining({ type: 'ref', sheet: name, text: 'B2:C3', end: text.length })]);
    expect(astToText(parseFormula(text))).toBe(text);
    expect(parseFormula(text).ref).toMatchObject({ sheet: name });
  });

  it('quotes a span whose endpoint needs it as a whole, and a renamed sheet as it is written', () => {
    expect(refToText(parseRefText('A1', 'A1', 'Mar'))).toBe("'A1:Mar'!A1");
    expect(renameSheetInFormula('Sheet1!A2*2', 'Sheet1', 'A1')).toBe("'A1'!A2*2");
    expect(renameSheetInFormula('Sheet1!A2*2', 'Sheet1', 'TRUE')).toBe("'TRUE'!A2*2");
    expect(renameSheetInFormula("'A1'!A2*2", 'A1', 'Data')).toBe('Data!A2*2');
  });
});
