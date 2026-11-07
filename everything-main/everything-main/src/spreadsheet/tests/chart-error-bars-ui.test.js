// @vitest-environment jsdom
import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { Workbook } from '../src/core/workbook.js';
import { closeAllModals } from '../src/ui/modal.js';
import { closeMenu } from '../src/ui/menu.js';
import { newExcelChart } from '../src/core/chart-subtypes.js';
import { openChartDialog } from '../src/ui/chartdialog.js';
import { elementForNode } from '../src/ui/chart-format-pane.js';

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
const ROWS = [['X', 'Y', 'Err'], ['1', '10', '1'], ['2', '20', '2'], ['3', '30', '3'], ['4', '40', '4']];

async function mount() {
  const doc = new Doc({ name: 'Errors' }), wb = doc.wb, id = wb.activeSheetId;
  ROWS.forEach((row, r) => row.forEach((v, c) => wb.setInput(id, r, c, v)));
  const chartId = wb.addChart(id, newExcelChart(wb, id, { r1: 0, c1: 0, r2: 4, c2: 1 }, 'scatter'));
  view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
  document.body.append(view.el); await flush();
  const box = view.el.querySelector('.chart-box');
  box.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, clientX: 1, clientY: 1 }));
  box.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, button: 0, clientX: 1, clientY: 1 }));
  await flush();
  return { wb, id, chart: () => wb.chartById(id, chartId) };
}
const pane = () => view.el.querySelector('.chart-format-pane');
const control = label => pane().querySelector(`[aria-label="${label}"]`);
const tick = label => [...pane().querySelectorAll('label.check')].find(n => n.textContent === label).querySelector('input');
const set = async (input, value) => { input.value = value; input.dispatchEvent(new Event('change')); await flush(); };
const drawn = axis => view.el.querySelectorAll(`.chart-box .chart-body svg .chart-error-bar[data-axis="${axis}"]`);

it('adds error bars from Add Chart Element, then sets each direction, its amount from cells, caps and line in Format Error Bars', async () => {
  const { chart } = await mount();
  view.run('chart', { action: 'element', element: 'errorBars', value: 'stdErr' }); await flush();
  expect(chart().errorBars[0].y).toMatchObject({ type: 'stdErr' });
  expect(drawn('y')).toHaveLength(4);

  view.run('chart', { action: 'formatPane', element: 'errorBars:0' }); await flush();
  expect(pane().querySelector('.chart-pane-title').textContent).toBe('Format Error Bars');
  await set(control('Vertical error amount'), 'cust');
  await set(control('Vertical positive error value'), '=C2:C5');
  await set(control('Vertical negative error value'), '0.5');
  expect(chart().errorBars[0].y).toMatchObject({ type: 'cust', plus: 'Sheet1!$C$2:$C$5', minusValues: [0.5] });
  // A range of a whole block is turned down, with the reason beside the field, and the chart keeps its bars.
  await set(control('Vertical negative error value'), 'A1:B5');
  expect(pane().querySelector('[role="alert"]:not([hidden])').textContent).toMatch(/one row or one column/);
  expect(chart().errorBars[0].y.minusValues).toEqual([0.5]);

  await set(control('Vertical error bar cap width (pt)'), '9');
  await set(control('Vertical error bar width (pt)'), '1.5');
  await set(control('Vertical error bar direction'), 'plus');
  expect(chart().errorBars[0].y).toMatchObject({ capWidth: 12, width: 2, direction: 'plus' });

  // Horizontal bars go on and off by themselves.
  tick('Show horizontal error bars').click(); await flush();
  expect(chart().errorBars[0].x).toBeTruthy();
  expect(drawn('x')).toHaveLength(4);
  await set(control('Horizontal error amount'), 'fixedVal');
  await set(control('Horizontal fixed value'), '0.25');
  expect(chart().errorBars[0].x).toMatchObject({ type: 'fixedVal', value: 0.25 });
  tick('Show vertical error bars').click(); await flush();
  expect(chart().errorBars[0].y).toBeUndefined();
  expect(drawn('y')).toHaveLength(0);
});

it('selects error bars by clicking them, and Delete takes them away', async () => {
  const { chart } = await mount();
  view.run('chart', { action: 'element', element: 'errorBars', value: 'percentage' }); await flush();
  const bar = view.el.querySelector('.chart-box .chart-body svg .chart-error-bar');
  expect(elementForNode(bar)).toBe('errorBars:0');
  view.run('chart', { action: 'selectElement', element: 'errorBars:0' }); await flush();
  view.el.querySelector('.chart-box').dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }));
  await flush();
  expect(chart().errorBars).toBeUndefined();
  expect(chart()).toBeTruthy();
});

it('offers error bars in the chart dialog for XY charts, from cells or a fixed amount', () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  ROWS.forEach((row, r) => row.forEach((v, c) => wb.setInput(id, r, c, v)));
  openChartDialog({ wb, sheetId: () => id, range: () => ({ r1: 0, c1: 0, r2: 4, c2: 1 }), grid: { focus: vi.fn(), selectChart: vi.fn() } });
  const field = label => document.querySelector(`[aria-label="${label}"]`);
  const pick = (input, value) => { input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); };
  expect(field('Vertical error bars').closest('.row').hidden).toBe(true);
  document.querySelector('[data-type="scatter"]').click();
  expect(field('Vertical error bars').closest('.row').hidden).toBe(false);
  pick(field('Vertical error bars'), 'cust');
  // No cells yet: the chart waits for them.
  document.querySelector('form').requestSubmit();
  expect(wb.sheet(id).charts).toHaveLength(0);
  expect(document.querySelector('.field-error').textContent).toMatch(/cells that hold the vertical error amounts/);
  pick(field('Vertical error cells'), '=C2:C5');
  pick(field('Horizontal error bars'), 'fixedVal');
  expect(field('Horizontal error amount').value).toBe('1');
  pick(field('Horizontal error amount'), '0.5');
  expect(document.querySelectorAll('.chart-preview .chart-error-bar')).toHaveLength(8);
  document.querySelector('form').requestSubmit();
  expect(wb.sheet(id).charts[0].errorBars).toEqual([{
    x: { type: 'fixedVal', value: 0.5, direction: 'both', caps: true, width: 1 },
    y: { type: 'cust', value: 1, plus: 'Sheet1!$C$2:$C$5', minus: 'Sheet1!$C$2:$C$5', direction: 'both', caps: true, width: 1 },
  }]);
});
