import { expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { normalizeChart } from '../src/core/charts.js';
import { renderChartSvg } from '../src/ui/chartsvg.js';
const parser = new (new JSDOM('').window.DOMParser)();
function draw({ width = 400, size = 12, format = '"$"#,##0', step = null, reverse = false, min = 0, max = 100000, plot = { x: .3, y: .1, w: .6, h: .7 } } = {}) {
  const chart = normalizeChart({ type: 'bar', range: { r1: 0, c1: 0, r2: 2, c2: 1 }, anchor: { r: 0, c: 0 }, legend: false, yMin: min, yMax: max,
    appearance: { plot, yFormat: format, yStep: step,
      reverseValues: reverse, yStyle: { size, color: '#123abc' } } });
  const before = JSON.stringify(chart);
  const svg = renderChartSvg({ categories: ['First', 'Second'], series: [{ name: 'Values', values: [max * .4, max * .8] }] }, chart, width, 300);
  expect(svg).not.toMatch(/NaN|Infinity/);
  expect(JSON.stringify(chart)).toBe(before);
  return [...parser.parseFromString(svg, 'image/svg+xml').querySelectorAll('text[fill="#123abc"]')]
    .map(n => ({ text: n.textContent, x: +n.getAttribute('x') })).sort((a, b) => a.x - b.x);
}
it.each([false, true])('fits automatic currency labels to the saved plot, reversed=%s', reverse => {
  const labels = draw({ reverse });
  expect(labels.length).toBeGreaterThanOrEqual(2);
  for (let i = 1; i < labels.length; i++) {
    const required = (labels[i - 1].text.length + labels[i].text.length) * 12 * .56 / 2 + 6;
    expect(labels[i].x - labels[i - 1].x).toBeGreaterThanOrEqual(required);
  }
});
it('responds to physical width, font size and formatted label length', () => {
  expect(draw({ width: 1000 }).length).toBeGreaterThan(draw().length);
  expect(draw({ size: 24 }).length).toBeLessThan(draw({ size: 10 }).length);
  expect(draw({ format: '"USD "#,##0.00' }).length).toBeLessThan(draw({ format: '0' }).length);
});
it('retains authored major units and fixed bounds even when labels are crowded', () => {
  const labels = draw({ step: 10000 });
  expect(labels).toHaveLength(11);
  expect(labels[0].text).toBe('$0');
  expect(labels.at(-1).text).toBe('$100,000');
  expect(labels[0].x).toBe(120); expect(labels.at(-1).x).toBe(360);
});
it('handles fractional and mixed-sign axes without changing their bounds', () => {
  for (const bounds of [{ min: -.005, max: .005 }, { min: -100000, max: 100000 }]) {
    const labels = draw({ ...bounds, format: '0.000' });
    expect(labels.length).toBeGreaterThanOrEqual(2);
    expect(labels[0].x).toBe(120); expect(labels.at(-1).x).toBe(360);
  }
});

it('retains labeled headroom when automatic bounds round to a larger major unit', () => {
  const chart = normalizeChart({ type: 'bar', legend: false, range: { r1: 0, c1: 0, r2: 2, c2: 1 }, anchor: { r: 0, c: 0 },
    appearance: { plot: { x: .3, y: .1, w: .6, h: .7 }, yFormat: '0.00', yStyle: { size: 14, color: '#123abc' } } });
  const svg = renderChartSvg({ categories: ['A', 'B'], series: [{ name: 'Values', values: [100, 400] }] }, chart, 400, 300);
  const labels = [...parser.parseFromString(svg, 'image/svg+xml').querySelectorAll('text[fill="#123abc"]')].map(n => Number(n.textContent));
  expect(Math.max(...labels)).toBeGreaterThan(400);
  expect(chart.yMax).toBeNull();
});

it.each([false, true])('fits end labels inside the chart frame, reversed=%s', reverse => {
  for (const step of [null, 25000]) {
    const labels = draw({ reverse, step, plot: { x: .01, y: .1, w: .98, h: .7 } });
    for (const label of labels) {
      const half = label.text.length * 12 * .56 / 2;
      expect(label.x - half).toBeGreaterThanOrEqual(5.9);
      expect(label.x + half).toBeLessThanOrEqual(394.1);
    }
  }
});
