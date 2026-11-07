import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

// The link dialog's "Named ranges" choice attaches a native #Name link. Renaming a sheet rewrites the
// "#Sheet!A1" links that point at it; renaming a name rewrote the name's uses in formulas but left such
// links pointing at the old name, dead without an error.
describe('renaming a defined name', () => {
  it('rewrites the #Name links in cells, names and rules', () => {
    const wb = new Workbook();
    const a = wb.activeSheetId;
    const two = wb.addSheet('Two').id;
    wb.defineName('Tgt', 'Sheet1!$A$5');
    wb.setLink(a, 0, 0, '#Tgt', 'go');
    wb.setLink(two, 0, 0, '#Sheet1!Tgt', 'qualified');
    wb.setLink(two, 1, 0, "#'Sheet1'!tgt", 'quoted, other case');
    wb.setInput(two, 2, 0, '=HYPERLINK( "#Tgt" )'); // spaces and no label
    wb.setInput(two, 3, 0, '=HYPERLINK("#Target","already this spelling")&""');
    wb.defineName('Link', 'HYPERLINK("#Tgt","named")');
    wb.addRule(two, { type: 'formula', range: { r1: 5, c1: 0, r2: 5, c2: 0 }, value: '=HYPERLINK("#Tgt")<>""', style: { bold: true } });
    expect(wb.resolveLink(wb.linkAt(a, 0, 0).url)).toEqual({ sheetId: a, range: { r1: 4, c1: 0, r2: 4, c2: 0 } });
    expect(wb.renameName('Tgt', null, 'Target', 'Sheet1!$A$5')).toBeNull();
    expect(wb.getCell(a, 0, 0).hyperlink).toBe('#Target');
    expect(wb.getCell(two, 0, 0).hyperlink).toBe('#Sheet1!Target');
    expect(wb.getCell(two, 1, 0).hyperlink).toBe("#'Sheet1'!Target");
    expect(wb.getCell(two, 2, 0).f).toBe('HYPERLINK( "#Target" )');
    expect(wb.getCell(two, 3, 0).f).toBe('HYPERLINK("#Target","already this spelling")&""');
    expect(wb.names.find((n) => n.name === 'Link').ref).toBe('HYPERLINK("#Target","named")');
    expect(wb.sheet(two).rules[0].value).toBe('=HYPERLINK("#Target")<>""');
    expect(wb.resolveLink(wb.linkAt(a, 0, 0).url)).toEqual({ sheetId: a, range: { r1: 4, c1: 0, r2: 4, c2: 0 } });
    expect(wb.resolveLink(wb.linkAt(two, 0, 0).url, two)).toEqual({ sheetId: a, range: { r1: 4, c1: 0, r2: 4, c2: 0 } });
    wb.undo();
    expect(wb.getCell(a, 0, 0).hyperlink).toBe('#Tgt');
    expect(wb.names.find((n) => n.name === 'Tgt')).toBeTruthy();
  });

  it('respects scope: a sheet-local name is renamed in its own links only, and a #Sheet!A1 link is left alone', () => {
    const wb = new Workbook();
    const a = wb.activeSheetId;
    const two = wb.addSheet('Two').id;
    wb.defineName('Tgt', 'Sheet1!$A$1'); // workbook-wide
    wb.defineName('Tgt', 'Two!$B$2', 'Two'); // local to Two, shadowing it there
    wb.setLink(a, 0, 0, '#Tgt', 'global');
    wb.setLink(two, 0, 0, '#Tgt', 'local');
    wb.setLink(a, 1, 0, '#Two!Tgt', 'local, from elsewhere');
    wb.setLink(a, 2, 0, '#Two!A1', 'a cell');
    expect(wb.renameName('Tgt', 'Two', 'Local', 'Two!$B$2')).toBeNull();
    expect(wb.getCell(a, 0, 0).hyperlink).toBe('#Tgt');
    expect(wb.getCell(two, 0, 0).hyperlink).toBe('#Local');
    expect(wb.getCell(a, 1, 0).hyperlink).toBe('#Two!Local');
    expect(wb.getCell(a, 2, 0).hyperlink).toBe('#Two!A1');
    expect(wb.renameName('Tgt', null, 'Global', 'Sheet1!$A$1')).toBeNull();
    expect(wb.getCell(a, 0, 0).hyperlink).toBe('#Global');
    expect(wb.getCell(two, 0, 0).hyperlink).toBe('#Local');
  });
});
