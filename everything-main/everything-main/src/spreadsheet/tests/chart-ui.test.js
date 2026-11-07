// @vitest-environment jsdom
import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { closeAllModals } from '../src/ui/modal.js';
import { closeMenu } from '../src/ui/menu.js';
import { chartData } from '../src/core/charts.js';

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

const flush = async (n = 3) => { for (let i = 0; i < n; i++) await vi.advanceTimersByTimeAsync(1); };
const key = (node, k, extra = {}) => node.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...extra }));
const viewport = () => view.el.querySelector('.grid-viewport');
const tab = name => [...view.el.querySelectorAll('.ribbon [role="tab"]')].find(n => n.textContent === name);
const button = label => [...view.el.querySelectorAll(`button[aria-label="${label}"]`)].find(b => !b.closest('[hidden]'));
const menuItem = label => [...document.querySelectorAll('.menu [role^="menuitem"]')].find(b => b.querySelector('.menu-label')?.firstChild?.textContent === label);
const dialog = title => document.querySelector(`[role="dialog"][aria-label="${title}"]`);

async function mount() {
  const doc = new Doc({ name: 'Charts' }); const wb = doc.wb; const id = wb.activeSheetId;
  [['Month', 'North', 'South'], ['Jan', '12', '9'], ['Feb', '15', '11'], ['Mar', '9', '14']].forEach((row, r) => row.forEach((v, c) => wb.setInput(id, r, c, v)));
  view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
  document.body.append(view.el); await flush();
  const name = view.el.querySelector('.name-box'); name.value = 'A1:C4'; key(name, 'Enter'); await flush();
  return { wb, id, chart: () => wb.sheet(id).charts[0] };
}
async function quickChart() {
  viewport().focus();
  key(viewport(), 'F1', { altKey: true }); await flush();
}
const svgNode = sel => view.el.querySelector(`.chart-box .chart-body svg ${sel}`);
async function press(node) {
  node.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, clientX: 1, clientY: 1 }));
  node.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, button: 0, clientX: 1, clientY: 1 }));
  await flush();
}
const elementBox = () => view.el.querySelector('select[aria-label="Chart Elements"]');

it('inserts the default chart with Alt+F1 and shows Chart Design and Format while it is selected', async () => {
  const { wb, chart } = await mount();
  expect(tab('Chart Design').hidden).toBe(true);
  await quickChart();
  expect(chart()).toMatchObject({ type: 'column', title: 'Chart title', w: 480, h: 288, anchor: { r: 0, c: 3 }, appearance: { gapWidth: 219, overlap: -27 } });
  expect(wb.undoLabel()).toBe('Insert chart');
  expect(tab('Chart Design').hidden).toBe(false);
  expect(tab('Format').hidden).toBe(false);
  expect(tab('Chart Design').getAttribute('aria-selected')).toBe('true');
  key(viewport(), 'Escape'); await flush();
  expect(tab('Chart Design').hidden).toBe(true);
  expect(tab('Home').getAttribute('aria-selected')).toBe('true');
});

it('charts the selection on a chart sheet of its own with F11, undoably', async () => {
  const { wb, id } = await mount();
  viewport().focus();
  key(viewport(), 'F11'); await flush();
  const sheet = wb.sheet(wb.activeSheetId);
  expect(sheet.kind).toBe('chart');
  expect(sheet.name).toBe('Chart1');
  expect(wb.sheets.indexOf(sheet)).toBe(0);
  expect(chartData(wb, sheet.id, sheet.charts[0]).series.map(s => s.values)).toEqual([[12, 15, 9], [9, 11, 14]]);
  wb.undo();
  expect(wb.sheets.map(s => s.id)).toEqual([id]);
});

it('adds chart elements, changes colours and picks a quick layout from Chart Design', async () => {
  const { chart } = await mount();
  await quickChart();
  button('Add Chart Element').click(); await flush();
  menuItem('Legend').click(); await flush();
  menuItem('Right').click(); await flush();
  expect(chart()).toMatchObject({ legend: true, legendPos: 'right' });
  button('Change Colors').click(); await flush();
  document.querySelector('.chart-palette-row[aria-label="Monochromatic Palette 1"]').click(); await flush();
  expect(chart().colors).toHaveLength(2);
  button('Quick Layout').click(); await flush();
  document.querySelector('.chart-gallery-tile[aria-label="Layout 2"]').click(); await flush();
  expect(chart()).toMatchObject({ labels: true, legendPos: 'top', appearance: { hideYAxis: true } });
  button('Switch Row/Column').click(); await flush();
  expect(chart().seriesIn).toBe('rows');
});

