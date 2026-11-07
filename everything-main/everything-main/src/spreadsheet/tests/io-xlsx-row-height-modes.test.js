import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { sameBook } from '../src/lib/drafts.js';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { readXlsxRowHeightModes } from '../src/core/xlsx-line-styles.js';
import { otherProgramsXlsx } from './helpers/xlsx-fixture.js';

const fixture = () => otherProgramsXlsx({ sheetXml: { Data: { rows:
  '<row r="2" ht="18"><c r="A2" t="str"><v>Automatic cache</v></c></row>'
  + '<row r="4" ht="90" customHeight="false"><c r="A4" t="str"><v>Automatic tall cache</v></c></row>'
  + '<row r="5" ht="90" customHeight="true"><c r="A5" t="str"><v>Fixed tall</v></c></row>'
  + '<row r="7" customHeight="1"><c r="A7" t="str"><v>Fixed default</v></c></row>'
  + '<row r="9"><c r="A9" t="str"><v>Automatic default</v></c></row>',
} } });
const modes = wb => Object.fromEntries(wb.activeSheet.rowHeightModes);
async function output(wb, native = false) {
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
  const text = path => new TextDecoder().decode(X.CFB.find(zip, path).content);
  if (native) X.CFB.utils.cfb_add(zip, '/xl/workbook.xml', new TextEncoder().encode(text('/xl/workbook.xml').replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, '')));
  return { xml: text('/xl/worksheets/sheet1.xml'), back: await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'roundtrip.xlsx') };
}

it('imports cached height independently from automatic/fixed sizing and preserves native-only round trips', async () => {
  const wb = await workbookFromFile(fixture(), 'external.xlsx');
  const expected = { 1: 'auto', 3: 'auto', 4: 'fixed', 6: 'fixed', 8: 'auto' };
  expect(modes(wb)).toEqual(expected);
  expect(wb.rowHeight(wb.activeSheetId, 1)).toBe(24);
  expect(wb.rowHeight(wb.activeSheetId, 3)).toBe(120);
  for (const native of [false, true]) {
    const { xml, back } = await output(wb, native);
    expect(modes(back)).toEqual(expected);
    for (const r of [2, 4, 9]) expect(xml.match(new RegExp(`<row\\b[^>]*r="${r}"[^>]*>`))[0]).not.toContain('customHeight');
    for (const r of [5, 7]) expect(xml.match(new RegExp(`<row\\b[^>]*r="${r}"[^>]*>`))[0]).toContain('customHeight="1"');
    expect(back.rowHeight(back.activeSheetId, 3)).toBe(120);
  }
});

it('resizes an automatic row at its current height to fixed, with undo and JSON preservation', async () => {
  const wb = await workbookFromFile(fixture(), 'external.xlsx'), id = wb.activeSheetId;
  wb.setRowHeight(id, 1, 24);
  expect(wb.activeSheet.rowHeightModes.get(1)).toBe('fixed');
  wb.undo();
  expect(wb.activeSheet.rowHeightModes.get(1)).toBe('auto');
  wb.redo();
  expect(modes(new Workbook(wb.toJSON()))).toEqual(modes(wb));
  wb.setRowHeight(id, 1, 40, { auto: true });
  expect(wb.activeSheet.rowHeightModes.get(1)).toBe('auto');
});

it('moves row sizing modes with insertion, deletion, reorder and undo', async () => {
  const wb = await workbookFromFile(fixture(), 'external.xlsx'), id = wb.activeSheetId;
  const original = modes(wb);
  wb.insertRows(id, 1, 2);
  expect(wb.activeSheet.rowHeightModes.get(3)).toBe('auto');
  expect(wb.activeSheet.rowHeightModes.get(6)).toBe('fixed');
  wb.deleteRows(id, 1, 2);
  expect(modes(wb)).toEqual(original);
  wb.undo(); wb.undo();
  expect(modes(wb)).toEqual(original);
  wb.moveRows(id, 1, 1, 7);
  expect(wb.activeSheet.rowHeightModes.get(6)).toBe('auto');
  wb.undo();
  expect(modes(wb)).toEqual(original);
});

