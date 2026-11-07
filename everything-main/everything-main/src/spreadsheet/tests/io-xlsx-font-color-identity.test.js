// @vitest-environment jsdom
import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { parseRange } from '../src/core/cell.js';
import { fontColorCss, normalizeFontColor } from '../src/core/font-color.js';
import { otherProgramsXlsx } from './helpers/xlsx-fixture.js';
import { cellsToHtml, parseHtmlClipboard } from '../src/core/clipboard.js';

async function saved(wb) {
  const blob = await workbookToXlsx(wb);
  const data = await new Promise(resolve => { const r = new FileReader(); r.onload = () => resolve(r.result); r.readAsArrayBuffer(blob); });
  const zip = X.CFB.read(new Uint8Array(data), { type: 'array' });
  const text = path => new TextDecoder().decode(X.CFB.find(zip, path).content);
  return { data, text, native: () => {
    X.CFB.utils.cfb_add(zip, '/xl/workbook.xml', new TextEncoder().encode(text('/xl/workbook.xml').replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, '')));
    return X.CFB.write(zip, { type: 'array', fileType: 'zip' });
  } };
}
const read = data => workbookFromFile(data, 'fonts.xlsx');
const look = (wb, r, c) => wb.conditionalStyle(wb.activeSheetId, r, c, wb.getValue(wb.activeSheetId, r, c));

// Table text applies when the font color equals Normal in native
// identity. RGB black, theme black and automatic are different identities.
it.each([
  [null, ['#843721', '#000000', 'windowtext', '#237864']],
  ['#000000', ['#843721', '#843721', 'windowtext', '#237864']],
  ['windowtext', ['#843721', '#000000', '#843721', '#237864']],
])('preserves table font inheritance with Normal color %s', async (color, expected) => {
  const colors = [undefined, '#000000', 'windowtext', '#237864'];
  const wb = new Workbook({ normalFont: color ? { name: 'Calibri', sz: 12, color } : null, sheets: [{
    cells: Object.fromEntries(colors.flatMap((color, c) => [[`0,${c}`, { v: `Header ${c}`, ...(color ? { s: { color } } : {}) }], [`1,${c}`, { v: c + 1 }]])),
    tables: [{ name: 'Items', style: 'custom', range: parseRange('A1:D5'), customStyle: {
      headerRow: { color: '#843721', bold: true }, wholeTable: { color: '#3256a9' },
    } }],
  }] });
  const out = await saved(wb);
  for (const back of [wb, new Workbook(wb.toJSON()), await read(out.data), await read(out.native())]) {
    expect(colors.map((_, c) => look(back, 0, c).color)).toEqual(expected);
    expect(look(back, 1, 0).color).toBe('#3256a9');
  }
});

it('retains custom theme and palette colors, tints and reference identity in native exports', async () => {
  const source = otherProgramsXlsx({
    styles: { fonts: ['<font><name val="Calibri"/><sz val="12"/><color theme="4" tint="0.4"/></font>', '<font><name val="Calibri"/><sz val="12"/><color indexed="2"/></font>'],
      cellXfs: [1, 2].map(fontId => `<xf fontId="${fontId}" fillId="0" borderId="0" numFmtId="0" xfId="0" applyFont="1"/>`) },
    sheetXml: { Data: { rows: '<row r="1"><c r="A1" s="1" t="inlineStr"><is><t>Themed</t></is></c><c r="B1" s="2" t="inlineStr"><is><t>Indexed</t></is></c></row>' } },
    patch: {
      '/xl/theme/theme1.xml': xml => xml.replace(/<a:accent1>[\s\S]*?<\/a:accent1>/, '<a:accent1><a:srgbClr val="286844"/></a:accent1>'),
      '/xl/styles.xml': xml => xml.replace('</styleSheet>', '<colors><indexedColors><rgbColor rgb="FF000000"/><rgbColor rgb="FFFFFFFF"/><rgbColor rgb="FF325678"/></indexedColors></colors></styleSheet>'),
    },
  });
  const wb = await read(source);
  const before = [0, 1].map(c => wb.styleAt(wb.activeSheetId, 0, c).color);
  expect(before[0]).toMatchObject({ theme: 4, base: '#286844', tint: 0.4 });
  expect(before[1]).toEqual({ indexed: 2, base: '#325678', rgb: '#325678' });
  wb.applyStyle(wb.activeSheetId, parseRange('A1'), { color: '#876543' });
  expect(wb.styleAt(wb.activeSheetId, 0, 0).color).toBe('#876543');
  wb.undo();
  const out = await saved(wb);
  expect(out.text('/xl/theme/theme1.xml')).toContain('<a:accent1><a:srgbClr val="286844"/></a:accent1>');
  expect(out.text('/xl/styles.xml')).toContain('<color theme="4" tint="0.4"/>');
  expect(out.text('/xl/styles.xml')).toContain('<color indexed="2"/>');
  for (const back of [await read(out.data), await read(out.native())]) {
    expect([0, 1].map(c => back.styleAt(back.activeSheetId, 0, c).color)).toEqual(before);
  }
  const html = cellsToHtml([['Themed']], [[wb.getCell(wb.activeSheetId, 0, 0)]]);
  expect(html).toContain(`color:${fontColorCss(before[0])}`);
  expect(parseHtmlClipboard(html).cells[0][0].s.color).toEqual(before[0]);
});

