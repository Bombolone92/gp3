import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx, workbookToOds } from '../src/core/io.js';
import { cellsToHtml } from '../src/core/clipboard.js';
import { otherProgramsXlsx } from './helpers/xlsx-fixture.js';

const source = (vertical, normal = 'center') => otherProgramsXlsx({
  sheetXml: { Data: { rows: '<row r="1" ht="48" customHeight="1"><c r="A1" t="inlineStr"><is><t>Existing</t></is></c></row>' } },
  patch: { '/xl/styles.xml': xml => {
    for (const [section, value] of [['cellXfs', vertical], ['cellStyleXfs', normal]]) {
      if (value) xml = xml.replace(new RegExp(`<${section}\\b[^>]*>[\\s\\S]*?</${section}>`),
        block => block.replace(/<xf\b([^>]*)\/>/, `<xf$1 applyAlignment="1"><alignment vertical="${value}"/></xf>`));
    }
    return xml;
  } },
});
const zipOf = async wb => X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
const xmlOf = (zip, path) => new TextDecoder().decode(X.CFB.find(zip, path).content);
const setXml = (zip, path, xml) => {
  const part = X.CFB.find(zip, path);
  part.content = new TextEncoder().encode(xml);
  part.size = part.content.length;
};
const readZip = zip => workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'roundtrip.xlsx');
async function reopen(wb, native = false) {
  const zip = await zipOf(wb);
  if (native) setXml(zip, '/xl/workbook.xml', xmlOf(zip, '/xl/workbook.xml').replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  return readZip(zip);
}
const alignment = (wb, r = 2, c = 1, id = wb.activeSheetId) => wb.styleAt(id, r, c)?.valign || 'middle';

it.each([[undefined, 'bottom'], ['top', 'top'], ['center', 'middle'], ['bottom', 'bottom']])(
  'inherits XF zero alignment %s on unallocated and newly entered cells', async (vertical, expected) => {
    let wb = await workbookFromFile(source(vertical), 'defaults.xlsx');
    for (let pass = 0; pass < 3; pass++) {
      const id = wb.activeSheetId;
      expect(wb.getCell(id, 2, 1)).toBeUndefined();
      expect(alignment(wb)).toBe(expected);
      wb.setInput(id, 2, 1, '123');
      expect(alignment(wb)).toBe(expected);
      wb.undo();
      expect(wb.getValue(id, 2, 1)).toBeNull();
      expect(alignment(wb)).toBe(expected);
      if (pass < 2) wb = await reopen(wb, pass === 1);
    }
  });

it('retains sheet defaults across copy, replacement, serialization and structural undo', async () => {
  const wb = await workbookFromFile(source('top'), 'defaults.xlsx'), id = wb.activeSheetId;
  wb.activeSheet.rightToLeft = true;
  const copy = wb.duplicateSheet(id);
  expect(alignment(wb, 5, 5, copy.id)).toBe('top');
  const target = new Workbook(), added = target.importSheets(wb), targetId = target.sheets[0].id;
  expect(alignment(target, 5, 5, added[0].id)).toBe('top');
  target.replaceSheetWith(targetId, wb, id);
  expect(alignment(target, 5, 5, targetId)).toBe('top');
  expect(target.sheet(targetId).rightToLeft).toBe(true);
  target.undo();
  expect(alignment(target, 5, 5, targetId)).toBe('middle');
  expect(target.sheet(targetId).rightToLeft).toBe(false);
  target.redo();
  expect(alignment(target, 5, 5, targetId)).toBe('top');
  expect(target.sheet(targetId).rightToLeft).toBe(true);
  wb.insertRows(id, 0, 2);
  wb.undo();
  expect(alignment(wb, 5, 5, id)).toBe('top');
  expect(alignment(new Workbook(wb.toJSON()), 5, 5, id)).toBe('top');
  expect(alignment(wb.sheetToWorkbook(id), 5, 5)).toBe('top');
  expect(alignment(await workbookFromFile(await workbookToOds(wb), 'defaults.ods'))).toBe('top');
});

it('keeps row, column and explicit overrides and restores the native default on Clear formats', async () => {
  const wb = await workbookFromFile(source('top'), 'defaults.xlsx'), id = wb.activeSheetId;
  wb.applyStyle(id, { r1: 0, c1: 1, r2: 1048575, c2: 1 }, { valign: 'bottom' });
  expect(alignment(wb)).toBe('bottom');
  wb.applyStyle(id, { r1: 2, c1: 0, r2: 2, c2: 16383 }, { valign: 'middle' });
  expect(alignment(wb)).toBe('middle');
  wb.setCells(id, [{ r: 2, c: 1, cell: { v: 123, s: { valign: 'bottom' } } }]);
  expect(alignment(wb)).toBe('bottom');
  for (const native of [false, true]) expect(alignment(await reopen(wb, native))).toBe('bottom');
  wb.clearRange(id, { r1: 2, c1: 1, r2: 2, c2: 1 }, { contents: false, styles: true });
  expect(alignment(wb)).toBe('top');
  for (const native of [false, true]) expect(alignment(await reopen(wb, native))).toBe('top');
  wb.undo();
  expect(alignment(wb)).toBe('bottom');
});

it('exports differing sheet defaults compactly and keeps blank-cell inheritance on native-only saves', async () => {
  const wb = await workbookFromFile(source('top'), 'defaults.xlsx'), top = wb.activeSheetId, mid = wb.addSheet('Middle').id;
  wb.setInput(mid, 0, 0, 'Middle');
  wb.applyStyle(top, { r1: 1, c1: 0, r2: 1, c2: 16383 }, { bold: true });
  wb.applyStyle(top, { r1: 0, c1: 2, r2: 1048575, c2: 2 }, { italic: true });
  const zip = await zipOf(wb), xml = xmlOf(zip, '/xl/worksheets/sheet2.xml');
  expect(xml.match(/<col\b/g)).toHaveLength(1);
  expect(xml).toContain('min="1" max="16384"');
  expect(xml).toMatch(/<col[^>]*width="[1-9][0-9.]*"/);
  // Explicit column geometry and formats split the synthetic default span.
  wb.setColWidth(mid, 3, 130);
  wb.applyStyle(mid, { r1: 0, c1: 6, r2: 1048575, c2: 6 }, { valign: 'bottom' });
  for (const native of [false, true]) {
    const back = await reopen(wb, native), first = back.sheetByName('Data'), second = back.sheetByName('Middle');
    for (const [r, c] of [[20, 20], [1, 5], [30, 2]]) expect(alignment(back, r, c, first.id)).toBe('top');
    for (const c of [0, 3, 4, 7, 16383]) expect(alignment(back, 20, c, second.id)).toBe('middle');
    expect(alignment(back, 20, 6, second.id)).toBe('bottom');
    expect(second.colWidths.get(3)).toBeCloseTo(130, 0);
    const again = await reopen(back, native);
    expect(alignment(again, 20, 20, again.sheetByName('Middle').id)).toBe('middle');
  }
});

it('preserves copied blank-cell alignment in cell copies and HTML', async () => {
  const wb = await workbookFromFile(source('top'), 'defaults.xlsx');
  const cells = wb.copyRange(wb.activeSheetId, { r1: 2, c1: 1, r2: 2, c2: 1 });
  expect(cells[0][0].s.valign).toBe('top');
  const target = new Workbook();
  target.pasteCells(target.activeSheetId, cells, 2, 1);
  target.setInput(target.activeSheetId, 2, 1, '123');
  expect(alignment(target)).toBe('top');
  expect(cellsToHtml([['']], cells)).toContain('vertical-align:top');
});

it('keeps app implicit middle alignment in unallocated cells with and without metadata', async () => {
  const wb = new Workbook();
  wb.setInput(wb.activeSheetId, 0, 0, 'App');
  for (const native of [false, true]) expect(alignment(await reopen(wb, native))).toBe('middle');
});

it('preserves sparse cell inheritance when reopening a sheet with a native default', async () => {
  const wb = await workbookFromFile(source('top'), 'defaults.xlsx');
  wb.setCells(wb.activeSheetId, [{ r: 2, c: 1, cell: { v: 123 } }]);
  const back = await reopen(wb);
  expect(back.getCell(back.activeSheetId, 2, 1).s?.valign).toBeUndefined();
  back.applyStyle(back.activeSheetId, { r1: 0, c1: 1, r2: 1048575, c2: 1 }, { valign: 'bottom' });
  expect(alignment(back)).toBe('bottom');
});

it.each(['bottom', null])('reconciles native XF-zero alignment edits (%s) against its saved baseline', async vertical => {
  const wb = await workbookFromFile(source('top'), 'defaults.xlsx');
  wb.addSheet('Middle');
  const zip = await zipOf(wb);
  setXml(zip, '/xl/styles.xml', xmlOf(zip, '/xl/styles.xml').replace(/(<cellXfs\b[^>]*>[\s\S]*?)<alignment\b[^>]*\/>/,
    (_, prefix) => prefix + (vertical ? `<alignment vertical="${vertical}"/>` : '')));
  const back = await readZip(zip);
  expect(alignment(back, 2, 1, back.sheetByName('Data').id)).toBe('bottom');
  expect(alignment(back, 0, 0, back.sheetByName('Data').id)).toBe('top');
  expect(alignment(back, 2, 1, back.sheetByName('Middle').id)).toBe('middle');
});
