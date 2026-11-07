import { afterEach, describe, expect, it, vi } from 'vitest';
import * as XLSX from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookToXlsx } from '../src/core/io.js';
import * as nativeExport from '../src/core/xlsx-export.js';

afterEach(() => vi.restoreAllMocks());

describe('saving layout on tall imported worksheets', () => {
  it.each(['hiddenRows', 'rowHeights'])('exports 200,000 %s entries without exceeding the argument limit', async (kind) => {
    const count = 200_000;
    const indices = Array.from({ length: count }, (_, i) => i);
    const wb = new Workbook({ sheets: [{
      name: 'Tall', rows: count, cells: { '0,0': { v: 42 } },
      [kind]: kind === 'hiddenRows' ? indices : Object.fromEntries(indices.map((i) => [i, 30])),
    }] });
    // Inspect the worksheet passed to the existing file writer without
    // compressing hundreds of thousands of row records in this boundary test.
    vi.spyOn(nativeExport, 'completeXlsx').mockImplementation(async (_X, _wb, _book, bytes) => bytes);
    const write = vi.spyOn(XLSX, 'write').mockImplementation((book) => {
      expect(book.Sheets.Tall.A1.v).toBe(42);
      const rows = book.Sheets.Tall['!rows'];
      expect(rows).toHaveLength(count);
      expect(rows[count - 1]).toMatchObject(kind === 'hiddenRows' ? { hidden: true } : { hpt: 22.5 });
      return new Uint8Array();
    });
    await workbookToXlsx(wb);
    expect(write).toHaveBeenCalledOnce();
  });
});
