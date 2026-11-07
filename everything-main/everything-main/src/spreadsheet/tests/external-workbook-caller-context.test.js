import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
const linked = "'[1]Data'!$A$1";
const fixture = (f, names = []) => new Workbook({ names,
  externalWorkbooks: { version: 1, books: [{ target: '/Source.xlsx', sheets: [{ name: 'Data', cells: null }] }] },
  sheets: [{ name: 'Report', cells: { '0,0': { f, externalResult: { formula: f, value: 41 } } } }, { name: 'Other' }] });
it.each([
  `${linked}+ROW()`, `${linked}+COLUMN()`, `SINGLE('[1]Data'!$A$1:$A$20)`, `@'[1]Data'!$A$1:$A$20`,
  `${linked}+INDIRECT("R[-1]C",FALSE)`, `${linked}+LEN(ADDRESS(1,1,4,FALSE))`,
  `${linked}+CELL("row")`, `${linked}+Caller`,
])('does not reuse a saved result after changing the caller: %s', f => {
  const wb = fixture(f, [{ name: 'Caller', ref: 'ROW()' }]), id = wb.activeSheetId;
  expect(wb.getValue(id, 0, 0)).toBe(41);
  wb.pasteCells(id, wb.copyCells(id, [0], [0]), 9, 2, { r: 0, c: 0 });
  expect(wb.getValue(id, 9, 2)).not.toBe(41);
  wb.undo(); expect(wb.getValue(id, 0, 0)).toBe(41);
  wb.redo(); expect(wb.getValue(id, 9, 2)).not.toBe(41);
});
it.each([linked, `SUM(${linked})`, `${linked}+ROWS('[1]Data'!$A$1:$A$3)`])('keeps caller-independent saved values portable: %s', f => {
  const wb = fixture(f), id = wb.activeSheetId;
  wb.pasteCells(id, wb.copyCells(id, [0], [0]), 9, 2, { r: 0, c: 0 });
  expect(wb.getValue(id, 9, 2)).toBe(41);
});
it('tracks only the axis read by ROW or COLUMN', () => {
  const wb = fixture(`${linked}+ROW()`), id = wb.activeSheetId;
  wb.pasteCells(id, wb.copyCells(id, [0], [0]), 0, 3, { r: 0, c: 0 });
  expect(wb.getValue(id, 0, 3)).toBe(41);
  const col = fixture(`${linked}+COLUMN()`), cid = col.activeSheetId;
  col.pasteCells(cid, col.copyCells(cid, [0], [0]), 3, 0, { r: 0, c: 0 });
  expect(col.getValue(cid, 3, 0)).toBe(41);
});
it('invalidates a saved sheet-count result when a sheet is added and restores it on undo', () => {
  const wb = fixture(`${linked}+SHEETS()`), id = wb.activeSheetId;
  wb.addSheet(); expect(wb.getValue(id, 0, 0)).toEqual({ error: '#REF!' });
  wb.undo(); expect(wb.getValue(id, 0, 0)).toBe(41);
});
it('invalidates a saved sheet-position result when transferring one sheet from its workbook', () => {
  const json = fixture(`${linked}+SHEET()`).toJSON();
  json.sheets.unshift({ name: 'First' });
  delete json.sheets[1].cells['0,0'].externalResult.context;
  const wb = new Workbook(json), copied = wb.sheetToWorkbook(wb.sheetByName('Report').id);
  expect(copied.getValue(copied.activeSheetId, 0, 0)).toEqual({ error: '#REF!' });
});
it('preserves original caller provenance through JSON and native export after a move', async () => {
  const wb = fixture(`${linked}+ROW()`), id = wb.activeSheetId;
  wb.pasteCells(id, wb.copyCells(id, [0], [0]), 9, 0, { r: 0, c: 0 });
  for (const restored of [new Workbook(wb.toJSON()), await workbookFromFile(await workbookToXlsx(wb))]) {
    expect(restored.getValue(restored.activeSheetId, 0, 0)).toBe(41);
    expect(restored.getValue(restored.activeSheetId, 9, 0)).toEqual({ error: '#REF!' });
  }
});

