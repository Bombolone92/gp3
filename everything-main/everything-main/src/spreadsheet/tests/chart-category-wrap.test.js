import { expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { normalizeChart } from '../src/core/charts.js';
import { renderChartSvg } from '../src/ui/chartsvg.js';

const parser = new (new JSDOM('').window.DOMParser)();
function render({ type = 'column', categories = ['First category', 'Second category', 'Third category', 'Fourth category'], appearance = {}, width = 360, height = 280 } = {}) {
  const chart = normalizeChart({ type, legend: false, anchor: { r: 0, c: 3 }, range: { r1: 0, c1: 0, r2: 4, c2: 1 },
    appearance: { xStyle: { size: 16, color: '#2468ab' }, yStyle: { size: 13, color: '#000000' }, xRotationAuto: false, xLabelSkip: 1, ...appearance } });
  const svg = renderChartSvg({ categories, series: [{ name: 'Data', values: categories.map((_, i) => i + 1) }] }, chart, width, height);
  const doc = parser.parseFromString(svg, 'image/svg+xml');
  const labels = [...doc.querySelectorAll('text')].filter(n => n.getAttribute('fill') === '#2468ab');
  return { chart, svg, doc, labels, plot: doc.querySelector('clipPath rect') };
}
const lines = label => label.querySelectorAll('tspan').length ? [...label.querySelectorAll('tspan')].map(n => n.textContent) : [label.textContent];

it('wraps words within category slots and reflows when the chart is resized', () => {
  const compact = render(), wide = render({ width: 1200 });
  expect(compact.labels).toHaveLength(4);
  expect(compact.labels.map(lines)).toEqual([['First', 'category'], ['Second', 'category'], ['Third', 'category'], ['Fourth', 'category']]);
  expect(wide.labels.every(n => lines(n).length === 1)).toBe(true);
  expect(compact.labels.every(n => !n.hasAttribute('transform'))).toBe(true);
  expect(compact.svg).not.toMatch(/NaN|Infinity/);
});

it.each(['square', 'none'])('honors hard breaks and blank lines with wrap=%s', xWrap => {
  const { labels } = render({ categories: ['North\r\n\r\nSales', '<East>\rSales'], appearance: { xWrap }, width: 800 });
  expect(labels.map(lines)).toEqual([['North', '', 'Sales'], ['<East>', 'Sales']]);
  expect(labels[0].getAttribute('aria-label')).toBe('North  Sales');
  expect(labels[0].innerHTML).not.toMatch(/<\/tspan>\s+<tspan/);
  expect(labels[1].querySelector('East')).toBeNull();
  const positions = [...labels[0].querySelectorAll('tspan')].map(n => +n.getAttribute('y'));
  expect(positions[1] - positions[0]).toBeCloseTo(19.2);
  expect(positions[2] - positions[1]).toBeCloseTo(19.2);
});

it('uses font ascent and descent for rotated multiline bounds when canvas metrics are available', () => {
  vi.stubGlobal('OffscreenCanvas', class {
    getContext() { return { font: '', measureText(text) {
      const size = Number(this.font.match(/([\d.]+)px/)?.[1] || 16);
      return { width: text.length * size * .56, fontBoundingBoxAscent: size, fontBoundingBoxDescent: size * .3 };
    } }; }
  });
  try {
    const { labels } = render({ categories: ['North\nSales', 'South\nSales'], width: 600, height: 300,
      appearance: { xRotation: 35, xWrap: 'none', xLabelPosition: 'high' } });
    expect(labels).toHaveLength(2);
    for (const label of labels) {
      const x = +label.getAttribute('x'), y = +label.getAttribute('y');
      const cos = Math.cos(35 * Math.PI / 180), sin = Math.sin(35 * Math.PI / 180);
      const ys = [...label.querySelectorAll('tspan')].flatMap(span => {
        const w = span.textContent.length * 16 * .56;
        return [-w, 0].flatMap(dx => [-16, 16 * .3].map(dy => y + dx * sin + (+span.getAttribute('y') - y + dy) * cos));
      });
      // SVG coordinates are serialized to hundredths of a pixel.
      expect(Math.min(...ys)).toBeGreaterThanOrEqual(-.01);
      expect(x).toBeGreaterThan(0);
    }
  } finally { vi.unstubAllGlobals(); }
});

it('retains unbreakable words and uses automatic rotation only when wrapping cannot fit them', () => {
  const categories = ['First category', 'Second category'];
  expect(render({ categories, width: 250, appearance: { xRotationAuto: true } }).labels.every(n => !n.hasAttribute('transform'))).toBe(true);
  const long = render({ categories: ['UnbreakableCategory', 'AnotherLongCategory'], width: 250, appearance: { xRotationAuto: true } });
  expect(long.labels.every(n => n.getAttribute('transform')?.startsWith('rotate(-45 '))).toBe(true);
  expect(long.labels.map(lines)).toEqual([['UnbreakableCategory'], ['AnotherLongCategory']]);
});

it('keeps no-wrap and oblique text on one line while preserving a saved interval', () => {
  for (const appearance of [{ xWrap: 'none' }, { xRotation: 45 }]) {
    const { labels } = render({ appearance: { ...appearance, xLabelSkip: 2 } });
    expect(labels.map(lines)).toEqual([['First category'], ['Third category']]);
  }
});

it.each(['low', 'high'])('uses the saved outside margin for %s horizontal bar labels', position => {
  const { labels, plot } = render({ type: 'bar', categories: ['First category has several words', 'Second category also has words'], width: 600,
    appearance: { xLabelPosition: position, plot: { x: .25, y: .2, w: .5, h: .6 } } });
  expect(labels.every(n => lines(n).length > 1)).toBe(true);
  expect(+plot.getAttribute('x')).toBe(150);
  expect(+plot.getAttribute('width')).toBe(300);
  labels.forEach(n => expect(+n.getAttribute('x')).toBe(position === 'low' ? 140 : 460));
});

it.each([-90, 90, 270])('wraps perpendicular bar labels at %s degrees within their category lanes', angle => {
  const { labels } = render({ type: 'bar', categories: ['First category', 'Second category'], width: 500, height: 260,
    appearance: { xRotation: angle, xLabelPosition: 'high' } });
  expect(labels).toHaveLength(2);
  expect(labels.every(n => lines(n).length > 1)).toBe(true);
  expect(labels.every(n => n.getAttribute('transform').startsWith(`rotate(${angle} `))).toBe(true);
});

it.each([-135, -90, -35, 0, 35, 90, 135, 180, 270])('reserves the entire multiline box at %s degrees for top and bottom labels', angle => {
  for (const position of ['low', 'high']) {
    const { labels, plot } = render({ categories: ['Alpha\nBeta\nGamma', 'Delta\nEpsilon'], width: 700, height: 420,
      appearance: { xRotation: angle, xLabelPosition: position, xWrap: 'none' } });
    expect(labels).toHaveLength(2);
    const top = +plot.getAttribute('y') + 1, bottom = top + +plot.getAttribute('height') - 2;
    for (const label of labels) {
      const anchor = label.getAttribute('text-anchor'), x = +label.getAttribute('x'), y = +label.getAttribute('y');
      const cos = Math.cos(angle * Math.PI / 180), sin = Math.sin(angle * Math.PI / 180);
      const corners = [...label.querySelectorAll('tspan')].flatMap(span => {
        const w = span.textContent.length * .56 * 16, dx = anchor === 'end' ? -w : anchor === 'middle' ? -w / 2 : 0;
        return [dx, dx + w].flatMap(px => [-12.8, 3.2].map(dy => {
          const py = +span.getAttribute('y') - y + dy;
          return { x: x + px * cos - py * sin, y: y + px * sin + py * cos };
        }));
      });
      expect(Math.min(...corners.map(p => p.x))).toBeGreaterThan(0);
      expect(Math.max(...corners.map(p => p.x))).toBeLessThan(700);
      expect(Math.min(...corners.map(p => p.y))).toBeGreaterThan(0);
      expect(Math.max(...corners.map(p => p.y))).toBeLessThan(420);
      if (position === 'high') expect(Math.max(...corners.map(p => p.y))).toBeLessThan(top);
      else expect(Math.min(...corners.map(p => p.y))).toBeGreaterThan(bottom);
    }
  }
});

it('preserves nonbreaking spaces and Unicode labels during word wrapping', () => {
  const { labels } = render({ width: 300, categories: ['North\u00a0East', '南方 🌏\n地域'] });
  expect(lines(labels[0])).toEqual(['North\u00a0East']);
  expect(lines(labels[1]).join(' ')).toBe('南方 🌏 地域');
  const unicode = render({ width: 300, categories: ['North\u2002East', 'North\u202fEast', 'North\u2007East'] });
  expect(unicode.labels.map(lines)).toEqual([['North', 'East'], ['North\u202fEast'], ['North\u2007East']]);
});

it('constrains a saved inner plot only when its multiline bottom labels would be clipped', () => {
  const { labels, plot } = render({ width: 600, height: 180, categories: ['North\nSales', 'South\nSales'],
    appearance: { plot: { x: .2, y: .1, w: .6, h: .8 } } });
  expect(+plot.getAttribute('x')).toBe(120);
  expect(+plot.getAttribute('width')).toBe(360);
  expect(+plot.getAttribute('y')).toBe(17); // Plot clipping includes a one-pixel line margin.
  expect(+plot.getAttribute('height')).toBeLessThan(146);
  for (const label of labels) for (const span of label.querySelectorAll('tspan')) {
    expect(+span.getAttribute('y') + 16 * .2).toBeLessThan(180);
  }
});

it.each([14.67, 14.666666666666666, 17.3])('retains a saved plot for single-line labels at fractional size %s', size => {
  const { labels, plot } = render({ width: 600, height: 180, categories: ['A', 'B'],
    appearance: { xStyle: { size, color: '#2468ab' }, plot: { x: .2, y: .1, w: .6, h: .8 } } });
  expect(labels.every(n => lines(n).length === 1)).toBe(true);
  // Ascent + descent can round above the font size; that is not another line.
  expect(+plot.getAttribute('height')).toBe(146);
});
