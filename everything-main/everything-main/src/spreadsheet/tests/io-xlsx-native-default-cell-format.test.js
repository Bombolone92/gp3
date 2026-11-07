import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { parseModelXml, modelChildren } from '../src/core/data-model-metadata.js';
import { normalizeNativeDefaultCellFormat } from '../src/core/native-default-cell-format.js';
import { defaultCellFormatFile, MAIN } from './helpers/default-cell-format.js';
import { sameBook } from '../src/lib/drafts.js';
import { nativePivotDirectStyle } from '../src/core/native-pivot-display.js';

async function output(wb, privateMeta = true) {
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
  const text = path => new TextDecoder().decode(X.CFB.find(zip, path).content);
  const styles = parseModelXml(text('/xl/styles.xml'));
  if (!privateMeta) {
    const part = X.CFB.find(zip, '/xl/workbook.xml');
    part.content = new TextEncoder().encode(text('/xl/workbook.xml').replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
    part.size = part.content.length;
  }
  return { bytes: X.CFB.write(zip, { type: 'array', fileType: 'zip' }), styles };
}
const nodes = (node, tag) => modelChildren(node, tag, MAIN);
const defaultStyle = wb => wb.styleAt(wb.activeSheetId, 100, 10);
const appearance = style => Object.fromEntries(Object.entries(style).filter(([k]) => k !== 'nativeFill'));

it.each([true, false])('retains an independently bound default No fill even without paint or font changes (duplicate=%s)', async duplicate => {
  const wb = await workbookFromFile(defaultCellFormatFile({ defaultFontId: 0, defaultBorderId: 0, numFmt: 0, alignment: '',
    defaultFillId: duplicate ? 2 : 0, normalFillId: duplicate ? 0 : 2,
    ...(duplicate ? { fill: '<fill><patternFill patternType="none"/></fill>' } : {}),
  }));
  const fill = wb.nativeDefaultCellFormat.style.nativeFill;
  expect(fill.paint).toBeNull(); expect(fill.key).not.toBe(wb.nativeNormalFill?.key);
  expect(nativePivotDirectStyle(defaultStyle(wb), wb.normalStyle, wb.nativeNormalFill).bg).toBe('transparent');
  const back = await workbookFromFile((await output(wb, false)).bytes);
  expect(back.nativeDefaultCellFormat.style.nativeFill.paint).toBeNull();
  expect(back.nativeDefaultCellFormat.style.nativeFill.key).not.toBe(back.nativeNormalFill?.key);
});

it.each([false, true])('inherits complete cell XF zero independently of Normal, prefixed=%s', async prefix => {
  const wb = await workbookFromFile(defaultCellFormatFile({ prefix }));
  expect(wb.normalFont).toMatchObject({ name: 'Arial', sz: 11 });
  expect(defaultStyle(wb)).toMatchObject({ font: 'courier', size: 56 / 3, bold: true, italic: true, color: '#234567',
    bg: '#bbddee', bb: true, align: 'right', valign: 'top', wrap: true, indent: 2, rot: -15, fmt: 'percent', dec: 0 });
  expect(wb.activeSheet.cells.size).toBe(2);
  wb.setInput(wb.activeSheetId, 100, 10, 'New input');
  expect(defaultStyle(wb).wrap).toBe(true);
});

it('retains complete No fill, General, alignment, border and font clears on other XFs', async () => {
  const wb = await workbookFromFile(defaultCellFormatFile());
  const style = wb.styleAt(wb.activeSheetId, 0, 0);
  expect(style).toMatchObject({ font: 'arial', size: 44 / 3, bold: null, italic: null, bg: null,
    nativeFill: null, bb: null, align: null, valign: 'bottom', wrap: null, indent: null, rot: null, fmt: null });
  expect(wb.getDisplay(wb.activeSheetId, 0, 0)).toBe('0.125');
  expect(wb.getDisplay(wb.activeSheetId, 0, 1)).toBe('25%');
});

it.each([true, false])('round-trips default resources, complete overrides, and sparse defaults (private metadata=%s)', async privateMeta => {
  let wb = await workbookFromFile(defaultCellFormatFile());
  const before = appearance(defaultStyle(wb)), cell = appearance(wb.styleAt(wb.activeSheetId, 0, 0));
  for (let cycle = 0; cycle < 2; cycle++) {
    const out = await output(wb, privateMeta), xf = nodes(nodes(out.styles, 'cellXfs')[0], 'xf')[0];
    expect(xf.getAttribute('numFmtId')).toBe('9');
    expect(nodes(xf, 'alignment')[0].getAttribute('wrapText')).toBe('1');
    const font = nodes(nodes(out.styles, 'fonts')[0], 'font')[Number(xf.getAttribute('fontId'))];
    expect(nodes(font, 'name')[0].getAttribute('val')).toBe('Courier New');
    const normalXf = nodes(nodes(out.styles, 'cellStyleXfs')[0], 'xf')[0];
    expect(normalXf.getAttribute('fontId')).toBe('0');
    expect(xf.getAttribute('fillId')).not.toBe(normalXf.getAttribute('fillId'));
    wb = await workbookFromFile(out.bytes);
    expect(appearance(defaultStyle(wb))).toEqual(before);
    expect(appearance(wb.styleAt(wb.activeSheetId, 0, 0))).toEqual(cell);
    expect(wb.activeSheet.cells.size).toBe(2);
  }
});

it('preserves default protection, extension namespaces, gradient fills and unsupported font details', async () => {
  const file = defaultCellFormatFile({ prefix: true, fill: '<fill><gradientFill degree="27"><stop position="0"><color theme="3"/></stop></gradientFill></fill>',
    font: '<font><outline/><shadow/><sz val="13"/><name val="Arial"/><family val="2"/></font>',
    extra: '<protection locked="0"/><extLst><ext uri="default"><q:record q:value="keep"/></ext></extLst>' });
  const wb = await workbookFromFile(file), out = await output(wb, false);
  const xf = nodes(nodes(out.styles, 'cellXfs')[0], 'xf')[0];
  expect(nodes(xf, 'protection')[0].getAttribute('locked')).toBe('0');
  expect(xf.getElementsByTagNameNS('urn:default-format-test', 'record')[0].getAttributeNS('urn:default-format-test', 'value')).toBe('keep');
  const fill = nodes(nodes(out.styles, 'fills')[0], 'fill')[Number(xf.getAttribute('fillId'))];
  expect(nodes(fill, 'gradientFill')[0].getAttribute('degree')).toBe('27');
  expect((await workbookFromFile(out.bytes)).nativeDefaultCellFormat.font).toContain('outline');
});

it('retains independent defaults and shared immutable fill bindings through drafts and extraction', async () => {
  const wb = await workbookFromFile(defaultCellFormatFile()), state = wb.toJSON();
  expect(typeof state.nativeDefaultCellFormat.style.nativeFill).toBe('string');
  const draft = new Workbook(state), extract = wb.sheetToWorkbook(wb.activeSheetId);
  for (const copy of [draft, extract]) {
    expect(copy.nativeDefaultCellFormat).toEqual(wb.nativeDefaultCellFormat);
    expect(copy.nativeDefaultCellFormat).not.toBe(wb.nativeDefaultCellFormat);
    expect(copy.nativeDefaultCellFormat.style.nativeFill).toBe(copy.getCell(copy.activeSheetId, 0, 1).s.nativeFill);
    expect(defaultStyle(copy)).toEqual(defaultStyle(wb));
  }
  draft.nativeDefaultCellFormat.numberFormat = '0.000';
  expect(wb.nativeDefaultCellFormat.numberFormat).toBe(9);
});

it('compares independent imports and drafts by definitions and default fill sharing', async () => {
  const a = await workbookFromFile(defaultCellFormatFile()), b = await workbookFromFile(defaultCellFormatFile());
  expect(a.nativeDefaultCellFormat.style.nativeFill.key).not.toBe(b.nativeDefaultCellFormat.style.nativeFill.key);
  expect(sameBook(a.toJSON(), b.toJSON())).toBe(true);
  const snapshot = b.toJSON();
  snapshot.nativeDefaultCellFormat.xf = snapshot.nativeDefaultCellFormat.xf.replace('fillId="2"', 'fillId="94"');
  expect(sameBook(a.toJSON(), snapshot)).toBe(true);
  snapshot.nativeDefaultCellFormat.xf = snapshot.nativeDefaultCellFormat.xf.replace('wrapText="1"', 'wrapText="0"');
  expect(sameBook(a.toJSON(), snapshot)).toBe(false);
});

it('accepts external default-format edits while retaining complete stored cell and line overrides', async () => {
  const wb = await workbookFromFile(defaultCellFormatFile({ head: '<cols><col min="4" max="4" style="1"/></cols>' }));
  const out = await output(wb), zip = X.CFB.read(out.bytes, { type: 'array' });
  const part = X.CFB.find(zip, '/xl/styles.xml');
  let xml = new TextDecoder().decode(part.content);
  xml = xml.replace(/(<cellXfs\b[^>]*>)([\s\S]*?<\/(?:\w+:)?xf>)/, (_, head, first) => head + first.replace('wrapText="1"', 'wrapText="0"'));
  part.content = new TextEncoder().encode(xml); part.size = part.content.length;
  const back = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }));
  expect(defaultStyle(back).wrap).toBeUndefined();
  expect(back.styleAt(back.activeSheetId, 0, 0).bg).toBeNull();
  expect(back.styleAt(back.activeSheetId, 100, 3).bg).toBeNull();
  expect(back.getDisplay(back.activeSheetId, 0, 0)).toBe('0.125');
});

