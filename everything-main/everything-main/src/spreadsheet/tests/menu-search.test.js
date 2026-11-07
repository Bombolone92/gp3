// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { openMenu, closeMenu, isMenuOpen } from '../src/ui/menu.js';
import { createSheetTabs } from '../src/ui/sheettabs.js';
import { Workbook } from '../src/core/workbook.js';

let tabs;
afterEach(() => { closeMenu(); tabs?.destroy(); tabs = null; document.body.replaceChildren(); });
const key = (name, extra = {}) => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...extra }));
const matches = () => [...document.querySelectorAll('.menu-item')].filter(node => !node.hidden);
function setup() {
  const anchor = document.createElement('button'); document.body.append(anchor); anchor.focus();
  const picked = vi.fn();
  const menu = openMenu({ anchor, search: 'Search sheets', items: [
    { label: 'North budget', checked: false, radio: true, onSelect: () => picked('north') },
    { label: 'South budget', checked: true, radio: true, onSelect: () => picked('south') },
    { separator: true }, { header: 'Hidden' },
    { label: 'Archived costs', onSelect: () => picked('archive') },
  ] }).menu;
  const input = menu.querySelector('input');
  const type = (text) => { input.value = text; input.dispatchEvent(new Event('input', { bubbles: true })); };
  return { anchor, menu, input, type, picked };
}

it('filters substrings without changing selection and removes empty group headings', () => {
  const { input, type, picked, menu } = setup();
  expect(menu.getAttribute('role')).toBe('dialog');
  expect(menu.querySelector('.menu-choices').getAttribute('role')).toBe('menu');
  expect(menu.querySelector('.menu-choices').contains(input)).toBe(false);
  expect(document.activeElement).toBe(input);
  type('BUDGET');
  expect(matches().map(node => node.textContent)).toEqual(['North budget', 'South budget']);
  expect(menu.querySelector('.menu-header').hidden).toBe(true);
  expect(menu.querySelector('.menu-sep').hidden).toBe(true);
  expect(menu.querySelector('[role="status"]').textContent).toBe('2 results');
  expect(picked).not.toHaveBeenCalled();
  type('costs');
  expect(matches().map(node => node.textContent)).toEqual(['Archived costs']);
  expect(menu.querySelector('.menu-header').hidden).toBe(false);
  type('');
  expect(matches()).toHaveLength(3);
  expect(menu.querySelector('.menu-sep').hidden).toBe(false);
  expect(menu.querySelector('[role="status"]').hidden).toBe(true);
});

it('supports arrows into results, returning to the field, and Enter to choose a filtered result', () => {
  const { input, type, picked } = setup();
  type('budget'); key('ArrowDown'); expect(document.activeElement.textContent).toBe('North budget');
  key('ArrowUp'); expect(document.activeElement).toBe(input);
  key('ArrowUp'); expect(document.activeElement.textContent).toBe('South budget');
  input.focus(); type('north'); key('Enter');
  expect(picked).toHaveBeenCalledWith('north'); expect(isMenuOpen()).toBe(false);
});

it('keeps the current sheet on empty Enter and does nothing on no matches or IME Enter', () => {
  const { type, picked, menu, anchor } = setup();
  type('missing'); key('Enter');
  expect(isMenuOpen()).toBe(true); expect(picked).not.toHaveBeenCalled();
  expect(menu.querySelector('[role="status"]').textContent).toBe('No matches');
  expect(menu.querySelector('.menu-choices').hidden).toBe(true);
  type('north'); key('Enter', { isComposing: true }); expect(picked).not.toHaveBeenCalled();
  type(''); key('Enter'); expect(picked).toHaveBeenCalledWith('south');
  expect(document.activeElement).toBe(anchor);
});

it('closes on Escape and restores the opener', () => {
  const { anchor, type } = setup(); type('costs'); key('Escape');
  expect(isMenuOpen()).toBe(false); expect(document.activeElement).toBe(anchor);
});

it('enables sheet search for a large workbook and keeps hidden sheets discoverable', () => {
  Element.prototype.scrollIntoView = () => {};
  const wb = new Workbook({ sheets: Array.from({ length: 9 }, (_, i) => ({ name: `Plan ${i + 1}`, hidden: i === 8 })) });
  tabs = createSheetTabs({ wb }); document.body.append(tabs.el);
  tabs.el.querySelector('.tab-all').click();
  const input = document.querySelector('[aria-label="Search sheets"]');
  input.value = '9'; input.dispatchEvent(new Event('input', { bubbles: true }));
  expect(matches().map(node => node.textContent)).toEqual(['Plan 9']);
  key('Enter');
  expect(wb.sheets[8].hidden).toBe(false);
  tabs.el.querySelector('.tab-all').click();
  expect(document.querySelectorAll('.menu-item')).toHaveLength(9);
});

it('keeps the small-workbook sheet picker simple', () => {
  Element.prototype.scrollIntoView = () => {};
  const wb = new Workbook(); tabs = createSheetTabs({ wb }); document.body.append(tabs.el);
  tabs.el.querySelector('.tab-all').click();
  expect(document.querySelector('.menu input')).toBeNull();
  expect(matches()).toHaveLength(1);
});
