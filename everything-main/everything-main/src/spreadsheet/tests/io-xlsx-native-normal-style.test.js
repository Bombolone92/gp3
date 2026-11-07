import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { readXlsxStyles } from '../src/core/xlsx-styles.js';
import { normalizeNativeNormalStyle, readNativeNormalStyle } from '../src/core/native-normal-style.js';
import { parseModelXml, modelChildren } from '../src/core/data-model-metadata.js';
import { otherProgramsXlsx } from './helpers/xlsx-fixture.js';
import { nativeFillXmlIdentity } from '../src/core/native-fill.js';

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const elements = (node, name) => modelChildren(node, name, MAIN);
const fill = '<fill><patternFill patternType="solid"><fgColor theme="4" tint="0.25"/></patternFill></fill>';
const border = '<border diagonalUp="1"><left style="double"><color theme="5"/></left><diagonal style="thin"/></border>';
const alignment = '<alignment horizontal="right" vertical="top" wrapText="1" indent="2" textRotation="105"/>';
function source({ prefix = false, pattern = fill, code = '0.000&quot; units&quot;', xfId = 2, normalNumFmt = 181 } = {}) {
  let styles = `<styleSheet xmlns="${MAIN}" xmlns:q="urn:normal-test"><numFmts count="1"><numFmt numFmtId="181" formatCode="${code}"/></numFmts>`
    + '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><sz val="13"/><name val="Arial"/></font></fonts>'
    + `<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>${pattern}</fills>`
    + `<borders count="2"><border/>${border}</borders><cellStyleXfs count="3"><xf/><xf fontId="0"/><xf fontId="1" fillId="2" borderId="1" numFmtId="${normalNumFmt}" applyFill="1">${alignment}<protection locked="0"/><extLst><ext uri="normal"><q:record q:value="keep"/></ext></extLst></xf></cellStyleXfs>`
    + `<cellXfs count="2"><xf fontId="0" fillId="0" borderId="0" numFmtId="0" xfId="${xfId}"/><xf fontId="1" fillId="2" borderId="1" numFmtId="181" xfId="${xfId}">${alignment}</xf></cellXfs>`
    + `<cellStyles count="1"><cellStyle name="標準" builtinId="0" xfId="${xfId}"/></cellStyles></styleSheet>`;
  if (prefix) styles = styles.replace(/<(\/?)([a-zA-Z][\w]*)(?=[\s/>])/g, (all, closing, name) => `<${closing}s:${name}`)
    .replace(`xmlns="${MAIN}"`, `xmlns:s="${MAIN}"`);
  return otherProgramsXlsx({ sheetXml: { Data: { rows: '<row r="1"><c r="A1" t="inlineStr"><is><t>Separate cell XF zero</t></is></c><c r="B1" s="1"><v>4.125</v></c></row>' } },
    patch: { '/xl/styles.xml': () => styles } });
}
async function output(wb, native = true) {
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
  const text = path => new TextDecoder().decode(X.CFB.find(zip, path).content);
  const xml = text('/xl/styles.xml');
  if (native) {
    const part = X.CFB.find(zip, '/xl/workbook.xml');
    part.content = new TextEncoder().encode(text('/xl/workbook.xml').replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
    part.size = part.content.length;
  }
  return { xml, bytes: X.CFB.write(zip, { type: 'array', fileType: 'zip' }) };
}
function records(xml) {
  const root = parseModelXml(xml), normal = elements(elements(root, 'cellStyles')[0], 'cellStyle').find(n => n.getAttribute('builtinId') === '0');
  const xf = elements(elements(root, 'cellStyleXfs')[0], 'xf')[Number(normal.getAttribute('xfId'))];
  return { xf, fill: elements(elements(root, 'fills')[0], 'fill')[Number(xf.getAttribute('fillId'))],
    border: elements(elements(root, 'borders')[0], 'border')[Number(xf.getAttribute('borderId'))],
    code: elements(elements(root, 'numFmts')[0], 'numFmt').find(n => n.getAttribute('numFmtId') === xf.getAttribute('numFmtId'))?.getAttribute('formatCode') };
}
function cellState(wb) {
  const groups = new Map([[wb.nativeNormalFill?.key, 0]]);
  return Object.fromEntries([...wb.activeSheet.cells].map(([key, cell]) => {
    const fill = cell.s?.nativeFill;
    if (!fill) return [key, cell];
    if (!groups.has(fill.key)) groups.set(fill.key, groups.size);
    return [key, { ...cell, s: { ...cell.s, nativeFill: { group: groups.get(fill.key),
      xml: nativeFillXmlIdentity(fill.xml), palette: fill.palette, paint: fill.paint } } }];
  }));
}

it.each([false, true])('preserves native Normal formatting independently of cell XF zero, prefixed=%s', async prefix => {
  let wb = await workbookFromFile(source({ prefix }));
  expect(wb.normalFont).toMatchObject({ name: 'Arial', sz: 13 });
  const cells = structuredClone(cellState(wb));
  expect(wb.styleAt(wb.activeSheetId, 0, 0).bg).toBeUndefined();
  const style = wb.nativeNormalStyle;
  expect(style.fill).toContain('theme="4"'); expect(style.fill).toContain('tint="0.25"');
  expect(style.numberFormat).toBe('0.000" units"');
  for (let cycle = 0; cycle < 2; cycle++) {
    const out = await output(wb), normal = records(out.xml);
    expect(normal.xf.getAttribute('fontId')).toBe('0'); expect(normal.xf.getAttribute('applyFill')).toBe('1');
    expect(elements(normal.xf, 'alignment')[0].getAttribute('textRotation')).toBe('105');
    expect(elements(normal.xf, 'protection')[0].getAttribute('locked')).toBe('0');
    expect(normal.xf.getElementsByTagNameNS('urn:normal-test', 'record')[0].getAttributeNS('urn:normal-test', 'value')).toBe('keep');
    expect(elements(elements(normal.fill, 'patternFill')[0], 'fgColor')[0].getAttribute('theme')).toBe('4');
    expect(normal.border.getAttribute('diagonalUp')).toBe('1'); expect(normal.code).toBe(style.numberFormat);
    wb = await workbookFromFile(out.bytes);
    expect(cellState(wb)).toEqual(cells);
  }
});

it('keeps gradient and extended records losslessly rather than reducing them to solid paint', async () => {
  const pattern = '<fill><gradientFill degree="45"><stop position="0"><color theme="4"/></stop><stop position="1"><color rgb="FF123456"/></stop></gradientFill></fill>';
  const wb = await workbookFromFile(source({ pattern }));
  const normal = records((await output(wb)).xml);
  expect(elements(normal.fill, 'gradientFill')[0].getAttribute('degree')).toBe('45');
  expect(elements(elements(normal.fill, 'gradientFill')[0], 'stop')).toHaveLength(2);
});

it('retains literal encoded-looking custom number formats', async () => {
  const wb = await workbookFromFile(source({ code: '0&quot; _x005F_x0041_&quot;' }));
  expect(wb.nativeNormalStyle.numberFormat).toBe('0" _x0041_"');
  const back = await workbookFromFile((await output(wb)).bytes);
  expect(back.nativeNormalStyle.numberFormat).toBe(wb.nativeNormalStyle.numberFormat);
});

it('copies definitions through drafts and sheet extraction without aliasing or changing clipboard cell formats', async () => {
  const wb = await workbookFromFile(source()), before = structuredClone(wb.nativeNormalStyle);
  const draft = new Workbook(wb.toJSON()), copy = wb.sheetToWorkbook(wb.activeSheetId);
  expect(draft.nativeNormalStyle).toEqual(before); expect(copy.nativeNormalStyle).toEqual(before);
  draft.nativeNormalStyle.numberFormat = '0%'; expect(wb.nativeNormalStyle).toEqual(before);
  const out = await output(copy), back = await workbookFromFile(out.bytes);
  expect(back.nativeNormalStyle.numberFormat).toBe(before.numberFormat);
  expect(wb.copyCells(wb.activeSheetId, [0], [0, 1])).toEqual(copy.copyCells(copy.activeSheetId, [0], [0, 1]));
});

it('uses externally edited native Normal records instead of stale private metadata', async () => {
  const wb = await workbookFromFile(source()), out = await output(wb, false);
  const zip = X.CFB.read(out.bytes, { type: 'array' }), part = X.CFB.find(zip, '/xl/styles.xml');
  part.content = new TextEncoder().encode(out.xml.replace('vertical="top" wrapText="1" indent="2" textRotation="105"', 'vertical="bottom" wrapText="0"'));
  part.size = part.content.length;
  const back = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }));
  expect(back.nativeNormalStyle.xf).toContain('vertical="bottom" wrapText="0"');
});

