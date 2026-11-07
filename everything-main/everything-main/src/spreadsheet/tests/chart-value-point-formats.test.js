import { expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { Workbook } from '../src/core/workbook.js';
import { normalizeChart, chartData, snapshotChartData } from '../src/core/charts.js';
import { renderChartSvg } from '../src/ui/chartsvg.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import * as X from '../src/vendor/xlsx.mjs';
const formats = ['0%', '"$"0.00'];
function fixture(type = 'column', referenced = true) {
  const chart = normalizeChart({ type, labels: true, headers: false, seriesIn: 'cols', anchor: { r: 0, c: 3 }, range: { r1: 0, c1: 0, r2: 1, c2: 1 },
    ...(referenced ? { sourceRefs: [{ categories: 'Data!A1:A2', values: 'Data!B1:B2' }] } : {}) });
  return new Workbook({ sheets: [{ name: 'Data', charts: [chart], cells: {
    '0,0': { v: 'First' }, '1,0': { v: 'Second' },
    '0,1': { v: .25, s: { fmt: 'custom', code: formats[0] } }, '1,1': { v: 12, s: { fmt: 'custom', code: formats[1] } },
  } }] });
}
const data = wb => chartData(wb, wb.activeSheetId, wb.activeSheet.charts[0]);
const dom = wb => new JSDOM(renderChartSvg(data(wb), wb.activeSheet.charts[0], 640, 420)).window.document;
const labels = wb => [...dom(wb).querySelectorAll('text')].map(n => n.textContent).join(' ');
const tips = wb => [...dom(wb).querySelectorAll('title')].map(n => n.textContent).join(' ');
async function native(wb, patch) {
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
  const get = p => new TextDecoder().decode(X.CFB.find(zip, p).content);
  const put = (p, s) => X.CFB.utils.cfb_add(zip, p, new TextEncoder().encode(s));
  put('/xl/workbook.xml', get('/xl/workbook.xml').replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  const path = '/xl/charts/chart1_1.xml';
  if (patch) put(path, patch(get(path)));
  return { xml: get(path), wb: await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' })) };
}
it.each(['column', 'bar', 'line', 'area', 'radar', 'waterfall', 'scatter'])('formats each %s value label and tooltip using its source cell', type => {
  const wb = fixture(type);
  if (type === 'scatter') { wb.setInput(wb.activeSheetId, 0, 0, 1); wb.setInput(wb.activeSheetId, 1, 0, 2); }
  if (type === 'radar') {
    wb.setInput(wb.activeSheetId, 2, 0, 'Third'); wb.setInput(wb.activeSheetId, 2, 1, 7);
    Object.assign(wb.activeSheet.charts[0].sourceRefs[0], { categories: 'Data!A1:A3', values: 'Data!B1:B3' });
  }
  expect(labels(wb)).toContain('25%'); expect(labels(wb)).toContain('$12.00');
  expect(tips(wb)).toContain('$12.00');
});
it.each([true, false])('exports per-value formats from referenced=%s charts through two native cycles', async referenced => {
  let wb = fixture('column', referenced);
  for (let i = 0; i < 2; i++) {
    const result = await native(wb);
    const xml = new JSDOM(result.xml, { contentType: 'text/xml' }).window.document;
    expect([...xml.getElementsByTagName('c:val')[0].getElementsByTagName('c:pt')].map(p => p.getAttribute('formatCode'))).toEqual(formats);
    wb = result.wb;
    expect(labels(wb)).toContain('25%'); expect(labels(wb)).toContain('$12.00');
    expect(data(wb).series[0].values).toEqual([.25, 12]);
  }
});
it('preserves omitted-sheet value formats and live supporting values', async () => {
  const original = fixture(), chart = original.activeSheet.charts[0];
  const wb = new Workbook({ sheets: [{ name: 'Report', charts: [chart] }, { ...original.toJSON().sheets[0], charts: [] }] });
  let copy = wb.sheetToWorkbook(wb.activeSheetId, { sourceWorkbook: '/Source.xlsx' });
  expect(copy.activeSheet.charts[0].sourceRefs[0].valuePointFormats).toEqual(formats);
  copy = (await native(copy)).wb;
  expect(labels(copy)).toContain('$12.00');
  const json = copy.toJSON();
  json.externalWorkbooks.books[0].sheets.find(s => s.name === 'Data').cells['1,1'] = 23;
  expect(labels(new Workbook(json))).toContain('$23.00');
});
it('preserves literal point formats and snapshots', async () => {
  const wb = fixture();
  wb.activeSheet.charts[0] = normalizeChart(snapshotChartData(wb, wb.activeSheetId, wb.activeSheet.charts[0]));
  expect(wb.activeSheet.charts[0].sourceRefs[0].valuePointFormats).toEqual(formats);
  expect(labels((await native(wb)).wb)).toContain('$12.00');
});
it('keeps sparse formats aligned and uses shared fallback for omitted literal points', async () => {
  const wb = new Workbook({ sheets: [{ name: 'Plot', charts: [normalizeChart({ type: 'column', labels: true, anchor: { r: 0, c: 0 }, range: { r1: 0, c1: 0, r2: 0, c2: 0 },
    sourceRefs: [{ valueFormat: '0.0', valuePointFormats: ['0%', null, '"$"0'], literal: { categories: ['a', 'b', 'c'], values: [.25, null, 12] } }] })] }] });
  const reopened = (await native(wb)).wb;
  expect(data(reopened).series[0].values).toEqual([.25, null, 12]);
  expect(labels(reopened)).toContain('25%'); expect(labels(reopened)).toContain('$12');
});
it('keeps point formats associated with Pareto categories when sorting and combining values', () => {
  const wb = fixture(); wb.activeSheet.charts[0].type = 'combo'; wb.activeSheet.charts[0].pareto = true;
  expect(data(wb).categories).toEqual(['Second', 'First']);
  expect(data(wb).series[0].pointStyles[0].code).toBe(formats[1]);
});
it('clones bounded point-format arrays through chart normalization', () => {
  const wb = fixture(), raw = wb.activeSheet.charts[0];
  raw.sourceRefs[0].valuePointFormats = [4, formats[1]];
  raw.sourceRefs[0].sizePointFormats = Array(5001).fill('0%');
  const ch = normalizeChart(raw);
  expect(ch.sourceRefs[0].valuePointFormats).toEqual([null, formats[1]]);
  expect(ch.sourceRefs[0].sizePointFormats).toHaveLength(5000);
  expect(ch.sourceRefs[0].valuePointFormats).not.toBe(raw.sourceRefs[0].valuePointFormats);
});

it('updates point formats after local styles change and does not inherit stale cache formats', async () => {
  let wb = (await native(fixture())).wb;
  wb.applyStyle(wb.activeSheetId, { r1: 0, c1: 1, r2: 1, c2: 1 }, { fmt: 'custom', code: '"USD "0.00' });
  expect(labels(wb)).toContain('USD 0.25'); expect(labels(wb)).toContain('USD 12.00');
  wb = (await native(wb)).wb;
  expect(labels(wb)).toContain('USD 12.00');
});
it('retains a uniform point override that differs from the shared native format', async () => {
  const wb = fixture();
  wb.activeSheet.charts[0] = normalizeChart({ ...wb.activeSheet.charts[0], sourceRefs: [{ valueFormat: 'General', valuePointFormats: ['0%', '0%'], literal: { categories: ['a', 'b'], values: [.25, .5] } }] });
  const restored = (await native(wb)).wb;
  expect(labels(restored)).toContain('25%'); expect(labels(restored)).toContain('50%');
});
it('keeps formats aligned after hidden points are removed', async () => {
  const wb = fixture();
  wb.setInput(wb.activeSheetId, 2, 0, 'Third'); wb.setInput(wb.activeSheetId, 2, 1, 9);
  wb.applyStyle(wb.activeSheetId, { r1: 2, c1: 1, r2: 2, c2: 1 }, { fmt: 'custom', code: '"Units "0' });
  Object.assign(wb.activeSheet.charts[0].sourceRefs[0], { categories: 'Data!A1:A3', values: 'Data!B1:B3' });
  wb.activeSheet.hiddenRows.add(0);
  expect(data(wb).series[0].values).toEqual([12, 9]);
  expect(labels(wb)).toContain('$12.00'); expect(labels(wb)).toContain('Units 9');
});

it.each(['pie', 'donut'])('retains %s point value formats in native labels and tooltips', async type => {
  const wb = fixture(type);
  wb.activeSheet.charts[0] = normalizeChart({ ...wb.activeSheet.charts[0], appearance: { pie: { labels: { value: true, percent: false } } } });
  expect(labels(wb)).toContain('$12.00'); expect(tips(wb)).toContain('$12.00');
  const reopened = (await native(wb)).wb;
  expect(labels(reopened)).toContain('$12.00'); expect(tips(reopened)).toContain('$12.00');
});
it('preserves bubble value and size point formats in native literals and tooltips', async () => {
  const wb = fixture('bubble');
  wb.activeSheet.charts[0] = normalizeChart({ ...wb.activeSheet.charts[0], sourceRefs: [{ valuePointFormats: formats, sizePointFormats: formats,
    literal: { categories: [1, 2], values: [.25, 12], sizes: [.5, 8] } }] });
  expect(tips(wb)).toContain('$12.00'); expect(tips(wb)).toContain('$8.00');
  let reopened = (await native(wb)).wb;
  expect(tips(reopened)).toContain('$12.00'); expect(tips(reopened)).toContain('$8.00');
  reopened.activeSheet.charts[0] = normalizeChart(snapshotChartData(reopened, reopened.activeSheetId, reopened.activeSheet.charts[0]));
  expect(reopened.activeSheet.charts[0].sourceRefs[0].sizePointFormats).toHaveLength(2);
  expect(tips(reopened)).toContain('$8.00');
  expect(tips((await native(reopened)).wb)).toContain('$8.00');
});
it('keeps explicit value label formats authoritative over individual source formats', async () => {
  const wb = fixture();
  wb.activeSheet.charts[0] = normalizeChart({ ...wb.activeSheet.charts[0], appearance: { valueLabels: [{ show: true, numberFormat: '"Value "0.00' }] } });
  const reopened = (await native(wb)).wb;
  expect(labels(reopened)).toContain('Value 12.00');
});

it('preserves size formats and values from range-authored bubble snapshots and native export', async () => {
  const wb = fixture('bubble', false), id = wb.activeSheetId;
  wb.activeSheet.charts[0].range.c2 = 2;
  wb.setInput(id, 0, 0, 1); wb.setInput(id, 1, 0, 2);
  wb.setInput(id, 0, 2, .5); wb.setInput(id, 1, 2, 8);
  formats.forEach((code, r) => wb.applyStyle(id, { r1: r, r2: r, c1: 2, c2: 2 }, { fmt: 'custom', code }));
  expect(tips(wb)).toContain('$8.00');
  expect(tips((await native(wb)).wb)).toContain('$8.00');
  const snapshot = snapshotChartData(wb, id, wb.activeSheet.charts[0]);
  expect(snapshot.sourceRefs[0].literal.sizes).toEqual([.5, 8]);
  expect(snapshot.sourceRefs[0].sizePointFormats).toEqual(formats);
});
it('uses General for an aggregate whose contributing value formats disagree', () => {
  const wb = fixture(); wb.activeSheet.charts[0].type = 'combo'; wb.activeSheet.charts[0].pareto = true;
  wb.setInput(wb.activeSheetId, 1, 0, 'First');
  expect(data(wb).series[0].values).toEqual([12.25]);
  expect(data(wb).series[0].pointStyles).toEqual([{}]);
});
it('formats chart data-table values individually', () => {
  const wb = fixture();
  wb.activeSheet.charts[0] = normalizeChart({ ...wb.activeSheet.charts[0], appearance: { dataTable: {} } });
  const text = dom(wb).querySelector('.chart-data-table').textContent;
  expect(text).toContain('25%'); expect(text).toContain('$12.00');
});
