import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx, workbookToOds } from '../src/core/io.js';
import * as X from '../src/vendor/xlsx.mjs';

const formula = "'[1]Data'!$B$2";
async function imported(value = 77) {
  const wb = new Workbook({ externalWorkbooks: { version: 1, books: [{ target: '/Source.xlsx', sheets: [{ name: 'Data', cells: null }] }] },
    sheets: [{ name: 'Report', cells: { '0,0': { f: formula } } }] });
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
  const type = typeof value === 'boolean' ? 'b' : value?.error ? 'e' : typeof value === 'string' ? 'str' : 'n';
  const text = String(value?.error ?? (typeof value === 'boolean' ? Number(value) : value)).replaceAll('&', '&amp;').replaceAll('<', '&lt;');
  const cached = value == null ? '' : `<v>${text}</v>`;
  const get = path => new TextDecoder().decode(X.CFB.find(zip, path).content);
  X.CFB.utils.cfb_add(zip, '/xl/workbook.xml', new TextEncoder().encode(get('/xl/workbook.xml').replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, '')));
  X.CFB.utils.cfb_add(zip, '/xl/worksheets/sheet1.xml', new TextEncoder().encode(get('/xl/worksheets/sheet1.xml')
    .replace(/<c\b[^>]*r="A1"[^>]*>[\s\S]*?<\/c>/, `<c r="A1" t="${type}"><f>${formula}</f>${cached}</c>`)));
  return workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }));
}
it('retains a valid linked formula and saved result through model serialization and sheet copying', async () => {
  const source = await imported();
  for (const wb of [source, new Workbook(source.toJSON()), source.sheetToWorkbook(source.activeSheetId)]) {
    expect(wb.getCell(wb.activeSheetId, 0, 0).f).toBe(formula);
    expect(wb.getValue(wb.activeSheetId, 0, 0)).toBe(77);
    const reopened = await workbookFromFile(await workbookToXlsx(wb));
    expect(reopened.getCell(reopened.activeSheetId, 0, 0).f).toBe(formula);
    expect(reopened.getValue(reopened.activeSheetId, 0, 0)).toBe(77);
  }
});
it('keeps saved results with edits and undo, but never applies them to a changed formula', async () => {
  const wb = await imported(), id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '88'); expect(wb.getValue(id, 0, 0)).toBe(88);
  wb.undo(); expect(wb.getCell(id, 0, 0).f).toBe(formula); expect(wb.getValue(id, 0, 0)).toBe(77);
  wb.redo(); expect(wb.getCell(id, 0, 0).f).toBeNull();
  wb.undo(); wb.setInput(id, 0, 0, '=[1]Data!$B$3');
  expect(wb.getValue(id, 0, 0)).toEqual({ error: '#REF!' });
});
it('uses supporting data when available instead of the saved whole-formula result', async () => {
  const wb = await imported();
  const json = wb.toJSON(); json.externalWorkbooks.books[0].sheets[0].cells = { '1,1': 12 };
  const restored = new Workbook(json);
  expect(restored.getValue(restored.activeSheetId, 0, 0)).toBe(12);
});
it('preserves saved results when link indexes change during whole-sheet transfers', async () => {
  const source = await imported();
  const target = new Workbook({ externalWorkbooks: { version: 1, books: [{ target: '/Other.xlsx', sheets: [{ name: 'Data', cells: { '1,1': 999 } }] }] } });
  const id = target.importSheets(source)[0].id;
  expect(target.getCell(id, 0, 0).f).toContain('[2]Data');
  expect(target.getValue(id, 0, 0)).toBe(77);
  target.undo(); expect(target.sheets).toHaveLength(1);
  target.redo(); expect(target.getValue(id, 0, 0)).toBe(77);
});
it('retains an absolute external formula and saved value through ordinary cell copy/paste', async () => {
  const wb = await imported(), id = wb.activeSheetId;
  const cells = wb.copyCells(id, [0], [0]);
  wb.pasteCells(id, cells, 3, 2, { r: 0, c: 0 });
  expect(wb.getCell(id, 3, 2).f).toBe(formula);
  expect(wb.getValue(id, 3, 2)).toBe(77);
  wb.undo(); expect(wb.getCell(id, 3, 2)).toBeFalsy();
  wb.redo(); expect(wb.getValue(id, 3, 2)).toBe(77);
});
it('does not reuse a saved result after a relative reference moves to another source cell', async () => {
  const wb = await imported(), id = wb.activeSheetId;
  wb.setCells(id, [{ r: 1, c: 0, cell: { f: '[1]Data!B2', externalResult: { formula: '[1]Data!B2', value: 17 } } }]);
  wb.pasteCells(id, wb.copyCells(id, [1], [0]), 2, 0, { r: 1, c: 0 });
  expect(wb.getValue(id, 2, 0)).toEqual({ error: '#REF!' });
});
it('restores a saved result after structural formula rewriting is undone', async () => {
  const wb = await imported(), id = wb.activeSheetId;
  wb.setCells(id, [{ r: 1, c: 0, cell: { f: "'[1]Data'!$B$2+A1", externalResult: { formula: "'[1]Data'!$B$2+A1", value: 154 } } }]);
  wb.insertRows(id, 0, 1);
  expect(wb.getCell(id, 2, 0).f).toContain('A2');
  wb.undo(); expect(wb.getValue(id, 1, 0)).toBe(154);
});
it.each([0, false, '', 'text & <data>', { error: '#N/A' }, null])('retains the saved result type through native-only cycles: %j', async value => {
  let wb = await imported(value);
  for (let cycle = 0; cycle < 2; cycle++) {
    expect(wb.getValue(wb.activeSheetId, 0, 0)).toEqual(value);
    const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
    const path = '/xl/workbook.xml', xml = new TextDecoder().decode(X.CFB.find(zip, path).content);
    X.CFB.utils.cfb_add(zip, path, new TextEncoder().encode(xml.replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, '')));
    wb = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }));
  }
  expect(wb.getValue(wb.activeSheetId, 0, 0)).toEqual(value);
});
it('accepts optional sheet quoting without confusing it with a changed source coordinate', () => {
  const wb = new Workbook({ externalWorkbooks: { version: 1, books: [{ target: '/Source.xlsx', sheets: [{ name: 'Data', cells: null }] }] },
    sheets: [{ name: 'Report', cells: { '0,0': { f: formula, externalResult: { formula: '[1]Data!$B$2', value: 41 } } } }] });
  expect(wb.getValue(wb.activeSheetId, 0, 0)).toBe(41);
});
it.each([Infinity, [], { error: '#N/A', extra: 1 }, { nested: true }])('does not accept an invalid saved result: %j', value => {
  const wb = new Workbook({ externalWorkbooks: { version: 1, books: [{ target: '/Source.xlsx', sheets: [{ name: 'Data', cells: null }] }] },
    sheets: [{ name: 'Report', cells: { '0,0': { f: formula, externalResult: { formula, value } } } }] });
  expect(wb.getCell(wb.activeSheetId, 0, 0).externalResult).toBeUndefined();
  expect(wb.getValue(wb.activeSheetId, 0, 0)).toEqual({ error: '#REF!' });
});

it('retains the existing ODS value and formula-sidecar behavior for unavailable links', async () => {
  const wb = await imported();
  const reopened = await workbookFromFile(await workbookToOds(wb), 'linked.ods');
  expect(reopened.getValue(reopened.activeSheetId, 0, 0)).toBe(77);
  expect(reopened.externalFormulas.get(reopened.activeSheetId).get('0,0').f).toBe(formula);
});
