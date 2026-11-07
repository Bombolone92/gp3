// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createToolbar } from '../src/ui/toolbar.js';
import { closeMenu } from '../src/ui/menu.js';
import { Workbook } from '../src/core/workbook.js';

// A long press on Undo or Redo on Android opened the history from the toolbar's own press timer and
// again from the browser's contextmenu event for the same press; the second opening on the same button
// is a toggle, so the list flashed and vanished. Only one of the two opens it, whichever comes first.
beforeEach(() => { vi.useFakeTimers(); globalThis.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} }); });
afterEach(() => { closeMenu(); vi.useRealTimers(); document.body.replaceChildren(); });

const menus = () => document.querySelectorAll('.menu').length;
const touch = (t, type) => t.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, button: 0, pointerType: 'touch' }));
const contextmenu = (t) => t.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));

function setup() {
  const wb = new Workbook();
  wb.setInput(wb.activeSheetId, 0, 0, 'x');
  const toolbar = createToolbar({
    wb, run() {}, activeCell: () => null, style: () => ({}), active: () => ({ r: 0, c: 0 }),
    range: () => ({ r1: 0, c1: 0, r2: 0, c2: 0 }), sheetId: () => wb.activeSheetId, grid: { editing: false, focus() {} }, subscribe: () => () => {},
  });
  document.body.append(toolbar.el);
  return toolbar.el.querySelector('[aria-label="Undo"]');
}

describe('a long press on the Undo button', () => {
  it('opens the history once when the browser reports its own contextmenu after the press timer', () => {
    const undo = setup();
    touch(undo, 'pointerdown');
    vi.advanceTimersByTime(500);
    expect(menus()).toBe(1);
    contextmenu(undo);
    touch(undo, 'pointerup');
    expect(menus()).toBe(1);
    // A later right-click is a new request: with the history open it closes the list, as a second press does.
    vi.advanceTimersByTime(2000);
    contextmenu(undo);
    expect(menus()).toBe(0);
    contextmenu(undo);
    expect(menus()).toBe(1);
  });

  it('opens the history once when the browser reports contextmenu before the press timer', () => {
    const undo = setup();
    touch(undo, 'pointerdown');
    vi.advanceTimersByTime(300);
    contextmenu(undo);
    expect(menus()).toBe(1);
    vi.advanceTimersByTime(500);
    touch(undo, 'pointerup');
    expect(menus()).toBe(1);
  });

  it('still opens the history on a plain right-click, and not on a short tap', () => {
    const undo = setup();
    contextmenu(undo);
    expect(menus()).toBe(1);
    closeMenu();
    touch(undo, 'pointerdown');
    vi.advanceTimersByTime(200);
    touch(undo, 'pointerup');
    vi.advanceTimersByTime(1000);
    expect(menus()).toBe(0);
  });
});
