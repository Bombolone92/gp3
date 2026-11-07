import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';

function setup() {
  const wb = new Workbook(), source = wb.activeSheetId;
  wb.renameSheet(source, 'Lead data');
  wb.setCells(source, [['Lead', 'Amount'], ['A', 100], ['B', 200], ['C', 300]]
    .flatMap((row, r) => row.map((v, c) => ({ r, c, cell: { v } }))));
  wb.addTable(source, { r1: 0, c1: 0, r2: 3, c2: 1 }, { name: 'Leads' });
  const target = wb.addSheet('Forecast').id;
  for (let r = 0; r < 5; r++) {
    wb.setInput(target, r, 0, '=Leads[@Lead]');
    wb.setInput(target, r, 1, '=Leads[[#This Row],[Amount]]*2');
  }
  return { wb, source, target };
}
const values = (wb, id) => [1, 2, 3].map(r => [wb.getValue(id, r, 0), wb.getValue(id, r, 1)]);

it('intersects an explicitly named table on the caller row across worksheets and follows edits and copies', () => {
  const { wb, source, target } = setup();
  expect(values(wb, target)).toEqual([['A', 200], ['B', 400], ['C', 600]]);
  for (const r of [0, 4]) expect(wb.getValue(target, r, 0)).toEqual({ error: '#VALUE!' });
  wb.setInput(source, 2, 1, '250');
  expect(wb.getValue(target, 2, 1)).toBe(500);
  wb.undo();
  expect(wb.getValue(target, 2, 1)).toBe(400);
  wb.pasteCells(target, wb.copyRange(target, { r1: 1, c1: 1, r2: 1, c2: 1 }), 3, 3, { r: 1, c: 1 });
  expect(wb.getValue(target, 3, 3)).toBe(600);
  expect(wb.getCell(target, 3, 3).f).toBe('Leads[[#This Row],[Amount]]*2');
  expect(wb.structuredToA1(target, 3, 3, wb.getCell(target, 3, 3).f)).toBe("'Lead data'!$B$4*2");
});

it('preserves cross-sheet table row references in native XLSX', async () => {
  const { wb, target } = setup(), bytes = await (await workbookToXlsx(wb)).arrayBuffer();
  const raw = X.read(bytes, { type: 'array' });
  expect(raw.Sheets.Forecast.B3.f).toBe('Leads[[#This Row],[Amount]]*2');
  expect(raw.Sheets.Forecast.B3.v).toBe(400);
  const own = await workbookFromFile(bytes, 'own.xlsx');
  expect(values(own, own.sheetByName('Forecast').id)).toEqual(values(wb, target));
  const zip = X.CFB.read(new Uint8Array(bytes), { type: 'array' }), part = X.CFB.find(zip, '/xl/workbook.xml');
  part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  part.size = part.content.length;
  const external = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'external.xlsx');
  expect(values(external, external.sheetByName('Forecast').id)).toEqual(values(wb, target));
});
