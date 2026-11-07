import { describe, expect, it } from 'vitest';
import * as XLSX from '../src/vendor/xlsx.mjs';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';

describe('imported hyperlinks', () => {
  it.each(['Go to data', '#Data!B2', ''])('keeps internal hyperlink targets with label %j', async (label) => {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, { '!ref': 'A1', A1: { t: 's', v: label, l: { Target: '#Data!B2' } } }, 'Index');
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['Data']]), 'Data');
    const wb = await workbookFromFile(XLSX.write(book, { type: 'array', bookType: 'xlsx' }), 'links.xlsx');
    const link = wb.linkAt(wb.activeSheetId, 0, 0);
    expect(link?.url).toBe('#Data!B2');
    expect(link.label).toBe(label || '#Data!B2');
    expect(wb.resolveLink(link.url)).toMatchObject({ sheetId: wb.sheetByName('Data').id, range: { r1: 1, c1: 1, r2: 1, c2: 1 } });
    const back = await workbookFromFile(await workbookToXlsx(wb), 'links.xlsx');
    expect(back.linkAt(back.activeSheetId, 0, 0)?.url).toBe('#Data!B2');
  });
});
