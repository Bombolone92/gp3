import { describe, expect, it } from 'vitest';
import * as XLSX from '../src/vendor/xlsx.mjs';
import { workbookFromFile } from '../src/core/io.js';

const errors = [[0x00, '#NULL!'], [0x07, '#DIV/0!'], [0x0f, '#VALUE!'], [0x17, '#REF!'], [0x1d, '#NAME?'], [0x24, '#NUM!'], [0x2a, '#N/A']];

describe('spreadsheet error values', () => {
  it('imports error constants as errors and propagates them to dependent formulas', async () => {
    const book = XLSX.utils.book_new();
    const sheet = { '!ref': 'A1:B7', B1: { t: 'n', f: 'IFERROR(A1,42)', v: 42 } };
    errors.forEach(([code], r) => { sheet[`A${r + 1}`] = { t: 'e', v: code }; });
    XLSX.utils.book_append_sheet(book, sheet, 'Errors');
    const bytes = XLSX.write(book, { type: 'array', bookType: 'xlsx' });
    const wb = await workbookFromFile(bytes, 'errors.xlsx');
    const id = wb.sheets[0].id;
    errors.forEach(([, error], r) => {
      expect(wb.getValue(id, r, 0)).toEqual({ error });
      expect(wb.getDisplay(id, r, 0)).toBe(error);
    });
    expect(wb.getValue(id, 0, 1)).toBe(42);
  });


});
