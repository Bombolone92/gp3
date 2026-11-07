import { expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { readXlsxConditionalFormats } from '../src/core/xlsx-condformat.js';
import { scaleColor } from '../src/core/condformat.js';
import { otherProgramsXlsx } from './helpers/xlsx-fixture.js';
import * as X from '../src/vendor/xlsx.mjs';

const parser = new (new JSDOM('').window.DOMParser)();
const colors = ['ff0000', '0000ff'], triple = ['ff0000', 'ffff00', '00ff00'];
const g = { r1: 2, c1: 3, r2: 6, c2: 3 };
const look = (wb, r, c = 3, id = wb.activeSheetId) => wb.conditionalStyle(id, r, c, wb.getValue(id, r, c))?.bg;
const scaleXml = (stops, paint = colors, sqref = 'D3:D7') => `<conditionalFormatting sqref="${sqref}"><cfRule type="colorScale" priority="1"><colorScale>${stops.map(([type, val]) => `<cfvo type="${type}"${val == null ? '' : ` val="${val}"`}/>`).join('')}${paint.map(c => `<color rgb="FF${c.toUpperCase()}"/>`).join('')}</colorScale></cfRule></conditionalFormatting>`;
async function native(stops, paint, values = [0, 1, 2, 3, 4], sqref = 'D3:D7') {
  const rows = values.map((v, i) => `<row r="${i + 3}"><c r="D${i + 3}"><v>${v}</v></c></row>`).join('');
  return workbookFromFile(otherProgramsXlsx({ sheetXml: { Data: { rows, tail: scaleXml(stops, paint, sqref) } } }), 'native.xlsx');
}
async function roundtrip(wb, privateData = false) {
  const bytes = new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), zip = X.CFB.read(bytes, { type: 'array' });
  const text = path => new TextDecoder().decode(X.CFB.find(zip, path).content);
  const xml = parser.parseFromString(text('/xl/worksheets/sheet1.xml'), 'application/xml');
  expect(xml.querySelector('parsererror')).toBeNull();
  if (!privateData) {
    const part = X.CFB.find(zip, '/xl/workbook.xml');
    part.content = new TextEncoder().encode(text('/xl/workbook.xml').replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, '')); part.size = part.content.length;
  }
  return { wb: await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'saved.xlsx'), xml };
}
// Expected RGBs measured in desktop Excel; its signed channel deltas truncate.
const cases = [
  ['two colors', [['min'], ['max']], colors, [0, 1, 2, 3, 4], ['ff0000', 'c0003f', '80007f', '4000bf', '0000ff']],
  ['unequal channels', [['min'], ['max']], ['020304', 'fd8041'], [0, 1, 2, 3, 4], ['020304', '402213', '7f4122', 'be6031', 'fd8041']],
  ['three colors', [['min'], ['percent', 50], ['max']], triple, [0, 1, 2, 3, 4], ['ff0000', 'ff7f00', 'ffff00', '80ff00', '00ff00']],
  ['equal values', [['min'], ['percent', 50], ['max']], triple, [5, 5, 5, 5, 5], Array(5).fill('00ff00')],
  ['percent bounds', [['percent', 20], ['percent', 80]], colors, [0, 20, 50, 80, 100], ['ff0000', 'ff0000', '80007f', '0000ff', '0000ff']],
  ['percentile bounds', [['percentile', 25], ['percentile', 75]], colors, [0, 1, 2, 3, 100], ['ff0000', 'ff0000', '80007f', '0000ff', '0000ff']],
  ['percentile midpoint', [['min'], ['percentile', 25], ['max']], triple, [0, 1, 2, 3, 100], ['ff0000', 'ffff00', 'fdff00', 'faff00', '00ff00']],
  ['number bounds', [['num', 0], ['num', 10], ['num', 100]], triple, [0, 1, 5, 10, 50], ['ff0000', 'ff1900', 'ff7f00', 'ffff00', '8eff00']],
  ['reversed bounds', [['num', 100], ['num', 0]], colors, [0, 10, 50, 90, 100], ['ff0000', 'e60019', '80007f', '1a00e5', '0000ff']],
  ['midpoint below low', [['num', 0], ['num', -10], ['num', 100]], triple, [-10, 0, 5, 50, 100], ['ff0000', 'ffff00', 'f3ff00', '80ff00', '00ff00']],
  ['midpoint above high', [['num', 0], ['num', 110], ['num', 100]], triple, [0, 50, 100, 110, 120], ['ff0000', 'ff7f00', 'ffff00', '00ff00', '00ff00']],
  ['equal bounds', [['num', 10], ['num', 10]], colors, [0, 5, 10, 15, 20], ['ff0000', 'ff0000', '0000ff', '0000ff', '0000ff']],
];
it.each(cases)('preserves native %s through repeat saves and live edits', async (_, stops, paint, values, expected) => {
  let wb = await native(stops, paint, values);
  for (let pass = 0; pass < 3; pass++) {
    expect(values.map((_, i) => look(wb, i + 2))).toEqual(expected.map(c => `#${c}`));
    const before = wb.toJSON(), result = await roundtrip(wb);
    expect(wb.toJSON()).toEqual(before);
    expect(result.xml.querySelector('cfRule').getAttribute('type')).toBe('colorScale');
    expect(result.xml.querySelectorAll('cfvo')).toHaveLength(stops.length);
    wb = result.wb;
  }
  const before = values.map((_, i) => look(wb, i + 2));
  wb.setInput(wb.activeSheetId, 2, 3, '200');
  const back = (await roundtrip(wb)).wb;
  expect(values.map((_, i) => look(back, i + 2))).toEqual(values.map((_, i) => look(wb, i + 2)));
  wb.undo(); expect(values.map((_, i) => look(wb, i + 2))).toEqual(before);
});

