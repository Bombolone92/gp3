import { describe, expect, it } from 'vitest';
import * as XLSX from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookToXlsx } from '../src/core/io.js';

describe('exported error values', () => {
  it('writes valid Excel error codes for calculated and spilled errors', async () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    wb.setInput(id, 0, 0, '=1/0');
    wb.setInput(id, 0, 1, '=NA()');
    wb.setInput(id, 0, 2, '={1,#N/A}');
    wb.setCells(id, [{ r: 1, c: 0, cell: { v: { error: '#NULL!' }, f: null } }]);
    wb.setInput(id, 1, 1, '=B2'); // internal cycle errors fall back to #VALUE! in the file
    const back = XLSX.read(await (await workbookToXlsx(wb)).arrayBuffer());
    const sheet = back.Sheets[back.SheetNames[0]];
    expect(sheet.A1).toMatchObject({ t: 'e', v: 0x07, f: '1/0' });
    expect(sheet.B1).toMatchObject({ t: 'e', v: 0x2a, f: 'NA()' });
    expect(sheet.D1).toMatchObject({ t: 'e', v: 0x2a });
    expect(sheet.A2).toMatchObject({ t: 'e', v: 0x00 });
    expect(sheet.B2).toMatchObject({ t: 'e', v: 0x0f });
  });
});
