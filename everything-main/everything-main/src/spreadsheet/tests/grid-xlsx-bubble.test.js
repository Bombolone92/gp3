// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from 'vitest';
import { workbookFromFile } from '../src/core/io.js';
import { chartData } from '../src/core/charts.js';
import { renderChartSvg } from '../src/ui/chartsvg.js';
import { createGrid } from '../src/ui/grid.js';
import { buildPrintSheet } from '../src/ui/print.js';
import { openChartDialog } from '../src/ui/chartdialog.js';
import { closeAllModals } from '../src/ui/modal.js';
import { bubbleXlsx } from './helpers/xlsx-bubble-fixture.js';

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 1600 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 1000 });
  HTMLCanvasElement.prototype.getContext = () => ({ measureText: t => ({ width: t.length * 7 }), font: '' });
  Element.prototype.scrollTo = () => {};
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
  globalThis.requestAnimationFrame = fn => setTimeout(fn, 0);
  globalThis.cancelAnimationFrame = clearTimeout;
});
afterEach(() => { closeAllModals(); document.body.replaceChildren(); });

const load = async options => {
  const wb = await workbookFromFile(bubbleXlsx(options), 'bubble.xlsx'), sheet = wb.sheets[0], chart = sheet.charts[0];
  const host = document.createElement('div');
  const render = () => { host.innerHTML = renderChartSvg(chartData(wb, sheet.id, chart),
    { ...chart, appearance: { ...chart.appearance, plotStroke: '#000000' } }, 600, 400); return host; };
  return { wb, sheet, chart, render };
};
const coordinates = (host, chart) => {
  const plot = host.querySelector('.chart-plot-border'), a = chart.appearance;
  return { x: v => +plot.getAttribute('x') + (v - a.xMin) / (a.xMax - a.xMin) * +plot.getAttribute('width'),
    y: v => +plot.getAttribute('y') + (chart.yMax - v) / (chart.yMax - chart.yMin) * +plot.getAttribute('height') };
};
const expectPath = (actual, expected) => {
  expect(actual.replace(/[-\d.]+/g, '')).toBe(expected.replace(/[-\d.]+/g, ''));
  const values = text => text.match(/-?\d+(?:\.\d+)?/g).map(Number);
  values(actual).forEach((value, i) => expect(value).toBeCloseTo(values(expected)[i], 1));
};

it('renders bubbles at independent coordinates with area scaling, gradients and standard errors', async () => {
  const { chart, render } = await load();
  let host = render(), bubbles = host.querySelectorAll('.chart-bubble');
  // Visible value labels can constrain a saved inner plot's left margin.
  // Check independent numeric coordinates against the final laid-out axes.
  const { x, y } = coordinates(host, chart);
  expect(+bubbles[0].getAttribute('cx')).toBeCloseTo(x(2), 1);
  expect(+bubbles[0].getAttribute('cy')).toBeCloseTo(y(6), 1);
  expect(+bubbles[2].getAttribute('cx')).toBeCloseTo(x(3), 1);
  expect(+bubbles[2].getAttribute('cy')).toBeCloseTo(y(4), 1);
  const radius = i => +bubbles[i].getAttribute('r');
  expect(radius(1) / radius(0)).toBeCloseTo(2, 2);
  expectPath(host.querySelector('.chart-error-bar[data-axis="x"]').getAttribute('d'),
    `M ${x(1)} ${y(6)} L ${x(3)} ${y(6)} M ${x(1)} ${y(6) - 3} V ${y(6) + 3} M ${x(3)} ${y(6) - 3} V ${y(6) + 3}`);
  expectPath(host.querySelector('.chart-error-bar[data-axis="y"]').getAttribute('d'),
    `M ${x(2)} ${y(5)} L ${x(2)} ${y(7)} M ${x(2) - 3} ${y(5)} H ${x(2) + 3} M ${x(2) - 3} ${y(7)} H ${x(2) + 3}`);
  expect([...host.querySelectorAll('.chart-data-label')].map(e => e.textContent)).toEqual(['6', '8', '4', '9', '10', '8', '15']);
  expect(host.querySelector('linearGradient').getAttribute('y2')).toBe('100%');
  const original = radius(0);
  chart.appearance.bubble.scale = 200;
  bubbles = render().querySelectorAll('.chart-bubble');
  expect(radius(0)).toBeCloseTo(original * 2, 1);
  chart.appearance.bubble.sizeRepresents = 'w';
  bubbles = render().querySelectorAll('.chart-bubble');
  expect(radius(1) / radius(0)).toBeCloseTo(4, 2);
});

