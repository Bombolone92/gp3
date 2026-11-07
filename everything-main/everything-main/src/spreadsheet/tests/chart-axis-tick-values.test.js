// @vitest-environment jsdom
import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { chartData, normalizeChart } from '../src/core/charts.js';
import { chartStylePatch } from '../src/core/chart-design.js';
import { newExcelChart } from '../src/core/chart-subtypes.js';
import { formatAxisTickValues, parseAxisTickValues } from '../src/core/axis-tick-values.js';
import { renderChartSvg } from '../src/ui/chartsvg.js';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { closeAllModals } from '../src/ui/modal.js';
import { closeMenu } from '../src/ui/menu.js';

// Issue #146: an axis's ticks could only step by the major unit; now they can be listed, like pages to print.
const book = rows => {
  const wb = new Workbook(), id = wb.activeSheetId;
  rows.forEach((row, r) => row.forEach((v, c) => wb.setInput(id, r, c, String(v))));
  return { wb, id };
};
const LINE = [['X', 'Y'], [1, 2], [2, 9], [3, 35], [4, 40]];
const chartOf = (wb, id, type, appearance = {}, patch = {}) => {
  const base = newExcelChart(wb, id, { r1: 0, c1: 0, r2: 4, c2: 1 }, type);
  const chartId = wb.addChart(id, { ...base, ...patch, appearance: { ...base.appearance, ...appearance } });
  return wb.chartById(id, chartId);
};
const svgOf = (wb, id, chart) => new DOMParser().parseFromString(renderChartSvg(chartData(wb, id, chart), chart, 480, 300), 'image/svg+xml');
const labels = (doc, el) => [...doc.querySelectorAll(`text[data-el="${el}"]`)].map(t => t.textContent.trim());

