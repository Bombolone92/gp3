import { afterEach, describe, it, expect } from 'vitest';
import { Workbook, MAX_COLS } from '../src/core/workbook.js';
import { MAX_COL } from '../src/core/refs.js';
import { workbookFromFile, workbookToOds, workbookToXlsx, detectDelimiter, sheetToCsv } from '../src/core/io.js';
import { toFileFormula, fromFileFormula } from '../src/core/xlfn.js';
import { setLocale } from '../src/core/format.js';

afterEach(() => setLocale('en-US'));

describe('CSV delimiter with comma decimals', () => {
  // Every line of "1,5;2,5" has one comma and one semicolon; the tie used to go
  // to the comma, splitting decimals in half. The locale's separator wins now.
  it('re-imports what the app exported in a comma-decimal locale', async () => {
    setLocale('de-DE');
    const wb = new Workbook();
    const id = wb.activeSheetId;
    [['1,5', '2,5'], ['3,5', '4,5']].forEach((row, r) => row.forEach((v, c) => wb.setInput(id, r, c, v)));
    expect(wb.getValue(id, 0, 0)).toBe(1.5);
    const csv = sheetToCsv(wb, id);
    expect(detectDelimiter(csv)).toBe(';');
    const back = await workbookFromFile(new TextEncoder().encode(csv), 'data.csv');
    expect([0, 1].map((c) => back.getValue(back.activeSheetId, 0, c))).toEqual([1.5, 2.5]);
  });

  it('still reads ordinary comma CSV, and semicolons where they clearly win', () => {
    expect(detectDelimiter('a,b,c\n1,2,3\n')).toBe(',');
    expect(detectDelimiter('a;b;c\n1;2;3\n')).toBe(';');
    setLocale('de-DE');
    expect(detectDelimiter('a,b,c\n1,2,3\n')).toBe(',');
  });
});

describe('ODS export', () => {
  it('keeps a merge whose top-left cell is empty', async () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.mergeCells(id, { r1: 0, c1: 0, r2: 1, c2: 1 });
    wb.setInput(id, 0, 0, 'Title');
    wb.mergeCells(id, { r1: 3, c1: 0, r2: 4, c2: 1 });
    const back = await workbookFromFile(await workbookToOds(wb), 'merges.ods');
    expect(back.sheet(back.activeSheetId).merges).toEqual([{ r1: 0, c1: 0, r2: 1, c2: 1 }, { r1: 3, c1: 0, r2: 4, c2: 1 }]);
  });
});

describe('future functions in files', () => {
  it('keeps the _xlfn. prefix Excel needs on the newer functions', () => {
    for (const name of ['REGEXEXTRACT', 'REGEXREPLACE', 'STOCKHISTORY', 'FORECAST.ETS.CONFINT', 'IMTAN']) {
      const file = toFileFormula(`${name}(A1)`);
      expect(file).toBe(`_xlfn.${name}(A1)`);
      expect(fromFileFormula(file)).toBe(`${name}(A1)`);
    }
  });
});

describe('a very wide text import', () => {
  it('stays within the grid and still saves', async () => {
    // A row as wide as the grid imports whole; past the grid's last column (XFD) it is cut.
    const wide = Array.from({ length: MAX_COLS }, (_, i) => `c${i}`).join(',');
    const wb = await workbookFromFile(new TextEncoder().encode(`${wide}\n${wide}\n`), 'wide.csv');
    const id = wb.activeSheetId;
    expect(wb.sheet(id).cols).toBe(MAX_COL + 1);
    expect(wb.getValue(id, 1, MAX_COLS - 1)).toBe(`c${MAX_COLS - 1}`);
    await expect(workbookToXlsx(wb)).resolves.toBeTruthy();
    const beyond = Array.from({ length: MAX_COL + 5 }, (_, i) => `d${i}`).join(',');
    const cut = await workbookFromFile(new TextEncoder().encode(`${beyond}\n`), 'beyond.csv');
    expect(cut.sheet(cut.activeSheetId).cols).toBe(MAX_COL + 1);
    expect(cut.getValue(cut.activeSheetId, 0, MAX_COL)).toBe(`d${MAX_COL}`);
    await expect(workbookToXlsx(cut)).resolves.toBeTruthy();
  });
});