it('selects chart elements with a click, edits the title by typing and deletes the legend', async () => {
  const { chart } = await mount();
  await quickChart();
  await press(svgNode('[data-el="title"]'));
  expect(elementBox().value).toBe('title');
  key(viewport(), 'S'); await flush();
  const input = view.el.querySelector('.chart-title-editor');
  expect(input.value).toBe('S');
  input.value = 'Sales by region'; key(input, 'Enter'); await flush();
  expect(chart().title).toBe('Sales by region');
  await press(svgNode('[data-el="legend"] text'));
  expect(elementBox().value).toBe('legend');
  key(viewport(), 'Delete'); await flush();
  expect(chart().legend).toBe(false);
  expect(view.el.querySelectorAll('.chart-box')).toHaveLength(1);
  await press(svgNode('[data-el="series"][data-series="1"]'));
  expect(elementBox().value).toBe('series:1');
  await press(svgNode('[data-el="series"][data-series="1"][data-point="2"]'));
  expect(elementBox().value).toBe('point:1:2');
});

it('opens the Format pane on a double-click and formats the selected series from the Format tab', async () => {
  const { chart } = await mount();
  await quickChart();
  const series = svgNode('[data-el="series"][data-series="0"]');
  series.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true })); await flush();
  const pane = view.el.querySelector('.chart-format-pane');
  expect(pane.hidden).toBe(false);
  expect(pane.querySelector('.chart-pane-title').textContent).toBe('Format Data Series');
  expect(document.querySelector('[role="dialog"]')).toBeNull(); // not the old chart dialog
  const gap = pane.querySelector('input[aria-label="Gap Width (%)"]');
  gap.value = '50'; gap.dispatchEvent(new Event('change')); await flush();
  expect(chart().appearance.gapWidth).toBe(50);
  tab('Format').click(); await flush();
  button('Shape Fill').click(); await flush();
  document.querySelector('.menu .swatch[aria-label="#ff0000"]').click(); await flush();
  expect(chart().colors[0]).toBe('#ff0000');
  const height = view.el.querySelector('input[aria-label="Shape Height"]');
  height.value = '4'; height.dispatchEvent(new Event('change')); await flush();
  expect(chart().h).toBe(384);
});

it('edits series in Select Data, changes the chart type and moves the chart to a new sheet', async () => {
  const { wb, id, chart } = await mount();
  await quickChart();
  button('Select Data').click(); await flush();
  let box = dialog('Select Data Source');
  expect([...box.querySelectorAll('[role="option"]')].map(n => n.textContent)).toEqual(['North', 'South']);
  box.querySelector('button[aria-label="Remove"]').click(); await flush();
  box.querySelector('button[type="submit"]').click(); await flush();
  expect(chartData(wb, id, chart()).series.map(s => s.name)).toEqual(['South']);
  button('Change Chart Type').click(); await flush();
  box = dialog('Change Chart Type');
  [...box.querySelectorAll('.chart-type-item')].find(n => n.textContent === 'Line').click(); await flush();
  box.querySelector('button[aria-label="Line with Markers"]').click(); await flush();
  box.querySelector('button[type="submit"]').click(); await flush();
  expect(chart()).toMatchObject({ type: 'line', title: 'Chart title' });
  button('Move Chart').click(); await flush();
  box = dialog('Move Chart');
  box.querySelector('input[value="sheet"]').click();
  box.querySelector('button[type="submit"]').click(); await flush();
  const chartSheet = wb.sheets.find(s => s.kind === 'chart');
  expect(chartSheet?.name).toBe('Chart1');
  expect(wb.sheet(id).charts).toHaveLength(0);
  expect(chartData(wb, chartSheet.id, chartSheet.charts[0]).series[0].values).toEqual([9, 11, 14]);
  wb.undo();
  expect(wb.sheets.some(s => s.kind === 'chart')).toBe(false);
  expect(wb.sheet(id).charts).toHaveLength(1);
});

it('inserts the recommended chart picked in the Insert Chart dialog', async () => {
  const { chart } = await mount();
  tab('Insert').click(); await flush();
  button('Recommended Charts').click(); await flush(6);
  const box = dialog('Insert Chart');
  expect(box.querySelector('[role="tab"][aria-selected="true"]').textContent).toBe('Recommended Charts');
  [...box.querySelectorAll('.chart-type-item')].find(n => n.textContent === 'Clustered Bar').click(); await flush();
  box.querySelector('button[type="submit"]').click(); await flush();
  expect(chart()).toMatchObject({ type: 'bar', stacked: false });
});