it('omits entirely default Normal records and keeps ordinary workbooks unchanged', async () => {
  const wb = await workbookFromFile(otherProgramsXlsx());
  expect(wb.nativeNormalStyle).toBeNull(); expect(wb.toJSON()).not.toHaveProperty('nativeNormalStyle');
  expect((await workbookFromFile((await output(wb)).bytes)).nativeNormalStyle).toBeNull();
});

it.each(['xf', 'fill', 'border', 'numberFormat'])('rejects malformed draft Normal %s records', key => {
  const value = { xf: `<xf xmlns="${MAIN}"/>`, fill: `<fill xmlns="${MAIN}"/>`, border: `<border xmlns="${MAIN}"/>`, numberFormat: 'General' };
  value[key] = key === 'numberFormat' ? {} : '<other xmlns="urn:wrong"/>';
  expect(() => normalizeNativeNormalStyle(value)).toThrow(/Normal style/);
});

it('resolves a built-in Normal number format without a custom numFmt record', () => {
  const xml = `<styleSheet xmlns="${MAIN}"><fonts/><fills><fill/></fills><borders><border/></borders><cellStyleXfs><xf numFmtId="9"/></cellStyleXfs><cellStyles><cellStyle builtinId="0" xfId="0"/></cellStyles></styleSheet>`;
  const styles = readXlsxStyles({ SSF: { 9: '0%' }, files: { 'xl/styles.xml': { content: new TextEncoder().encode(xml) } } });
  expect(styles.nativeNormalStyle.numberFormat).toBe(9);
});

