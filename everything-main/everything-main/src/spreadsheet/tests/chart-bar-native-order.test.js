import { expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { Workbook } from '../src/core/workbook.js';
import { chartData } from '../src/core/charts.js';
import { renderChartSvg } from '../src/ui/chartsvg.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import * as X from '../src/vendor/xlsx.mjs';
function fixture(values = [3, 7, 4], options = {}) {
  return new Workbook({ sheets: [{ name: 'Report', charts: [{ type: 'bar', legend: false, anchor: { r: 0, c: 0 },
    range: { r1: 0, c1: 0, r2: 2, c2: 1 }, sourceRefs: [{ name: 'First', literal: { categories: ['Alpha', 'Beta', 'Gamma'], values } }], ...options }] }] });
}
const chart = wb => wb.activeSheet.charts[0];
function view(wb) {
  const svg = renderChartSvg(chartData(wb, wb.activeSheetId, chart(wb)), chart(wb), 640, 450);
  const doc = new JSDOM(svg).window.document;
  const bars = [...doc.querySelectorAll('rect')].filter(n => n.querySelector('title'));
  const texts = [...doc.querySelectorAll('text')];
  const categories = ['Alpha', 'Beta', 'Gamma'].map(name => texts.find(n => n.textContent === name));
  return { doc, bars, categories };
}
async function native(wb, metadata = false) {
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
  const xml = new TextDecoder().decode(X.CFB.find(zip, '/xl/charts/chart1_1.xml').content);
  if (!metadata) {
    const part = X.CFB.find(zip, '/xl/workbook.xml');
    X.CFB.utils.cfb_add(zip, '/xl/workbook.xml', new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, '')));
  }
  return { wb: await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' })), xml };
}
function topToBottom(wb) {
  const { bars, categories } = view(wb);
  const ys = bars.slice(0, 3).map(n => Number(n.getAttribute('y')));
  expect(ys[0]).toBeLessThan(ys[1]); expect(ys[1]).toBeLessThan(ys[2]);
  const labels = categories.map(n => Number(n.getAttribute('y')));
  expect(labels[0]).toBeLessThan(labels[1]); expect(labels[1]).toBeLessThan(labels[2]);
}
it.each([[3, 7, 4], [-3, -7, -4], [-3, 7, 4]])('preserves authored category order and axis sides through two native cycles for %j', async (...values) => {
  let wb = fixture(values); topToBottom(wb);
  for (let cycle = 0; cycle < 2; cycle++) {
    const result = await native(wb); wb = result.wb; topToBottom(wb);
    expect(chartData(wb, wb.activeSheetId, chart(wb)).series[0].values).toEqual(values);
    expect(chart(wb).appearance).toMatchObject({ reverseCategories: true, axisCrossings: { y: 'max' } });
    const doc = new JSDOM(result.xml, { contentType: 'text/xml' }).window.document;
    expect(doc.getElementsByTagName('c:catAx')[0].getElementsByTagName('c:orientation')[0].getAttribute('val')).toBe('maxMin');
    expect(doc.getElementsByTagName('c:valAx')[0].getElementsByTagName('c:crosses')[0].getAttribute('val')).toBe('max');
    const rendered = view(wb), axis = rendered.doc.querySelector('.chart-axis-line.chart-axis-y');
    expect(Number(axis.getAttribute('y1'))).toBeGreaterThan(Math.max(...rendered.bars.map(n => Number(n.getAttribute('y')))));
  }
});
it.each([false, true])('keeps clustered/stacked series order and native categories after sheet copy, stacked=%s', async stacked => {
  let wb = fixture([3, 7, 4], { stacked });
  chart(wb).sourceRefs.push({ name: 'Second', literal: { categories: ['Alpha', 'Beta', 'Gamma'], values: [2, 5, 1] } });
  wb = wb.sheetToWorkbook(wb.activeSheetId, { sourceWorkbook: '/Original.xlsx' });
  wb = (await native(wb)).wb; topToBottom(wb);
  const bars = view(wb).bars;
  if (!stacked) expect(Number(bars[0].getAttribute('y'))).toBeLessThan(Number(bars[3].getAttribute('y')));
  expect(chartData(wb, wb.activeSheetId, chart(wb)).series.map(s => s.name)).toEqual(['First', 'Second']);
});
it.each([false, true])('preserves explicit native bar orientation and crossings, reversed=%s', async reverseCategories => {
  const wb = (await native(fixture([3, 7, 4], { appearance: { reverseCategories, xLabelPosition: 'high', axisCrossings: { y: 'min' } } }))).wb;
  expect(chart(wb).appearance).toMatchObject({ reverseCategories, xLabelPosition: 'high', axisCrossings: { y: 'min' } });
  const ys = view(wb).bars.map(n => Number(n.getAttribute('y')));
  expect(ys[0] < ys[1]).toBe(reverseCategories);
});
it('keeps column category orientation and existing authored metadata unchanged', async () => {
  const original = fixture(), before = JSON.stringify(chart(original));
  const withMetadata = (await native(original, true)).wb;
  expect(JSON.stringify(chart(original))).toBe(before);
  expect(chart(withMetadata).appearance).toBeUndefined(); topToBottom(withMetadata);
  const column = (await native(fixture([3, 7, 4], { type: 'column' }))).wb;
  expect(chart(column).appearance.reverseCategories).toBe(false);
  expect(chart(column).appearance.axisCrossings.y).toBe('autoZero');
});
