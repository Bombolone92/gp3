// @vitest-environment jsdom
// A scatter chart's horizontal axis has its own bounds, in either style (issue #142).
import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { Workbook } from '../src/core/workbook.js';
import { chartData, chartXBounds, chartXBoundsPatch, normalizeChart } from '../src/core/charts.js';
import { chartStylePatch } from '../src/core/chart-design.js';
import { renderChartSvg } from '../src/ui/chartsvg.js';
import { openChartDialog } from '../src/ui/chartdialog.js';
import { closeAllModals } from '../src/ui/modal.js';
import { closeMenu } from '../src/ui/menu.js';

const ROWS = [['x', 'y'], ['1', '2'], ['2', '5'], ['3', '7'], ['4', '11'], ['5', '13']];
const RANGE = { r1: 0, c1: 0, r2: 5, c2: 1 };
function book(extra = {}) {
  const wb = new Workbook(), id = wb.activeSheetId;
  ROWS.forEach((row, r) => row.forEach((v, c) => wb.setInput(id, r, c, v)));
  const chartId = wb.addChart(id, { type: 'scatter', range: RANGE, title: 'Mine', anchor: { r: 0, c: 3 }, w: 400, h: 260, ...extra });
  return { wb, id, chart: () => wb.chartById(id, chartId) };
}
const svgOf = (wb, id, chart) => new DOMParser().parseFromString(renderChartSvg(chartData(wb, id, chart), chart, 600, 400), 'image/svg+xml');

describe('the model', () => {
  it('keeps x bounds on a chart in the app\'s style and in the appearance of an Excel-style one', () => {
    const plain = normalizeChart({ type: 'scatter', range: RANGE, anchor: { r: 0, c: 0 }, xMin: 2, xMax: 4 });
    expect(chartXBounds(plain)).toEqual({ min: 2, max: 4 });
    expect(chartXBoundsPatch(plain, 1, null)).toEqual({ xMin: 1, xMax: null });
    const styled = { appearance: { xMin: 3, xMax: null } };
    expect(chartXBounds(styled)).toEqual({ min: 3, max: null });
    expect(chartXBoundsPatch(styled, null, 9)).toEqual({ appearance: { xMin: null, xMax: 9 } });
  });

  it('drops a reversed pair and leaves charts without bounds unchanged', () => {
    const reversed = normalizeChart({ type: 'scatter', range: RANGE, anchor: { r: 0, c: 0 }, xMin: 5, xMax: 2 });
    expect(chartXBounds(reversed)).toEqual({ min: null, max: null });
    expect(Object.hasOwn(normalizeChart({ type: 'scatter', range: RANGE, anchor: { r: 0, c: 0 } }), 'xMin')).toBe(false);
  });

  it('moves the bounds into the appearance when a Chart Style is applied', () => {
    const { chart } = book({ xMin: 2, xMax: 4 });
    const patch = chartStylePatch(chart(), 3);
    expect(patch.appearance).toMatchObject({ xMin: 2, xMax: 4 });
    const next = normalizeChart({ ...chart(), ...patch });
    expect(Object.hasOwn(next, 'xMin')).toBe(false);
    expect(chartXBounds(next)).toEqual({ min: 2, max: 4 });
  });
});

describe('drawing in the app\'s style', () => {
  it('starts and ends the x axis at its bounds and leaves out points past them', () => {
    const { wb, id, chart } = book();
    expect(svgOf(wb, id, chart()).querySelectorAll('circle')).toHaveLength(5);
    wb.updateChart(id, chart().id, { xMin: 2, xMax: 4 });
    const doc = svgOf(wb, id, chart());
    expect(doc.querySelectorAll('circle')).toHaveLength(3);
    const labels = [...doc.querySelectorAll('text')].map(t => t.textContent);
    // The x labels follow the y axis's: the axis runs from 2 to 4, with nothing beyond.
    expect(labels.slice(-5)).toEqual(['2.0', '2.5', '3.0', '3.5', '4.0']);
    expect(doc.querySelector('g[clip-path]')).not.toBeNull();
  });
});

