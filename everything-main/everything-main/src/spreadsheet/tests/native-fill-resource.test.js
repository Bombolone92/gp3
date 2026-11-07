import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { xlsxElements, xlsxAttr } from '../src/core/xlsx-styles.js';
import { parseRange } from '../src/core/cell.js';
import { nativeFillXmlIdentity, normalizeNativeFill } from '../src/core/native-fill.js';
import { otherProgramsXlsx } from './helpers/xlsx-fixture.js';
import { parseXlsxMetadata } from '../src/core/xlsx-metadata-codec.js';
import { writeExportMetadata } from '../src/core/xlsx-export-meta.js';
import { MAX_COL } from '../src/core/refs.js';
import { sameBook } from '../src/lib/drafts.js';

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const kinds = [
  ['RGB', '<patternFill patternType="solid"><fgColor rgb="FF286844"/></patternFill>'],
  ['theme', '<patternFill patternType="solid"><fgColor theme="4" tint="0.2"/></patternFill>'],
  ['no fill', '<patternFill patternType="none"/>'],
  ['pattern', '<patternFill patternType="darkTrellis"><fgColor theme="4"/><bgColor indexed="2"/></patternFill>'],
  ['gradient', '<gradientFill type="path" left="0.2" right="0.8" top="0.3" bottom="0.7"><stop position="0"><color theme="4"/></stop><stop position="1"><color indexed="3"/></stop></gradientFill>'],
];
function source(body) {
  return otherProgramsXlsx({ styles: { fills: [`<fill>${body}</fill>`, `<fill>${body}</fill>`],
    cellXfs: [2, 3].map(fillId => `<xf fontId="0" fillId="${fillId}" borderId="0" numFmtId="0" xfId="1"/>`),
  }, sheetXml: { Data: { head: '<cols><col min="7" max="7" style="1"/></cols>',
    rows: '<row r="3"><c r="C3" s="1"><v>37</v></c><c r="D3" s="2"><v>49</v></c><c r="E3" s="1"><v>83</v></c></row><row r="5" s="2" customFormat="1"/>',
  } }, patch: { '/xl/styles.xml': xml => xml
    .replace(/<cellStyleXfs\b[^>]*>[\s\S]*?<\/cellStyleXfs>/, '<cellStyleXfs count="2"><xf fontId="0" fillId="0" borderId="0" numFmtId="0"/><xf fontId="0" fillId="2" borderId="0" numFmtId="0"/></cellStyleXfs>')
    .replace(/<cellStyles\b[^>]*>[\s\S]*?<\/cellStyles>/, '<cellStyles count="1"><cellStyle name="標準" builtinId="0" xfId="1"/></cellStyles>') } });
}
async function output(wb, native = false) {
  const bytes = new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), zip = X.CFB.read(bytes, { type: 'array' });
  const text = path => new TextDecoder().decode(X.CFB.find(zip, path).content);
  const set = (path, value) => X.CFB.utils.cfb_add(zip, path, new TextEncoder().encode(value));
  const styles = text('/xl/styles.xml'), sheet = text('/xl/worksheets/sheet1.xml');
  const xfs = xlsxElements(xlsxElements(styles, 'cellXfs')[0], 'xf');
  const fill = xf => Number(xlsxAttr(xf, 'fillId') || 0);
  const normal = fill(xlsxElements(xlsxElements(styles, 'cellStyleXfs')[0], 'xf')[0]);
  const cell = address => fill(xfs[Number(xlsxAttr(xlsxElements(sheet, 'c').find(c => xlsxAttr(c, 'r') === address), 's') || 0)]);
  if (native) set('/xl/workbook.xml', text('/xl/workbook.xml').replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  return { normal, cell, styles, sheet, text, set, finish: () => X.CFB.write(zip, { type: 'array', fileType: 'zip' }) };
}

