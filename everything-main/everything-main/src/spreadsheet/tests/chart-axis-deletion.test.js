import { expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { normalizeChart } from '../src/core/charts.js';
import { renderChartSvg } from '../src/ui/chartsvg.js';
import { chartAxisScale, chartAxisTransferBounds } from '../src/core/chart-axis-scale.js';

const parser = new (new JSDOM('').window.DOMParser)();
const data = { categories: ['A', 'B', 'C'], series: [{ name: 'Columns', values: [20, 80, 40] }, { name: 'Line', values: [2, 8, 4] }] };
function draw(appearance = {}, options = {}, input = data) {
  const chart = normalizeChart({ type: 'combo', secondaryAxis: true, anchor: { r: 0, c: 3 }, range: { r1: 0, c1: 0, r2: 2, c2: 1 },
    legend: false, yMin: 0, yMax: 1000, ...options, appearance: {
      plot: { x: .2, y: .2, w: .6, h: .6 }, y2Min: 0, y2Max: 100, yStep: 250, y2Step: 20,
      yStyle: { color: '#336699' }, y2Style: { color: '#cc2255' }, y2Gridlines: true,
      axisStyles: { x: { color: '#111111' }, y: { color: '#336699', majorTick: 'out' }, y2: { color: '#cc2255', majorTick: 'out' } },
      ...appearance,
    } });
  const before = JSON.stringify(chart), svg = renderChartSvg(input, chart, 600, 400);
  expect(JSON.stringify(chart)).toBe(before);
  expect(svg).not.toMatch(/NaN|Infinity/);
  const doc = parser.parseFromString(svg, 'image/svg+xml'), clip = doc.querySelector('clipPath rect');
  const plot = { x: +clip.getAttribute('x'), y: +clip.getAttribute('y') + 1, w: +clip.getAttribute('width'), h: +clip.getAttribute('height') - 2 };
  return { doc, plot, chart, labels: color => [...doc.querySelectorAll(`text[fill="${color}"]`)].map(e => e.textContent),
    bars: [...doc.querySelectorAll('.chart-column')], markers: [...doc.querySelectorAll('circle.chart-series')] };
}

it.each([[false, false], [true, false], [false, true], [true, true]])('deletes value axes independently (%s, %s) while retaining their series and grids', (hideYAxis, hideY2Axis) => {
  const { doc, labels, bars, plot } = draw({ hideYAxis, hideY2Axis });
  for (const [key, color, hidden] of [['y', '#336699', hideYAxis], ['y2', '#cc2255', hideY2Axis]]) {
    expect(doc.querySelector(`.chart-axis-line.chart-axis-${key}`) == null).toBe(hidden);
    expect(doc.querySelectorAll(`.chart-axis-tick-major.chart-axis-${key}`).length > 0).toBe(!hidden);
    expect(labels(color).length > 0).toBe(!hidden);
    expect(doc.querySelectorAll(`.chart-gridline-${key}`).length).toBeGreaterThan(0);
  }
  const max = hideYAxis && !hideY2Axis ? 100 : 1000;
  expect(bars).toHaveLength(3);
  bars.forEach((bar, i) => expect(+bar.getAttribute('height')).toBeCloseTo(data.series[0].values[i] / max * plot.h, 1));
  const line = doc.querySelector('path.chart-series');
  expect(line).not.toBeNull();
  const lineMax = hideY2Axis && !hideYAxis ? 1000 : 100;
  const coordinates = line.getAttribute('d').match(/-?\d+(?:\.\d+)?/g).map(Number);
  expect(coordinates[1]).toBeCloseTo(plot.y + plot.h * (1 - 2 / lineMax), 1);
});

it('retains deleted grid intervals and the original category crossing, while sharing series bounds', () => {
  const { doc, plot, bars } = draw({ hideYAxis: true, axisCrossings: { x: 50 } });
  expect(+doc.querySelector('.chart-axis-line.chart-axis-x').getAttribute('y1')).toBeCloseTo(plot.y + plot.h * .95);
  expect(+bars[0].getAttribute('height')).toBeCloseTo(plot.h * .3);
  expect(+bars[0].getAttribute('y')).toBeCloseTo(plot.y + plot.h * .5);
  expect(doc.querySelectorAll('.chart-gridline-y')).toHaveLength(1); // 250 does not fit the shared 0–100 range.
  const secondary = draw({ hideY2Axis: true });
  expect(secondary.doc.querySelectorAll('.chart-gridline-y2')).toHaveLength(51); // Retains 20 across 0–1000.
});

it.each(['hideYAxis', 'hideY2Axis'])('retains each series direction with %s', hidden => {
  const normal = draw({ [hidden]: true }), reversed = draw({ [hidden]: true, reverseValues: true, reverseSecondaryValues: true });
  normal.bars.forEach((bar, i) => {
    expect(+reversed.bars[i].getAttribute('height')).toBe(+bar.getAttribute('height'));
    expect(+reversed.bars[i].getAttribute('y')).toBeCloseTo(reversed.plot.y);
  });
  const category = reversed.doc.querySelector('.chart-axis-line.chart-axis-x');
  expect(+category.getAttribute('y1')).toBeCloseTo(reversed.plot.y);
});

it.each(['hideYAxis', 'hideY2Axis'])('includes stacked totals in the surviving automatic range with %s', hidden => {
  const input = { ...data, series: [data.series[0], { name: 'Stack', values: [30, 90, 20] }, data.series[1]] };
  const { labels, plot, bars } = draw({ [hidden]: true, yStep: null, y2Step: null, y2Min: null, y2Max: null }, { yMin: null, yMax: null, stacked: true }, input);
  const maximum = Number(labels(hidden === 'hideYAxis' ? '#cc2255' : '#336699').at(-1));
  expect(maximum).toBe(hidden === 'hideYAxis' ? 200 : 180);
  expect(+bars[1].getAttribute('height') + +bars[4].getAttribute('height')).toBeCloseTo(plot.h * 170 / maximum, 1);
});

// Expected bounds for each data range. Fixed major units expose
// range policy independently of its automatic choice of tick interval.
it.each([
  [[1, 95, 50], [2, 8, 4], 10, null, null, 0, 110],
  [[90, 100, 95], [91, 99, 95], 1, null, null, 84, 102],
  [[80, 100, 90], [81, 99, 90], 1, null, null, 0, 111],
  [[-1, -95, -50], [-2, -8, -4], .3, null, null, -105, 9],
  [[-90, -100, -95], [-91, -99, -95], 1, null, null, -102, -84],
  [[-80, -100, -90], [-81, -99, -90], 1, null, null, -107, 0],
  [[0, -100, -50], [-2, -8, -4], 1, null, null, -111, 0],
  [[-100, -100, -100], [-2, -8, -4], 1, null, null, -111, 0],
  [[-100, 100, 0], [-2, 8, 4], 1, null, null, -121, 121],
  [[20, 80, 40], [2, 8, 4], 5, 0, 100, 0, 115],
  [[20, 800, 40], [2, 8, 4], 5, 0, 100, 0, 840],
  [[-20, -800, -40], [-2, -8, -4], 5, -100, 0, -840, 0],
  [[20, 80, 40], [200, 800, 400], 10, null, null, 0, 840],
  [[100, 100, 100], [2, 8, 4], 1, null, null, 0, 111],
  [[0, 0, 0], [.02, .08, .04], .01, null, null, -1.11, .14],
])('transfers the unrounded primary range for %j', (primary, secondary, step, yMin, yMax, min, max) => {
  const input = { ...data, series: [{ name: 'Primary', values: primary }, { name: 'Secondary', values: secondary }] };
  const { labels, bars, plot } = draw({ hideYAxis: true, yStep: step, y2Step: step, y2Min: null, y2Max: null }, { yMin, yMax }, input);
  const ticks = labels('#cc2255').map(Number);
  expect(ticks[0]).toBeCloseTo(min);
  expect(ticks.at(-1)).toBeCloseTo(max);
  const crossing = Math.max(min, Math.min(max, 0));
  expect(+bars[0].getAttribute('height')).toBeCloseTo(Math.abs(primary[0] - crossing) / (max - min) * plot.h, 1);
});

it('keeps transfer headroom independent of units, sign symmetry and rounded primary ticks', () => {
  for (const factor of [.001, 1, 1e6]) {
    const primary = chartAxisTransferBounds(90 * factor, 100 * factor, { step: 30 * factor });
    expect(primary[0] / factor).toBeCloseTo(89.5);
    expect(primary[1] / factor).toBeCloseTo(100.5);
    const scale = chartAxisScale(...primary, { step: factor });
    expect(scale.min / factor).toBeCloseTo(84);
    expect(scale.max / factor).toBeCloseTo(102);
    const negative = chartAxisTransferBounds(-95 * factor, -factor);
    expect(negative[0] / factor).toBeCloseTo(-99.7);
    expect(negative[1] / factor).toBeCloseTo(3.7);
  }
  expect(chartAxisTransferBounds(0, 1, { percent: true })).toEqual([0, 1]);
  expect(chartAxisTransferBounds(Infinity, -Infinity)).toEqual([0, 1.05]);
  for (const bounds of [[-Number.MAX_VALUE, Number.MAX_VALUE], [0, 0], [10, 10], [-10, -10]]) {
    const transferred = chartAxisTransferBounds(...bounds);
    expect(transferred.every(Number.isFinite)).toBe(true);
    expect(transferred[1]).toBeGreaterThan(transferred[0]);
  }
});

it('transfers an empty primary default range and preserves unpadded percentage extents', () => {
  const empty = { ...data, series: [{ name: 'Empty', values: [null, null, null] }, { name: 'Line', values: [.02, .08, .04] }] };
  const appearance = { hideYAxis: true, yStep: .01, y2Step: .01, y2Min: null, y2Max: null };
  const limits = result => [Number(result.labels('#cc2255')[0]), Number(result.labels('#cc2255').at(-1))];
  expect(limits(draw(appearance, { yMin: null, yMax: null }, empty))).toEqual([0, 1.11]);
  for (const sign of [1, -1]) {
    const values = [20, 80, 40].map(v => v * sign);
    const input = { ...data, series: [{ name: 'A', values }, { name: 'B', values }, { name: 'Line', values: values.map(v => v / 100) }] };
    expect(limits(draw(appearance, { yMin: null, yMax: null, stacked: true, stack100: true }, input)))
      .toEqual(sign > 0 ? [0, 1.05] : [-1.05, 0]);
  }
  for (const value of [null, 0]) {
    const input = { ...data, series: [{ name: 'A', values: [value, value, value] },
      { name: 'B', values: [value, value, value] }, empty.series[1]] };
    expect(limits(draw(appearance, { yMin: null, yMax: null, stacked: true, stack100: true }, input))).toEqual([0, .09]);
  }
});

it('retains the deleted primary automatic grid interval when a larger secondary series extends the range', () => {
  const input = { ...data, series: [data.series[0], { name: 'Line', values: [200, 800, 400] }] };
  const { doc, labels } = draw({ hideYAxis: true, yStep: null, y2Step: null, y2Min: null, y2Max: null }, { yMin: null, yMax: null }, input);
  expect(labels('#cc2255').at(-1)).toBe('900');
  expect(doc.querySelectorAll('.chart-gridline-y')).toHaveLength(91);
});

it('keeps a sole deleted value axis on its saved range', () => {
  const { bars, plot, doc } = draw({ hideYAxis: true }, { type: 'column', secondaryAxis: false }, { ...data, series: [data.series[0]] });
  expect(+bars[1].getAttribute('height')).toBeCloseTo(plot.h * .08);
  expect(doc.querySelector('.chart-axis-line.chart-axis-y')).toBeNull();
});

it('hides deleted-axis display units without dropping titles or stored bounds', () => {
  const units = { divisor: 10, label: 'Secondary units' };
  const hidden = draw({ hideY2Axis: true, y2Units: units }, { yTitle: 'Value title' });
  expect(hidden.doc.documentElement.textContent).not.toContain('Secondary units');
  expect(hidden.doc.documentElement.textContent).toContain('Value title');
  expect(hidden.chart.appearance.y2Max).toBe(100);
  expect(draw({ y2Units: units }).doc.documentElement.textContent).toContain('Secondary units');
});

it('includes deleted primary fixed bounds only when the surviving endpoint is automatic', () => {
  const automatic = draw({ hideYAxis: true, yStep: null, y2Step: null, y2Min: 10, y2Max: null, y2Format: '0' });
  const labels = automatic.labels('#cc2255').map(Number);
  expect(labels[0]).toBe(10);
  expect(labels.at(-1)).toBeGreaterThanOrEqual(1000);
  const fixed = draw({ hideYAxis: true, y2Min: 10, y2Max: 100 });
  expect(fixed.labels('#cc2255').map(Number)).toEqual([10, 30, 50, 70, 90]);
  const secondary = draw({ hideY2Axis: true, yStep: null, y2Min: -1000, y2Max: 1000 }, { yMin: null, yMax: null });
  expect(secondary.labels('#336699').map(Number)).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90]);
});

