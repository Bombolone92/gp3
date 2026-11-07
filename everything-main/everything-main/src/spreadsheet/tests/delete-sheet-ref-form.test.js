import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { parseRange } from '../src/core/cell.js';

const REF = { error: '#REF!' };

/** Sheet1 reads sheet Two from formulas, a rule, a validation, a filter condition, names and a calculated column. */
function setup() {
  const wb = new Workbook();
  const one = wb.activeSheetId;
  const two = wb.addSheet('Two').id;
  wb.addSheet('Three');
  wb.setInput(two, 0, 0, '5');
  wb.setInput(wb.sheets[2].id, 0, 0, '7');
  wb.defineName('Rate', 'Two!$A$1', 'Two');
  wb.setCells(one, [{ r: 0, c: 0, cell: { v: 'Qty' } }, { r: 0, c: 1, cell: { v: 'Share' } }, { r: 1, c: 0, cell: { v: 1 } }, { r: 2, c: 0, cell: { v: 2 } }]);
  const own = wb.addTable(one, parseRange('A1:B3'), { name: 'Own' });
  wb.setInput(one, 1, 1, '=[@Qty]*Two!$A$1'); // the Share column's calculated formula (a relative reference would shift per row)
  expect(wb.getValue(one, 2, 1)).toBe(10);
  wb.setInput(one, 0, 3, '=Two!A1');
  wb.setInput(one, 0, 4, "=SUM('Two'!$A$1:B2)+A2");
  wb.setInput(one, 0, 5, '=Two!Rate*2');
  wb.setInput(one, 0, 6, '=SUM(Sheet1:Two!A2)');
  wb.setInput(one, 0, 7, '=SUM(Two:Three!A1)');
  wb.addRule(one, { type: 'formula', range: parseRange('D1:D1'), value: '=Two!A1>1', style: { bold: true } });
  wb.addValidation(one, { type: 'list', range: parseRange('H2:H2'), source: '=Two!A1:A3', strict: true });
  wb.setFilterCriteria(one, 0, { formula: '=A2<Two!A1' });
  wb.defineName('Only', 'Two!$A$1');
  wb.defineName('Mixed', 'Sheet1!$A$2+Two!$A$1');
  wb.setInput(one, 0, 8, '=Mixed');
  expect([3, 4, 5, 6, 7, 8].map((c) => wb.getValue(one, 0, c))).toEqual([5, 6, 10, 1, 12, 6]);
  wb.clearHistory();
  return { wb, one, two, own };
}

// References to a deleted sheet were kept as written (Two!A1) and read #REF! only because no sheet
// had that name, so adding a sheet named Two again (the next new sheet is called Sheet2 again)
// silently took every old formula over. Excel writes them as #REF!A1, and so does this now.
describe('deleting a sheet', () => {
  it("rewrites every reference to it in Excel's #REF! form, which still reads #REF!", () => {
    const { wb, one, two, own } = setup();
    expect(wb.deleteSheet(two)).toBe(true);
    const f = (c) => wb.getCell(one, 0, c).f;
    expect(f(3)).toBe('#REF!A1');
    expect(f(4)).toBe('SUM(#REF!$A$1:B2)+A2');
    expect(f(5)).toBe('#REF!*2');
    expect(f(6)).toBe('SUM(Sheet1!A2)'); // a span shrinks to the sheets left
    expect(f(7)).toBe('SUM(Three!A1)');
    expect(wb.getCell(one, 1, 1).f).toBe('[@Qty]*#REF!$A$1');
    expect(wb.tableById(one, own).calc[1]).toBe('[@Qty]*#REF!$A$1');
    const sheet = wb.sheet(one);
    expect(sheet.rules[0].value).toBe('=#REF!A1>1');
    expect(sheet.validations[0].source).toBe('=#REF!A1:A3');
    expect(sheet.filter.criteria[0].formula).toBe('=A2<#REF!A1');
    // A name scoped to the sheet goes with it; one pointing at it alone stays and reads #REF!, and one that also reads elsewhere is rewritten.
    expect(wb.names.map((n) => [n.name, n.ref])).toEqual([['Mixed', 'Sheet1!$A$2+#REF!$A$1'], ['Only', '#REF!']]);
    expect([3, 4, 5, 8].map((c) => wb.getValue(one, 0, c))).toEqual([REF, REF, REF, REF]);
    expect(wb.getValue(one, 1, 1)).toEqual(REF);
    expect([6, 7].map((c) => wb.getValue(one, 0, c))).toEqual([1, 7]);
  });

  it('keeps them #REF! when a sheet with the same name is added again, and undo brings the originals back', () => {
    const { wb, one, two } = setup();
    wb.deleteSheet(two);
    wb.addSheet('Two');
    wb.setInput(wb.sheetByName('Two').id, 0, 0, '99');
    expect([3, 4, 5].map((c) => wb.getValue(one, 0, c))).toEqual([REF, REF, REF]);
    wb.undo(); // the 99
    wb.undo(); // the new sheet
    wb.undo(); // the deletion
    expect(wb.getCell(one, 0, 3).f).toBe('Two!A1');
    expect(wb.getCell(one, 0, 5).f).toBe('Two!Rate*2');
    expect(wb.names.map((n) => n.name).sort()).toEqual(['Mixed', 'Only', 'Rate']);
    expect([3, 4, 5, 6, 7, 8].map((c) => wb.getValue(one, 0, c))).toEqual([5, 6, 10, 1, 12, 6]);
  });

  it('matches the sheet whichever way its name is spelled, and leaves other sheets\' references alone', () => {
    const wb = new Workbook();
    const one = wb.activeSheetId;
    const cafe = wb.addSheet('Café').id;
    wb.addSheet('Cafes');
    wb.setInput(one, 0, 0, '=Café!A1+CAFÉ!B1+Cafes!A1+Sheet1!A1');
    wb.defineName('Menu', 'Café!$A$1', 'Café');
    wb.deleteSheet(cafe);
    expect(wb.getCell(one, 0, 0).f).toBe('#REF!A1+#REF!B1+Cafes!A1+Sheet1!A1');
    expect(wb.names).toEqual([]);
  });

  it('survives saving as JSON and as .xlsx', async () => {
    const { wb, one, two } = setup();
    wb.deleteSheet(two);
    const json = new Workbook(wb.toJSON());
    expect(json.getCell(json.sheets[0].id, 0, 3).f).toBe('#REF!A1');
    expect(json.getValue(json.sheets[0].id, 0, 3)).toEqual(REF);
    const back = await workbookFromFile(await workbookToXlsx(wb), 'gone.xlsx');
    const id = back.sheets[0].id;
    expect(back.getCell(id, 0, 3).f).toBe('#REF!A1');
    expect(back.getCell(id, 0, 4).f).toBe('SUM(#REF!$A$1:B2)+A2');
    expect(back.getValue(id, 0, 3)).toEqual(REF);
    expect(wb.getValue(one, 0, 3)).toEqual(REF);
  });
});
