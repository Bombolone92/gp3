// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryStorage } from './helpers/memory-storage.js';
import { openMenu, closeMenu, isMenuOpen } from '../src/ui/menu.js';
import { createToolbar } from '../src/ui/toolbar.js';
import { createSheetTabs } from '../src/ui/sheettabs.js';
import { Workbook } from '../src/core/workbook.js';

globalThis.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
beforeEach(() => { vi.stubGlobal('localStorage', memoryStorage()); Element.prototype.scrollIntoView = vi.fn(); });
afterEach(() => { closeMenu(); document.body.replaceChildren(); vi.unstubAllGlobals(); });

/** A click as the browser delivers it: the press first, which the open menu sees, then the click. */
function press(button) {
  button.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
  button.click();
}

// Every dropdown but the menu-bar titles reopened its menu on a second click: the press on the anchor
// was left to the anchor, whose click then built a new menu over the one it had just closed.
describe('a second click on a menu button', () => {
  it('closes the menu the first click opened and hands back a menu that never opened', () => {
    const button = document.createElement('button');
    button.setAttribute('aria-haspopup', 'menu');
    document.body.append(button);
    const items = [{ label: 'One' }, { label: 'Two' }];
    press(button);
    const first = openMenu({ anchor: button, items });
    expect(isMenuOpen()).toBe(true);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    press(button);
    const second = openMenu({ anchor: button, items });
    expect(isMenuOpen()).toBe(false);
    expect(document.querySelectorAll('.menu')).toHaveLength(0);
    expect(button.getAttribute('aria-expanded')).toBe('false');
    // What a caller does with the menu right after opening it finds nothing rather than fails.
    expect(second.menu.querySelector('button')).toBeNull();
    expect(second.owns(button)).toBe(false);
    second.focusFirst();
    second.close();
    expect(first.menu.isConnected).toBe(false);
    // A third click opens it again.
    press(button);
    openMenu({ anchor: button, items });
    expect(isMenuOpen()).toBe(true);
  });

  it('opens another button’s menu in place of the open one', () => {
    const a = document.createElement('button');
    const b = document.createElement('button');
    document.body.append(a, b);
    press(a);
    openMenu({ anchor: a, items: [{ label: 'A' }], label: 'A' });
    press(b);
    openMenu({ anchor: b, items: [{ label: 'B' }], label: 'B' });
    expect(document.querySelectorAll('.menu')).toHaveLength(1);
    expect(document.querySelector('.menu').getAttribute('aria-label')).toBe('B');
  });

  it('applies to the toolbar dropdowns, including the colour menus that focus a swatch on opening', () => {
    const wb = new Workbook();
    const toolbar = createToolbar({
      wb, run() {}, activeCell: () => null, style: () => ({}), active: () => ({ r: 0, c: 0 }),
      range: () => ({ r1: 0, c1: 0, r2: 0, c2: 0 }), sheetId: () => wb.activeSheetId,
      grid: { editing: false }, subscribe: () => () => {},
    });
    document.body.append(toolbar.el);
    for (const label of ['.tb-fmt', '.tb-font', '.tb-size', '[aria-label="Text color"]', '[aria-label="Fill color"]', '[aria-label="Borders"]', '[aria-label="Vertical align"]', '[aria-label="Sort and summarize"]', '[aria-label="Rows"]', '[aria-label="Columns"]', '[aria-label="Freeze panes"]']) {
      const button = toolbar.el.querySelector(label);
      press(button);
      expect(isMenuOpen(), `${label} opens`).toBe(true);
      press(button);
      expect(isMenuOpen(), `${label} closes on the second click`).toBe(false);
      expect(document.querySelectorAll('.menu'), label).toHaveLength(0);
      expect(button.getAttribute('aria-expanded'), label).toBe('false');
    }
  });

  it('applies to the sheet options and All sheets buttons', () => {
    const wb = new Workbook({ sheets: [{ name: 'First' }, { name: 'Second' }] });
    const tabs = createSheetTabs({ wb });
    document.body.append(tabs.el);
    for (const selector of ['.tab-menu-btn', '.tab-all']) {
      const button = tabs.el.querySelector(selector);
      press(button);
      expect(isMenuOpen(), selector).toBe(true);
      press(button);
      expect(isMenuOpen(), selector).toBe(false);
    }
    tabs.destroy();
  });
});
