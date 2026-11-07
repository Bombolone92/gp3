import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { JSDOM } from 'jsdom';
import { Workbook } from '../src/core/workbook.js';
import { parseTableSpec, renderTableSpec } from '../src/core/tables.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';

const headers = ['Cost', 'Cost ', ' ', '  ', 'Forecast\nclose', ' Forecast'];
function setup() {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setCells(id, [headers, [10, 20, 30, 40, 50, 60], [1, 2, 3, 4, 5, 6]]
    .flatMap((row, r) => row.map((v, c) => ({ r, c, cell: { v } }))));
  wb.applyStyle(id, { r1: 0, c1: 0, r2: 0, c2: 5 }, { fmt: 'custom', code: '0;0;0;_(@_)' });
  wb.addTable(id, { r1: 0, c1: 0, r2: 2, c2: 5 }, { name: 'Costs' });
  headers.forEach((name, r) => wb.setInput(id, r, 8, `=SUM(Costs[[${name}]])`));
  return wb;
}
const values = wb => headers.map((_, r) => wb.getValue(wb.activeSheetId, r, 8));

it('preserves whitespace inside column names while allowing spacing between specifiers', () => {
  for (const name of headers) {
    const spec = { rows: 'data', cols: [name, name] };
    expect(parseTableSpec(renderTableSpec(spec))).toEqual(spec);
    expect(parseTableSpec(name)).toEqual(spec);
    expect(parseTableSpec(` [#Totals], [${name}] `)).toEqual({ ...spec, rows: 'totals' });
  }
  expect(parseTableSpec(' [Forecast\nclose] : [ Forecast] ')).toEqual({ rows: 'data', cols: ['Forecast\nclose', ' Forecast'] });
  expect(parseTableSpec('@[  ]')).toEqual({ rows: 'this', cols: ['  ', '  '] });
  expect(parseTableSpec('')).toEqual({ rows: 'data', cols: null });
});

it('keeps distinct whitespace headers through creation, rename, undo and formula copy', () => {
  const wb = setup(), id = wb.activeSheetId;
  expect(wb.tableColumns(id, wb.sheet(id).tables[0])).toEqual(headers);
  expect(values(wb)).toEqual([11, 22, 33, 44, 55, 66]);
  wb.setInput(id, 0, 1, 'Revenue ');
  expect(wb.getCell(id, 1, 8).f).toBe('SUM(Costs[[Revenue ]])');
  expect(wb.getCell(id, 0, 8).f).toBe('SUM(Costs[[Cost]])');
  expect(values(wb)).toEqual([11, 22, 33, 44, 55, 66]);
  wb.undo();
  expect(wb.tableColumns(id, wb.sheet(id).tables[0])).toEqual(headers);
  wb.pasteCells(id, wb.copyRange(id, { r1: 0, c1: 8, r2: 5, c2: 8 }), 0, 10, { r: 0, c: 8 });
  expect(headers.map((_, r) => wb.getValue(id, r, 10))).toEqual(values(wb));
  const copied = wb.copyRange(id, { r1: 0, c1: 0, r2: 2, c2: 5 });
  wb.pasteCells(id, copied, 10, 0, { r: 0, c: 0 });
  wb.addTable(id, { r1: 10, c1: 0, r2: 12, c2: 5 }, { name: 'Pasted' });
  expect(wb.tableColumns(id, wb.tableByName('Pasted').table)).toEqual(headers);
});

it('exports distinct native table headers and correct formulas without private metadata', async () => {
  let wb = setup();
  for (let pass = 0; pass < 2; pass++) {
    const bytes = await (await workbookToXlsx(wb)).arrayBuffer();
    const own = await workbookFromFile(bytes, 'own.xlsx');
    expect(values(own)).toEqual([11, 22, 33, 44, 55, 66]);
    const zip = X.CFB.read(new Uint8Array(bytes), { type: 'array' });
    const xml = new TextDecoder().decode(X.CFB.find(zip, '/xl/tables/table1.xml').content);
    const dom = new JSDOM(xml, { contentType: 'text/xml' });
    // ST_Xstring attribute line feeds are escaped before XML serialization.
    expect([...dom.window.document.querySelectorAll('tableColumn')].map(c => c.getAttribute('name'))).toEqual(headers.map(value => value.replace(/\n/g, '_x000A_')));
    dom.window.close();
    const part = X.CFB.find(zip, '/xl/workbook.xml');
    part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
    part.size = part.content.length;
    wb = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'external.xlsx');
    expect(values(wb)).toEqual([11, 22, 33, 44, 55, 66]);
    expect(wb.tableColumns(wb.activeSheetId, wb.sheets[0].tables[0])).toEqual(headers);
    wb.setInput(wb.activeSheetId, 7, 8, '=SUM(Costs[[  ]])');
    expect(wb.getValue(wb.activeSheetId, 7, 8)).toBe(44);
  }
});

it.each([
  ['0;0;0;_(@_)', ' Qty '],
  ['0;0;0;" _* "@', ' _*  Qty '],
  ['0;0;0;\\_@\\*', '_ Qty *'],
  ['0;0;0;_("Total "@_)', 'Total  Qty '],
])('keeps literal header characters while ignoring padding in %s', async (code, expected) => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setInput(id, 0, 0, ' Qty ');
  wb.setInput(id, 1, 0, '7');
  wb.addTable(id, { r1: 0, c1: 0, r2: 1, c2: 0 }, { name: 'Items' });
  wb.setInput(id, 0, 2, '=SUM(Items[[ Qty ]])');
  wb.applyStyle(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, { fmt: 'custom', code });
  expect(wb.tableColumns(id, wb.activeSheet.tables[0])).toEqual([expected]);
  expect(wb.getValue(id, 0, 2)).toBe(7);
  const saved = new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer());
  const zip = X.CFB.read(saved, { type: 'array' }), part = X.CFB.find(zip, '/xl/workbook.xml');
  part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  part.size = part.content.length;
  const back = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'external.xlsx');
  expect(back.tableColumns(back.activeSheetId, back.activeSheet.tables[0])).toEqual([expected]);
  expect(back.getValue(back.activeSheetId, 0, 2)).toBe(7);
  wb.undo();
  expect(wb.tableColumns(id, wb.activeSheet.tables[0])).toEqual([' Qty ']);
  expect(wb.getValue(id, 0, 2)).toBe(7);
});
