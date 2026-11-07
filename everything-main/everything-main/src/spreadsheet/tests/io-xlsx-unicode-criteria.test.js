import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import * as X from '../src/vendor/xlsx.mjs';

async function external(wb) {
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
  const part = X.CFB.find(zip, '/xl/workbook.xml');
  part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  part.size = part.content.length;
  return workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'unicode-comparison.xlsx');
}

it('preserves literal criteria, typed errors, edits and copied formulas through native-only saves', async () => {
  let wb = new Workbook(), id = wb.activeSheetId;
  const inputs = ['Straße', 'STRASSE', 'ab', 'a\u200bb', 'ab\u200b', '#N/A'];
  for (const [r, v] of inputs.entries()) wb.setCells(id, [{ r, c: 0, cell: { v } }]);
  wb.setInput(id, 6, 0, '=NA()');
  const formulas = ['COUNTIF(A1:A7,"STRASSE")', 'COUNTIF(A1:A7,"ab")', 'COUNTIF(A1:A7,"#N/A")', 'COUNTIF(A1:A7,"#*")'];
  for (const [r, f] of formulas.entries()) wb.setInput(id, r, 1, '=' + f);
  const check = () => {
    expect([0, 1, 2, 3].map(r => wb.getValue(id, r, 1))).toEqual([2, 2, 1, 1]);
    for (const [r, f] of formulas.entries()) expect(wb.getCell(id, r, 1).f).toBe(f);
    for (const [r, v] of inputs.entries()) expect(wb.getValue(id, r, 0)).toBe(v);
  };
  check();
  for (let pass = 0; pass < 2; pass++) { wb = await external(wb); id = wb.activeSheetId; check(); }
  wb.setInput(id, 0, 0, 'STRASZE');
  expect(wb.getValue(id, 0, 1)).toBe(1);
  wb.undo(); check();
  wb.pasteCells(id, wb.copyRange(id, { r1: 0, c1: 0, r2: 6, c2: 1 }), 10, 0, { r: 0, c: 0 });
  wb = await external(wb); id = wb.activeSheetId;
  expect(wb.getCell(id, 10, 1).f).toBe('COUNTIF(A11:A17,"STRASSE")');
  expect([10, 11, 12, 13].map(r => wb.getValue(id, r, 1))).toEqual([2, 2, 1, 1]);
});
