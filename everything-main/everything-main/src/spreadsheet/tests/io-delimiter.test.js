import { describe, expect, it } from 'vitest';
import { detectDelimiter, workbookFromFile, sheetToCsv, sheetToTsv } from '../src/core/io.js';
import { Workbook } from '../src/core/workbook.js';

describe('delimiter detection for multiline fields', () => {
  it.each([',', ';', '\t', '|'])('ignores other separators inside quoted multiline fields (%s)', async (delimiter) => {
    const other = delimiter === ';' ? ',' : ';';
    const description = `first\none${other}two\nthree${other}four\nfive${other}six`;
    const source = `Name${delimiter}Description\nAlice${delimiter}"${description}"\n`;
    expect(detectDelimiter(source, 'data.csv')).toBe(delimiter);
    const wb = await workbookFromFile(new TextEncoder().encode(source), 'data.csv');
    expect(wb.getValue(wb.activeSheetId, 1, 0)).toBe('Alice');
    expect(wb.getValue(wb.activeSheetId, 1, 1)).toBe(description);
    expect(wb.activeSheet.cells.size).toBe(4);
  });

  it('samples complete records even when a quoted field spans more than 25 physical lines', () => {
    const source = `Name,Description\nAlice,"${'one;two\n'.repeat(30)}end"\nBob,plain\n`;
    expect(detectDelimiter(source)).toBe(',');
  });
});

it.each([['csv', sheetToCsv], ['tsv', sheetToTsv]])('preserves embedded CR and CRLF through %s export and import', async (extension, exportSheet) => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  const rows = [['Name', 'Notes'], ['Alice', 'First\r\nSecond'], ['Bob', 'One\rTwo']];
  wb.setCells(id, rows.flatMap((row, r) => row.map((v, c) => ({ r, c, cell: { v } }))));
  const back = await workbookFromFile(new TextEncoder().encode(exportSheet(wb, id)), `data.${extension}`);
  expect(rows.map((row, r) => row.map((_, c) => back.getValue(back.activeSheetId, r, c)))).toEqual(rows);
});
