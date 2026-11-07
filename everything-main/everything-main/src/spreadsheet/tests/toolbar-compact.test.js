// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createToolbar } from '../src/ui/toolbar.js';
import { Workbook } from '../src/core/workbook.js';

let toolbar, resized;
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback) { resized = callback; }
    observe() {}
    disconnect() {}
  });
});
afterEach(() => { toolbar?.destroy(); vi.unstubAllGlobals(); document.body.replaceChildren(); });
const visible = () => [...toolbar.el.querySelectorAll('.tb-btn')].filter(b => !b.closest('[hidden]'));
const available = () => visible().filter(b => !b.disabled);
const key = (target, name) => target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));

function setup(gridOverrides = {}) {
  const wb = new Workbook();
  toolbar = createToolbar({
    wb, run: vi.fn(), activeCell: () => null, style: () => ({}), active: () => ({ r: 0, c: 0 }),
    range: () => ({ r1: 0, c1: 0, r2: 0, c2: 0 }), sheetId: () => wb.activeSheetId,
    grid: { editing: false, ...gridOverrides }, subscribe: () => () => {},
  });
  document.body.append(toolbar.el);
  let width = 390;
  Object.defineProperty(toolbar.el, 'clientWidth', { get: () => width });
  resized();
  return { wb, resize: next => { width = next; resized(); } };
}

it('shows essentials in a narrow toolbar and keeps all commands available through expansion', () => {
  setup();
  const collapsed = visible();
  expect(collapsed).toHaveLength(7);
  expect(collapsed.map(b => b.getAttribute('aria-label'))).toEqual([
    'Undo', 'Redo', 'Number format: General', 'Bold', 'Italic', 'Fill color', 'Show all formatting tools',
  ]);
  const toggle = toolbar.el.querySelector('.tb-expand');
  toggle.focus(); toggle.click();
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  expect(document.activeElement).toBe(toggle);
  expect(visible()).toHaveLength(39);
  toolbar.refresh();
  expect(document.activeElement).toBe(toggle);
  toggle.click();
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  expect(visible()).toEqual(collapsed);
});

it('keeps one tab stop and skips collapsed controls when navigating with arrows', () => {
  setup();
  const controls = available();
  expect(controls.filter(b => b.tabIndex === 0)).toHaveLength(1);
  controls[0].focus();
  for (let i = 0; i < controls.length; i++) {
    key(document.activeElement, 'ArrowRight');
    expect(document.activeElement).toBe(controls[(i + 1) % controls.length]);
  }
  key(document.activeElement, 'End');
  expect(document.activeElement).toBe(controls.at(-1));
});

it('keeps the collapse control outside the controlled content and resets scrolling when collapsed', () => {
  setup();
  const tools = toolbar.el.querySelector('.toolbar-tools');
  const toggle = toolbar.el.querySelector('.tb-expand');
  const content = toolbar.el.querySelector('.toolbar-tool-content');
  expect(toggle.getAttribute('aria-controls')).toBe(content.id);
  expect(content.contains(toggle)).toBe(false);
  expect(tools.contains(toggle)).toBe(true);
  toggle.focus(); toggle.click();
  tools.scrollTop = 100;
  toolbar.refresh();
  expect(tools.scrollTop).toBe(100);
  expect(document.activeElement).toBe(toggle);
  toggle.click();
  expect(tools.scrollTop).toBe(0);
  expect(available().filter(b => b.tabIndex === 0)).toHaveLength(1);
});

it('preserves a visible active cell without jumping to one the user scrolled away from', () => {
  const scrollToActive = vi.fn();
  let top = 170;
  setup({
    viewport: { getBoundingClientRect: () => ({ left: 0, right: 300, top: 100, bottom: 200 }) },
    cellRect: () => ({ left: 0, right: 100, top, bottom: top + 26 }), scrollToActive,
  });
  toolbar.el.querySelector('.tb-expand').click();
  expect(scrollToActive).toHaveBeenCalledTimes(1);
  top = 250;
  toolbar.el.querySelector('.tb-expand').click();
  expect(scrollToActive).toHaveBeenCalledTimes(1);
});

it('restores all tools when widened and repairs focus when the focused control is hidden', () => {
  const { resize } = setup();
  toolbar.el.querySelector('.tb-expand').focus();
  resize(1000);
  expect(toolbar.el.querySelector('.tb-expand')).toBeNull();
  expect(visible()).toHaveLength(38);
  expect(available()).toContain(document.activeElement);
  toolbar.el.querySelector('.tb-font').focus();
  resize(390);
  expect(toolbar.el.querySelector('.tb-font').hidden).toBe(true);
  expect(available()).toContain(document.activeElement);
  expect(available().filter(b => b.tabIndex === 0)).toHaveLength(1);
});

it('keeps chart-sheet tools accessible and restores the narrow worksheet toolbar on return', () => {
  const { wb } = setup();
  const sheet = wb.activeSheetId;
  const [chart] = wb.importSheets(new Workbook({ sheets: [{ name: 'Plot', kind: 'chart' }] }));
  wb.setActiveSheet(chart.id); toolbar.refresh();
  expect(visible().map(b => b.dataset.cmd)).toEqual(['undo', 'redo', 'editChart', 'copy', 'zoomFit']);
  wb.setActiveSheet(sheet); toolbar.refresh();
  expect(visible()).toHaveLength(7);
  expect(available().filter(b => b.tabIndex === 0)).toHaveLength(1);
});

it('restores an expanded worksheet after visiting a chart sheet without constraining chart tools', () => {
  const { wb } = setup();
  const sheet = wb.activeSheetId;
  toolbar.el.querySelector('.tb-expand').click();
  const [chart] = wb.importSheets(new Workbook({ sheets: [{ name: 'Plot', kind: 'chart' }] }));
  wb.setActiveSheet(chart.id); toolbar.refresh();
  expect(toolbar.el.classList.contains('toolbar-expanded')).toBe(false);
  expect(visible()).toHaveLength(5);
  wb.setActiveSheet(sheet); toolbar.refresh();
  expect(toolbar.el.classList.contains('toolbar-expanded')).toBe(true);
  expect(visible()).toHaveLength(39);
});