it.each([false, true])('exports app-created scales and custom limits (private=%s)', async privateData => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setCells(id, [0, 25, 50, 75, 100].map((v, i) => ({ r: i + 2, c: 3, cell: { v } })));
  wb.addRule(id, { type: 'scale', range: g, from: '#f00', mid: '#ff0', to: '#0f0', scaleMin: ' = 20', scaleMid: '  ', scaleMax: ' =80' });
  const before = Array.from({ length: 5 }, (_, i) => look(wb, i + 2)), { wb: back } = await roundtrip(wb, privateData);
  expect(Array.from({ length: 5 }, (_, i) => look(back, i + 2))).toEqual(before);
  expect(before[2]).toBe('#ffff00');
});

it.each(['min', 'percentile'])('shares %s statistics across disjoint areas without reading the gap', async type => {
  const wb = await native(type === 'min' ? [['min'], ['max']] : [['percentile', 25], ['percentile', 75]], colors, [0, 10, 999, 90, 100], 'D3:D4 D6:D7');
  expect(wb.activeSheet.rules).toHaveLength(2);
  expect(look(wb, 4)).toBeUndefined();
  expect(look(wb, 3)).toBe(type === 'min' ? '#e60019' : '#f80007');
  expect(look(wb, 5)).toBe(type === 'min' ? '#1a00e5' : '#0800f7');
  const back = (await roundtrip(wb)).wb;
  for (const r of [2, 3, 4, 5, 6]) expect(look(back, r)).toBe(look(wb, r));
  wb.setInput(wb.activeSheetId, 6, 3, '200');
  expect(look(wb, 3)).not.toBe(look(back, 3));
});

it('ignores text, booleans, errors and blanks but includes calculated and spilled numbers', async () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.addRule(id, { type: 'scale', range: { ...g, r2: 10 }, from: '#ff0000', to: '#0000ff' });
  wb.setCells(id, [0, '1', true, { f: '1/0' }, null, { f: 'SEQUENCE(2,1,2,2)' }].map((v, i) => ({ r: i + 2, c: 3, cell: v && typeof v === 'object' ? v : { v } })));
  const back = (await roundtrip(wb)).wb;
  expect([2, 3, 4, 5, 6, 7, 8].map(r => look(back, r))).toEqual(['#ff0000', undefined, undefined, undefined, undefined, '#80007f', '#0000ff']);
});

it('preserves priorities, stops and nonconflicting formats around a color scale', async () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setCells(id, [0, 1, 2, 3, 4].map((v, i) => ({ r: i + 2, c: 3, cell: { v } })));
  wb.addRule(id, { type: 'formula', range: g, value: 'D3=1', stopIfTrue: true, style: { bg: '#ffffff' } });
  wb.addRule(id, { type: 'scale', range: g, from: '#ff0000', to: '#0000ff' });
  wb.addRule(id, { type: 'formula', range: g, value: 'TRUE', style: { bg: '#123456', bold: true } });
  const back = (await roundtrip(wb)).wb;
  expect(look(back, 3)).toBe('#ffffff');
  expect(back.conditionalStyle(back.activeSheetId, 4, 3, 2)).toEqual({ bg: '#80007f', bold: true });
});

it.each(['insertRows', 'insertCols', 'moveRows', 'moveCols', 'deleteRows', 'deleteCols', 'insertCells', 'deleteCells'])('keeps fixed cross-sheet thresholds live after %s and undo', method => {
  const wb = new Workbook({ sheets: [{ name: 'Data', cells: { '2,1': { v: 0 }, '3,1': { v: 10 } } }, { name: 'Colors', cells: { '2,3': { v: 5 } }, rules: [{ type: 'scale', range: g, from: '#ff0000', to: '#0000ff', scaleMin: 'Data!$B$3', scaleMax: 'Data!$B$4' }] }] });
  const id = wb.sheets[1].id, before = wb.toJSON();
  if (method === 'moveRows') wb.moveRows(wb.sheets[0].id, 2, 2, 6);
  else if (method === 'moveCols') wb.moveCols(wb.sheets[0].id, 1, 1, 5);
  else if (method.endsWith('Cells')) wb[method](wb.sheets[0].id, { r1: 0, c1: 1, r2: 0, c2: 1 });
  else wb[method](wb.sheets[0].id, 0, 1);
  expect(look(wb, 2, 3, id)).toBe('#80007f');
  wb.undo(); expect(wb.toJSON()).toEqual(before);
  wb.renameSheet(wb.sheets[0].id, 'New Data');
  expect(wb.sheets[1].rules[0].scaleMin).toBe("'New Data'!$B$3");
  expect(look(wb, 2, 3, id)).toBe('#80007f');
});