describe('the editor', () => {
  let view;
  beforeEach(() => {
    vi.useFakeTimers(); vi.stubGlobal('Blob', NodeBlob);
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
    vi.stubGlobal('requestAnimationFrame', fn => setTimeout(fn, 0)); vi.stubGlobal('cancelAnimationFrame', clearTimeout);
    Element.prototype.scrollIntoView = () => {}; Element.prototype.scrollTo = () => {};
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 400 });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ measureText: text => ({ width: text.length * 7 }), font: '' });
    localStorage.clear(); document.body.replaceChildren();
  });
  afterEach(() => { closeMenu(); closeAllModals(); view?.destroy(); view = null; vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });
  const flush = async () => { for (let i = 0; i < 3; i++) await vi.advanceTimersByTimeAsync(1); };

  async function mount(styled) {
    const doc = new Doc({ name: 'Charts' }), wb = doc.wb, id = wb.activeSheetId;
    ROWS.forEach((row, r) => row.forEach((v, c) => wb.setInput(id, r, c, v)));
    const chartId = wb.addChart(id, { type: 'scatter', range: RANGE, title: 'Mine', anchor: { r: 0, c: 3 }, dx: 4, dy: 4, w: 400, h: 260 });
    if (styled) wb.updateChart(id, chartId, chartStylePatch(wb.chartById(id, chartId), 1));
    view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
    document.body.append(view.el); await flush();
    const box = view.el.querySelector(`.chart-box[data-chart="${chartId}"]`);
    box.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, clientX: 1, clientY: 1 }));
    box.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, button: 0, clientX: 1, clientY: 1 }));
    await flush();
    const pane = view.el.querySelector('.chart-format-pane');
    const open = async element => { view.run('chart', { action: 'selectElement', element }); view.run('chart', { action: 'formatPane' }); await flush(); };
    const set = async (label, value) => { const input = pane.querySelector(`[aria-label="${label}"]`); input.value = value; input.dispatchEvent(new Event('change')); await flush(); };
    return { wb, id, chart: () => wb.chartById(id, chartId), pane, open, set, box };
  }

  it.each([['app', false], ['Excel', true]])('formats the x axis of a scatter chart in the %s style from the Format pane', async (_, styled) => {
    const { chart, open, set } = await mount(styled);
    await open('xAxis');
    await set('Minimum', '2');
    await set('Maximum', '4');
    expect(chartXBounds(chart())).toEqual({ min: 2, max: 4 });
    expect(!!chart().appearance).toBe(styled);
    // The value axis keeps its own bounds.
    expect(chart().yMin).toBeNull();
  });

  it('switches the Format Axis pane between the axes', async () => {
    const { pane, open, set, chart } = await mount(false);
    await open('yAxis');
    const picker = pane.querySelector('select[aria-label="Axis"]');
    expect([...picker.options].map(o => o.textContent)).toEqual(['Horizontal (Value) Axis', 'Vertical (Value) Axis']);
    expect(picker.value).toBe('yAxis');
    picker.value = 'xAxis'; picker.dispatchEvent(new Event('change')); await flush();
    expect(pane.querySelector('select[aria-label="Axis"]').value).toBe('xAxis');
    await set('Minimum', '3');
    expect(chartXBounds(chart()).min).toBe(3);
    expect(chart().yMin).toBeNull();
  });

  it('opens the selected axis from More Axis Options and from a right-click on it', async () => {
    const { pane, box } = await mount(true);
    view.run('chart', { action: 'selectElement', element: 'xAxis' }); await flush();
    view.run('chart', { action: 'formatPane', element: 'yAxis' }); await flush();
    expect(pane.querySelector('select[aria-label="Axis"]').value).toBe('yAxis');
    view.run('chart', { action: 'formatPane', element: null }); await flush();
    expect(pane.querySelector('select[aria-label="Axis"]').value).toBe('xAxis');

    view.run('chart', { action: 'selectElement', element: 'chartArea' }); await flush();
    const axisLabel = box.querySelector('[data-el="xAxis"]');
    axisLabel.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }));
    await flush();
    const item = [...document.querySelectorAll('[role="menuitem"]')].find(n => n.textContent.includes('Format Axis'));
    expect(item).toBeTruthy();
    view.run('chart', { action: 'formatPane', element: 'yAxis' }); await flush();
    item.click(); await flush();
    expect(pane.querySelector('select[aria-label="Axis"]').value).toBe('xAxis');
  });

});

describe('Edit chart', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('matchMedia', () => ({ matches: true })); document.body.innerHTML = '<div id="app"></div>'; });
  afterEach(() => { closeAllModals(); vi.runAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

  it.each([['app', false], ['Excel', true]])('sets both axes\' bounds of a scatter chart in the %s style', (_, styled) => {
    const { wb, id, chart } = book();
    if (styled) wb.updateChart(id, chart().id, chartStylePatch(chart(), 1));
    const open = () => openChartDialog({ wb, sheetId: () => id, range: () => RANGE, grid: { focus: vi.fn(), selectChart: vi.fn() } }, { chart: chart() }).panel;
    let panel = open();
    const field = label => panel.querySelector(`[aria-label="${label}"]`);
    const type = (label, v) => { field(label).value = v; field(label).dispatchEvent(new Event('input')); };
    expect(field('Value axis minimum')).toBeNull();
    type('Vertical axis minimum', '1');
    type('Horizontal axis minimum', '4');
    type('Horizontal axis maximum', '3');
    panel.querySelector('form').requestSubmit();
    expect(chartXBounds(chart())).toEqual({ min: null, max: null });
    expect(field('Horizontal axis minimum').getAttribute('aria-invalid')).toBe('true');
    type('Horizontal axis maximum', '6');
    panel.querySelector('form').requestSubmit();
    expect(chartXBounds(chart())).toEqual({ min: 4, max: 6 });
    expect(chart().yMin).toBe(1);
    expect(!!chart().appearance).toBe(styled);
    // Opened again, it shows them; clearing one leaves that end automatic.
    panel = open();
    expect(field('Horizontal axis minimum').value).toBe('4');
    type('Horizontal axis minimum', '');
    panel.querySelector('form').requestSubmit();
    expect(chartXBounds(chart())).toEqual({ min: null, max: 6 });
  });

  it('shows the horizontal bounds only for scatter and bubble charts', () => {
    const wb = new Workbook(), id = wb.activeSheetId;
    ROWS.forEach((row, r) => row.forEach((v, c) => wb.setInput(id, r, c, v)));
    const { panel } = openChartDialog({ wb, sheetId: () => id, range: () => RANGE, grid: { focus: vi.fn(), selectChart: vi.fn() } }, { range: RANGE, type: 'column' });
    const row = () => panel.querySelector('[aria-label="Horizontal axis minimum"]').closest('.row');
    expect(row().hidden).toBe(true);
    expect(panel.querySelector('[aria-label="Value axis minimum"]')).not.toBeNull();
    panel.querySelector('.chart-type[data-type="scatter"]').click();
    expect(row().hidden).toBe(false);
    expect(panel.querySelector('[aria-label="Vertical axis minimum"]')).not.toBeNull();
  });
});
