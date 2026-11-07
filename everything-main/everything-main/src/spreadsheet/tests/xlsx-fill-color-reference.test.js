import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { xlsxAttr, xlsxElements } from '../src/core/xlsx-styles.js';
import { otherProgramsXlsx } from './helpers/xlsx-fixture.js';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';
import { fillColorCss, normalizeFillColor } from '../src/core/fill-color.js';

const theme = { theme: 4, base: '#4f81bd', rgb: '#4f81bd' };
async function saved(wb) {
  const data = new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer());
  const zip = X.CFB.read(data, { type: 'array' });
  const text = path => new TextDecoder().decode(X.CFB.find(zip, path).content);
  const set = (path, value) => X.CFB.utils.cfb_add(zip, path, new TextEncoder().encode(value));
  return { data, text, set, finish: () => X.CFB.write(zip, { type: 'array', fileType: 'zip' }), native: () => {
    set('/xl/workbook.xml', text('/xl/workbook.xml').replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
    return X.CFB.write(zip, { type: 'array', fileType: 'zip' });
  } };
}

function source(color) {
  return otherProgramsXlsx({ styles: {
    fills: [`<fill><patternFill patternType="solid">${color}<bgColor indexed="64"/></patternFill></fill>`],
    cellXfs: ['<xf fontId="0" fillId="2" borderId="0" numFmtId="0" xfId="0"/>'],
  }, sheetXml: { Data: { rows: '<row r="3"><c r="C3" s="1"><v>37</v></c></row>' } } });
}

it.each([
  ['<fgColor theme="4" tint="0.3"/>', { theme: 4, tint: 0.3 }],
  ['<fgColor indexed="3"/>', { indexed: 3 }],
])('preserves native solid-fill reference identity through app and native-only saves: %s', async (color, identity) => {
  let wb = await workbookFromFile(source(color));
  expect(wb.getCell(wb.activeSheetId, 2, 2).s.bg).toMatchObject(identity);
  for (let cycle = 0; cycle < 2; cycle++) {
    const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
    const text = path => new TextDecoder().decode(X.CFB.find(zip, path).content);
    const xml = text('/xl/styles.xml'), sheet = text('/xl/worksheets/sheet1.xml');
    const index = Number(xlsxAttr(xlsxElements(sheet, 'c').find(c => xlsxAttr(c, 'r') === 'C3'), 's'));
    const xf = xlsxElements(xlsxElements(xml, 'cellXfs')[0], 'xf')[index];
    const fill = xlsxElements(xlsxElements(xml, 'fills')[0], 'fill')[Number(xlsxAttr(xf, 'fillId'))];
    for (const [key, value] of Object.entries(identity)) expect(xlsxAttr(xlsxElements(fill, 'fgColor')[0], key)).toBe(String(value));
    if (cycle) {
      const part = X.CFB.find(zip, '/xl/workbook.xml');
      part.content = new TextEncoder().encode(text('/xl/workbook.xml').replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
      part.size = part.content.length;
    }
    wb = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }));
    expect(wb.getCell(wb.activeSheetId, 2, 2).s.bg).toMatchObject(identity);
    expect(wb.getValue(wb.activeSheetId, 2, 2)).toBe(37);
  }
});

it.each(['cell', 'column', 'row'])('accepts an externally replaced %s fill identity even when its resolved RGB is unchanged', async target => {
  const sheet = { cells: { '2,2': { v: 'Identity' } } };
  if (target === 'cell') sheet.cells['2,2'].s = { bg: theme };
  else sheet[target === 'column' ? 'colStyles' : 'rowStyles'] = { 2: { bg: theme } };
  const wb = new Workbook({ sheets: [sheet] }), out = await saved(wb);
  out.set('/xl/styles.xml', out.text('/xl/styles.xml').replace(/<fgColor theme="4"\/>/g, '<fgColor rgb="FF4F81BD"/>'));
  const back = await workbookFromFile(out.finish()), point = target === 'cell' ? [2, 2] : target === 'column' ? [90, 2] : [2, 50];
  expect(back.styleAt(back.activeSheetId, ...point).bg).toBe('#4f81bd');
  const next = await saved(back);
  for (const bytes of [next.data, next.native()]) {
    const again = await workbookFromFile(bytes);
    expect(again.styleAt(again.activeSheetId, ...point).bg).toBe('#4f81bd');
  }
});

it('keeps cell, row and column theme bindings through an external theme edit', async () => {
  const wb = new Workbook({ sheets: [{ colStyles: { 2: { bg: theme } }, rowStyles: { 4: { bg: theme } }, cells: { '2,2': { v: 'Theme', s: { bg: theme } } } }] });
  const out = await saved(wb);
  out.set('/xl/theme/theme1.xml', out.text('/xl/theme/theme1.xml').replace(/<a:accent1>[\s\S]*?<\/a:accent1>/, '<a:accent1><a:srgbClr val="286844"/></a:accent1>'));
  const back = await workbookFromFile(out.finish());
  for (const point of [[2, 2], [90, 2], [4, 20]]) expect(back.styleAt(back.activeSheetId, ...point).bg).toEqual({ theme: 4, base: '#286844', rgb: '#286844' });
});