it.each(kinds)('preserves shared versus duplicate %s fill resources through two native-only cycles', async (_name, body) => {
  let wb = await workbookFromFile(source(body));
  const original = nativeFillXmlIdentity(`<fill xmlns="${MAIN}">${body}</fill>`);
  for (let cycle = 0; cycle < 2; cycle++) {
    const id = wb.activeSheetId, normal = wb.nativeNormalFill;
    expect(wb.getCell(id, 2, 2).s.nativeFill).toBe(normal);
    expect(wb.getCell(id, 2, 4).s.nativeFill).toBe(normal);
    expect(wb.getCell(id, 2, 3).s.nativeFill.key).not.toBe(normal.key);
    expect(nativeFillXmlIdentity(wb.getCell(id, 2, 3).s.nativeFill.xml)).toBe(original);
    expect(wb.activeSheet.colStyles.get(6).nativeFill).toBe(normal);
    expect(wb.activeSheet.rowStyles.get(4).nativeFill.key).toBe(wb.getCell(id, 2, 3).s.nativeFill.key);
    const out = await output(wb, true);
    expect(out.cell('C3')).toBe(out.normal); expect(out.cell('E3')).toBe(out.normal);
    expect(out.cell('D3')).not.toBe(out.normal);
    wb = await workbookFromFile(out.finish());
    expect(wb.getValue(wb.activeSheetId, 2, 2)).toBe(37);
  }
});

it('interns draft definitions, restores shared ownership, and preserves it during sheet operations', async () => {
  const wb = await workbookFromFile(source(kinds[1][1])), state = wb.toJSON();
  expect(typeof state.sheets[0].cells['2,2'].s.nativeFill).toBe('string');
  // The default cell XF also references canonical No fill independently of
  // the colored Normal style; it is a third live resource, not an unused fill.
  expect(Object.keys(state.nativeFillRecords)).toHaveLength(3);
  const draft = new Workbook(JSON.parse(JSON.stringify(state))), id = draft.activeSheetId;
  expect(draft.getCell(id, 2, 2).s.nativeFill).toBe(draft.nativeNormalFill);
  expect(Object.isFrozen(draft.nativeNormalFill)).toBe(true);
  expect(Object.isFrozen(draft.nativeNormalFill.palette.theme)).toBe(true);
  const copy = draft.sheetToWorkbook(id);
  expect(copy.getCell(copy.activeSheetId, 2, 2).s.nativeFill).toBe(copy.nativeNormalFill);
  const incoming = new Workbook(); incoming.importSheets(copy);
  expect(incoming.sheets[1].cells.get('2,2').s.nativeFill.key).toBe(copy.nativeNormalFill.key);
  const replacement = new Workbook(); replacement.replaceSheetWith(replacement.activeSheetId, copy, copy.activeSheetId);
  expect(replacement.getCell(replacement.activeSheetId, 2, 2).s.nativeFill.key).toBe(copy.nativeNormalFill.key);
});

it('compares draft resources by their definitions and sharing rather than archive keys or dictionary order', async () => {
  const a = await workbookFromFile(source(kinds[1][1])), b = await workbookFromFile(source(kinds[1][1]));
  expect(a.nativeNormalFill.key).not.toBe(b.nativeNormalFill.key);
  expect(sameBook(a.toJSON(), b.toJSON())).toBe(true);
  b.getCell(b.activeSheetId, 2, 3).s.nativeFill = b.nativeNormalFill;
  expect(sameBook(a.toJSON(), b.toJSON())).toBe(false);
  const draft = a.toJSON(); draft.nativeFillRecords = Object.fromEntries(Object.entries(draft.nativeFillRecords).reverse());
  expect(sameBook(a.toJSON(), draft)).toBe(true);
});

it('retains a blank cell’s nonempty XF-zero fill instead of the vendor’s resolved RGB fallback', async () => {
  const src = otherProgramsXlsx({ styles: { fills: ['<fill><patternFill patternType="solid"><fgColor theme="4"/></patternFill></fill>'] },
    sheetXml: { Data: { rows: '<row r="6"><c r="F6"/></row>' } },
    patch: { '/xl/styles.xml': xml => xml.replace(/<cellXfs\b[^>]*>[\s\S]*?<\/cellXfs>/,
      '<cellXfs count="1"><xf fontId="0" fillId="2" borderId="0" numFmtId="0"/></cellXfs>') } });
  const wb = await workbookFromFile(src), cell = wb.getCell(wb.activeSheetId, 5, 5);
  expect(cell.s.bg).toMatchObject({ theme: 4, rgb: '#4f81bd' });
  expect(cell.s.nativeFill.paint).toBe(cell.s.bg);
  const back = await workbookFromFile((await output(wb, true)).finish());
  expect(back.styleAt(back.activeSheetId, 5, 5).bg).toMatchObject({ theme: 4, rgb: '#4f81bd' });
});