it.each([{}, { theme: 12, rgb: '#000000', base: '#000000' }, { theme: 0, rgb: 'url(https://example.com)', base: '#000000' }, { indexed: 2, rgb: '#000000', base: '#000000', tint: Infinity }])
  ('rejects malformed font references without emitting CSS or native references: %j', color => {
    expect(normalizeFontColor(color)).toBeNull();
    const html = cellsToHtml([['x']], [[{ v: 'x', s: { color } }]]);
    expect(html).not.toContain('color:url(');
  });

it('copies reference colors between different palettes using source paint, without changing either palette', async () => {
  const color = { theme: 4, base: '#286844', rgb: '#286844' };
  const source = new Workbook({ colorPalette: { theme: [null, '#000000', null, null, '#286844'] }, sheets: [{ cells: { '0,0': { v: 'Copied', s: { color } } } }] });
  const target = new Workbook({ colorPalette: { theme: [null, '#000000', null, null, '#9b2138'] } });
  const id = target.activeSheetId;
  target.pasteCells(id, source.copyRange(source.activeSheetId, parseRange('A1')), 2, 2);
  expect(fontColorCss(target.styleAt(id, 2, 2).color)).toBe('#286844');
  expect(target.colorPalette.theme[4]).toBe('#9b2138');
  expect(source.colorPalette.theme[4]).toBe('#286844');
  const out = await saved(target);
  for (const back of [await read(out.data), await read(out.native())]) {
    expect(back.styleAt(back.activeSheetId, 2, 2).color).toBe('#286844');
  }
});

it('accepts an external theme edit over stale private resolved colors', async () => {
  const color = { theme: 4, base: '#286844', rgb: '#286844' };
  const wb = new Workbook({ colorPalette: { theme: [null, '#000000', null, null, '#286844'] }, sheets: [{
    colStyles: { 0: { color } }, rowStyles: { 2: { color } }, cells: { '0,0': { v: 'Cell', s: { color } } },
  }] });
  const out = await saved(wb);
  const zip = X.CFB.read(new Uint8Array(out.data), { type: 'array' });
  const xml = out.text('/xl/theme/theme1.xml').replace('val="286844"', 'val="913C57"');
  X.CFB.utils.cfb_add(zip, '/xl/theme/theme1.xml', new TextEncoder().encode(xml));
  const back = await read(X.CFB.write(zip, { type: 'array', fileType: 'zip' }));
  for (const [r,c] of [[0,0], [99,0], [2,9]]) {
    expect(back.styleAt(back.activeSheetId, r, c).color).toEqual({ theme: 4, base: '#913c57', rgb: '#913c57' });
  }
});

it('detaches and validates reference colors supplied in formatting patches', () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  const color = { theme: 4, base: '#286844', rgb: '#286844' };
  wb.applyStyle(id, parseRange('B2'), { color });
  color.base = color.rgb = '#ff0000';
  expect(wb.styleAt(id, 1, 1).color).toEqual({ theme: 4, base: '#286844', rgb: '#286844' });
  expect(Object.isFrozen(wb.styleAt(id, 1, 1).color)).toBe(true);
  wb.applyStyle(id, parseRange('B2'), { color: { theme: -1, base: '#ff0000', rgb: '#ff0000' } });
  expect(fontColorCss(wb.styleAt(id, 1, 1).color)).toBe('#286844');
});

it('detaches rule reference colors across edits, JSON reloads and undo', () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  const color = { theme: 4, base: '#286844', rgb: '#286844' };
  const rule = wb.addRule(id, { range: parseRange('B2:B5'), type: 'gt', value: 2, style: { color } });
  color.base = color.rgb = '#ff0000';
  expect(fontColorCss(wb.activeSheet.rules[0].style.color)).toBe('#286844');
  const json = JSON.parse(JSON.stringify(wb.toJSON()));
  const copy = new Workbook(json);
  json.sheets[0].rules[0].style.color.rgb = '#123456';
  expect(fontColorCss(copy.activeSheet.rules[0].style.color)).toBe('#286844');
  const next = { indexed: 2, base: '#345678', rgb: '#345678' };
  wb.updateRule(id, rule, { style: { color: next } });
  next.rgb = next.base = '#abcdef';
  expect(fontColorCss(wb.activeSheet.rules[0].style.color)).toBe('#345678');
  wb.undo();
  expect(fontColorCss(wb.activeSheet.rules[0].style.color)).toBe('#286844');
});

it.each(['#f00', '#1234', '#12345678', '#ABCDEF', 'windowtext'])('retains existing CSS color paint %s', color => {
  expect(fontColorCss(color)).toBe(color);
});
