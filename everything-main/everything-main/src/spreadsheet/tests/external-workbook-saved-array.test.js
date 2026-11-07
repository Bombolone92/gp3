import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx, workbookToOds } from '../src/core/io.js';
import * as X from '../src/vendor/xlsx.mjs';

const f = "'[1]Data'!$D$4:$E$5";
async function imported(dynamic = false) {
  const original = new Workbook({ externalWorkbooks: { version: 1, books: [{ target: '/Source.xlsx', sheets: [{ name: 'Data', cells: null }] }] },
    sheets: [{ name: 'Report', cells: { '1,1': { f, ...(!dynamic ? { array: { rows: 2, cols: 2 } } : {}) } } }] });
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(original)).arrayBuffer()), { type: 'array' });
  const get = path => new TextDecoder().decode(X.CFB.find(zip, path).content);
  X.CFB.utils.cfb_add(zip, '/xl/workbook.xml', new TextEncoder().encode(get('/xl/workbook.xml').replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, '')));
  const sheet = get('/xl/worksheets/sheet1.xml').replace(/<sheetData>[\s\S]*?<\/sheetData>/,
    `<sheetData><row r="2"><c r="B2"${dynamic ? ' cm="1"' : ''}><f t="array" ref="B2:C3">${f}</f><v>11</v></c><c r="C2"><v>12</v></c></row><row r="3"><c r="B3"><v>21</v></c><c r="C3"><v>22</v></c></row></sheetData>`);
  X.CFB.utils.cfb_add(zip, '/xl/worksheets/sheet1.xml', new TextEncoder().encode(sheet));
  return workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }));
}
const values = wb => wb.rangeValues(wb.activeSheetId, { r1: 1, c1: 1, r2: 2, c2: 2 });
it.each([false, true])('retains the saved output block of an unavailable external array (dynamic=%s)', async dynamic => {
  const wb = await imported(dynamic);
  expect(values(wb)).toEqual([[11, 12], [21, 22]]);
  expect(wb.getCell(wb.activeSheetId, 1, 1).array).toEqual(dynamic ? undefined : { rows: 2, cols: 2 });
  const restored = new Workbook(wb.toJSON());
  expect(values(restored)).toEqual([[11, 12], [21, 22]]);
  const reopened = await workbookFromFile(await workbookToXlsx(restored));
  expect(values(reopened)).toEqual([[11, 12], [21, 22]]);
});
it.each([false, true])('copies the complete cached array and restores it with undo/redo (dynamic=%s)', async dynamic => {
  const source = await imported(dynamic), copy = source.sheetToWorkbook(source.activeSheetId);
  expect(values(copy)).toEqual([[11, 12], [21, 22]]);
  const id = source.activeSheetId;
  source.pasteCells(id, source.copyCells(id, [1, 2], [1, 2]), 5, 4, { r: 1, c: 1 });
  const range = { r1: 5, c1: 4, r2: 6, c2: 5 };
  expect(source.rangeValues(id, range)).toEqual([[11, 12], [21, 22]]);
  source.undo(); expect(source.getCell(id, 5, 4)).toBeFalsy();
  source.redo(); expect(source.rangeValues(id, range)).toEqual([[11, 12], [21, 22]]);
});
it('protects fixed cached array interiors against independent edits', async () => {
  const wb = await imported(), id = wb.activeSheetId;
  wb.setInput(id, 2, 2, '999');
  expect(values(wb)).toEqual([[11, 12], [21, 22]]);
  expect(wb.getCell(id, 2, 2)?.v ?? null).toBeNull();
});
it('applies ordinary spill collisions to a saved dynamic output block', async () => {
  const wb = await imported(true), id = wb.activeSheetId;
  wb.setInput(id, 2, 2, '999');
  expect(wb.getValue(id, 1, 1)).toEqual({ error: '#SPILL!' });
  wb.undo(); expect(values(wb)).toEqual([[11, 12], [21, 22]]);
});
it.each([false, true])('recalculates array outputs when supporting data becomes available (dynamic=%s)', async dynamic => {
  const wb = await imported(dynamic), json = wb.toJSON();
  json.externalWorkbooks.books[0].sheets[0].cells = { '3,3': 101, '3,4': 102, '4,3': 201, '4,4': 202 };
  const restored = new Workbook(json);
  expect(values(restored)).toEqual([[101, 102], [201, 202]]);
});
it.each([false, true])('retains array extent and each native cached value without private metadata (dynamic=%s)', async dynamic => {
  let wb = await imported(dynamic);
  for (let cycle = 0; cycle < 2; cycle++) {
    const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
    const get = path => new TextDecoder().decode(X.CFB.find(zip, path).content);
    expect(get('/xl/worksheets/sheet1.xml')).toMatch(/<f[^>]*ref="B2:C3"/);
    X.CFB.utils.cfb_add(zip, '/xl/workbook.xml', new TextEncoder().encode(get('/xl/workbook.xml').replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, '')));
    wb = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }));
    expect(values(wb)).toEqual([[11, 12], [21, 22]]);
    expect(wb.getCell(wb.activeSheetId, 1, 1).array).toEqual(dynamic ? undefined : { rows: 2, cols: 2 });
  }
});
it('keeps a large sparse fixed output sparse and readable at its far corner', () => {
  const rows = 900000, cols = 10000;
  const wb = new Workbook({ externalWorkbooks: { version: 1, books: [{ target: '/Source.xlsx', sheets: [{ name: 'Data', cells: null }] }] },
    sheets: [{ name: 'Report', rows, cols, cells: { '0,0': { f, array: { rows, cols },
      externalResult: { formula: f, value: 3, array: { rows, cols, cells: { '899999,9999': 8 } } } } } }] });
  expect(wb.getValue(wb.activeSheetId, rows - 1, cols - 1)).toBe(8);
  expect(wb.getValue(wb.activeSheetId, rows - 2, cols - 1)).toBe(0);
  expect(Object.keys(wb.toJSON().sheets[0].cells)).toEqual(['0,0']);
});
it('applies the evaluator output budget before expanding a saved dynamic array', () => {
  const wb = new Workbook({ externalWorkbooks: { version: 1, books: [{ target: '/Source.xlsx', sheets: [{ name: 'Data', cells: null }] }] },
    sheets: [{ name: 'Report', cells: { '0,0': { f, externalResult: { formula: f, value: 3,
      array: { rows: 2001, cols: 2000, cells: {} } } } } }] });
  expect(wb.getValue(wb.activeSheetId, 0, 0)).toEqual({ error: '#NUM!' });
});
it.each([
  { rows: 0, cols: 2, cells: {} },
  { rows: 2, cols: 2, cells: { '2,1': 3 } },
  { rows: 2, cols: 2, cells: { '0,0': 99 } },
  { rows: 2, cols: 2, cells: { '1,1': Infinity } },
  { rows: 2, cols: 2, cells: [] },
])('rejects malformed saved array metadata: %j', array => {
  const wb = new Workbook({ externalWorkbooks: { version: 1, books: [{ target: '/Source.xlsx', sheets: [{ name: 'Data', cells: null }] }] },
    sheets: [{ name: 'Report', cells: { '0,0': { f, externalResult: { formula: f, value: 3, array } } } }] });
  expect(wb.getCell(wb.activeSheetId, 0, 0).externalResult).toBeUndefined();
  expect(wb.getValue(wb.activeSheetId, 0, 0)).toEqual({ error: '#REF!' });
});

it.each([false, true])('exports each unavailable array value to ODS (dynamic=%s)', async dynamic => {
  const wb = await imported(dynamic);
  const reopened = await workbookFromFile(await workbookToOds(wb), 'array.ods');
  expect(values(reopened)).toEqual([[11, 12], [21, 22]]);
});
