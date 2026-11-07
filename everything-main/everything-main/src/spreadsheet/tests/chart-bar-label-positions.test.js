import { expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { normalizeChart, chartData } from '../src/core/charts.js';
import { renderChartSvg } from '../src/ui/chartsvg.js';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import * as X from '../src/vendor/xlsx.mjs';

const parser = new (new JSDOM('', { url: 'https://example.test' }).window.DOMParser)();
const values = [-60, 30, 80];
const make = (type, position, reverseValues, stacked = false, stack100 = false, cross = 0) => normalizeChart({
  type, anchor: { r: 0, c: 4 }, range: { r1: 0, c1: 0, r2: 2, c2: 0 }, labels: true, legend: false, stacked, stack100,
  sourceRefs: [{ literal: { categories: ['A', 'B', 'C'], values } }],
  appearance: { reverseValues, axisCrossings: { x: cross },
    valueLabels: [{ show: true, position, numberFormat: '"v "0', style: { size: 12 } }] },
});
const render = chart => {
  const wb = new Workbook();
  return parser.parseFromString(renderChartSvg(chartData(wb, wb.activeSheetId, chart), chart, 650, 450), 'image/svg+xml');
};

it.each(['bar', 'column'])('positions %s labels relative to their own base and end under axis reversal', type => {
  for (const reverse of [false, true]) for (const cross of [0, 45]) for (const position of ['ctr', 'inBase', 'inEnd', 'outEnd']) {
    const doc = render(make(type, position, reverse, false, false, cross));
    const horizontal = type === 'bar', axis = horizontal ? 'x' : 'y', extent = horizontal ? 'width' : 'height';
    const bars = [...doc.querySelectorAll('.chart-series')];
    const labels = [...doc.querySelectorAll('text')].filter(n => n.textContent.includes('v '));
    expect(labels).toHaveLength(3);
    bars.forEach((bar, i) => {
      const low = +bar.getAttribute(axis), length = +bar.getAttribute(extent);
      const direction = Math.sign(values[i] - cross) * (horizontal ? 1 : -1) * (reverse ? -1 : 1);
      const base = direction > 0 ? low : low + length;
      const at = +labels[i].getAttribute(axis) - (horizontal ? 0 : +labels[i].getAttribute('font-size') * .35);
      const fraction = (at - base) * direction / length;
      if (position === 'ctr') expect(fraction).toBeCloseTo(.5, 3);
      if (position === 'inBase') { expect(fraction).toBeGreaterThan(0); expect(fraction).toBeLessThan(.5); }
      if (position === 'inEnd') { expect(fraction).toBeGreaterThan(.5); expect(fraction).toBeLessThan(1); }
      if (position === 'outEnd') expect(fraction).toBeGreaterThan(1);
      if (horizontal) expect(labels[i].getAttribute('text-anchor')).toBe(position === 'ctr' ? 'middle'
        : (position === 'inEnd' ? -direction : direction) > 0 ? 'start' : 'end');
    });
  }
});

it.each(['bar', 'column'])('centers omitted %s labels on stacked and percent-stacked segments', type => {
  for (const reverse of [false, true]) for (const percent of [false, true]) {
    const chart = make(type, null, reverse, true, percent);
    chart.sourceRefs.push({ literal: { categories: ['A', 'B', 'C'], values: [-25, 40, 15] } });
    chart.appearance.valueLabels.push({ ...chart.appearance.valueLabels[0] });
    const doc = render(chart), horizontal = type === 'bar';
    const bars = [...doc.querySelectorAll('.chart-series')], labels = [...doc.querySelectorAll('text')].filter(n => n.textContent.includes('v '));
    expect(labels).toHaveLength(6);
    bars.forEach((bar, i) => {
      const center = +bar.getAttribute(horizontal ? 'x' : 'y') + +bar.getAttribute(horizontal ? 'width' : 'height') / 2;
      const at = +labels[i].getAttribute(horizontal ? 'x' : 'y') - (horizontal ? 0 : 12 * .35);
      expect(at).toBeCloseTo(center, 1);
    });
  }
});

it('preserves omitted and explicit positions through duplication and native-only export', async () => {
  for (const position of [null, 'inBase', 'inEnd', 'ctr', 'outEnd']) {
    let wb = new Workbook({ sheets: [{ name: 'Data', charts: [make('bar', position, false, position == null)] }] });
    wb.duplicateChart(wb.activeSheetId, wb.activeSheet.charts[0].id);
    for (let pass = 0; pass < 2; pass++) {
      const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
      const part = X.CFB.find(zip, '/xl/workbook.xml');
      part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, '')); part.size = part.content.length;
      const xml = new TextDecoder().decode(X.CFB.find(zip, '/xl/charts/chart1_1.xml').content);
      if (position == null) expect(xml).not.toContain('<c:dLblPos');
      else expect(xml).toContain(`<c:dLblPos val="${position}"/>`);
      wb = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }));
      expect(wb.activeSheet.charts).toHaveLength(2);
      for (const ch of wb.activeSheet.charts) expect(ch.appearance.valueLabels[0].position).toBe(position);
    }
  }
});

it('keeps zero-length labels finite and respects per-series visibility', () => {
  for (const type of ['bar', 'column']) for (const reverse of [false, true]) for (const position of ['inBase', 'inEnd', 'ctr', null]) {
    const chart = make(type, position, reverse);
    chart.sourceRefs[0].literal.values = [0, 30, 80];
    chart.appearance.valueLabels[0].hidden = [1];
    const doc = render(chart), labels = [...doc.querySelectorAll('text')].filter(n => n.textContent.includes('v '));
    expect(labels.map(n => n.textContent)).toEqual(['v 0', 'v 80']);
    for (const label of labels) for (const key of ['x', 'y']) expect(Number.isFinite(+label.getAttribute(key))).toBe(true);
  }
});
