import { expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { Workbook } from '../src/core/workbook.js';
import { chartData } from '../src/core/charts.js';
import { renderChartSvg } from '../src/ui/chartsvg.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import * as X from '../src/vendor/xlsx.mjs';
function fixture(type, count, mode = 'clustered', appearance) {
  return new Workbook({ sheets: [{ name: 'Report', charts: [{ type, legend: false,
    stacked: mode !== 'clustered', stack100: mode === 'percent', anchor: { r: 0, c: 0 }, range: { r1: 0, c1: 0, r2: 2, c2: 1 },
    ...(appearance ? { appearance } : {}), sourceRefs: Array.from({ length: count }, (_, i) => ({ name: `Series ${i + 1}`,
      literal: { categories: ['A', 'B', 'C'], values: [3 + i, 7 + i, 4 + i] } })) }] }] });
}
const chart = wb => wb.activeSheet.charts[0];
function geometry(wb, width = 640, height = 450) {
  const ch = chart(wb), svg = renderChartSvg(chartData(wb, wb.activeSheetId, ch), ch, width, height);
  const bars = [...new JSDOM(svg).window.document.querySelectorAll('rect')].filter(n => n.querySelector('title'));
  const horizontal = ch.type === 'bar', coordinate = horizontal ? 'y' : 'x', size = horizontal ? 'height' : 'width';
  const slot = Number(bars[1].getAttribute(coordinate)) - Number(bars[0].getAttribute(coordinate));
  return { fraction: Number(bars[0].getAttribute(size)) / slot, bars, slot };
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
const cases = ['column', 'bar'].flatMap(type => [1, 2, 3, 20, 21, 60].flatMap(count => ['clustered', 'stacked', 'percent'].map(mode => ({ type, count, mode }))));
it.each(cases)('preserves relative $type thickness for $count $mode series through two native cycles', async ({ type, count, mode }) => {
  let wb = fixture(type, count, mode);
  const groups = mode === 'clustered' ? count : 1, gap = Math.min(500, 25 * groups), expected = 1 / (groups + gap / 100);
  expect(geometry(wb).fraction).toBeCloseTo(expected, 3);
  for (let i = 0; i < 2; i++) {
    const result = await native(wb); wb = result.wb;
    expect(result.xml).toContain(`<c:gapWidth val="${gap}"/>`);
    expect(geometry(wb).fraction).toBeCloseTo(expected, 3);
    expect(geometry(wb, 1024, 720).fraction).toBeCloseTo(expected, 3);
    expect(chartData(wb, wb.activeSheetId, chart(wb)).series).toHaveLength(count);
  }
});
it.each([0, 40, 500])('preserves explicit imported gap %s and overlap', async gapWidth => {
  const original = fixture('column', 3, 'clustered', { gapWidth, overlap: 35 });
  const before = geometry(original).fraction, result = await native(original);
  expect(chart(result.wb).appearance).toMatchObject({ gapWidth, overlap: 35 });
  expect(geometry(result.wb).fraction).toBeCloseTo(before, 3);
});
it.each([false, true])('counts only the column series in a combination chart, stacked=%s', async stacked => {
  const original = fixture('combo', 4, stacked ? 'stacked' : 'clustered');
  const result = await native(original);
  expect(result.xml).toContain(`<c:gapWidth val="${stacked ? 25 : 75}"/>`);
  expect(geometry(result.wb).fraction).toBeCloseTo(geometry(original).fraction, 3);
});
it('keeps the shared dense-group geometry through sheet copies and metadata without mutating the source', async () => {
  const original = fixture('column', 21), before = JSON.stringify(chart(original));
  let wb = original.sheetToWorkbook(original.activeSheetId, { sourceWorkbook: '/Source.xlsx' });
  wb = (await native(wb, true)).wb;
  expect(chart(wb).appearance).toBeUndefined();
  expect(geometry(wb).fraction).toBeCloseTo(geometry(original).fraction, 3);
  expect(JSON.stringify(chart(original))).toBe(before);
});

it.each(['column', 'bar'])('keeps dense %s clusters inside their category slots using fractional bar widths', async type => {
  const wb = fixture(type, 60), n = 30;
  for (const source of chart(wb).sourceRefs) source.literal = { categories: Array.from({ length: n }, (_, i) => `Point ${i + 1}`), values: Array.from({ length: n }, (_, i) => i + 1) };
  const before = geometry(wb), coordinate = type === 'bar' ? 'y' : 'x', dimension = type === 'bar' ? 'height' : 'width';
  const last = before.bars[59 * n], next = before.bars[1];
  expect(Number(last.getAttribute(coordinate)) + Number(last.getAttribute(dimension))).toBeLessThan(Number(next.getAttribute(coordinate)));
  expect(Number(before.bars[0].getAttribute(dimension))).toBeGreaterThan(0);
  expect(Number(before.bars[0].getAttribute(dimension))).toBeLessThan(1);
  const after = geometry((await native(wb)).wb);
  // SVG coordinates are rounded to hundredths of a pixel. Check thickness
  // in pixels rather than amplifying that rounding by a subpixel width.
  for (const rendered of [before, after]) expect(rendered.fraction * rendered.slot).toBeCloseTo(rendered.slot / 65, 2);
});

it.each(['column', 'bar'])('exports default %s bars without inventing an outline', async type => {
  const result = await native(fixture(type, 3));
  for (const bar of geometry(result.wb).bars) expect(bar.getAttribute('stroke')).toBe('none');
  expect(chart(result.wb).appearance.bars.every(bar => bar.stroke === 'none')).toBe(true);
});
it.each(['column', 'bar'])('retains explicit %s series borders', async type => {
  const result = await native(fixture(type, 1, 'clustered', { bars: [{ stroke: '#123456', strokeWidth: 2.5 }] }));
  for (const bar of geometry(result.wb).bars) {
    expect(bar.getAttribute('stroke')).toBe('#123456'); expect(Number(bar.getAttribute('stroke-width'))).toBeCloseTo(2.5, 3);
  }
});