it('keeps automatic-height calculation out of history, dirty state and formula invalidation', async () => {
  const wb = await workbookFromFile(fixture(), 'external.xlsx'), id = wb.activeSheetId;
  wb.dirty = false; wb.clearHistory(); const version = wb.version;
  expect(wb.cacheAutoRowHeights(id, new Map([[1, 73], [4, 2], [3, Infinity], [8, 100000]]))).toBe(true);
  expect(wb.rowHeight(id, 1)).toBe(73);
  expect(wb.rowHeight(id, 4)).toBe(120);
  expect(wb.rowHeight(id, 8)).toBe(546);
  expect(wb.version).toBe(version); expect(wb.dirty).toBe(false); expect(wb.canUndo()).toBe(false);
  const { back } = await output(wb, true);
  expect(back.rowHeight(back.activeSheetId, 1)).toBe(73);
  expect(back.activeSheet.rowHeightModes.get(1)).toBe('auto');
});

it('bounds native/draft row modes and ignores comments, non-sheet rows and malformed flags', () => {
  expect(readXlsxRowHeightModes('<worksheet><row r="99"/><sheetData><!-- <row r="40"/> --><row r="1"/><row customHeight="0"/><row r="1048576" customHeight="true"/><row r="0"/><row r="1048577"/><row r="4" customHeight="invalid"/></sheetData></worksheet>'))
    .toEqual({ 0: 'auto', 1: 'auto', 1048575: 'fixed' });
  const wb = new Workbook({ sheets: [{ rowHeightModes: { '-1': 'auto', 0: 'other', 2: 'fixed', 1048576: 'auto' } }] });
  expect(modes(wb)).toEqual({ 2: 'fixed' });
});

it('retains unspecified app row modes through its native fixed-height projection', async () => {
  const wb = new Workbook(); wb.setInput(wb.activeSheetId, 0, 0, 'text');
  expect(modes((await output(wb)).back)).toEqual({});
  expect(modes((await output(wb, true)).back)).toEqual({ 0: 'fixed' });
});

it('copies sizing modes with whole-sheet imports, including automatic rows at the default height', async () => {
  const source = await workbookFromFile(fixture(), 'external.xlsx');
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.placeSheetAt(id, source, source.activeSheetId, 10, 0, 'Import', { lines: true });
  expect(wb.activeSheet.rowHeightModes.get(10)).toBe('auto');
  expect(wb.activeSheet.rowHeightModes.get(17)).toBe('auto');
  expect(wb.activeSheet.rowHeightModes.get(13)).toBe('fixed');
  wb.undo(); expect(wb.activeSheet.rowHeightModes.size).toBe(0);
});

it('compares automatic layout caches as the same saved content while retaining fixed-size edits', async () => {
  const wb = await workbookFromFile(fixture(), 'external.xlsx'), before = wb.toJSON();
  wb.cacheAutoRowHeights(wb.activeSheetId, new Map([[1, 200], [3, 30]]));
  expect(sameBook(before, wb.toJSON())).toBe(true);
  wb.setRowHeight(wb.activeSheetId, 4, 130);
  expect(sameBook(before, wb.toJSON())).toBe(false);
  wb.undo(); wb.setRowHeight(wb.activeSheetId, 1, 200);
  expect(sameBook(before, wb.toJSON())).toBe(false);
});

it('retains automatic fitted heights below the sheet default in native-only output', async () => {
  const { measureRows } = await import('../src/core/row-height.js');
  const { heightForLines } = await import('../src/core/textfit.js');
  const wb = new Workbook({ sheets: [{ defaultRowHeight: 80, rowHeights: { 0: 120 }, rowHeightModes: { 0: 'auto' },
    cells: { '0,0': { v: 'Short', s: { size: 14, wrap: true } } } }] });
  wb.cacheAutoRowHeights(wb.activeSheetId, measureRows(wb, wb.activeSheetId, 0, 0,
    { force: true, automatic: true, textWidth: text => text.length * 7 }));
  const { xml, back } = await output(wb, true);
  expect(back.activeSheet.defaultRowHeight).toBe(80);
  expect(back.rowHeight(back.activeSheetId, 0)).toBe(heightForLines(1, 14));
  expect(modes(back)).toMatchObject({ 0: 'auto' });
  expect(xml.match(/<row\b[^>]*r="1"[^>]*>/)[0]).not.toContain('customHeight');
});
