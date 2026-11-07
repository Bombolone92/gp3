import { expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { normalizeChart } from '../src/core/charts.js';
import { renderChartSvg } from '../src/ui/chartsvg.js';
const parser = new (new JSDOM('').window.DOMParser)();
const data = { categories: ['Alpha', 'Beta'], series: [{ name: 'Values', values: [-160, -25] }] };
function render(type, position = 'nextTo', appearance = {}, values = data) {
  const chart = normalizeChart({ type, legend: false, range: { r1: 0, c1: 0, r2: 1, c2: 1 }, anchor: { r: 0, c: 3 },
    appearance: { xLabelPosition: position, xRotationAuto: false, axisStyles: { x: { color: '#000000' } }, ...appearance } });
  const svg = renderChartSvg(values, chart, 520, 320), doc = parser.parseFromString(svg, 'image/svg+xml');
  const labels = [...doc.querySelectorAll('text')].filter(n => data.categories.includes(n.textContent));
  const axis = doc.querySelector('.chart-axis-line.chart-axis-x');
  return { chart, svg, doc, labels, axis, plot: doc.querySelector('clipPath rect') };
}

it.each(['bar', 'column'])('follows the zero crossing in %s charts and paints labels above the marks', type => {
  for (const values of [[-160,-25], [-40,70], [25,160]]) {
    const {doc, labels, axis} = render(type, 'nextTo', {}, {...data, series:[{name:'Values',values}]});
    for (const label of labels) {
      const key = type === 'bar' ? 'x' : 'y';
      const offset = +label.getAttribute(key) - +axis.getAttribute(`${key}1`);
      if (type === 'bar') expect(offset).toBeCloseTo(-10);
      else expect(offset).toBeGreaterThan(0);
      expect(doc.querySelector('.chart-series').compareDocumentPosition(label) & 4).toBe(4);
      expect(label.parentElement.tagName).toBe('svg');
    }
  }
});

it.each(['bar', 'column'])('keeps low/high labels independent of the axis crossing for %s', type => {
  const low = render(type, 'low'), high = render(type, 'high');
  for (const result of [low, high]) {
    for (const label of result.labels) {
      const {plot} = result, isHigh = result === high;
      if (type === 'bar') {
        const edge = +plot.getAttribute('x') + (isHigh ? +plot.getAttribute('width') : 0);
        expect(+label.getAttribute('x') - edge).toBe(isHigh ? 10 : -10);
        expect(label.getAttribute('text-anchor')).toBe(isHigh ? 'start' : 'end');
      } else {
        const top = +plot.getAttribute('y'), bottom = top + +plot.getAttribute('height');
        if (isHigh) expect(+label.getAttribute('y')).toBeLessThan(top);
        else expect(+label.getAttribute('y')).toBeGreaterThan(bottom);
      }
    }
  }
});

it.each(['bar', 'column'])('hides only the %s tick labels when position is none', type => {
  const {chart, labels, doc, axis} = render(type, 'none');
  expect(labels).toHaveLength(0); expect(axis).not.toBeNull();
  expect(doc.querySelector('.chart-series')).not.toBeNull(); expect(chart.appearance.hideXAxis).toBe(false);
});

it.each([-90, -45, 45, 90, 135])('places rotated high category labels above the plot at %s degrees', rotation => {
  const { labels, plot, svg } = render('column', 'high', { xRotation: rotation });
  expect(svg).not.toMatch(/NaN|Infinity/);
  const top = +plot.getAttribute('y');
  for (const label of labels) {
    expect(+label.getAttribute('y')).toBeLessThan(top);
    expect(label.getAttribute('transform')).toContain(`rotate(${rotation} `);
  }
});

it.each(['bar', 'column', 'scatter'])('also follows the crossing in unstyled %s charts', type => {
  const svg = renderChartSvg({...data, x:[1,2], series:[{...data.series[0], x:[1,2]}]}, {type, legend:false}, 520,320);
  const doc = parser.parseFromString(svg,'image/svg+xml');
  const labels = [...doc.querySelectorAll('text')].filter(n => type === 'scatter'
    ? n.getAttribute('text-anchor') === 'middle' && n.getAttribute('font-size') === '11'
    : data.categories.includes(n.textContent));
  expect(labels.length).toBeGreaterThan(0);
  for (const label of labels) {
    if (type === 'bar') expect(+label.getAttribute('x')).toBeGreaterThan(260);
    else expect(+label.getAttribute('y')).toBeLessThan(160);
    expect(doc.querySelector('g').compareDocumentPosition(label) & 4).toBe(4);
    expect(label.parentElement.tagName).toBe('svg');
  }
});

it('normalizes malformed category label positions to nextTo', () => {
  expect(render('column','<bad>').chart.appearance.xLabelPosition).toBe('nextTo');
});

it.each(['low', 'high', 'nextTo'])('does not skip interleaving angled bar labels in the %s position', position => {
  const categories = ['First category', 'Second category'];
  const {doc} = render('bar', position, {xRotation:45}, {...data,categories});
  expect([...doc.querySelectorAll('text')].filter(n => categories.includes(n.textContent))).toHaveLength(2);
});
