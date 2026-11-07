// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { createSheetTabs } from '../src/ui/sheettabs.js';
import { closeMenu } from '../src/ui/menu.js';
import { stylesheet, declared } from './helpers/css.js';

let tabs;
beforeEach(() => { Element.prototype.scrollIntoView = vi.fn(); });
afterEach(() => { closeMenu(); tabs?.destroy(); document.body.replaceChildren(); });

function setup() {
  const wb = new Workbook({ sheets: [{ name: 'First' }, { name: 'Second' }, { name: 'Third' }] });
  tabs = createSheetTabs({ wb });
  document.body.append(tabs.el);
  return wb;
}

// A tablist may own nothing but tabs, yet the active sheet's options button sat inside it (axe:
// aria-required-children). The button now lives beside the tablist, right after it in reading
// order, and is laid over the end of the active tab's chip so it looks where it always did.
describe('the sheet tablist and the options button', () => {
  it('holds only tabs, with the options button next in reading order', () => {
    const wb = setup();
    const tablist = tabs.el.querySelector('[role="tablist"]');
    expect(tablist.getAttribute('aria-label')).toBe('Sheets');
    for (const node of tablist.querySelectorAll('[role], button, [tabindex]')) {
      expect(node.getAttribute('role'), `${node.tagName}.${node.className}`).toBe('tab');
    }
    expect(tablist.querySelectorAll('[role="tab"]')).toHaveLength(3);
    const button = tabs.el.querySelector('.tab-menu-btn');
    expect(tablist.contains(button)).toBe(false);
    expect(tablist.nextElementSibling).toBe(button);
    expect(button.getAttribute('aria-label')).toBe('First options');
    expect(button.getAttribute('aria-haspopup')).toBe('menu');
    // It acts on the active sheet and follows a switch.
    wb.setActiveSheet(wb.sheets[2].id);
    const same = tabs.el.querySelector('.tab-menu-btn');
    expect(same).toBe(button);
    expect(button.getAttribute('aria-label')).toBe('Third options');
    button.click();
    expect(document.querySelector('[role="menu"]').getAttribute('aria-label')).toBe('Third options');
  });

  it('keeps the active tab’s chip with room for the button laid over its end', () => {
    const wb = setup();
    wb.setSheetColor(wb.sheets[0].id, '#ff0000');
    const chip = tabs.el.querySelector('.tab-item.active');
    expect(chip.querySelector('[role="tab"]').textContent).toBe('First');
    expect(chip.querySelector('.tab-menu-btn')).toBeNull();
    expect(chip.classList.contains('colored')).toBe(true);
    expect(chip.style.getPropertyValue('--tab-color')).toBe('#ff0000');
    const css = stylesheet('editor.css');
    const px = (v) => parseFloat(v);
    const buttonWidth = px(declared(css, '.tab-menu-btn').width);
    expect(px(declared(css, '.tab-item.active')['padding-right'])).toBeGreaterThanOrEqual(buttonWidth + 4);
    expect(declared(css, '.tab-list').position).toBe('relative');
    expect(declared(css, '.tab-list > .tab-menu-btn').position).toBe('absolute');
    expect(buttonWidth).toBeGreaterThanOrEqual(24);
  });

  it('keeps keyboard focus on the strip across a rebuild while the button itself persists', () => {
    const wb = setup();
    const button = tabs.el.querySelector('.tab-menu-btn');
    button.focus();
    wb.renameSheet(wb.sheets[0].id, 'Renamed');
    expect(document.activeElement).toBe(button);
    expect(button.getAttribute('aria-label')).toBe('Renamed options');
    const [first, second] = tabs.el.querySelectorAll('[role="tab"]');
    first.focus();
    second.click();
    expect(document.activeElement.getAttribute('role')).toBe('tab');
    expect(document.activeElement.textContent).toBe('Second');
  });
});