it.each(['hideYAxis', 'hideY2Axis'])('keeps percentage stack values and the ordinary line on the shared domain with %s', hidden => {
  const input = { ...data, series: [data.series[0], { name: 'Stack', values: [30, 90, 20] }, data.series[1]] };
  const { labels, bars, plot } = draw({ [hidden]: true, yStep: null, y2Step: null, y2Min: null, y2Max: null },
    { yMin: null, yMax: null, stacked: true, stack100: true }, input);
  const maximum = hidden === 'hideYAxis' ? 9 : 8;
  expect(labels(hidden === 'hideYAxis' ? '#cc2255' : '#336699').at(-1)).toBe(hidden === 'hideYAxis' ? '9' : '800%');
  expect(+bars[0].getAttribute('height') + +bars[3].getAttribute('height')).toBeCloseTo(plot.h / maximum, 1);
});

it('handles negative, empty and malformed shared ranges without losing drawable geometry', () => {
  const negative = { ...data, series: [{ name: 'Columns', values: [-20, -80, -40] }, { name: 'Line', values: [-200, -800, -400] }] };
  const result = draw({ hideY2Axis: true, yStep: null, y2Step: null, y2Min: null, y2Max: null }, { yMin: null, yMax: null }, negative);
  expect(result.labels('#336699')[0]).toBe('-900');
  expect(result.labels('#336699').at(-1)).toBe('0');
  const empty = { ...data, series: data.series.map(s => ({ ...s, values: [null, NaN, Infinity] })) };
  draw({ hideYAxis: true, y2Min: 5, y2Max: -5 }, {}, empty);
});
