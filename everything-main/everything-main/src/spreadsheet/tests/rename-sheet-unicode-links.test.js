import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

// internalLinkFor writes a sheet name of letters from any script unquoted (#Données!A1), but the
// rename rewrite only recognised ASCII bare names, so renaming such a sheet left its links dead.
describe('renaming a sheet whose name has letters beyond ASCII', () => {
  it.each([
    ['Données', 'Data'],
    ['Übersicht', 'Overview'],
    ['日本', 'Japan'],
    ['Zoë.2', 'Zoe'],
  ])('rewrites the internal links to %s', (name, renamed) => {
    const wb = new Workbook();
    const a = wb.activeSheetId;
    const target = wb.addSheet(name).id;
    wb.setInput(target, 0, 0, '42');
    wb.setInput(a, 0, 0, `=HYPERLINK("#${name}!A1","go")`);
    // The app's own link to a range on that sheet is written unquoted too.
    const url = wb.internalLinkFor(target, { r1: 1, c1: 1, r2: 2, c2: 2 });
    expect(url).toBe(`#${name}!B2:C3`);
    wb.setInput(a, 1, 0, `=HYPERLINK("${url}","range")`);
    expect(wb.resolveLink(wb.linkAt(a, 0, 0).url)).toEqual({ sheetId: target, range: { r1: 0, c1: 0, r2: 0, c2: 0 } });
    expect(wb.renameSheet(target, renamed)).toBe(true);
    expect(wb.getCell(a, 0, 0).f).toBe(`HYPERLINK("#${renamed}!A1","go")`);
    expect(wb.getCell(a, 1, 0).f).toBe(`HYPERLINK("#${renamed}!B2:C3","range")`);
    expect(wb.resolveLink(wb.linkAt(a, 0, 0).url)).toEqual({ sheetId: target, range: { r1: 0, c1: 0, r2: 0, c2: 0 } });
    expect(wb.resolveLink(wb.linkAt(a, 1, 0).url)).toEqual({ sheetId: target, range: { r1: 1, c1: 1, r2: 2, c2: 2 } });
    // A link to another sheet is left alone.
    wb.setInput(a, 2, 0, '=HYPERLINK("#Sheet1!A1","home")');
    wb.renameSheet(target, name);
    expect(wb.getCell(a, 2, 0).f).toBe('HYPERLINK("#Sheet1!A1","home")');
  });

  it('still rewrites quoted and ASCII names, and stays out of the link text', () => {
    const wb = new Workbook();
    const a = wb.activeSheetId;
    const spaced = wb.addSheet('my sheet').id;
    const plain = wb.addSheet('Two').id;
    wb.setInput(a, 0, 0, '=HYPERLINK("#\'my sheet\'!A1","see my sheet")');
    wb.setInput(a, 1, 0, '=HYPERLINK("#Two!A1","Two")');
    wb.renameSheet(spaced, 'Été');
    wb.renameSheet(plain, 'Deux');
    expect(wb.getCell(a, 0, 0).f).toBe('HYPERLINK("#Été!A1","see my sheet")');
    expect(wb.getCell(a, 1, 0).f).toBe('HYPERLINK("#Deux!A1","Two")');
    expect(wb.resolveLink(wb.linkAt(a, 0, 0).url)).toMatchObject({ sheetId: spaced });
  });
});
