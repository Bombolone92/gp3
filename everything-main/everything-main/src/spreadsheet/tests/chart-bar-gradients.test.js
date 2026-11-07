import { expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { chartData, normalizeChart } from '../src/core/charts.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { renderChartSvg, standaloneSvg } from '../src/ui/chartsvg.js';
const gradient = { angle: 45, scaled: false, stops: [
  { offset: 0, color: '#cc2244', opacity: 0 }, { offset: .5, color: '#22aacc', opacity: .75 }, { offset: 1, color: '#334455', opacity: 1 },
] };
const make = (type = 'bar', extra = {}) => {
  const wb = new Workbook();
  wb.addChart(wb.activeSheetId, { type, anchor: { r: 0, c: 0 }, range: { r1: 0, c1: 0, r2: 1, c2: 1 },
    sourceRefs: [{ name: 'A', literal: { categories: ['One', 'Two'], values: [7, -3] } }],
    appearance: { bars: [{ gradient, invertIfNegative: false }] }, ...extra });
  return wb;
};
const render = wb => {
  const ch = wb.activeSheet.charts[0];
  return new JSDOM(standaloneSvg(renderChartSvg(chartData(wb, wb.activeSheetId, ch), ch, 600, 220), () => ''), { contentType: 'image/svg+xml' }).window.document;
};
const get = (zip, path) => new TextDecoder().decode(X.CFB.find(zip, path).content);
const set = (zip, path, value) => X.CFB.utils.cfb_add(zip, path, new TextEncoder().encode(value));
const save = async wb => X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
const open = async zip => {
  set(zip, '/xl/workbook.xml', get(zip, '/xl/workbook.xml').replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  return workbookFromFile(new Uint8Array(X.CFB.write(zip, { type: 'array', fileType: 'zip' })), 'native.xlsx');
};
it.each(['bar', 'column'])('renders and natively round-trips %s linear gradients, transparency and copies', async type => {
  let wb = make(type);
  const original = wb.activeSheet.charts[0];
  expect(wb.chartById(wb.activeSheetId, wb.duplicateChart(wb.activeSheetId, original.id)).appearance.bars[0].gradient).toEqual(gradient);
  for (let pass = 0; pass < 2; pass++) {
    const doc = render(wb), fills = [...doc.querySelectorAll('linearGradient')];
    expect(fills).toHaveLength(2);
    expect(fills[0].getAttribute('gradientUnits')).toBe('userSpaceOnUse');
    for (const fill of fills) {
      const dx = Number(fill.getAttribute('x2')) - Number(fill.getAttribute('x1'));
      const dy = Number(fill.getAttribute('y2')) - Number(fill.getAttribute('y1'));
      expect(dy / dx).toBeCloseTo(1, 3); // physical 45 degrees, independent of bar aspect ratio
      expect([...fill.querySelectorAll('stop')].map(n => Number(n.getAttribute('stop-opacity')))).toEqual([0, .75, 1]);
    }
    const zip = await save(wb);
    expect(get(zip, '/xl/charts/chart1_1.xml')).toContain('<a:lin ang="2700000" scaled="0"/>');
    wb = await open(zip);
    expect(wb.activeSheet.charts[0].appearance.bars[0].gradient).toEqual(gradient);
  }
});
it('applies point gradients and explicit fills before series gradients, and preserves negative inversion', async () => {
  const wb = make('column', { appearance: { bars: [{ gradient, invertIfNegative: true,
    points: [{ index: 0, gradient: { ...gradient, angle: 90 }, invertIfNegative: false }] }] } });
  let doc = render(wb);
  expect(doc.querySelectorAll('linearGradient')).toHaveLength(1);
  expect([...doc.querySelectorAll('.chart-column')].map(n => n.getAttribute('fill'))[1]).toBe('#ffffff');
  const restored = await open(await save(wb));
  expect(restored.activeSheet.charts[0].appearance.bars[0].points[0].gradient.angle).toBe(90);
  wb.updateChart(wb.activeSheetId, wb.activeSheet.charts[0].id, { colors: ['#abcdef'] });
  doc = render(wb); expect(doc.querySelectorAll('linearGradient')).toHaveLength(1); // point override remains
  const seriesOnly = make('bar', { colors: ['#abcdef'] });
  expect(render(seriesOnly).querySelectorAll('linearGradient')).toHaveLength(0);
  expect(get(await save(seriesOnly), '/xl/charts/chart1_1.xml')).not.toContain('gradFill');
});
it('retains scaled-angle geometry and validates stored stop paint', () => {
  const wb = make('bar', { appearance: { bars: [{ gradient: { ...gradient, scaled: true }, invertIfNegative: false }] } });
  const doc = render(wb), bar = doc.querySelector('.chart-bar'), fill = doc.querySelector('linearGradient');
  const dx = +fill.getAttribute('x2') - +fill.getAttribute('x1'), dy = +fill.getAttribute('y2') - +fill.getAttribute('y1');
  expect(dy / dx).toBeCloseTo(+bar.getAttribute('height') / +bar.getAttribute('width'), 3);
  const normalized = normalizeChart({ ...wb.activeSheet.charts[0], appearance: { bars: [{ gradient: { stops: [{ offset: 0, color: 'url(unsafe)', opacity: 1 }] } }] } });
  expect(normalized.appearance.bars[0].gradient.stops).toEqual([]);
});
it('decodes preset colors and ordered alpha transforms without dropping fully transparent stops', async () => {
  const zip = await save(make());
  set(zip, '/xl/charts/chart1_1.xml', get(zip, '/xl/charts/chart1_1.xml').replace('<a:srgbClr val="CC2244"><a:alpha val="0"/></a:srgbClr>', '<a:prstClr val="red"><a:alpha val="80000"/><a:alphaMod val="50000"/><a:alphaOff val="10000"/></a:prstClr>'));
  const back = await open(zip), stop = back.activeSheet.charts[0].appearance.bars[0].gradient.stops[0];
  expect(stop).toEqual({ offset: 0, color: '#ff0000', opacity: .5 });
});
