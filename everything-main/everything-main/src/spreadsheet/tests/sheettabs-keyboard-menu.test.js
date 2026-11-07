// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { createSheetTabs } from '../src/ui/sheettabs.js';
import { closeMenu } from '../src/ui/menu.js';
import { closeAllModals } from '../src/ui/modal.js';

globalThis.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} });

let tabs;
beforeEach(() => {
  vi.useFakeTimers();
  Element.prototype.scrollIntoView = vi.fn();
  // A viewport wide enough for the menu's clamping to leave it where it was placed.
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
});
afterEach(() => { closeMenu(); closeAllModals(); tabs?.destroy(); vi.useRealTimers(); delete HTMLElement.prototype.clientWidth; document.body.replaceChildren(); });

const TAB_RECT = { left: 100, top: 500, right: 180, bottom: 530, width: 80, height: 30, x: 100, y: 500 };
function setup() {
  const wb = new Workbook({ sheets: [{ name: 'First' }, { name: 'Second' }, { name: 'Third' }] });
  tabs = createSheetTabs({ wb });
  document.body.append(tabs.el);
  for (const tab of tabs.el.querySelectorAll('[role="tab"]')) tab.getBoundingClientRect = () => TAB_RECT;
  return wb;
}
const key = (target, k, init = {}) => { const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }); target.dispatchEvent(e); return e; };
const contextmenu = (target, init = {}) => { const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, ...init }); target.dispatchEvent(e); return e; };
const menu = () => document.querySelector('.menu');
const menus = () => document.querySelectorAll('.menu').length;
const activeTab = () => tabs.el.querySelector('.tab.active');

// A focused tab answered fewer keys than the grid and the tab-list pattern: Shift+F10 and the Menu key,
// which open the cell menu in the grid, opened nothing here, and Home and End did nothing; a contextmenu
// event a browser synthesises for the key, with no pointer position, put the menu in the window's corner.
describe('the menu key on a sheet tab', () => {
  it.each([['Shift+F10', 'F10', { shiftKey: true }], ['the Menu key', 'ContextMenu', {}]])('opens the tab\'s menu at the tab on %s', (_, k, init) => {
    setup();
    const tab = activeTab();
    tab.focus();
    expect(key(tab, k, init).defaultPrevented).toBe(true);
    expect(menus()).toBe(1);
    expect(menu().getAttribute('aria-label')).toBe('First options');
    expect(menu().style.left).toBe('100px'); // under the tab, not at the pointer or the corner
    expect(menu().style.top).toBe(`${TAB_RECT.bottom + 4}px`);
    key(document.activeElement, 'Escape');
    expect(menus()).toBe(0);
    expect(document.activeElement).toBe(tab);
  });

  it('opens it once when the browser also reports a contextmenu event for the key', () => {
    setup();
    const tab = activeTab();
    tab.focus();
    key(tab, 'F10', { shiftKey: true });
    expect(menus()).toBe(1);
    expect(contextmenu(tab, { clientX: 0, clientY: 0 }).defaultPrevented).toBe(true);
    expect(menus()).toBe(1); // a second opening on the same anchor would have closed the first
    vi.advanceTimersByTime(1000);
    contextmenu(tab, { button: 2, clientX: 300, clientY: 600 }); // a later right-click is a new request
    expect(menus()).toBe(1);
    expect(menu().style.left).toBe('300px');
  });

  it('leaves a plain F10 alone', () => {
    setup();
    const tab = activeTab();
    tab.focus();
    expect(key(tab, 'F10').defaultPrevented).toBe(false);
    expect(menus()).toBe(0);
  });
});

describe('a contextmenu event on a tab', () => {
  it('anchors the menu to the tab when it carries no pointer position', () => {
    setup();
    contextmenu(tabs.el.querySelectorAll('[role="tab"]')[1], { clientX: 0, clientY: 0 });
    expect(menu().getAttribute('aria-label')).toBe('Second options');
    expect(menu().style.left).toBe('100px');
  });

  it('still opens at the pointer on a right-click', () => {
    setup();
    contextmenu(activeTab(), { button: 2, clientX: 250, clientY: 560 });
    expect(menu().style.left).toBe('250px');
    expect(menu().style.top).toBe('560px');
  });
});

describe('Home and End on a sheet tab', () => {
  it('move to the first and last tab, switching sheets and keeping focus on the strip', () => {
    const wb = setup();
    activeTab().focus();
    expect(key(activeTab(), 'End').defaultPrevented).toBe(true);
    expect(wb.activeSheet.name).toBe('Third');
    expect(document.activeElement).toBe(activeTab());
    expect(key(activeTab(), 'Home').defaultPrevented).toBe(true);
    expect(wb.activeSheet.name).toBe('First');
    expect(document.activeElement).toBe(activeTab());
  });

  it('skip hidden sheets and do nothing at the end already reached', () => {
    const wb = setup();
    wb.setSheetHidden(wb.sheets[2].id, true);
    activeTab().focus();
    key(activeTab(), 'End');
    expect(wb.activeSheet.name).toBe('Second');
    expect(key(activeTab(), 'End').defaultPrevented).toBe(false);
    expect(wb.activeSheet.name).toBe('Second');
  });
});
