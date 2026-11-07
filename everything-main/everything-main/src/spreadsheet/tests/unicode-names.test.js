import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { tokenize } from '../src/core/formula/tokenizer.js';
import { parseFormula } from '../src/core/formula/parser.js';
import { astToText } from '../src/core/formula/print.js';
import { quoteSheet } from '../src/core/refs.js';
import { toFileFormula, fromFileFormula } from '../src/core/xlfn.js';
import { calc } from './helpers/calc.js';

// Excel writes sheet names made of letters in any script without quotes, and allows those
// letters in defined names and LAMBDA parameters; the tokenizer, printer and file formulas agree.
describe('Unicode sheet and defined names', () => {
  const book = () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.addSheet('Übersicht');
    wb.addSheet('シート1');
    const de = wb.sheetByName('Übersicht').id;
    const jp = wb.sheetByName('シート1').id;
    wb.setInput(de, 0, 0, '7');
    wb.setInput(jp, 0, 0, '5');
    return { wb, id, de, jp };
  };

  it('reads an unquoted non-ASCII sheet name in a reference', () => {
    const { wb, id } = book();
    wb.setInput(id, 0, 0, '=Übersicht!A1*2');
    wb.setInput(id, 1, 0, '=シート1!A1+1');
    wb.setInput(id, 2, 0, "='Übersicht'!A1+シート1!A1");
    wb.setInput(id, 3, 0, '=SUM(Übersicht!A1:A2)');
    expect(wb.getValue(id, 0, 0)).toBe(14);
    expect(wb.getValue(id, 1, 0)).toBe(6);
    expect(wb.getValue(id, 2, 0)).toBe(12);
    expect(wb.getValue(id, 3, 0)).toBe(7);
  });

  it('tokenizes the sheet as one reference and prints it back unquoted', () => {
    const tokens = tokenize('Übersicht!A1+1');
    expect(tokens[0]).toMatchObject({ type: 'ref', sheet: 'Übersicht', text: 'A1' });
    expect(astToText(parseFormula('Übersicht!A1:B2'))).toBe('Übersicht!A1:B2');
    expect(astToText(parseFormula('シート1!A1'))).toBe('シート1!A1');
    expect(quoteSheet('Übersicht')).toBe('Übersicht');
    expect(quoteSheet('Größe 2024')).toBe("'Größe 2024'");
    expect(quoteSheet('1abc')).toBe("'1abc'");
    expect(quoteSheet("it's")).toBe("'it''s'");
    // A letter glued to a cell reference makes it a name, as A1x already did.
    expect(tokenize('A1ü')[0].type).toBe('name');
  });

  it('accepts and evaluates a defined name with non-ASCII letters', () => {
    const { wb, id } = book();
    expect(wb.validateName('Größe')).toBeNull();
    expect(wb.validateName('合計')).toBeNull();
    expect(wb.validateName('1Größe')).not.toBeNull();
    wb.defineName('Größe', '=Übersicht!$A$1');
    wb.setInput(id, 0, 0, '=Größe*3');
    expect(wb.getValue(id, 0, 0)).toBe(21);
    // ß has no single upper-case letter, so Größe and GRÖSSE stay different names.
    expect(tokenize('Größe*3')[0]).toMatchObject({ type: 'name', value: 'GRÖßE' });
    wb.setInput(id, 1, 0, '=GRÖßE+größe');
    expect(wb.getValue(id, 1, 0)).toBe(14);
    wb.setInput(id, 2, 0, '=GRÖSSE');
    expect(wb.getValue(id, 2, 0)).toEqual({ error: '#NAME?' });
  });

  it('binds LAMBDA and LET names written with non-ASCII letters, optional ones included', () => {
    expect(calc('LAMBDA(größe,größe*2)(3)')).toBe(6);
    expect(calc('LAMBDA(x,[größe],x+IF(ISOMITTED(größe),10,größe))(1)')).toBe(11);
    expect(calc('LET(合計,4,合計+1)')).toBe(5);
  });

  it('keeps the _xlfn. prefixes of file formulas around a non-ASCII sheet name', () => {
    const ours = '=XLOOKUP(1,Übersicht!A1:A3,シート1!B1:B3)';
    const file = toFileFormula(ours);
    expect(file).toBe('=_xlfn.XLOOKUP(1,Übersicht!A1:A3,シート1!B1:B3)');
    expect(fromFileFormula(file)).toBe(ours);
    expect(toFileFormula('=CONCAT(Übersicht!A1,"x")')).toBe('=_xlfn.CONCAT(Übersicht!A1,"x")');
  });
});
