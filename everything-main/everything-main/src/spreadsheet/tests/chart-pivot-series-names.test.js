import { expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { Workbook } from '../src/core/workbook.js';
import { chartData, normalizeChart, snapshotChartData } from '../src/core/charts.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { renderChartSvg } from '../src/ui/chartsvg.js';
import { parseModelXml } from '../src/core/data-model-metadata.js';
import * as X from '../src/vendor/xlsx.mjs';

const C = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
const caption = 'Net revenue & margin — 年';
const text = new TextDecoder(), bytes = new TextEncoder();
function fixture(type = 'column', standalone = false) {
  return new Workbook({ sheets: [{ name: 'Report', cells: {
    '0,1': { v: 'Custom report alias' }, '1,0': { v: 'North' }, '2,0': { v: 'South' },
    '1,1': { v: 3 }, '2,1': { v: 7 }, '1,2': { v: 4 }, '2,2': { v: 8 },
  }, charts: [normalizeChart({ type, anchor: { r: 5, c: 0 },
    range: { r1: 0, c1: 0, r2: 2, c2: 1 },
    pivotSource: { name: '[Book.xlsx]Report!Summary', standalone },
    sourceRefs: [{ nameRef: 'Report!B1', categories: 'Report!A2:A3', values: 'Report!B2:B3', sizes: 'Report!C2:C3' }],
  })] }] });
}
const chart = wb => wb.activeSheet.charts[0];
const data = wb => chartData(wb, wb.activeSheetId, chart(wb));
async function roundtrip(wb, { patch, metadata = false } = {}) {
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
  if (!metadata) {
    const part = X.CFB.find(zip, '/xl/workbook.xml');
    X.CFB.utils.cfb_add(zip, '/xl/workbook.xml', bytes.encode(text.decode(part.content)
      .replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, '')));
  }
  const part = X.CFB.find(zip, '/xl/charts/chart1_1.xml');
  const xml = patch ? patch(text.decode(part.content)) : text.decode(part.content);
  X.CFB.utils.cfb_add(zip, '/xl/charts/chart1_1.xml', bytes.encode(xml));
  return { wb: await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' })), xml };
}
const nameCache = (xml, body) => xml.replace(/(<c:tx><c:strRef><c:f>[\s\S]*?<\/c:f>)<c:strCache>[\s\S]*?<\/c:strCache>/,
  `$1<c:strCache>${body}</c:strCache>`);
const captionPatch = xml => nameCache(xml, '<c:ptCount val="2"/><c:pt idx="1"><c:v>Wrong point</c:v></c:pt>'
  + `<c:pt idx="0"><c:v>${caption.replace('&', '&amp;')}</c:v></c:pt>`);
const cachedName = xml => parseModelXml(xml).getElementsByTagNameNS(C, 'tx')[0]
  .getElementsByTagNameNS(C, 'v')[0]?.textContent;

it.each(['column', 'bar', 'line', 'area', 'scatter', 'bubble', 'radar', 'pie', 'donut'])
('preserves the native %s PivotChart caption independently of its worksheet alias', async type => {
  let { wb } = await roundtrip(fixture(type), { patch: captionPatch });
  expect(chart(wb).sourceRefs[0].pivotName).toBe(caption);
  expect(data(wb).series[0].name).toBe(caption);
  wb.setInput(wb.activeSheetId, 0, 1, 'Another report alias');
  wb.setInput(wb.activeSheetId, 1, 0, 'East');
  wb.setInput(wb.activeSheetId, 1, 1, '11');
  for (let cycle = 0; cycle < 2; cycle++) {
    const out = await roundtrip(wb); wb = out.wb;
    expect(cachedName(out.xml)).toBe(caption);
    expect(chart(wb).sourceRefs[0].nameRef).toBe('Report!B1');
    expect(data(wb).series[0]).toMatchObject({ name: caption, values: [11, 7], categories: ['East', 'South'] });
  }
  if (!['pie', 'donut'].includes(type)) {
    const svg = new JSDOM(renderChartSvg(data(wb), chart(wb), 720, 480));
    expect([...svg.window.document.querySelectorAll('text')].map(node => node.textContent)).toContain(caption);
  }
});

it.each([false, true])('preserves captions through JSON, duplication and native metadata, standalone=%s', async standalone => {
  let { wb } = await roundtrip(fixture('column', standalone), { patch: captionPatch });
  wb = new Workbook(wb.toJSON());
  wb.duplicateChart(wb.activeSheetId, chart(wb).id);
  wb = (await roundtrip(wb, { metadata: true })).wb;
  expect(wb.activeSheet.charts.map(ch => chartData(wb, wb.activeSheetId, ch).series[0].name)).toEqual([caption, caption]);
  expect(chart(wb).pivotSource.standalone).toBe(standalone);
});

it('adopts external native caption edits even when private drawing metadata exists', async () => {
  const { wb } = await roundtrip(fixture(), { patch: captionPatch });
  const out = await roundtrip(wb, { metadata: true, patch: xml => xml.replace(caption.replace('&', '&amp;'), 'Revised caption') });
  expect(data(out.wb).series[0].name).toBe('Revised caption');
});

it.each(['', '<c:ptCount val="1"/><c:pt idx="1"><c:v>Not the name</c:v></c:pt>'])
('uses the live header when a PivotChart has no cached point zero: %s', async cache => {
  const { wb } = await roundtrip(fixture(), { patch: xml => nameCache(xml, cache) });
  expect(chart(wb).sourceRefs[0].pivotName).toBeUndefined();
  expect(data(wb).series[0].name).toBe('Custom report alias');
});

it('preserves an explicit empty caption through native export and reopening', async () => {
  let { wb } = await roundtrip(fixture(), { patch: xml => nameCache(xml, '<c:ptCount val="1"/><c:pt idx="0"><c:v/></c:pt>') });
  for (let cycle = 0; cycle < 2; cycle++) {
    expect(data(wb).series[0].name).toBe('');
    wb = (await roundtrip(wb)).wb;
    expect(chart(wb).sourceRefs[0].pivotName).toBe('');
  }
});

it('preserves literal pivot captions, including an empty string without a name reference', async () => {
  for (const name of [caption, '']) {
    const { wb } = await roundtrip(fixture(), { patch: xml => xml.replace(/<c:tx>[\s\S]*?<\/c:tx>/,
      `<c:tx><c:v>${name.replace('&', '&amp;')}</c:v></c:tx>`) });
    expect(data(wb).series[0].name).toBe(name);
    const out = await roundtrip(wb);
    expect(cachedName(out.xml)).toBe(name);
    expect(data(out.wb).series[0].name).toBe(name);
  }
});

it('keeps ordinary chart names live and ignores retained pivot captions after detachment', async () => {
  const { wb } = await roundtrip(fixture(), { patch: captionPatch });
  delete chart(wb).pivotSource;
  wb.setInput(wb.activeSheetId, 0, 1, 'Live ordinary heading');
  expect(data(wb).series[0].name).toBe('Live ordinary heading');
  const out = await roundtrip(wb);
  expect(chart(out.wb).sourceRefs[0].pivotName).toBeUndefined();
  expect(data(out.wb).series[0].name).toBe('Live ordinary heading');
});

it('captures captions when freezing a chart for a detached picture or literal series', async () => {
  const { wb } = await roundtrip(fixture(), { patch: captionPatch });
  const snapshot = snapshotChartData(wb, wb.activeSheetId, chart(wb));
  expect(snapshot.sourceRefs[0]).toMatchObject({ name: caption, literal: { values: [3, 7] } });
  expect(snapshot.sourceRefs[0].nameRef).toBeUndefined();
  expect(snapshot.sourceRefs[0].pivotName).toBeUndefined();
});

it('retains long captions when a PivotChart becomes an ordinary literal chart', async () => {
  const name = 'Revenue 年 & margin '.repeat(30);
  const { wb } = await roundtrip(fixture(), { patch: xml => nameCache(xml,
    `<c:ptCount val="1"/><c:pt idx="0"><c:v>${name.replaceAll('&', '&amp;')}</c:v></c:pt>`) });
  const snapshot = snapshotChartData(wb, wb.activeSheetId, chart(wb));
  delete snapshot.pivotSource;
  wb.activeSheet.charts = [normalizeChart(snapshot)];
  expect(data(wb).series[0].name).toBe(name);
  const out = await roundtrip(wb);
  expect(cachedName(out.xml)).toBe(name);
  expect(data(out.wb).series[0].name).toBe(name);
});

it('bounds native captions and ignores malformed metadata without changing ordinary names', () => {
  for (const pivotName of [null, 7, {}, []]) {
    expect(normalizeChart({ ...chart(fixture()), sourceRefs: [{ pivotName }] }).sourceRefs[0].pivotName).toBeUndefined();
  }
  const normalized = normalizeChart({ ...chart(fixture()), sourceRefs: [{ pivotName: 'x'.repeat(40000) }] });
  expect(normalized.sourceRefs[0].pivotName).toHaveLength(32767);
});