it.each([14, 27])('retains built-in Normal format %s rather than fixing its locale-sensitive code', async id => {
  const wb = await workbookFromFile(source({ normalNumFmt: id }));
  expect(wb.nativeNormalStyle.numberFormat).toBe(id);
  const out = await output(wb);
  expect(records(out.xml).xf.getAttribute('numFmtId')).toBe(String(id));
  expect((await workbookFromFile(out.bytes)).nativeNormalStyle.numberFormat).toBe(id);
});

it.each(['General', ''])('retains explicitly declared custom Normal format %j', async code => {
  const wb = await workbookFromFile(source({ code })), out = await output(wb);
  expect(Number(records(out.xml).xf.getAttribute('numFmtId'))).toBeGreaterThanOrEqual(164);
  expect(records(out.xml).code).toBe(code);
  expect((await workbookFromFile(out.bytes)).nativeNormalStyle.numberFormat).toBe(code);
});

it.each([-1, 164, 1.5, Infinity])('rejects a draft Normal format identifier outside the builtin domain: %s', numberFormat => {
  expect(() => normalizeNativeNormalStyle({ xf: `<xf xmlns="${MAIN}"/>`, fill: `<fill xmlns="${MAIN}"/>`,
    border: `<border xmlns="${MAIN}"/>`, numberFormat })).toThrow(/Normal style/);
});

it('bounds oversized records before parsing malformed XML', () => {
  expect(() => readNativeNormalStyle({ xf: 'x'.repeat(1048577), fill: '<fill/>', border: '<border/>', numberFormat: 0 })).toThrow(/Normal style/);
});
