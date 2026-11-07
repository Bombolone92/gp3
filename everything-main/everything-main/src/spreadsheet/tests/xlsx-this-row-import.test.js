import { expect, it } from 'vitest';
import { fromFileFormula, toFileFormula } from '../src/core/xlfn.js';
import { Workbook } from '../src/core/workbook.js';
import * as X from '../src/vendor/xlsx.mjs';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';

// Reopen only the native parts: the app's private metadata sheet is removed from the package.
async function nativeReopen(wb) {
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
  const part = X.CFB.find(zip, '/xl/workbook.xml');
  part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  part.size = part.content.length;
  return workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'native.xlsx');
}

it.each([
  ['Items[[#This Row],[Quantity]]*2', 'Items[@Quantity]*2'],
  ['T[[#This Row],[Unit price]]', 'T[@[Unit price]]'],
  ['T[[#This Row],[a.b]]+T[[#This Row],[Q2]]', 'T[@[a.b]]+T[@Q2]'],
  ['T[[#this row],[A]:[C]]', 'T[@[A]:[C]]'],
  ['T[ [#This Row] , [X] ]', 'T[@X]'],
  ['T[#This Row]', 'T[@]'],
  ['[[#This Row],[Amount]]', '[@Amount]'],
  ["T[[#This Row],['[Note']]]", "T[@['[Note']]]"],
  ['T[[#This Row],[Ünit]]', 'T[@Ünit]'],
  ['_xlfn.CONCAT(T[[#This Row],[X]],"x")', 'CONCAT(T[@X],"x")'],
])('reads the file spelling %s in its @ form', (file, shown) => {
  expect(fromFileFormula(file)).toBe(shown);
  // Written again, the formula takes the file spelling it came from (up to keyword case and spacing).
  expect(fromFileFormula(toFileFormula(shown))).toBe(shown);
});

it('leaves other selectors and text that only looks like a selector unchanged', () => {
  for (const f of ['SUM(T[[#Headers],[A]])', 'T[[#Data],[A]]', 'T[[#All],[A]:[B]]', 'T[[#Totals],[A]]', '"[#This Row]"&1', 'T[A]'])
    expect(fromFileFormula(f)).toBe(f);
});

it('shows Excel-saved row references with @ in cells and table templates after import', async () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  [['Qty', 'Unit price', 'Total'], [2, 5, null], [3, 7, null]].forEach((row, r) => row.forEach((v, c) => { if (v != null) wb.setInput(id, r, c, String(v)); }));
  wb.addTable(id, { r1: 0, c1: 0, r2: 2, c2: 2 }, { name: 'Lines' });
  wb.setInput(id, 1, 2, '=Lines[@Qty]*Lines[@[Unit price]]');
  const back = await nativeReopen(wb);
  const sheet = back.activeSheet;
  expect(back.getCell(sheet.id, 2, 2).f).toBe('Lines[@Qty]*Lines[@[Unit price]]');
  expect(sheet.tables[0].calc[2]).toBe('Lines[@Qty]*Lines[@[Unit price]]');
  expect(back.getValue(sheet.id, 2, 2)).toBe(21);
});