it.each([
  ['fixedVal', 2, 'plus', [2, 4]],
  ['percentage', 50, 'minus', [1, 2]],
  // Standard deviation bars stand on the series' mean (x = 3 here), as Excel draws them, not on each point.
  ['stdDev', 1, 'both', [3 - Math.SQRT2, 3 + Math.SQRT2]],
])('renders %s errors with the requested direction and caps', async (type, value, direction, [low, high]) => {
  const { chart, render } = await load();
  chart.errorBars = [{ x: { type, value, direction, caps: false, color: '#000000', width: 1 } }];
  const host = render(), { x, y } = coordinates(host, chart);
  expectPath(host.querySelector('.chart-error-bar').getAttribute('d'), `M ${x(low)} ${y(6)} L ${x(high)} ${y(6)}`);
});

it('inherits shared bubble labels and honors per-point suppression', async () => {
  const { render } = await load({ editChart: s => s.replaceAll('<c:showVal val="1"/>', '')
    .replace('<c:bubbleScale', '<c:dLbls><c:showVal val="true"/><c:dLbl><c:idx val="0"/><c:delete val="1"/></c:dLbl></c:dLbls><c:bubbleScale') });
  expect([...render().querySelectorAll('.chart-data-label')].map(e => e.textContent)).toEqual(['8', '9', '8', '15']);
});

it('uses native default column widths on screen and retains bubbles and annotations in print', async () => {
  const { wb, sheet } = await load();
  const grid = createGrid({ wb, sheetId: sheet.id, announce() {} });
  try {
    document.body.append(grid.el);
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(grid.el.querySelector('#gc-0-1').style.width).toBe('61px');
    const svg = grid.el.querySelector('svg[aria-label="bubble chart"]');
    expect(svg.closest('.transparent.borderless')).not.toBeNull();
    expect(svg.querySelectorAll('.chart-bubble')).toHaveLength(7);
    const object = buildPrintSheet(wb, sheet.id).querySelector('.print-object');
    expect(object.style.backgroundColor).toBe('transparent');
    expect(object.querySelectorAll('.chart-bubble')).toHaveLength(7);
    expect([...object.querySelectorAll('.chart-annotation')].map(line => line.textContent).join(' '))
      .toBe('Standard error & uncertainty');
  } finally { grid.destroy(); }
});

it('edits embedded values and size references with a live preview and undo', async () => {
  const { wb, sheet, chart } = await load();
  openChartDialog({ wb, sheetId: () => sheet.id, range: () => chart.range, grid: { selectChart() {}, focus() {} } }, { chart });
  const sizes = document.querySelector('[aria-label="Bubble sizes for series 1"]');
  expect(sizes.value).toBe('9, 36');
  const bubble = () => document.querySelector('.chart-preview .chart-bubble');
  const previous = +bubble().getAttribute('r');
  sizes.value = '36, 36';
  sizes.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, 180));
  expect(+bubble().getAttribute('r')).toBeCloseTo(previous * 2, 1);
  const values = document.querySelector('[aria-label="Values for series 1"]');
  values.value = '12, 14';
  document.querySelector('form').requestSubmit();
  expect(sheet.charts[0].sourceRefs[0].literal.sizes).toEqual([36, 36]);
  expect(chartData(wb, sheet.id, sheet.charts[0]).series[0].values).toEqual([12, 14, null]);
  wb.undo();
  expect(sheet.charts[0].sourceRefs[0].literal.sizes).toEqual([9, 36]);

  openChartDialog({ wb, sheetId: () => sheet.id, range: () => chart.range, grid: { selectChart() {}, focus() {} } }, { chart: sheet.charts[0] });
  document.querySelector('[aria-label="Bubble sizes for series 1"]').value = 'Values!G1:H1';
  document.querySelector('form').requestSubmit();
  expect(sheet.charts[0].sourceRefs[0].sizes).toBe('Values!G1:H1');
  expect(sheet.charts[0].sourceRefs[0].literal.sizes).toBeUndefined();
  wb.setInput(wb.sheets[1].id, 0, 6, '81');
  expect(chartData(wb, sheet.id, sheet.charts[0]).series[0].sizes[0]).toBe(81);
});