it('retains local scale formulas when duplicating a sheet', async () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setCells(id, [{ r: 0, c: 0, cell: { v: 0 } }, { r: 1, c: 0, cell: { v: 10 } }, { r: 2, c: 3, cell: { v: 5 } }]);
  wb.addRule(id, { type: 'scale', range: g, from: '#ff0000', to: '#0000ff', scaleMin: '$A$1', scaleMax: '$A$2' });
  const copy = wb.duplicateSheet(id);
  expect(look(wb, 2, 3, copy.id)).toBe('#80007f');
  wb.setInput(copy.id, 1, 0, '20');
  expect(look(wb, 2, 3, copy.id)).toBe('#c0003f');
  expect(look(wb, 2, 3, id)).toBe('#80007f');
  const back = (await roundtrip(wb)).wb;
  expect(look(back, 2, 3, back.sheets[1].id)).toBe('#c0003f');
});

it('evaluates fixed thresholds once per revision and notices volatile formulas', () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setCells(id, Array.from({ length: 100 }, (_, r) => ({ r, c: 0, cell: { v: r } })));
  wb.addRule(id, { type: 'scale', range: { r1: 0, c1: 0, r2: 1048575, c2: 0 }, scaleMin: '0', scaleMax: 'MAX($A:$A)', from: '#000000', to: '#ffffff' });
  const spy = vi.spyOn(wb, 'evalRuleFormula');
  for (let r = 0; r < 100; r++) look(wb, r, 0);
  expect(spy).toHaveBeenCalledTimes(2);
  wb.setInput(id, 99, 0, '200'); look(wb, 1, 0);
  expect(spy).toHaveBeenCalledTimes(4);
  wb.updateRule(id, wb.activeSheet.rules[0].id, { scaleMax: 'TODAY()' });
  expect(wb.hasVolatileFormulas()).toBe(true);
});

it('rejects malformed native thresholds and unsafe color strings', async () => {
  for (const stops of [[['num', 'SUM('], ['max']], [['percent', -1], ['max']], [['percentile', 101], ['max']], [['unknown'], ['max']]]) {
    expect(readXlsxConditionalFormats(scaleXml(stops), {}, {})).toEqual([]);
  }
  expect(scaleColor({ from: 'url(https://invalid.test/x)', to: '#123456' }, 0, 0, 1)).toBe('#ffffff');
  expect(scaleColor({ from: '#f00', to: '#00f' }, 1, 0, 1, [{ error: '#N/A' }, 0, 1])).toBeNull();
});

it('retains names referenced only by scale thresholds in extracted sheets', () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.defineName('LowerLimit', '0'); wb.defineName('UpperLimit', '10');
  wb.setInput(id, 2, 3, '5');
  wb.addRule(id, { type: 'scale', range: g, from: '#ff0000', to: '#0000ff', scaleMin: 'LowerLimit', scaleMax: 'UpperLimit' });
  const extracted = wb.sheetToWorkbook(id);
  expect(extracted.names.map(n => n.name).sort()).toEqual(['LowerLimit', 'UpperLimit']);
  expect(look(extracted, 2)).toBe('#80007f');
});

it('counts overlapping sqref areas in percentile statistics', async () => {
  const wb = await native([['num', 0], ['percentile', 40]], colors, [0, 10, 20, 30, 100], 'D3:D5 D5:D7');
  expect(look(wb, 3)).toBe('#80007f');
  const back = (await roundtrip(wb)).wb;
  expect(look(back, 3)).toBe('#80007f');
});

it('excludes blanks and errors before combining separate percentile areas', async () => {
  const rows = '<row r="3"><c r="D3"><v>0</v></c></row><row r="4"><c r="D4"><v>10</v></c></row><row r="6"><c r="D6" t="e"><v>#DIV/0!</v></c></row><row r="7"><c r="D7"><v>90</v></c></row><row r="8"><c r="D8"><v>100</v></c></row>';
  const tail = scaleXml([['percentile', 25], ['percentile', 75]], colors, 'D3:D5 D6:D8');
  const wb = await workbookFromFile(otherProgramsXlsx({ sheetXml: { Data: { rows, tail } } }), 'areas.xlsx');
  expect(look(wb, 3)).toBe('#f80007'); expect(look(wb, 6)).toBe('#0800f7');
  expect(look(wb, 4)).toBeUndefined(); expect(look(wb, 5)).toBeUndefined();
  const back = (await roundtrip(wb)).wb;
  for (let r = 2; r < 8; r++) expect(look(back, r)).toBe(look(wb, r));
});
