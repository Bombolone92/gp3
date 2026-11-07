import { expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { normalizeChart } from '../src/core/charts.js';
import { renderChartSvg } from '../src/ui/chartsvg.js';

const parser = new (new JSDOM('', { url: 'https://test.invalid/' }).window.DOMParser)();
const data = { categories: ['Alpha', 'Beta'], series: [{ name: 'Amount', values: [200000, 900000] }] };
function render(appearance = {}, width = 680, type = 'column') {
  const chart = normalizeChart({ type, legend: false, yMin: 0, yMax: 1000000, range: { r1: 0, c1: 0, r2: 2, c2: 1 }, anchor: { r: 0, c: 3 }, appearance: {
    plot: { x: .01, y: .2, w: .97, h: .55 }, plotStroke: '#000000',
    yStep: 200000, yFormat: '#,##0.00', yStyle: { size: 14 }, ...appearance,
  } });
  const before = structuredClone(chart);
  const svg = renderChartSvg(data, chart, width, 390);
  expect(chart).toEqual(before); // Rendering never rewrites the exported/manual coordinates.
  expect(svg).not.toMatch(/NaN|Infinity/);
  const doc = parser.parseFromString(svg, 'image/svg+xml');
  const border = doc.querySelector('.chart-plot-border');
  return { doc, x: +border.getAttribute('x'), w: +border.getAttribute('width'),
    y: +border.getAttribute('y'), h: +border.getAttribute('height') };
}
const values = doc => [...doc.querySelectorAll('text')].filter(n => /\.00$/.test(n.textContent));

// The plot constrains an insufficient manual inner margin, but
// retains sufficient margins and reserves nothing for hidden tick labels.
it.each(['column', 'line', 'combo', 'scatter'])('fits visible value labels beside a manual %s plot', type => {
  for (const width of [320, 680, 1100]) for (const size of [10, 24]) for (const side of ['low', 'high']) {
    const result = render({ yStyle: { size }, yLabelPosition: side }, width, type);
    expect(result.x + result.w).toBeLessThanOrEqual(width);
    expect(result.y).toBe(78);
    expect(result.h).toBe(214.5);
    expect(values(result.doc).map(n => n.textContent)).toHaveLength(6);
    for (const label of values(result.doc)) {
      const textWidth = label.textContent.length * .56 * size;
      const x = +label.getAttribute('x');
      expect(side === 'low' ? x - textWidth : x).toBeGreaterThanOrEqual(0);
      expect(side === 'high' ? x + textWidth : x).toBeLessThanOrEqual(width);
    }
    if (side === 'low') expect(result.x + result.w).toBeCloseTo(width * .98, 1);
    else expect(result.x).toBeCloseTo(width * .01, 1);
  }
});

it.each([{ hideYAxis: true }, { yLabelPosition: 'none' }])('retains manual coordinates when value labels are hidden: %j', appearance => {
  const result = render(appearance);
  expect(result.x).toBe(6.8);
  expect(result.w).toBe(659.6);
  expect(values(result.doc)).toHaveLength(0);
});

it.each(['low', 'high'])('retains an already sufficient %s manual margin', yLabelPosition => {
  const result = render({ plot: { x: .3, y: .2, w: .4, h: .55 }, yLabelPosition });
  expect(result.x).toBe(204);
  expect(result.w).toBe(272);
});

it('responds to formatted label width, display units, and font size', () => {
  const normal = render(), large = render({ yStyle: { size: 24 } });
  const units = render({ yUnits: { divisor: 1000000 }, yFormat: '0.0' });
  expect(large.x).toBeGreaterThan(normal.x);
  expect(units.x).toBeLessThan(normal.x);
  expect(normal.x + normal.w).toBeCloseTo(large.x + large.w, 1);
});

it.each(['low', 'high'])('keeps a drawable plot for labels wider than the chart on the %s side', yLabelPosition => {
  const result = render({ yStyle: { size: 48 }, yLabelPosition }, 120);
  expect(result.w).toBeGreaterThanOrEqual(10);
  expect(result.x).toBeGreaterThanOrEqual(0);
  expect(result.x + result.w).toBeLessThanOrEqual(120);
});

it('measures using the same bold/italic font as the rendered axis text', () => {
  const fonts = [];
  const context = { font: '', measureText(text) { fonts.push(this.font); return { width: text.length * 10 }; } };
  vi.stubGlobal('OffscreenCanvas', class { getContext() { return context; } });
  try {
    render({ hideXAxis: true, yStyle: { size: 19, bold: true, italic: true } });
    expect(fonts.some(font => /^italic 700 19px /.test(font))).toBe(true);
  } finally { vi.unstubAllGlobals(); }
});