it('replaces same-color bindings on user edits and restores the exact resource on undo', async () => {
  const wb = await workbookFromFile(source(kinds[0][1])), id = wb.activeSheetId, fill = wb.nativeNormalFill;
  wb.applyStyle(id, parseRange('C3'), { bg: '#286844' });
  // Clear the independently bound default XF resource as well as the cell's
  // old binding; omitting the key would inherit the default resource again.
  expect(wb.getCell(id, 2, 2).s.nativeFill).toBeNull();
  const edited = await output(wb); expect(edited.cell('C3')).not.toBe(edited.normal);
  wb.undo(); expect(wb.getCell(id, 2, 2).s.nativeFill).toBe(fill);
  wb.applyStyle(id, parseRange('C3'), { bg: null });
  expect(wb.styleAt(id, 2, 2).bg).toBeUndefined();
  expect((await output(wb)).cell('C3')).not.toBe((await output(wb)).normal);
  wb.undo(); expect(wb.getCell(id, 2, 2).s.nativeFill).toBe(fill);
  wb.applyStyle(id, parseRange('C3'), { bg: { theme: -1 } });
  expect(wb.getCell(id, 2, 2).s.nativeFill).toBe(fill);
});

it('accepts an externally changed resource binding even when its color and XML are identical', async () => {
  const wb = await workbookFromFile(source(kinds[0][1])), out = await output(wb);
  const xfs = xlsxElements(xlsxElements(out.styles, 'cellXfs')[0], 'xf');
  const duplicate = xfs.findIndex(xf => Number(xlsxAttr(xf, 'fillId')) === out.cell('D3'));
  out.set('/xl/worksheets/sheet1.xml', out.sheet.replace(/<c r="C3" s="\d+"/, `<c r="C3" s="${duplicate}"`));
  const back = await workbookFromFile(out.finish());
  expect(back.getCell(back.activeSheetId, 2, 2).s.nativeFill.key).not.toBe(back.nativeNormalFill.key);
  const again = await output(back); expect(again.cell('C3')).toBe(again.cell('D3'));
  expect(again.cell('C3')).not.toBe(again.normal);
});

it('recognizes an external Normal binding to an unchanged writer-created fill', async () => {
  const wb = new Workbook({ sheets: [{ name: 'Data', cells: { '2,2': { v: 31, s: { bg: '#456789' } } } }] });
  const out = await output(wb), index = out.cell('C3');
  out.set('/xl/styles.xml', out.styles.replace(/<cellStyleXfs\b[^>]*>[\s\S]*?<\/cellStyleXfs>/,
    `<cellStyleXfs count="1"><xf fontId="0" fillId="${index}" borderId="0" numFmtId="0"/></cellStyleXfs>`));
  const back = await workbookFromFile(out.finish());
  expect(back.getCell(back.activeSheetId, 2, 2).s.nativeFill).toBe(back.nativeNormalFill);
  expect(back.nativeNormalFill.paint).toBe('#456789');
  for (const native of [false, true]) {
    const again = await output(back, native); expect(again.cell('C3')).toBe(again.normal);
    const reopened = await workbookFromFile(again.finish());
    expect(reopened.getCell(reopened.activeSheetId, 2, 2).s.nativeFill).toBe(reopened.nativeNormalFill);
  }
});

