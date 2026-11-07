// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { createToolbar } from '../src/ui/toolbar.js';
import { Workbook } from '../src/core/workbook.js';

const key = (target, key) => target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
afterEach(() => document.body.replaceChildren());
function setup() {
  const wb = new Workbook();
  const toolbar = createToolbar({
    wb, run() {}, activeCell: () => null, style: () => ({}), active: () => ({ r: 0, c: 0 }),
    range: () => ({ r1: 0, c1: 0, r2: 0, c2: 0 }), sheetId: () => wb.activeSheetId,
    grid: { editing: false }, subscribe: () => () => {},
  });
  document.body.append(toolbar.el);
  return { wb, toolbar, buttons: [...toolbar.el.querySelectorAll('.tb-btn')] };
}

describe('toolbar keyboard navigation', () => {
  it('has an enabled Tab entry point even when Undo and Redo are disabled', () => {
    const { buttons } = setup();
    const stops = buttons.filter((b) => b.tabIndex === 0);
    expect(stops).toHaveLength(1);
    expect(stops[0].disabled).toBe(false);
  });

  it('skips disabled controls for arrows, Home, and End', () => {
    const { buttons } = setup();
    const available = buttons.filter((b) => !b.disabled);
    for (let i = 0; i < available.length; i++) {
      available[i].focus();
      key(available[i], 'ArrowRight');
      expect(document.activeElement).toBe(available[(i + 1) % available.length]);
      key(document.activeElement, 'ArrowLeft');
      expect(document.activeElement).toBe(available[i]);
    }
    key(document.activeElement, 'Home');
    expect(document.activeElement).toBe(available[0]);
    key(document.activeElement, 'End');
    expect(document.activeElement).toBe(available.at(-1));
  });

  it('repairs the Tab entry point when its control becomes disabled', () => {
    const { wb, toolbar, buttons } = setup();
    wb.setInput(wb.activeSheetId, 0, 0, 'x');
    toolbar.refresh();
    buttons[0].focus();
    key(buttons[0], 'Home');
    wb.undo();
    toolbar.refresh();
    const stops = buttons.filter((b) => b.tabIndex === 0);
    expect(stops).toHaveLength(1);
    expect(stops[0].disabled).toBe(false);
    expect(document.activeElement).toBe(stops[0]);
  });
});

it('offers chart actions with a valid tab stop and restores cell controls on return', () => {
  const { wb, toolbar } = setup();
  const worksheet = wb.activeSheetId;
  const [chart] = wb.importSheets(new Workbook({ sheets: [{ name: 'Plot', kind: 'chart' }] }));
  wb.setActiveSheet(chart.id); toolbar.refresh();
  const visible = () => [...toolbar.el.querySelectorAll('.tb-btn')].filter(b => !b.closest('[hidden]'));
  expect(visible().map(b => b.dataset.cmd)).toEqual(['undo', 'redo', 'editChart', 'copy', 'zoomFit']);
  const stop = visible().find(b => b.tabIndex === 0);
  expect(stop).toBeDefined(); expect(stop.disabled).toBe(false);
  stop.focus(); key(stop, 'End'); expect(document.activeElement.dataset.cmd).toBe('zoomFit');
  wb.setActiveSheet(worksheet); toolbar.refresh();
  expect(toolbar.el.querySelector('[data-cmd="zoomFit"]')).toBeNull();
  expect(visible().some(b => b.dataset.cmd === 'bold')).toBe(true);
  expect(visible().filter(b => b.tabIndex === 0)).toHaveLength(1);
  toolbar.destroy();
});
