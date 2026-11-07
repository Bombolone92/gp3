// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from 'vitest';
import { workbookFromFile } from '../src/core/io.js';
import { chartData } from '../src/core/charts.js';
import { renderChartSvg } from '../src/ui/chartsvg.js';
import { createGrid } from '../src/ui/grid.js';
import { buildPrintSheet } from '../src/ui/print.js';
import { pieXlsx } from './helpers/xlsx-pie-fixture.js';

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 1600 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 1000 });
  HTMLCanvasElement.prototype.getContext = () => ({ measureText: t => ({ width: t.length * 7 }), font: '' });
  Element.prototype.scrollTo = () => {};
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
  globalThis.requestAnimationFrame = fn => setTimeout(fn, 0);
  globalThis.cancelAnimationFrame = clearTimeout;
});
afterEach(() => document.body.replaceChildren());

it('draws imported doughnuts transparently over the grid and in print, with live labels', async () => {
  const wb = await workbookFromFile(pieXlsx(), 'plan.xlsx'), sheet = wb.sheets[0];
  const grid = createGrid({ wb, sheetId: sheet.id, announce() {} });
  try {
    document.body.append(grid.el);
    await new Promise(resolve => setTimeout(resolve, 20));
    const svg = grid.el.querySelector('svg[aria-label="Spending plan"]');
    expect(svg).not.toBeNull();
    expect(svg.closest('.transparent.borderless')).not.toBeNull();
    expect(svg.querySelector('rect').getAttribute('fill')).toBe('none');
    expect(svg.querySelectorAll('.chart-data-label')).toHaveLength(4);
    expect(grid.el.querySelector('#gc-6-4').textContent).toBe('900');
    expect(grid.el.querySelector('#gc-6-4').style.fontFamily).toContain('Segoe UI');
    expect(svg.textContent).toContain('Savings$850');
    const printed = buildPrintSheet(wb, sheet.id), object = printed.querySelector('.print-object');
    expect(object.style.backgroundColor).toBe('transparent');
    expect(object.querySelector('svg').textContent).toContain('Savings$850');
    wb.setInput(sheet.id, 1, 1, '2500');
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(grid.el.querySelector('svg[aria-label="Spending plan"]').textContent).toContain('Savings$1,350');
  } finally { grid.destroy(); }
});

it('uses the imported angle and inner radius, and handles a single full ring or empty data', async () => {
  const wb = await workbookFromFile(pieXlsx(), 'plan.xlsx'), sheet = wb.sheets[0], chart = sheet.charts[0];
  const host = document.createElement('div');
  const render = values => {
    const data = chartData(wb, sheet.id, chart);
    if (values) data.series[0].values = values;
    host.innerHTML = renderChartSvg(data, chart, 600, 400);
    return [...host.querySelectorAll('path[fill-rule="evenodd"]')];
  };
  // Plot bounds are x=90, y=24, w=420, h=320: radius 160, hole 40,
  // center (300,184), rotated 45 degrees clockwise from the top.
  expect(render()[0].getAttribute('d')).toMatch(/^M 413\.14 70\.86 A 160 160/);
  expect(render()[0].getAttribute('d')).toContain('A 40 40');
  expect(render([0, 0, 0, 2000])).toHaveLength(1);
  expect(host.querySelector('.chart-data-label').textContent).toBe('Savings$2,000');
  expect(render([0, 0, 0, 0])).toHaveLength(0);
  expect(host.textContent).toContain('No nonzero numbers to chart');
  expect(host.innerHTML).not.toMatch(/NaN|Infinity/);
});
