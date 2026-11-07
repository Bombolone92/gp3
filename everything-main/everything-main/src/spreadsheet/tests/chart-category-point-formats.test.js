import { expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { Workbook } from '../src/core/workbook.js';
import { normalizeChart, chartData } from '../src/core/charts.js';
import { renderChartSvg } from '../src/ui/chartsvg.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import * as X from '../src/vendor/xlsx.mjs';
const formats = ['0%', '"$"0.00'];
const chart = (type = 'column', sourceRefs = [{ categories: 'Data!A1:A2', values: 'Data!B1:B2' }]) => normalizeChart({
  type, anchor: { r: 0, c: 0 }, range: { r1: 0, c1: 0, r2: 1, c2: 1 }, sourceRefs,
});
function fixture(type = 'column') {
  return new Workbook({ sheets: [{ name: 'Report', charts: [chart(type)] }, { name: 'Data', cells: {
    '0,0': { v: 0.25, s: { fmt: 'custom', code: formats[0] } }, '1,0': { v: 12, s: { fmt: 'custom', code: formats[1] } },
    '0,1': { v: 4 }, '1,1': { v: 7 },
  } }] });
}
const data = wb => chartData(wb, wb.activeSheetId, wb.activeSheet.charts[0]);
async function native(wb, patch) {
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
  const get = path => new TextDecoder().decode(X.CFB.find(zip, path).content);
  const put = (path, text) => X.CFB.utils.cfb_add(zip, path, new TextEncoder().encode(text));
  put('/xl/workbook.xml', get('/xl/workbook.xml').replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  const path = '/xl/charts/chart1_1.xml';
  if (patch) put(path, patch(get(path)));
  return { xml: get(path), wb: await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' })) };
}
it.each(['column', 'pie', 'donut'])('preserves mixed numeric category formats in a copied %s chart and two native cycles', async type => {
  const original = fixture(type);
  let wb = original.sheetToWorkbook(original.activeSheetId, { sourceWorkbook: '/Source.xlsx' });
  for (let cycle = 0; cycle < 2; cycle++) {
    expect(data(wb).categories).toEqual(['25%', '$12.00']);
    expect(data(wb).series[0].values).toEqual([4, 7]);
    const exported = await native(wb);
    const dom = new JSDOM(exported.xml, { contentType: 'text/xml' }).window.document;
    const points = [...dom.getElementsByTagName('c:cat')[0].getElementsByTagName('c:pt')];
    expect(points.map(point => point.getAttribute('formatCode'))).toEqual(formats);
    expect(points.map(point => point.textContent)).toEqual(['0.25', '12']);
    wb = exported.wb;
  }
  expect(data(wb).categories).toEqual(['25%', '$12.00']);
});
it('imports point formats from native numeric literals, including sparse indexes and a shared fallback', async () => {
  const wb = new Workbook({ sheets: [{ name: 'Report', charts: [chart('column', [{ categoryFormat: '0.0', literal: { categories: [0.25, 12, 2], values: [4, 7, 9] } }])] }] });
  const result = await native(wb, xml => xml.replace(/(<c:cat>[\s\S]*?<c:pt idx="1")/, '$1 formatCode="0%"'));
  expect(data(result.wb).categories).toEqual(['0.3', '1200%', '2.0']);
  expect(result.wb.activeSheet.charts[0].sourceRefs[0].categoryPointFormats).toEqual([null, '0%']);
});
it('renders point-formatted literal category labels', () => {
  const ch = chart('column', [{ categoryPointFormats: formats, literal: { categories: [0.25, 12], values: [4, 7] } }]);
  const wb = new Workbook(), resolved = chartData(wb, wb.activeSheetId, ch);
  const text = new JSDOM(renderChartSvg(resolved, ch, 600, 400)).window.document.body.textContent;
  expect(text).toContain('25%'); expect(text).toContain('$12.00');
});
it('uses current worksheet formatting over cached point formats and updates exported caches', async () => {
  const wb = fixture(), ch = wb.activeSheet.charts[0];
  ch.sourceRefs[0].categoryPointFormats = ['0.000', '0.000'];
  expect(data(wb).categories).toEqual(['25%', '$12.00']);
  const source = wb.sheetByName('Data'); wb.applyStyle(source.id, { r1: 1, c1: 0, r2: 1, c2: 0 }, { fmt: 'custom', code: '"USD "0' });
  const copy = wb.sheetToWorkbook(wb.activeSheetId, { sourceWorkbook: '/Source.xlsx' });
  expect(data(copy).categories).toEqual(['25%', 'USD 12']);
  expect(data((await native(wb)).wb).categories).toEqual(['25%', 'USD 12']);
  expect((await native(wb)).xml).toContain('formatCode="&quot;USD &quot;0"');
});
it('retains point formatting when supporting values change without freezing chart values', () => {
  const src = fixture(), wb = src.sheetToWorkbook(src.activeSheetId, { sourceWorkbook: '/Source.xlsx' }), json = wb.toJSON();
  json.externalWorkbooks.books[0].sheets.find(s => s.name === 'Data').cells['0,0'] = 0.5;
  expect(data(new Workbook(json)).categories).toEqual(['50%', '$12.00']);
});
it('preserves point formats through chart duplication and JSON without sharing arrays', () => {
  const src = fixture(), wb = src.sheetToWorkbook(src.activeSheetId, { sourceWorkbook: '/Source.xlsx' });
  wb.duplicateChart(wb.activeSheetId, wb.activeSheet.charts[0].id);
  const restored = new Workbook(wb.toJSON());
  for (const ch of restored.activeSheet.charts) expect(chartData(restored, restored.activeSheetId, ch).categories).toEqual(['25%', '$12.00']);
  expect(restored.activeSheet.charts[0].sourceRefs[0].categoryPointFormats).not.toBe(restored.activeSheet.charts[1].sourceRefs[0].categoryPointFormats);
});
it('bounds and normalizes malformed point format metadata', () => {
  const ch = chart('column', [{ categoryPointFormats: [null, 4, {}, '0%'], literal: { categories: [1, 2, 3, 0.4], values: [1, 2, 3, 4] } }]);
  expect(ch.sourceRefs[0].categoryPointFormats).toEqual([null, null, null, '0%']);
  expect(chart('column', [{ categoryPointFormats: Array(5002).fill('0') }]).sourceRefs[0].categoryPointFormats).toHaveLength(5000);
});

it('uses the last duplicate numeric point and ignores out-of-range format indexes', async () => {
  const wb = new Workbook({ sheets: [{ name: 'Report', charts: [chart('column', [{ categoryFormat: '0.0', literal: { categories: [0.25, 12], values: [4, 7] } }])] }] });
  const result = await native(wb, xml => xml.replace(/(<c:cat>[\s\S]*?)(<\/c:numLit>)/, '$1<c:pt idx="1" formatCode="0%"><c:v>12</c:v></c:pt><c:pt idx="1"><c:v>13</c:v></c:pt><c:pt idx="5000" formatCode="0%"><c:v>2</c:v></c:pt>$2'));
  expect(data(result.wb).categories).toEqual(['0.3', '13.0']);
  expect(result.wb.activeSheet.charts[0].sourceRefs[0].categoryPointFormats).toBeUndefined();
});
it('keeps sparse point formats aligned with blank numeric literal entries', async () => {
  const wb = new Workbook({ sheets: [{ name: 'Report', charts: [chart('column', [{ categoryPointFormats: ['0%', null, '"$"0'], literal: { categories: [0.25, null, 12], values: [4, 0, 7] } }])] }] });
  const result = await native(wb);
  expect(data(result.wb).categories).toEqual(['25%', '2', '$12']);
  expect(result.wb.activeSheet.charts[0].sourceRefs[0].categoryPointFormats).toEqual(['0%', null, '"$"0']);
});
