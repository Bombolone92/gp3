import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { sameSheetName, sheetKey } from '../src/core/refs.js';

const NFC = 'Café'; // precomposed é, as a keyboard produces it
const NFD = 'Café'.normalize('NFD'); // e plus a combining mark, as a macOS file name spells it

// Every structural edit rewrites the references into the edited sheet. They matched the sheet's name by
// lower-case text alone, so a reference spelled in the other Unicode composition (which evaluates, since
// sheetByName normalises) was left behind, silently pointing at the wrong row after an ordinary insertion.
describe('structural edits follow references spelled in another Unicode composition', () => {
  const book = (sheetName, refName) => {
    const wb = new Workbook({ sheets: [{ name: sheetName, cells: { '4,0': { v: 7 }, '4,1': { v: 9 } } }, { name: 'Two' }] });
    const [cafe, two] = wb.sheets.map((s) => s.id);
    wb.setInput(two, 0, 0, `='${refName}'!A5`);
    wb.setInput(two, 1, 0, `='${sheetName}'!A5`); // the sheet's own spelling, as a control
    return { wb, cafe, two, q: `'${refName}'` };
  };

  it.each([[NFD, NFC], [NFC, NFD]])('insertRows on a sheet named %s moves a reference spelled %s', (sheetName, refName) => {
    const { wb, cafe, two } = book(sheetName, refName);
    expect(wb.getValue(two, 0, 0)).toBe(7);
    wb.insertRows(cafe, 0, 1);
    expect([0, 1].map((r) => wb.getCell(two, r, 0).f.normalize('NFC'))).toEqual(['Café!A6', 'Café!A6']);
    expect(wb.getValue(two, 0, 0)).toBe(7);
    wb.undo();
    expect(wb.getCell(two, 0, 0).f.normalize('NFC')).toBe("'Café'!A5");
  });

  it('deleteRows, insertCells, moveCols and drag-move follow too', () => {
    const { wb, cafe, two } = book(NFD, NFC);
    wb.deleteRows(cafe, 0, 1);
    expect(wb.getCell(two, 0, 0).f).toBe('Café!A4');
    expect(wb.getValue(two, 0, 0)).toBe(7);
    wb.insertCells(cafe, { r1: 0, c1: 0, r2: 1, c2: 0 }, 'down');
    expect(wb.getCell(two, 0, 0).f).toBe('Café!A6');
    wb.moveCols(cafe, 0, 1, 3);
    expect(wb.getCell(two, 0, 0).f).toBe('Café!C6');
    expect(wb.moveRange(cafe, { r1: 5, c1: 2, r2: 5, c2: 2 }, 8, 0)).toBeTruthy();
    expect(wb.getCell(two, 0, 0).f).toBe('Café!A9');
    expect(wb.getValue(two, 0, 0)).toBe(7);
  });

  it('a cut block carries and drags such references across sheets', () => {
    const { wb, cafe, two } = book(NFD, NFC);
    wb.setInput(cafe, 8, 3, `='${NFC}'!A5*2`); // inside the cut block, spelled the other way, reading a cell of the block
    const src = { r1: 4, c1: 0, r2: 8, c2: 3 };
    expect(wb.placeMoved(two, 10, 0, wb.copyRange(cafe, src), { sheetId: cafe, range: src })).toEqual({ r1: 10, c1: 0, r2: 14, c2: 3 });
    expect(wb.getCell(two, 0, 0).f).toBe('Two!A11'); // the reference followed the block onto this sheet
    expect(wb.getValue(two, 0, 0)).toBe(7);
    expect(wb.getCell(two, 14, 3).f).toBe('Two!A11*2'); // the carried formula keeps reading the moved value
    expect(wb.getValue(two, 14, 3)).toBe(14);
  });

  it('defined names, rule, validation and filter formulas follow as cell formulas do', () => {
    const { wb, cafe, two } = book(NFD, NFC);
    wb.defineName('Tgt', `'${NFC}'!$A$5`);
    wb.addRule(two, { type: 'formula', range: { r1: 9, c1: 0, r2: 9, c2: 0 }, value: `='${NFC}'!$A$5>0`, style: { bold: true } });
    wb.addValidation(two, { type: 'formula', range: { r1: 9, c1: 1, r2: 9, c2: 1 }, source: `='${NFC}'!$A$5>0` });
    for (let r = 1; r <= 3; r++) wb.setInput(two, r, 2, String(r));
    wb.setFilterRange(two, { r1: 0, c1: 2, r2: 3, c2: 2 });
    wb.setFilterCriteria(two, 2, { formula: `'${NFC}'!$A$5>C2` });
    wb.insertRows(cafe, 0, 2);
    expect(wb.names[0].ref).toBe('Café!$A$7');
    expect(wb.sheet(two).rules[0].value).toBe('=Café!$A$7>0');
    expect(wb.sheet(two).validations[0].source).toBe('=Café!$A$7>0');
    expect(wb.sheet(two).filter.criteria[2].formula).toBe('Café!$A$7>C2');
    expect(wb.getValue(two, 0, 0)).toBe(7);
  });

  it('exposes the comparison every rewrite uses', () => {
    expect(sameSheetName(NFC, NFD)).toBe(true);
    expect(sameSheetName('CAFÉ', NFD)).toBe(true);
    expect(sameSheetName(null, NFD)).toBe(false);
    expect(sameSheetName('Cafe', NFD)).toBe(false);
    expect(sheetKey(NFD)).toBe(sheetKey(NFC));
  });
});