it('keeps named Normal fill edits authoritative and rebinds its shared cells and columns', async () => {
  const wb = await workbookFromFile(source(kinds[0][1])), original = wb.nativeNormalFill;
  wb.nativeNormalStyle.fill = `<fill xmlns="${MAIN}"><patternFill patternType="solid"><fgColor rgb="FF987654"/></patternFill></fill>`;
  for (const native of [false, true]) {
    const out = await output(wb, native);
    expect(out.cell('C3')).toBe(out.normal); expect(out.cell('E3')).toBe(out.normal);
    expect(out.cell('D3')).not.toBe(out.normal);
    const back = await workbookFromFile(out.finish());
    expect(back.nativeNormalFill.paint).toBe('#987654');
    expect(back.getCell(back.activeSheetId, 2, 2).s.nativeFill).toBe(back.nativeNormalFill);
    expect(back.styleAt(back.activeSheetId, 2, 2).bg).toBe('#987654');
    expect(back.activeSheet.colStyles.get(6).nativeFill).toBe(back.nativeNormalFill);
    expect(back.styleAt(back.activeSheetId, 2, 3).bg).toBe('#286844');
  }
  expect(wb.nativeNormalFill).toBe(original); expect(original.paint).toBe('#286844');
});

it('adopts resources from older private metadata without freezing partial row or cell inheritance', async () => {
  const wb = new Workbook({ sheets: [{ name: 'Data',
    colStyles: Object.fromEntries(Array.from({ length: MAX_COL + 1 }, (_, c) => [c, { bg: '#345678' }])),
    rowStyles: { 4: { bold: true } }, cells: { '4,2': { v: 17 }, '2,2': { v: 23, s: { italic: true } } },
  }] });
  const out = await output(wb), nativeBook = X.read(out.finish(), { type: 'array' });
  const metaSheet = nativeBook.Sheets._puter_meta;
  const json = Object.keys(metaSheet).filter(k => /^A\d+$/.test(k)).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))
    .map(k => metaSheet[k].v).join('');
  const meta = parseXlsxMetadata(json); delete meta.nativeFillBaseline;
  expect(meta.sheets.Data.nativeRowStyleBase.bg).toBe('#345678');
  writeExportMetadata(X, { SheetNames: nativeBook.SheetNames, PuterExportMeta: { name: '_puter_meta', data: meta } }, { get: out.text, set: out.set });
  const back = await workbookFromFile(out.finish()), id = back.activeSheetId;
  expect(back.activeSheet.rowStyles.get(4)).toEqual({ bold: true });
  expect(back.getCell(id, 4, 2).s).toBeUndefined();
  expect(back.getCell(id, 2, 2).s).toEqual({ italic: true });
  expect(back.activeSheet.colStyles.get(2).nativeFill.paint).toBe('#345678');
  back.applyStyle(id, { r1: 0, c1: 2, r2: 1048575, c2: 2 }, { bg: '#abcdef' });
  expect(back.styleAt(id, 4, 2)).toMatchObject({ bold: true, bg: '#abcdef' });
  expect(back.styleAt(id, 2, 2)).toMatchObject({ italic: true, bg: '#abcdef' });
  const again = await workbookFromFile((await output(back)).finish());
  expect(again.styleAt(again.activeSheetId, 4, 2)).toMatchObject({ bold: true, bg: '#abcdef' });
});

it.each(kinds.slice(3))('rebases all palette colors in a copied %s without changing geometry or source ownership', async (_name, body) => {
  const wb = await workbookFromFile(source(body)), id = wb.activeSheetId;
  const target = new Workbook({ colorPalette: { theme: [null, null, null, null, '#123456'], indexed: [null, null, '#112233', '#445566'] } });
  target.pasteCells(target.activeSheetId, wb.copyRange(id, parseRange('C3')), 2, 2);
  const out = await output(target, true), xml = xlsxElements(xlsxElements(out.styles, 'fills')[0], 'fill')[out.cell('C3')];
  expect(xml).not.toContain('theme="4"'); expect(xml).toContain('rgb="FF4F81BD"');
  expect(xml).toContain(_name === 'pattern' ? 'patternType="darkTrellis"' : 'left="0.2"');
  expect(wb.getCell(id, 2, 2).s.nativeFill.palette.theme[4]).toBe('#4f81bd');
  const back = await workbookFromFile(out.finish()); expect(back.getCell(back.activeSheetId, 2, 2).s.nativeFill.xml).toContain('rgb="FF4F81BD"');
});

it.each([null, '<other xmlns="urn:wrong"/>', '<fill xmlns="urn:wrong"/>', '<!DOCTYPE fill><fill/>', 'x'.repeat(1048577)])
('rejects malformed or oversized resource XML', xml => {
  expect(() => normalizeNativeFill({ key: 'valid', xml })).toThrow();
});
