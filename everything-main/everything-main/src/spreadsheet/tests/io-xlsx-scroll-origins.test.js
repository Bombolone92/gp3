import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx, workbookToOds } from '../src/core/io.js';
import { sameBook } from '../src/lib/drafts.js';
import { otherProgramsXlsx } from './helpers/xlsx-fixture.js';

const read = (views) => workbookFromFile(otherProgramsXlsx({ sheetXml: { Data: { head: `<sheetViews>${views}</sheetViews>` } } }), 'view.xlsx');
const view = (attrs, body = '') => `<sheetView workbookViewId="0" ${attrs}>${body}</sheetView>`;

it('preserves a viewport independently from an offscreen selection through native and ODS round trips', async () => {
  const wb = await read(view('topLeftCell="F43"', '<selection activeCell="K90" sqref="J89:K90"/>'));
  expect(wb.activeSheet.viewOrigin).toEqual({ r: 42, c: 5 });
  expect(wb.activeSheet.viewSelection.active).toEqual({ r: 89, c: 10 });
  for (const blob of [await workbookToXlsx(wb), await workbookToOds(wb)]) {
    const back = await workbookFromFile(blob, 'view');
    expect(back.activeSheet.viewOrigin).toEqual({ r: 42, c: 5 });
    expect(back.activeSheet.viewSelection.active).toEqual({ r: 89, c: 10 });
  }
});

it.each([[3, 2, { r: 19, c: 7 }, { r: 4, c: 3 }], [3, 0, { r: 19, c: 3 }, { r: 4, c: 0 }], [0, 2, { r: 4, c: 7 }, { r: 0, c: 3 }]])
  ('distinguishes the first frozen cell from the scrolling pane with %i rows and %i columns', async (rows, cols, origin, frozenOrigin) => {
    const wb = await read(view('topLeftCell="D5"', `<pane xSplit="${cols}" ySplit="${rows}" state="frozen" topLeftCell="H20" activePane="bottomRight"/>`));
    expect(wb.activeSheet.viewOrigin).toEqual(origin);
    expect(wb.activeSheet.frozenOrigin).toEqual(frozenOrigin);
    const bytes = new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer());
    const zip = X.CFB.read(bytes, { type: 'array' });
    const xml = new TextDecoder().decode(X.CFB.find(zip, '/xl/worksheets/sheet1.xml').content);
    expect(xml).toMatch(/<sheetView\b[^>]*topLeftCell="D5"/);
    const book = X.CFB.find(zip, '/xl/workbook.xml');
    book.content = new TextEncoder().encode(new TextDecoder().decode(book.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
    book.size = book.content.length;
    const back = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'native.xlsx');
    expect(back.activeSheet.viewOrigin).toEqual(origin);
    expect(back.activeSheet.frozenOrigin).toEqual(frozenOrigin);
  });

it.each(['', 'bogus', 'A0', 'XFE1', 'A1048577'])('ignores malformed viewport coordinates %s', async ref => {
  const wb = await read(view(`topLeftCell="${ref}"`));
  expect(wb.activeSheet.viewOrigin).toBeUndefined();
});

it('uses the first non-commented view, including a self-closing view', async () => {
  const wb = await read('<!-- <sheetView topLeftCell="Z99"/> --><sheetView workbookViewId="0" topLeftCell="C8"/>' + view('topLeftCell="J30"'));
  expect(wb.activeSheet.viewOrigin).toEqual({ r: 7, c: 2 });
});

it('keeps distant origins sparse and navigation independent of drafts, undo and calculation', async () => {
  const wb = new Workbook({ sheets: [{ name: 'Data', cells: { '0,0': { f: 'RAND()' } }, viewOrigin: { r: 50000, c: 1000 } }] });
  const id = wb.activeSheetId, before = wb.toJSON(), random = wb.getValue(id, 0, 0);
  expect(wb.activeSheet.rows).toBeGreaterThan(50000);
  expect(wb.activeSheet.cells.size).toBe(1);
  wb.setSheetOrigin(id, { r: 40000, c: 900 });
  expect(wb.dirty).toBe(false); expect(wb.canUndo()).toBe(false);
  expect(wb.getValue(id, 0, 0)).toBe(random);
  expect(sameBook(before, wb.toJSON())).toBe(true);
  const copy = new Workbook(wb.toJSON());
  copy.activeSheet.viewOrigin.r = 2;
  expect(wb.activeSheet.viewOrigin.r).toBe(40000);
  const duplicate = wb.duplicateSheet(id);
  duplicate.viewOrigin.c = 2;
  expect(wb.sheet(id).viewOrigin.c).toBe(900);
  wb.insertRows(id, 0, 1);
  wb.setSheetOrigin(id, { r: 30, c: 3 });
  wb.undo();
  expect(wb.sheet(id).viewOrigin).toEqual({ r: 30, c: 3 });
});

it('prefers native viewport and freeze edits over retained sidecar settings', async () => {
  const wb = await read(view('topLeftCell="D5"', '<pane xSplit="2" ySplit="3" state="frozen" topLeftCell="H20" activePane="bottomRight"/>'));
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
  const part = X.CFB.find(zip, '/xl/worksheets/sheet1.xml');
  const xml = new TextDecoder().decode(part.content).replace('topLeftCell="D5"', 'topLeftCell="F7"').replace('ySplit="3"', 'ySplit="1"').replace('topLeftCell="H20"', 'topLeftCell="K40"');
  X.CFB.utils.cfb_add(zip, '/xl/worksheets/sheet1.xml', new TextEncoder().encode(xml));
  const back = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'edited.xlsx');
  expect(back.activeSheet.frozenRows).toBe(1);
  expect(back.activeSheet.frozenOrigin).toEqual({ r: 6, c: 5 });
  expect(back.activeSheet.viewOrigin).toEqual({ r: 39, c: 10 });
});

it('bounds malformed frozen origins so exported pane references stay inside the file grid', async () => {
  const wb = new Workbook({ sheets: [{ name: 'Data', frozenRows: 3, frozenCols: 2,
    frozenOrigin: { r: 1048575, c: 16383 }, viewOrigin: { r: Infinity, c: 0 } }] });
  expect(wb.activeSheet.viewOrigin).toBeUndefined();
  expect(wb.activeSheet.frozenOrigin).toEqual({ r: 1048572, c: 16381 });
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
  const xml = new TextDecoder().decode(X.CFB.find(zip, '/xl/worksheets/sheet1.xml').content);
  expect(xml).toMatch(/<pane\b[^>]*topLeftCell="XFD1048576"/);
});
