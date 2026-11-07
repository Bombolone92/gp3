import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';

function setup() {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setCells(id, [['Cost', 'Cost ', ' Qty ', ' ', '  '], [10, 20, 30, 40, 50]]
    .flatMap((row, r) => row.map((v, c) => ({ r, c, cell: { v } }))));
  wb.addTable(id, { r1: 0, c1: 0, r2: 1, c2: 4 }, { name: 'Items' });
  ['Cost', 'Cost ', 'Qty', ' Cost', ' ', '  '].forEach((name, r) => wb.setInput(id, r, 7, `=SUM(Items[[${name}]])`));
  return wb;
}
const values = wb => Array.from({ length: 6 }, (_, r) => wb.getValue(wb.activeSheetId, r, 7));

it('prefers exact names, accepts unique old spellings and rejects ambiguous trimmed names through native export', async () => {
  let wb = setup();
  for (let pass = 0; pass < 2; pass++) {
    expect(values(wb)).toEqual([10, 20, 30, { error: '#REF!' }, 40, 50]);
    const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
    const part = X.CFB.find(zip, '/xl/workbook.xml');
    part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
    part.size = part.content.length;
    wb = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'external.xlsx');
  }
});

it('renames shorthand references without stealing exact or ambiguous references from other columns', () => {
  const wb = setup(), id = wb.activeSheetId;
  wb.defineName('QuantitySum', '=SUM(Items[Qty])');
  wb.setInput(id, 8, 7, '=QuantitySum');
  wb.setInput(id, 0, 0, 'Price');
  expect(wb.getCell(id, 0, 7).f).toContain('Price');
  expect(wb.getCell(id, 1, 7).f).toBe('SUM(Items[[Cost ]])');
  expect(wb.getCell(id, 3, 7).f).toBe('SUM(Items[[ Cost]])');
  wb.undo();
  wb.setInput(id, 0, 2, ' Quantity ');
  expect(wb.getCell(id, 2, 7).f).toBe('SUM(Items[[ Quantity ]])');
  expect(wb.getValue(id, 2, 7)).toBe(30);
  expect(wb.getValue(id, 8, 7)).toBe(30);
  wb.undo();
  // Formatting/batch writes use the same alias-aware rename mapping.
  wb.applyStyle(id, { r1: 0, c1: 2, r2: 0, c2: 2 }, { fmt: 'custom', code: '"New "@' });
  expect(wb.getCell(id, 2, 7).f).toBe('SUM(Items[[New  Qty ]])');
  expect(wb.getValue(id, 2, 7)).toBe(30);
  const range = { r1: 2, c1: 7, r2: 2, c2: 7 };
  wb.pasteCells(id, wb.copyRange(id, range), 2, 9, { r: 2, c: 7 });
  expect(wb.getValue(id, 2, 9)).toBe(30);
});

it('keeps shorthand references attached when deleting a header promotes a new one', () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  [' Qty ', 'Amount', '7'].forEach((v, r) => wb.setInput(id, r, 0, v));
  wb.addTable(id, { r1: 0, c1: 0, r2: 2, c2: 0 }, { name: 'Items' });
  wb.setInput(id, 5, 7, '=SUM(Items[Qty])');
  wb.deleteRows(id, 0, 1);
  expect(wb.getCell(id, 4, 7).f).toBe('SUM(Items[Amount])');
  expect(wb.getValue(id, 4, 7)).toBe(7);
  wb.undo();
  expect(wb.getCell(id, 5, 7).f).toBe('SUM(Items[Qty])');
  expect(wb.getValue(id, 5, 7)).toBe(7);
});
