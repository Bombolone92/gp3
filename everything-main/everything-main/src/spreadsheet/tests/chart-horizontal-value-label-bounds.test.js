import { expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { normalizeChart } from '../src/core/charts.js';
import { renderChartSvg } from '../src/ui/chartsvg.js';
const parser = new (new JSDOM('', { url: 'https://example.test' }).window.DOMParser)();
const data = { categories: ['A', 'B', 'C'], series: [{ name: 'Values', values: [7, 18, 27] }] };
function draw(appearance = {}, height = 180) {
  const chart = normalizeChart({ type: 'bar', anchor: { r: 0, c: 0 }, range: { r1: 0, c1: 0, r2: 2, c2: 1 }, legend: false,
    appearance: { plot: { x: .25, y: .01, w: .65, h: .96 }, yStyle: { size: 16, color: '#2468ab' }, ...appearance } });
  const before = JSON.stringify(chart.appearance.plot), svg = renderChartSvg(data, chart, 420, height);
  expect(svg).not.toMatch(/NaN|Infinity/);
  expect(JSON.stringify(chart.appearance.plot)).toBe(before);
  const doc = parser.parseFromString(svg, 'image/svg+xml'), rect = doc.querySelector('clipPath rect');
  return { labels: [...doc.querySelectorAll('text[fill="#2468ab"]')], plot: {
    x: +rect.getAttribute('x'), y: +rect.getAttribute('y') + 1, w: +rect.getAttribute('width'), h: +rect.getAttribute('height') - 2,
  }, chart };
}
it.each(['low', 'high', 'nextTo'])('keeps %s horizontal value labels inside the frame with reversed category axes', position => {
  for (const reverse of [false, true]) for (const crossing of ['min', 'max', 2]) for (const height of [100, 240]) {
    const { labels, plot } = draw({ yLabelPosition: position, reverseCategories: reverse, axisCrossings: { y: crossing } }, height);
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) {
      const y = +label.getAttribute('y');
      expect(y - 16 * .8).toBeGreaterThanOrEqual(0);
      expect(y + 16 * .2).toBeLessThanOrEqual(height);
    }
    expect(plot.x).toBe(105); expect(plot.w).toBe(273);
    // A single edge moves; the saved opposite edge stays fixed.
    const high = (position === 'nextTo' ? crossing === 'max' : position === 'high') !== reverse;
    if (high) expect(plot.y + plot.h).toBeCloseTo(height * .97, 1);
    else expect(plot.y).toBeCloseTo(height * .01, 1);
  }
});
it('retains an ample manual plot and reserves nothing for hidden or empty labels', () => {
  const plot = { x: .25, y: .2, w: .65, h: .6 };
  const ordinary = draw({ plot });
  expect(ordinary.plot).toEqual({ x: 105, y: 36, w: 273, h: 108 });
  for (const options of [{ hideYAxis: true }, { yLabelPosition: 'none' }, { yFormat: ';;;' }]) {
    const result = draw(options);
    expect(result.plot.y).toBeCloseTo(1.8); expect(result.plot.h).toBeCloseTo(172.8);
  }
});
it('uses label font size when fitting a compact chart', () => {
  const small = draw({ yStyle: { size: 10, color: '#2468ab' } }), large = draw({ yStyle: { size: 24, color: '#2468ab' } });
  expect(large.plot.h).toBeLessThan(small.plot.h);
  for (const label of large.labels) expect(+label.getAttribute('y') + 24 * .2).toBeLessThan(180);
});