it('retains private implicit font defaults when an external editor changes only XF-zero wrapping', async () => {
  const wb = new Workbook(), out = await output(wb), zip = X.CFB.read(out.bytes, { type: 'array' });
  const part = X.CFB.find(zip, '/xl/styles.xml');
  part.content = new TextEncoder().encode(new TextDecoder().decode(part.content)
    .replace(/(<cellXfs\b[^>]*>)([\s\S]*?<\/xf>)/, (_, head, first) => head + first.replace('<alignment ', '<alignment wrapText="1" ')));
  part.size = part.content.length;
  const back = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }));
  expect(back.normalFont).toBeNull();
  expect(defaultStyle(back)).toEqual({ valign: 'middle', wrap: true });
  expect(back.nativeDefaultCellFormat.font).toContain('Calibri');
});

it.each(['xf', 'font', 'fill', 'border', 'numberFormat', 'style'])('rejects malformed default %s records', key => {
  const value = { xf: `<xf xmlns="${MAIN}"/>`, font: `<font xmlns="${MAIN}"/>`, fill: `<fill xmlns="${MAIN}"/>`, border: `<border xmlns="${MAIN}"/>`, numberFormat: 0, style: {} };
  value[key] = ['numberFormat', 'style'].includes(key) ? [] : '<other xmlns="urn:wrong"/>';
  expect(() => normalizeNativeDefaultCellFormat(value)).toThrow(/default cell format/);
});
