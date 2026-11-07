import { expect, it } from 'vitest';
import * as XLSX from '../src/vendor/xlsx.mjs';

it.each(['0%', '0.0%', '0.00%', '0.000%', '#,##0%', '#,##0.0%', '#,##0.00%', '#,##0.000%'])('preserves ODS percentage code %s', (code) => {
  const sheet = XLSX.utils.aoa_to_sheet([[{ t: 'n', v: 1234.567, z: code }]]);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Percent');
  const back = XLSX.read(XLSX.write(book, { type: 'array', bookType: 'ods' }), { type: 'array', cellNF: true });
  expect(back.Sheets.Percent.A1.z).toBe(code);
  expect(back.Sheets.Percent.A1.v).toBe(1234.567);
});