it('reads a list of values and ranges like pages to print, and says what it cannot read', () => {
  expect(parseAxisTickValues('1, 2, 5, 8, 12')).toEqual({ values: [1, 2, 5, 8, 12] });
  expect(parseAxisTickValues('8; 1-3, 2')).toEqual({ values: [1, 2, 3, 8] });
  expect(parseAxisTickValues('-3--1, .5, 50%, 1e3')).toEqual({ values: [-3, -2, -1, 0.5, 1000] });
  expect(parseAxisTickValues('  ')).toEqual({ values: undefined });
  expect(parseAxisTickValues('1, two').error).toMatch(/"two" isn't a number or a range/);
  expect(parseAxisTickValues('5-1').error).toMatch(/low to high/);
  expect(parseAxisTickValues('1-100000').error).toMatch(/up to 200 values/);
  expect(formatAxisTickValues([1, 2, 3, 4, 5, 8, 10, 11, 12.5])).toBe('1-5, 8, 10, 11, 12.5');
  expect(formatAxisTickValues(undefined)).toBe('');
});

it('keeps a sorted list without repeats on the chart, and through a change of chart style', () => {
  const { wb, id } = book(LINE);
  const chart = chartOf(wb, id, 'line', { yTickValues: [40, 3, 'x', 3, 17], y2TickValues: [] });
  expect(chart.appearance.yTickValues).toEqual([3, 17, 40]);
  expect(chart.appearance.y2TickValues).toBeUndefined();
  expect(normalizeChart({ ...chart, appearance: { ...chart.appearance, yTickValues: null } }).appearance.yTickValues).toBeUndefined();
  expect(chartStylePatch(chart, 3).appearance.yTickValues).toEqual([3, 17, 40]);
});

it('draws a value axis’s ticks, gridlines and labels only at its custom values, widening automatic bounds to reach them', () => {
  const { wb, id } = book(LINE);
  const auto = svgOf(wb, id, chartOf(wb, id, 'column'));
  expect(labels(auto, 'yAxis')).toEqual(['0', '5', '10', '15', '20', '25', '30', '35', '40', '45']);

  const doc = svgOf(wb, id, chartOf(wb, id, 'column', { yTickValues: [3, 17, 40, 60] }));
  expect(labels(doc, 'yAxis')).toEqual(['3', '17', '40', '60']);
  expect(doc.querySelectorAll('.chart-gridline-y')).toHaveLength(4);
  // A fixed bound leaves out the values beyond it.
  const fixed = svgOf(wb, id, chartOf(wb, id, 'column', { yTickValues: [3, 17, 40, 60] }, { yMax: 50 }));
  expect(labels(fixed, 'yAxis')).toEqual(['3', '17', '40']);
  // A value off any step keeps its own decimals.
  expect(labels(svgOf(wb, id, chartOf(wb, id, 'line', { yTickValues: [2.25, 10] })), 'yAxis')).toEqual(['2.25', '10']);
});

it('picks the ticks of a logarithmic axis, leaving out values at or below zero', () => {
  const { wb, id } = book([['X', 'Y'], [1, 1], [2, 20], [3, 300], [4, 1000]]);
  expect(labels(svgOf(wb, id, chartOf(wb, id, 'line', { yLogBase: 10 })), 'yAxis')).toEqual(['1', '10', '100', '1,000']);
  const doc = svgOf(wb, id, chartOf(wb, id, 'line', { yLogBase: 10, yTickValues: [-1, 0, 3, 30, 300] }));
  expect(labels(doc, 'yAxis')).toEqual(['3', '30', '300']);
});

it('sets a scatter chart’s horizontal axis values, with minor ticks kept off them', () => {
  const { wb, id } = book([['X', 'Y'], [1, 2], [2.5, 9], [4, 35], [6, 40]]);
  const axisStyles = { x: { color: '#000000', width: 1, majorTick: 'out', minorTick: 'out' } };
  const doc = svgOf(wb, id, chartOf(wb, id, 'scatter', { xTickValues: [1.5, 3, 7], axisStyles }));
  expect(labels(doc, 'xAxis')).toEqual(['1.5', '3', '7']);
  const x = cls => [...doc.querySelectorAll(`.chart-axis-tick-${cls}.chart-axis-x`)].map(l => +l.getAttribute('x1'));
  expect(x('major')).toHaveLength(3);
  expect(x('minor').length).toBeGreaterThan(3);
  expect(x('minor').some(m => x('major').some(v => Math.abs(m - v) < .01))).toBe(false);
});

it('sets the secondary axis’s values by themselves', () => {
  const { wb, id } = book([['X', 'A', 'B'], ['N', 2, 100], ['S', 9, 200], ['E', 35, 300], ['W', 40, 400]]);
  const base = newExcelChart(wb, id, { r1: 0, c1: 0, r2: 4, c2: 2 }, 'comboColumnLineSecondary');
  const chartId = wb.addChart(id, { ...base, secondaryAxis: true, appearance: { ...base.appearance, y2TickValues: [150, 350] } });
  const doc = svgOf(wb, id, wb.chartById(id, chartId));
  expect(labels(doc, 'y2Axis')).toEqual(['150', '350']);
  expect(labels(doc, 'yAxis').length).toBeGreaterThan(2);
});

describe('Format Axis', () => {
  let view;
  beforeEach(() => {
    vi.useFakeTimers(); vi.stubGlobal('Blob', NodeBlob);
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
    vi.stubGlobal('requestAnimationFrame', fn => setTimeout(fn, 0)); vi.stubGlobal('cancelAnimationFrame', clearTimeout);
    Element.prototype.scrollIntoView = () => {}; Element.prototype.scrollTo = () => {};
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ measureText: text => ({ width: text.length * 7 }), font: '' });
    localStorage.clear(); document.body.replaceChildren();
  });
  afterEach(() => { closeMenu(); closeAllModals(); view?.destroy(); view = null; vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });
  const flush = async () => { for (let i = 0; i < 3; i++) await vi.advanceTimersByTimeAsync(1); };

  it('takes custom values in Format Axis, shows them back as written, and turns down what it cannot read', async () => {
    const doc = new Doc({ name: 'Ticks' }), wb = doc.wb, id = wb.activeSheetId;
    LINE.forEach((row, r) => row.forEach((v, c) => wb.setInput(id, r, c, String(v))));
    const chartId = wb.addChart(id, newExcelChart(wb, id, { r1: 0, c1: 0, r2: 4, c2: 1 }, 'scatter'));
    view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
    document.body.append(view.el); await flush();
    const box = view.el.querySelector('.chart-box');
    for (const type of ['pointerdown', 'pointerup']) box.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: 1, clientY: 1 }));
    await flush();
    const chart = () => wb.chartById(id, chartId);
    const pane = () => view.el.querySelector('.chart-format-pane');
    const set = async value => { const input = pane().querySelector('[aria-label="Custom values"]'); input.value = value; input.dispatchEvent(new Event('change')); await flush(); };

    view.run('chart', { action: 'formatPane', element: 'yAxis' }); await flush();
    await set('5, 10-13, 40');
    expect(chart().appearance.yTickValues).toEqual([5, 10, 11, 12, 13, 40]);
    expect(pane().querySelector('[aria-label="Custom values"]').value).toBe('5, 10-13, 40');
    expect(labels(new DOMParser().parseFromString(view.el.querySelector('.chart-box .chart-body svg').outerHTML, 'image/svg+xml'), 'yAxis'))
      .toEqual(['5', '10', '11', '12', '13', '40']);

    await set('5, ten');
    expect(pane().querySelector('[role="alert"]:not([hidden])').textContent).toMatch(/"ten"/);
    expect(chart().appearance.yTickValues).toEqual([5, 10, 11, 12, 13, 40]);
    await set('');
    expect(chart().appearance.yTickValues).toBeUndefined();

    view.run('chart', { action: 'formatPane', element: 'xAxis' }); await flush();
    await set('1, 2.5, 4');
    expect(chart().appearance.xTickValues).toEqual([1, 2.5, 4]);
  });
});
