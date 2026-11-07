import { expect, it } from 'vitest';
import { NATIVE_ICON_SETS, nativeIconFor } from '../src/core/native-icons.js';
import { readXlsxConditionalFormats } from '../src/core/xlsx-condformat.js';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import * as X from '../src/vendor/xlsx.mjs';
const range = { r1: 1, c1: 0, r2: 6, c2: 0 };
const cf = (set = '3Arrows', limits = '<cfvo type="percent" val="0"/><cfvo type="percent" val="33"/><cfvo type="percent" val="67"/>', attrs = '', sqref = 'A2:A7') => `<conditionalFormatting sqref="${sqref}"><cfRule type="iconSet" priority="1"><iconSet iconSet="${set}" ${attrs}>${limits}</iconSet></cfRule></conditionalFormatting>`;
const read = xml => readXlsxConditionalFormats(xml, { dxfs: [] });
const look = (wb, r, c = 0) => wb.conditionalStyle(wb.activeSheetId, r, c, wb.getValue(wb.activeSheetId, r, c));
const indices = (wb, c = 0, rows = [1, 2, 3, 4, 5, 6]) => rows.map(r => look(wb, r, c)?.iconIndex);
function make(xml = cf(), values = [0, 20, 40, 60, 80, 100]) {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setCells(id, values.map((v, r) => ({ r: r + 1, c: 0, cell: { v } })));
  for (const rule of read(xml)) wb.addRule(id, rule);
  return wb;
}
async function zipOf(wb) { return X.CFB.read(new Uint8Array(await(await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' }); }
const xmlOf = (zip, path = '/xl/worksheets/sheet1.xml') => new TextDecoder().decode(X.CFB.find(zip, path).content);
const change = (zip, path, fn) => { const part = X.CFB.find(zip, path); part.content = new TextEncoder().encode(fn(xmlOf(zip, path))); part.size = part.content.length; };
async function reopen(wb, nativeOnly = false) {
  const zip = await zipOf(wb);
  if (nativeOnly) change(zip, '/xl/workbook.xml', xml => xml.replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  return workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'icons.xlsx');
}
it.each(Object.keys(NATIVE_ICON_SETS).filter(name => !NATIVE_ICON_SETS[name].extended))('imports, evaluates and natively round-trips %s', async name => {
  const set = NATIVE_ICON_SETS[name];
  const limits = Array.from({ length: set.count }, (_, i) => `<cfvo type="num" val="${i * 10}"/>`).join('');
  const values = Array.from({ length: set.count }, (_, i) => i * 10), rows = values.map((_, i) => i + 1);
  let wb = make(cf(name, limits), values);
  expect(indices(wb, 0, rows)).toEqual(rows.map(r => r - 1));
  for (const r of rows) {
    expect(look(wb, r).iconImage).toBe(set.images[r - 1]);
    const svg = decodeURIComponent(set.images[r - 1].split(',')[1]);
    expect(svg).toContain('viewBox="0 0 16 16"'); expect(svg).not.toMatch(/script|foreignObject|https?:\/\/(?!www.w3.org)/);
  }
  for (const nativeOnly of [false, true, true]) { wb = await reopen(wb, nativeOnly); expect(indices(wb, 0, rows)).toEqual(rows.map(r => r - 1)); }
});
it('keeps default family, value visibility, percent flag, reverse and exclusive boundaries', () => {
  const xml = cf('3Arrows', '<cfvo type="num" val="999"/><cfvo type="num" val="5" gte="0"/><cfvo type="num" val="15" gte="false"/>', 'reverse="true" showValue="false" percent="0"');
  const wb = make(xml, [0, 5, 10, 15, 20]);
  expect(wb.activeSheet.rules[0]).toMatchObject({ iconReverse: true, iconOnly: true, iconPercent: false, iconThreshold1Gte: false });
  expect(indices(wb).slice(0,5)).toEqual([undefined, undefined, 1, 1, 0]);
  expect(read(cf().replace('iconSet="3Arrows"', ''))[0].iconSet).toBe('3TrafficLights1');
});
it('evaluates percentile, fixed formulas, errors and unordered thresholds', () => {
  const wb = make(cf('3Arrows', '<cfvo type="num" val="0"/><cfvo type="percentile" val="33"/><cfvo type="formula" val="$C$1"/>'));
  wb.setInput(wb.activeSheetId, 0, 2, '70'); expect(indices(wb)).toEqual([0,0,1,1,2,2]);
  wb.setInput(wb.activeSheetId, 0, 2, '50'); expect(indices(wb)).toEqual([0,0,1,2,2,2]);
  wb.undo(); expect(indices(wb)).toEqual([0,0,1,1,2,2]);
  wb.setInput(wb.activeSheetId, 0, 2, '=1/0'); expect(indices(wb)).toEqual(Array(6).fill(undefined));
  const reversed = make(cf('3Arrows', '<cfvo type="num" val="0"/><cfvo type="num" val="70"/><cfvo type="num" val="30"/>'));
  expect(indices(reversed)).toEqual([0,0,2,2,2,2]);
});
it('retains native overflow behavior separately from equivalent numeric thresholds', () => {
  const values = [-1e308,-5e307,0,5e307,1e308];
  expect(indices(make(cf(), values)).slice(0,5)).toEqual([2,2,2,2,2]);
  const numeric = cf('3Arrows', '<cfvo type="num" val="0"/><cfvo type="num" val="-3.4e307"/><cfvo type="num" val="3.4e307"/>');
  expect(indices(make(numeric, values)).slice(0,5)).toEqual([undefined,undefined,1,2,2]);
  expect(indices(make(cf('3Arrows', '<cfvo type="percentile" val="0"/><cfvo type="percentile" val="33"/><cfvo type="percentile" val="67"/>'), values)).slice(0,5)).toEqual([0,0,1,2,2]);
});
it('shares a disjoint statistical domain, preserves it through partial moves, and copies to a new domain', async () => {
  const wb = make(cf('3Arrows', undefined, '', 'A2:A4 A6:A7')), id = wb.activeSheetId;
  expect(wb.activeSheet.rules).toHaveLength(2);
  wb.moveRange(id, { r1: 2,c1:0,r2:2,c2:0 }, 2, 3);
  expect(look(wb,2,3).iconIndex).toBe(0); expect(look(wb,5).iconIndex).toBe(2);
  const back = await reopen(wb,true); expect(look(back,2,3).iconIndex).toBe(0); expect(look(back,5).iconIndex).toBe(2);
  const rows = [5,6], cells = wb.copyCells(id,rows,[0]), conditionalFormats = wb.copyConditionalFormats(id,rows,[0]);
  wb.pasteCells(id,cells,1,5,{r:5,c:0},null,{conditionalFormats});
  expect(indices(wb,5,[1,2])).toEqual([0,2]);
});
it('copies explicit threshold references, keeps numeric thresholds and lets native edits win over metadata', async () => {
  const wb = make(cf('3Arrows', '<cfvo type="num" val="0"/><cfvo type="formula" val="C1"/><cfvo type="num" val="75"/>')), id = wb.activeSheetId;
  // Relative bounds authored in the app retain app copy semantics; XLSX
  // thresholds themselves are fixed references, as required by Excel.
  wb.updateRule(id,wb.activeSheet.rules[0].id,{iconThreshold1:'C1'});
  wb.setInput(id,0,2,'30'); wb.setInput(id,0,4,'50');
  const rows=[1,2,3,4,5,6]; wb.pasteCells(id,wb.copyCells(id,rows,[0]),1,2,{r:1,c:0},null,{conditionalFormats:wb.copyConditionalFormats(id,rows,[0])});
  expect(wb.activeSheet.rules[0].iconThreshold1).toBe('E1'); expect(indices(wb,2)).toEqual([0,0,0,1,2,2]);
  const zip=await zipOf(wb); change(zip,'/xl/worksheets/sheet1.xml',xml=>xml.replace('reverse="0"','reverse="1"'));
  const back=await workbookFromFile(X.CFB.write(zip,{type:'array',fileType:'zip'}),'edited.xlsx');
  expect(back.activeSheet.rules[0].iconReverse).toBe(true); expect(indices(back,2)).toEqual([2,2,2,1,0,0]);
});
it('ignores unsupported families and malformed bounds without drawing an unrelated fallback', () => {
  for (const xml of [cf('Unknown'),cf('5Arrows'),cf('3Arrows','<cfvo type="min"/><cfvo type="num" val="1"/><cfvo type="num" val="2"/>'),cf().replace('val="33"','val="101"'),cf().replace('val="67"','val="SUM("')]) expect(read(xml)).toEqual([]);
  expect(nativeIconFor({iconSet:'__proto__'},1,[0,1,2])).toBeNull();
  for (const value of [null,'10',true,Infinity,{error:'#NUM!'}]) expect(nativeIconFor({iconSet:'3Arrows'},value,[0,1,2])).toBeNull();
});
