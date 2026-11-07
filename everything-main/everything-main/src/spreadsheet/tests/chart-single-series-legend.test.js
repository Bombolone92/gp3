// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { chartData, normalizeChart } from '../src/core/charts.js';
import { renderChartSvg } from '../src/ui/chartsvg.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { openChartDialog } from '../src/ui/chartdialog.js';
import { closeAllModals } from '../src/ui/modal.js';
import * as X from '../src/vendor/xlsx.mjs';
const data = { categories: ['A', 'B'], x: [1, 2], sizes: [4, 8], series: [{ name: 'Revenue', values: [3, 7], x: [1, 2], sizes: [4, 8] }] };
const chart = (type = 'column', legendPos = 'bottom') => normalizeChart({ type, legendPos, anchor: { r: 0, c: 0 }, range: { r1: 0, c1: 0, r2: 1, c2: 1 } });
function texts(svg) {
  const host = document.createElement('div'); host.innerHTML = svg;
  return [...host.querySelectorAll('text')];
}
const revenue = svg => texts(svg).find(n => n.textContent === 'Revenue');
afterEach(() => { closeAllModals(); vi.unstubAllGlobals(); document.body.replaceChildren(); });
it.each(['column', 'bar', 'line', 'area', 'scatter', 'bubble', 'radar'])('honors enabled and disabled legends for a single %s series', type => {
  const ch = chart(type);
  expect(revenue(renderChartSvg(data, ch, 480, 300))).toBeTruthy();
  expect(revenue(renderChartSvg(data, { ...ch, legend: false }, 480, 300))).toBeUndefined();
});
it.each(['bottom', 'top', 'right'])('places a single-series legend at the selected %s position', position => {
  const node = revenue(renderChartSvg(data, chart('column', position), 480, 300));
  expect(node).toBeTruthy();
  if (position === 'bottom') expect(Number(node.getAttribute('y'))).toBeGreaterThan(250);
  if (position === 'top') expect(Number(node.getAttribute('y'))).toBeLessThan(60);
  if (position === 'right') expect(Number(node.getAttribute('x'))).toBeGreaterThan(350);
});
it('does not fabricate legend entries when there are no series or no chartable numbers', () => {
  expect(revenue(renderChartSvg({ ...data, series: [] }, chart(), 480, 300))).toBeUndefined();
  expect(revenue(renderChartSvg({ ...data, series: [{ name: 'Revenue', values: [null, null] }] }, chart(), 480, 300))).toBeUndefined();
});
it.each([true, false])('preserves single-series legend visibility through sheet copy and native export, enabled=%s', async enabled => {
  const ch = { ...chart(), legend: enabled, sourceRefs: [{ name: 'Revenue', literal: { categories: ['A', 'B'], values: [3, 7] } }] };
  let wb = new Workbook({ sheets: [{ name: 'Report', charts: [ch] }] });
  wb = wb.sheetToWorkbook(wb.activeSheetId, { sourceWorkbook: '/Original.xlsx' });
  for (let cycle = 0; cycle < 2; cycle++) {
    const current = wb.activeSheet.charts[0];
    expect(!!revenue(renderChartSvg(chartData(wb, wb.activeSheetId, current), current, 480, 300))).toBe(enabled);
    const blob = await workbookToXlsx(wb);
    const bytes = await new Promise((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error); reader.readAsArrayBuffer(blob);
    });
    const zip = X.CFB.read(new Uint8Array(bytes), { type: 'array' });
    const part = X.CFB.find(zip, '/xl/workbook.xml');
    X.CFB.utils.cfb_add(zip, '/xl/workbook.xml', new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, '')));
    const xml = new TextDecoder().decode(X.CFB.find(zip, '/xl/charts/chart1_1.xml').content);
    expect(xml.includes('<c:legend>')).toBe(enabled);
    wb = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }));
  }
  const current = wb.activeSheet.charts[0];
  expect(!!revenue(renderChartSvg(chartData(wb, wb.activeSheetId, current), current, 480, 300))).toBe(enabled);
});
it('updates the single-series dialog preview for every legend choice and saves the choice', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true })); document.body.innerHTML = '<div id="app"></div>';
  const wb = new Workbook(), id = wb.activeSheetId;
  [['Month', 'Revenue'], ['Jan', '3'], ['Feb', '7']].forEach((row, r) => row.forEach((v, c) => wb.setInput(id, r, c, v)));
  openChartDialog({ wb, sheetId: () => id, range: () => ({ r1: 0, c1: 0, r2: 2, c2: 1 }), grid: { focus: vi.fn(), selectChart: vi.fn() } });
  const select = document.querySelector('[aria-label="Legend"]');
  for (const value of ['none', 'bottom', 'right', 'top']) {
    select.value = value; select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(!!revenue(document.querySelector('.chart-preview').innerHTML)).toBe(value !== 'none');
  }
  document.querySelector('form').requestSubmit();
  expect(wb.activeSheet.charts[0]).toMatchObject({ legend: true, legendPos: 'top' });
});
