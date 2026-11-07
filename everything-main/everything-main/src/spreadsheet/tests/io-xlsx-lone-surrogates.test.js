import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import * as X from '../src/vendor/xlsx.mjs';

const strings = ['\ud83d', '\ude00', 'a\ud83dX', '\ude00b', '\ud83d😀\ude00', '_xD83D_\ud83d', '\ud83d\ud83d', '\ude00\ude00'];

it.each([false, true])('writes lone surrogates as ST_Xstring escapes with shared strings = %s', bookSST => {
  const book = X.utils.book_new();
  X.utils.book_append_sheet(book, X.utils.aoa_to_sheet(strings.map(v => [v])), 'Text');
  const bytes = new Uint8Array(X.write(book, { type: 'array', bookType: 'xlsx', bookSST }));
  const raw = X.read(bytes), sheet = raw.Sheets.Text;
  strings.forEach((v, r) => expect(sheet[`A${r + 1}`].v).toBe(v));
  const zip = X.CFB.read(bytes, { type: 'array' });
  const xml = new TextDecoder().decode(X.CFB.find(zip, bookSST ? '/xl/sharedStrings.xml' : '/xl/worksheets/sheet1.xml').content);
  expect(xml).toContain('_xD83D_'); expect(xml).not.toContain('�');
});

it('round-trips Version 1 surrogate results, formula literals, and text without private metadata', async () => {
  let wb = new Workbook({ calculationCompatibility: { version: 1 } });
  const formulas = ['MID("😀",1,1)', 'MID("😀",2,1)', 'REPLACE("😀",2,1,"X")', ...strings.map(s => `"${s}"`)];
  const expected = ['\ud83d', '\ude00', '\ud83dX', ...strings];
  wb.setCells(wb.activeSheetId, formulas.map((f, r) => ({ r, c: 0, cell: { f } })));
  for (let round = 0; round < 2; round++) {
    const bytes = new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer());
    const raw = X.read(bytes), sheet = raw.Sheets[raw.SheetNames[0]];
    formulas.forEach((f, r) => { expect(sheet[`A${r + 1}`].f).toBe(f); expect(sheet[`A${r + 1}`].v).toBe(expected[r]); });
    const zip = X.CFB.read(bytes, { type: 'array' }), part = X.CFB.find(zip, '/xl/workbook.xml');
    part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, '')); part.size = part.content.length;
    wb = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'native.xlsx');
    expected.forEach((v, r) => expect(wb.getValue(wb.activeSheetId, r, 0)).toBe(v));
  }
});