it('preserves SHEET when its numeric index stays unchanged', () => {
  const wb = fixture(`${linked}+SHEET()`), copied = wb.sheetToWorkbook(wb.activeSheetId);
  expect(copied.getValue(copied.activeSheetId, 0, 0)).toBe(41);
});
it('follows named definitions and detects a changed definition at the same caller', () => {
  const wb = fixture(`${linked}+Caller`, [{ name: 'Caller', ref: 'ROW()+1' }]), id = wb.activeSheetId;
  wb.defineName('Caller', 'ROW()+2');
  expect(wb.getValue(id, 0, 0)).toEqual({ error: '#REF!' });
  wb.undo(); expect(wb.getValue(id, 0, 0)).toBe(41);
});
it('keeps a caller-independent named expression portable within its scope', () => {
  const wb = fixture(`${linked}+Caller`, [{ name: 'Caller', ref: '2+3' }]), id = wb.activeSheetId;
  wb.pasteCells(id, wb.copyCells(id, [0], [0]), 8, 4, { r: 0, c: 0 });
  expect(wb.getValue(id, 8, 4)).toBe(41);
});
it.each([`LET(x,2,${linked}+x)`, `LAMBDA(x,${linked}+x)(2)`])('understands caller-independent lexical bindings: %s', f => {
  const wb = fixture(f), id = wb.activeSheetId;
  wb.pasteCells(id, wb.copyCells(id, [0], [0]), 8, 4, { r: 0, c: 0 });
  expect(wb.getValue(id, 8, 4)).toBe(41);
});
it.each([`LET(x,ROW(),${linked}+x)`, `LAMBDA(x,${linked}+ROW()+x)(2)`])('follows caller reads inside lexical bindings: %s', f => {
  const wb = fixture(f), id = wb.activeSheetId;
  wb.pasteCells(id, wb.copyCells(id, [0], [0]), 8, 4, { r: 0, c: 0 });
  expect(wb.getValue(id, 8, 4)).toEqual({ error: '#REF!' });
});
it('keeps provenance valid across formatting and structural undo', () => {
  const wb = fixture(`${linked}+ROW()`), id = wb.activeSheetId;
  wb.applyStyle(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, { bold: true });
  expect(wb.getValue(id, 0, 0)).toBe(41);
  wb.insertRows(id, 0, 1);
  expect(wb.getValue(id, 1, 0)).toEqual({ error: '#REF!' });
  wb.undo(); expect(wb.getValue(id, 0, 0)).toBe(41);
});
it('tracks named sheet targets when the order changes', () => {
  const wb = fixture(`${linked}+SHEET("Other")`), id = wb.activeSheetId;
  wb.moveSheet(wb.sheetByName('Other').id, 0);
  expect(wb.getValue(id, 0, 0)).toEqual({ error: '#REF!' });
  wb.undo(); expect(wb.getValue(id, 0, 0)).toBe(41);
});
it('follows a renamed caller namespace through undo and redo', () => {
  const wb = fixture(`${linked}+Caller`, [{ name: 'Caller', ref: '2+3' }]), id = wb.activeSheetId;
  wb.renameSheet(id, 'Renamed'); expect(wb.getValue(id, 0, 0)).toBe(41);
  wb.undo(); expect(wb.getValue(id, 0, 0)).toBe(41);
  wb.redo(); expect(wb.getValue(id, 0, 0)).toBe(41);
});
it.each([{ r: -1 }, { c: 16384 }, { index: 0 }, { order: 'invalid' }, { names: 'invalid' }, { unknown: 1 }])('rejects invalid caller provenance: %j', context => {
  const json = fixture(`${linked}+ROW()`).toJSON();
  json.sheets[0].cells['0,0'].externalResult.context = context;
  const wb = new Workbook(json);
  expect(wb.getValue(wb.activeSheetId, 0, 0)).toEqual({ error: '#REF!' });
});
it('calculates the new caller normally once source values become available', () => {
  const wb = fixture(`${linked}+ROW()`), id = wb.activeSheetId;
  wb.pasteCells(id, wb.copyCells(id, [0], [0]), 9, 0, { r: 0, c: 0 });
  const json = wb.toJSON(); json.externalWorkbooks.books[0].sheets[0].cells = { '0,0': 40 };
  const restored = new Workbook(json);
  expect(restored.getValue(restored.activeSheetId, 0, 0)).toBe(41);
  expect(restored.getValue(restored.activeSheetId, 9, 0)).toBe(50);
});
it('tracks caller-relative named references even when their formula contains no ROW function', () => {
  const wb = fixture(`${linked}+Caller`, [{ name: 'Caller', ref: 'A2', relative: true }]), id = wb.activeSheetId;
  wb.pasteCells(id, wb.copyCells(id, [0], [0]), 9, 2, { r: 0, c: 0 });
  expect(wb.getValue(id, 9, 2)).toEqual({ error: '#REF!' });
});
