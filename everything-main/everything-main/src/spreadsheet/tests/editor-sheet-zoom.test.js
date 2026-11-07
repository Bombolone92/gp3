// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile } from '../src/core/io.js';
import { otherProgramsXlsx } from './helpers/xlsx-fixture.js';
import { closeAllModals } from '../src/ui/modal.js';
import { closeMenu } from '../src/ui/menu.js';

let view, doc;
beforeEach(() => {
  vi.useFakeTimers(); localStorage.clear();
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('requestAnimationFrame', fn => setTimeout(fn, 0)); vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  Element.prototype.scrollIntoView = () => {}; Element.prototype.scrollTo = () => {};
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 400 });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ measureText: t => ({ width: t.length * 7 }), font: '' });
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(() => { closeMenu(); closeAllModals(); view?.destroy(); doc?.destroy(); view = doc = null; vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });
function mount(wb) {
  doc = new Doc({ wb, name: 'Views' });
  view = editorView({ doc, goHome() {}, openPath() {}, newDoc() {}, importFile() {} });
  document.querySelector('#app').append(view.el);
}
const label = () => document.querySelector('.zoom-label').textContent;
const refresh = () => vi.advanceTimersByTime(20);

it('restores each native view on sheet navigation and saves only user zoom changes', async () => {
  const wb = await workbookFromFile(otherProgramsXlsx({ sheetNames: ['Detail', 'Overview'], sheetXml: {
    Detail: { head: '<sheetViews><sheetView workbookViewId="0" zoomScale="175"/></sheetViews>' },
    Overview: { head: '<sheetViews><sheetView workbookViewId="0"/></sheetViews>' },
  } }), 'views.xlsx');
  localStorage.setItem('spreadsheet:zoom', '1.5'); mount(wb);
  expect(label()).toBe('175%'); expect(wb.dirty).toBe(false);
  wb.setActiveSheet(wb.sheets[1].id);
  refresh();
  expect(label()).toBe('100%'); expect(wb.dirty).toBe(false);
  document.querySelector('[aria-label="Zoom in"]').click();
  refresh();
  expect(label()).toBe('110%'); expect(wb.sheets[1].viewZoom).toBe(1.1);
  expect(wb.dirty).toBe(true); expect(doc.status).toBe('unsaved'); expect(wb.canUndo()).toBe(false);
  wb.setActiveSheet(wb.sheets[0].id); refresh(); expect(label()).toBe('175%');
  wb.setActiveSheet(wb.sheets[1].id); refresh(); expect(label()).toBe('110%');
});

it('renders the complete native zoom range without modifying stored sizes', () => {
  const wb = new Workbook({ sheets: [{ name: 'Small', viewZoom: .1 }, { name: 'Large', viewZoom: 4 }] }); mount(wb);
  expect(label()).toBe('10%'); expect(wb.dirty).toBe(false);
  wb.setActiveSheet(wb.sheets[1].id); refresh(); expect(label()).toBe('400%'); expect(wb.dirty).toBe(false);
  document.querySelector('[aria-label="Zoom in"]').click(); refresh(); expect(label()).toBe('400%');
  expect(wb.colWidth(wb.activeSheetId, 0)).toBe(100);
});

it('keeps device zoom for a new document without treating initialization as an edit', () => {
  localStorage.setItem('spreadsheet:zoom', '1.25'); const wb = new Workbook(); mount(wb);
  expect(label()).toBe('125%'); expect(wb.dirty).toBe(false); expect(doc.status).toBe('saved');
});

function customZoom() {
  document.querySelector('.zoom-label').click();
  [...document.querySelectorAll('.menu-item')].find(item => item.textContent.includes('Custom zoom')).click();
  return document.querySelector('[aria-label="Zoom percentage"]');
}

async function applyPercentage(input, value) {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.closest('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await vi.advanceTimersByTimeAsync(20);
}

it('applies an exact custom percentage and preserves it when stepping and switching sheets', async () => {
  const wb = new Workbook({ sheets: [{ name: 'Detail' }, { name: 'Summary' }] }); mount(wb);
  await applyPercentage(customZoom(), '133%');
  expect(label()).toBe('133%');
  expect(wb.sheets[0].viewZoom).toBe(1.33);
  expect(localStorage.getItem('spreadsheet:zoom')).toBe('1.33');
  expect(wb.colWidth(wb.activeSheetId, 0)).toBe(100);
  expect(wb.canUndo()).toBe(false);
  document.querySelector('[aria-label="Zoom in"]').click(); refresh();
  expect(label()).toBe('143%');
  document.querySelector('[aria-label="Zoom out"]').click(); refresh();
  expect(label()).toBe('133%');
  wb.setActiveSheet(wb.sheets[1].id); refresh();
  wb.setActiveSheet(wb.sheets[0].id); refresh();
  expect(label()).toBe('133%');
});

it('keeps invalid percentages in the dialog and leaves the view unchanged on cancel', async () => {
  const wb = new Workbook(); mount(wb);
  const input = customZoom();
  for (const invalid of ['', '9', '401', '133.5', '120abc']) {
    await applyPercentage(input, invalid);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(document.querySelector('.field-error').textContent).toContain('10% to 400%');
    expect(label()).toBe('100%');
    expect(wb.dirty).toBe(false);
  }
  document.querySelector('.modal-panel .btn-ghost').click();
  await vi.advanceTimersByTimeAsync(20);
  expect(label()).toBe('100%');
  expect(wb.dirty).toBe(false);
});

it.each([['10', 'Zoom out'], ['400', 'Zoom in']])('makes the %s%% limit clear while preserving keyboard focus', async (value, name) => {
  const wb = new Workbook(); mount(wb);
  await applyPercentage(customZoom(), value);
  const button = document.querySelector(`[aria-label="${name}"]`);
  expect(button.getAttribute('aria-disabled')).toBe('true');
  button.focus(); button.click(); refresh();
  expect(label()).toBe(`${value}%`);
  expect(document.activeElement).toBe(button);
});

it('allows custom zoom to leave chart fit mode', async () => {
  const wb = new Workbook({ sheets: [{ name: 'Plot', kind: 'chart', zoomToFit: true }] }); mount(wb);
  expect(label()).toBe('Fit');
  await applyPercentage(customZoom(), '83');
  expect(label()).toBe('83%');
  expect(wb.sheets[0]).toMatchObject({ viewZoom: .83, zoomToFit: false });
});
