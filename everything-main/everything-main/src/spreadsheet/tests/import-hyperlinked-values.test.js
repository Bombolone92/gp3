import { expect, it } from 'vitest';
import * as XLSX from '../src/vendor/xlsx.mjs';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';

function linkedFile() {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, {
    '!ref': 'A1:B6',
    A1: { t: 'n', v: 2, l: { Target: 'https://x.test/n' } },
    A2: { t: 'n', v: 45000, z: 'yyyy-mm-dd', l: { Target: 'https://x.test/d' } },
    A3: { t: 'b', v: true, l: { Target: 'https://x.test/b' } },
    A4: { t: 'n', v: 4, f: 'A1*2', l: { Target: 'https://x.test/f' } },
    A5: { t: 's', v: 'Docs', l: { Target: 'https://x.test/s' } },
    A6: { t: 'n', v: 3, f: 'A1+1', F: 'A6:A6', l: { Target: 'https://x.test/a' } },
    B1: { t: 'n', v: 0, f: 'SUM(A1:A4)' },
  }, 'Data');
  return XLSX.write(book, { type: 'array', bookType: 'xlsx' });
}

function expectLinkedValues(wb) {
  const id = wb.sheetByName('Data').id;
  expect(wb.getValue(id, 0, 0)).toBe(2);
  expect(wb.linkAt(id, 0, 0)?.url).toBe('https://x.test/n');
  // A hyperlinked date stays a date: a serial with its format, not the text "45000".
  expect(wb.getValue(id, 1, 0)).toBe(45000);
  expect(wb.getCell(id, 1, 0).s?.fmt).toBe('date');
  expect(wb.getDisplay(id, 1, 0)).toMatch(/2023/);
  expect(wb.linkAt(id, 1, 0)?.url).toBe('https://x.test/d');
  expect(wb.getValue(id, 2, 0)).toBe(true);
  expect(wb.linkAt(id, 2, 0)?.url).toBe('https://x.test/b');
  // A formula cell keeps both its formula and its link.
  expect(wb.getValue(id, 3, 0)).toBe(4);
  expect(wb.linkAt(id, 3, 0)?.url).toBe('https://x.test/f');
  expect(wb.getValue(id, 4, 0)).toBe('Docs');
  expect(wb.linkAt(id, 4, 0)?.url).toBe('https://x.test/s');
  // Linked numbers still add up.
  expect(wb.getValue(id, 0, 1)).toBe(45006);
}

it('keeps the type of hyperlinked numbers, dates, booleans and formulas', async () => {
  const wb = await workbookFromFile(linkedFile(), 'links.xlsx');
  const id = wb.sheetByName('Data').id;
  expect(wb.getCell(id, 0, 0)).toMatchObject({ v: 2, f: null, hyperlink: 'https://x.test/n' });
  expect(wb.getCell(id, 2, 0)).toMatchObject({ v: true, f: null, hyperlink: 'https://x.test/b' });
  expect(wb.getCell(id, 3, 0)).toMatchObject({ f: 'A1*2', hyperlink: 'https://x.test/f' });
  expect(wb.getCell(id, 4, 0)).toMatchObject({ v: 'Docs', f: null, hyperlink: 'https://x.test/s' });
  // An array formula is left as it is: wrapping it would change what it spills.
  expect(wb.getCell(id, 5, 0).f).toBe('A1+1');
  expect(wb.linkAt(id, 5, 0)?.url).toBe('https://x.test/a');
  expect(wb.getValue(id, 5, 0)).toBe(3);
  expectLinkedValues(wb);
});

it('round-trips hyperlinked values without wrapping them twice', async () => {
  let wb = await workbookFromFile(linkedFile(), 'links.xlsx');
  for (let round = 0; round < 2; round++) {
    wb = await workbookFromFile(await workbookToXlsx(wb), 'saved.xlsx');
    const id = wb.sheetByName('Data').id;
    expect(wb.getCell(id, 0, 0)).toMatchObject({ v: 2, f: null, hyperlink: 'https://x.test/n' });
    expect(wb.getCell(id, 3, 0)).toMatchObject({ f: 'A1*2', hyperlink: 'https://x.test/f' });
    expectLinkedValues(wb);
  }
});
