import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';

function fixture() {
  const sheet = { '!ref': 'A1:J8', A4: { t: 'n', v: 10 }, A5: { t: 'n', v: 20 }, A6: { t: 'n', v: 30 } };
  for (const [addr, f, flags] of [
    ['C1', 'OFFSET($A$4,,,3)', {}], ['C5', 'OFFSET($A$4,,,3)', {}],
    ['D5', 'INDIRECT("A4:A6")', {}], ['E5', 'INDEX(A4:A6,0)', {}],
    ['F1', 'SUM(OFFSET($A$4,,,3))', {}],
    ['G1', 'OFFSET($A$4,,,3)', { F: 'G1:G3' }],
    ['H1', 'OFFSET($A$4,,,3)', { F: 'H1', D: true }],
    ['I1', 'OFFSET($A$4,,,3)', { F: 'I1' }],
    ['J1', 'OFFSET($A$4,,,3)', { D: true }],
  ]) sheet[addr] = { t: 'n', v: 0, f, ...flags };
  const book = X.utils.book_new(); X.utils.book_append_sheet(book, sheet, 'Data');
  book.Workbook = { Names: [{ Name: 'Values', Ref: 'OFFSET(Data!$A$4,,,3)' }] };
  return X.write(book, { type: 'array', bookType: 'xlsx' });
}

async function external(wb) {
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
  const part = X.CFB.find(zip, '/xl/workbook.xml');
  part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  part.size = part.content.length;
  return X.CFB.write(zip, { type: 'array', fileType: 'zip' });
}

it('intersects legacy reference results at the caller and leaves explicit arrays and names intact', async () => {
  let wb = await workbookFromFile(fixture(), 'legacy.xlsx');
  for (let pass = 0; pass < 2; pass++) {
    const id = wb.activeSheetId;
    expect(wb.getCell(id, 0, 2).f).toBe(pass ? 'SINGLE(OFFSET($A$4,,,3))' : '@OFFSET($A$4,,,3)');
    expect(wb.getValue(id, 0, 2)).toEqual({ error: '#VALUE!' });
    for (const c of [2, 3, 4]) expect(wb.getValue(id, 4, c)).toBe(20);
    expect(wb.getValue(id, 0, 5)).toBe(60);
    for (const c of [6, 7, 9]) expect([0, 1, 2].map(r => wb.getValue(id, r, c))).toEqual([10, 20, 30]);
    expect(wb.getCell(id, 0, 8).f).toBe('OFFSET($A$4,,,3)');
    expect(wb.names[0].ref).toBe('OFFSET(Data!$A$4,,,3)');
    wb = await workbookFromFile(await external(wb), 'native.xlsx');
  }
});

it('keeps authored reference formulas dynamic after native export, including blocked and one-cell results', async () => {
  let wb = new Workbook(); const id = wb.activeSheetId;
  wb.setInput(id, 3, 0, '10'); wb.setInput(id, 4, 0, '20'); wb.setInput(id, 0, 1, '1');
  wb.setInput(id, 0, 2, '=OFFSET($A$4,,,$B$1)');
  wb.setInput(id, 0, 3, '=INDIRECT("A4:A5")'); wb.setInput(id, 1, 3, 'blocked');
  wb.setInput(id, 0, 4, '=INDEX(A4:A5,0)'); wb.setInput(id, 1, 4, 'blocked');
  const bytes = await external(wb), native = X.read(bytes, { type: 'array' }).Sheets.Sheet1;
  for (const a of ['C1', 'D1', 'E1']) expect(native[a]).toMatchObject({ D: true, F: a });
  wb = await workbookFromFile(bytes, 'dynamic.xlsx'); const sid = wb.activeSheetId;
  expect(wb.getValue(sid, 0, 2)).toBe(10);
  for (const c of [3, 4]) expect(wb.getValue(sid, 0, c)).toEqual({ error: '#SPILL!' });
  wb.setInput(sid, 0, 1, '2'); expect(wb.getValue(sid, 1, 2)).toBe(20);
  wb.undo(); expect(wb.getValue(sid, 1, 2)).toBeNull();
  wb.pasteCells(sid, wb.copyRange(sid, { r1: 0, c1: 2, r2: 0, c2: 2 }), 0, 5, { r: 0, c: 2 });
  expect(wb.getCell(sid, 0, 5).f).toBe('OFFSET($A$4,,,$B$1)');
  expect(wb.getValue(sid, 0, 5)).toBe(10);
});
