// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { defaultChart } from '../src/core/charts.js';
import { openChartDialog } from '../src/ui/chartdialog.js';
import { closeAllModals } from '../src/ui/modal.js';

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(() => {
  closeAllModals();
  vi.runAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

function setup(type = null) {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  const range = { r1: 0, c1: 0, r2: 1, c2: 0 };
  wb.setInput(id, 0, 0, '10');
  wb.setInput(id, 1, 0, '20');
  const chartId = type ? wb.addChart(id, { ...defaultChart(range, { r: 0, c: 2 }), type }) : null;
  openChartDialog({ wb, sheetId: () => id, range: () => range, grid: { focus: vi.fn(), selectChart: vi.fn() } },
    chartId ? { chart: wb.chartById(id, chartId) } : {});
  return { wb, id, radios: [...document.querySelectorAll('[role="radiogroup"][aria-label="Chart type"] [role="radio"]')] };
}

it('has one chart-type tab stop and supports arrow selection, wrapping, and insertion', () => {
  const { wb, id, radios } = setup();
  expect(radios.filter((node) => node.tabIndex === 0)).toEqual([radios[0]]);
  radios[0].focus();
  const press = (key, expected) => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    document.activeElement.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(expected);
    expect(radios.filter((node) => node.tabIndex === 0)).toEqual([expected]);
    expect(radios.filter((node) => node.getAttribute('aria-checked') === 'true')).toEqual([expected]);
  };
  press('ArrowLeft', radios.at(-1));
  press('ArrowDown', radios[0]);
  press('ArrowRight', radios[1]);
  press('ArrowUp', radios[0]);
  press('ArrowRight', radios[1]);
  expect(wb.sheet(id).charts).toHaveLength(0);
  document.querySelector('form').requestSubmit();
  expect(wb.sheet(id).charts[0].type).toBe('bar');
  wb.undo();
  expect(wb.sheet(id).charts).toHaveLength(0);
});

it('focuses an edited chart\'s own type first, so the first arrow moves on from it', () => {
  const { radios } = setup('pie');
  const pie = radios.find((node) => node.dataset.type === 'pie');
  expect(document.activeElement).toBe(pie);
  expect(pie.getAttribute('aria-checked')).toBe('true');
  const event = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true });
  document.activeElement.dispatchEvent(event);
  const donut = radios.find((node) => node.dataset.type === 'donut');
  expect(document.activeElement).toBe(donut);
  expect(radios.filter((node) => node.getAttribute('aria-checked') === 'true')).toEqual([donut]);
});

it('starts on an existing chart type and leaves composing and unrelated keys alone', () => {
  const { wb, id, radios } = setup('line');
  const line = radios.find((node) => node.dataset.type === 'line');
  expect(radios.filter((node) => node.tabIndex === 0)).toEqual([line]);
  line.focus();
  for (const init of [{ key: 'ArrowRight', isComposing: true }, { key: 'Tab' }]) {
    const event = new KeyboardEvent('keydown', { ...init, bubbles: true, cancelable: true });
    line.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(line.getAttribute('aria-checked')).toBe('true');
  }
  const pie = radios.find((node) => node.dataset.type === 'pie');
  pie.focus();
  pie.click();
  expect(document.activeElement).toBe(pie);
  expect(radios.filter((node) => node.tabIndex === 0)).toEqual([pie]);
  document.querySelector('form').requestSubmit();
  expect(wb.sheet(id).charts[0].type).toBe('pie');
  wb.undo();
  expect(wb.sheet(id).charts[0].type).toBe('line');
});
