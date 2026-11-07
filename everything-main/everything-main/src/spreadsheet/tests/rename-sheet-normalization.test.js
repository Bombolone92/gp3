import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { renameSheetInFormula } from '../src/core/refs.js';

const NFC = 'Café';
const NFD = 'Café';

// Sheet names match whichever way their accented letters are composed, so a reference spelled in
// the other form evaluates; the rename compared lowercase text only and left such references
// behind, reading #REF! from then on.
describe('renaming a sheet whose name is spelled in another Unicode composition', () => {
  it('rewrites references, sheet-qualified names and internal links spelled either way', () => {
    const wb = new Workbook();
    const a = wb.activeSheetId;
    const cafe = wb.addSheet(NFC).id;
    wb.setInput(cafe, 0, 0, '9');
    wb.setInput(a, 0, 0, `=${NFD}!A1`);
    wb.setInput(a, 1, 0, `=${NFC}!A1`);
    wb.setInput(a, 2, 0, `=HYPERLINK("#${NFD}!A1","go")`);
    wb.setInput(a, 3, 0, `=SUM(${NFD.toUpperCase()}!A1:A2)`);
    expect([0, 1, 3].map((r) => wb.getValue(a, r, 0))).toEqual([9, 9, 9]);
    expect(wb.renameSheet(cafe, 'Coffee')).toBe(true);
    expect([0, 1, 2, 3].map((r) => wb.getCell(a, r, 0).f)).toEqual([
      'Coffee!A1', 'Coffee!A1', 'HYPERLINK("#Coffee!A1","go")', 'SUM(Coffee!A1:A2)',
    ]);
    expect([0, 1, 3].map((r) => wb.getValue(a, r, 0))).toEqual([9, 9, 9]);
    expect(wb.resolveLink(wb.linkAt(a, 2, 0).url)).toEqual({ sheetId: cafe, range: { r1: 0, c1: 0, r2: 0, c2: 0 } });
  });

  it('works the other way round, for a sheet named in the decomposed form', () => {
    const wb = new Workbook();
    const a = wb.activeSheetId;
    const cafe = wb.addSheet(NFD).id;
    wb.setInput(cafe, 0, 0, '9');
    wb.setInput(a, 0, 0, `=${NFC}!A1`);
    expect(wb.getValue(a, 0, 0)).toBe(9);
    wb.renameSheet(cafe, 'Coffee');
    expect(wb.getCell(a, 0, 0).f).toBe('Coffee!A1');
    expect(wb.getValue(a, 0, 0)).toBe(9);
  });

  it('shrinks a 3D span whose end is spelled the other way when that sheet is deleted', () => {
    const wb = new Workbook();
    const a = wb.activeSheetId;
    const cafe = wb.addSheet(NFC).id;
    const three = wb.addSheet('Three').id;
    wb.setInput(cafe, 0, 0, '2');
    wb.setInput(three, 0, 0, '3');
    wb.setInput(a, 0, 0, '1');
    wb.setInput(a, 1, 0, `=SUM(Sheet1:${NFD}!A1)`);
    wb.setInput(a, 2, 0, `=SUM(${NFD}:Three!A1)`);
    expect([1, 2].map((r) => wb.getValue(a, r, 0))).toEqual([3, 5]);
    wb.deleteSheet(cafe);
    expect(wb.getCell(a, 1, 0).f).toBe('SUM(Sheet1!A1)');
    expect(wb.getCell(a, 2, 0).f).toBe('SUM(Three!A1)');
    expect([1, 2].map((r) => wb.getValue(a, r, 0))).toEqual([1, 3]);
  });

  it('compares names without regard to case or composition in renameSheetInFormula', () => {
    expect(renameSheetInFormula(`${NFD}!A1+'${NFD}'!B2`, NFC, 'New')).toBe('New!A1+New!B2');
    expect(renameSheetInFormula(`${NFC.toUpperCase()}!A1`, NFD, 'New')).toBe('New!A1');
    // A different name that only shares letters is left alone.
    expect(renameSheetInFormula('Cafes!A1', NFC, 'New')).toBe('Cafes!A1');
  });
});