it.each(['theme', 'indexed'])('copies a %s fill into a different palette using its source paint', async key => {
  const ref = { [key]: 4, base: '#286844', rgb: '#286844' };
  const source = new Workbook({ colorPalette: { [key]: [null, null, null, null, '#286844'] }, sheets: [{ cells: { '1,2': { v: 'Copied', s: { bg: ref } } } }] });
  const target = new Workbook({ colorPalette: { [key]: [null, null, null, null, '#aabbcc'] } });
  target.pasteCells(target.activeSheetId, source.copyRange(source.activeSheetId, parseRange('C2')), 3, 4);
  expect(fillColorCss(target.styleAt(target.activeSheetId, 3, 4).bg)).toBe('#286844');
  const out = await saved(target);
  for (const bytes of [out.data, out.native()]) {
    const back = await workbookFromFile(bytes);
    expect(back.styleAt(back.activeSheetId, 3, 4).bg).toBe('#286844');
  }
  expect(source.colorPalette[key][4]).toBe('#286844'); expect(target.colorPalette[key][4]).toBe('#aabbcc');
});

it('detaches reference fills, keeps edits atomic, and restores binding on undo and draft/sheet copies', async () => {
  const wb = new Workbook(), id = wb.activeSheetId, supplied = { ...theme };
  wb.applyStyle(id, parseRange('D4'), { bg: supplied });
  supplied.base = supplied.rgb = '#123456';
  expect(wb.styleAt(id, 3, 3).bg).toEqual(theme);
  expect(Object.isFrozen(wb.styleAt(id, 3, 3).bg)).toBe(true);
  wb.applyStyle(id, parseRange('D4'), { bg: theme.rgb });
  expect(wb.styleAt(id, 3, 3).bg).toBe(theme.rgb);
  wb.undo(); expect(wb.styleAt(id, 3, 3).bg).toEqual(theme);
  wb.applyStyle(id, parseRange('D4'), { bg: null });
  expect(wb.styleAt(id, 3, 3)?.bg).toBeUndefined();
  wb.undo(); expect(wb.styleAt(id, 3, 3).bg).toEqual(theme);
  const draft = new Workbook(JSON.parse(JSON.stringify(wb.toJSON()))), sheet = wb.sheetToWorkbook(id);
  expect(draft.styleAt(draft.activeSheetId, 3, 3).bg).toEqual(theme);
  expect(sheet.styleAt(sheet.activeSheetId, 3, 3).bg).toEqual(theme);
  expect((await workbookFromFile((await saved(sheet)).native())).activeSheet.cells.get('3,3').s.bg).toEqual(theme);
});

it('preserves conditional and custom table differential fill references in native XLSX', async () => {
  const wb = new Workbook({ sheets: [{ cells: { '0,0': { v: 'Header' }, '1,0': { v: 9 } },
    tables: [{ name: 'Items', style: 'custom', customStyle: { headerRow: { bg: theme } }, range: parseRange('A1:A3') }],
  }] });
  wb.addRule(wb.activeSheetId, { range: parseRange('A2:A3'), type: 'gt', value: 5,
    style: { bg: { indexed: 3, base: '#00ff00', rgb: '#00ff00' } } });
  const out = await saved(wb);
  expect(out.text('/xl/styles.xml')).toContain('<bgColor theme="4"/>');
  expect(out.text('/xl/styles.xml')).toContain('<bgColor indexed="3"/>');
  for (const bytes of [out.data, out.native()]) {
    const back = await workbookFromFile(bytes), id = back.activeSheetId;
    expect(back.conditionalStyle(id, 0, 0, 'Header').bg).toEqual(theme);
    expect(back.conditionalStyle(id, 1, 0, 9).bg).toEqual({ indexed: 3, base: '#00ff00', rgb: '#00ff00' });
  }
});

it.each([{}, { theme: -1, base: '#000000', rgb: '#000000' }, { indexed: 66, base: '#000000', rgb: '#000000' },
  { theme: 4, base: '#000000', rgb: 'url(x)' }, { theme: 4, base: '#000000', rgb: '#000000', tint: Infinity }])
('rejects malformed fill references while retaining the previous valid fill: %j', bad => {
  expect(normalizeFillColor(bad)).toBeNull();
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.applyStyle(id, parseRange('A1'), { bg: theme });
  wb.applyStyle(id, parseRange('A1'), { bg: bad });
  expect(wb.styleAt(id, 0, 0).bg).toEqual(theme);
});
