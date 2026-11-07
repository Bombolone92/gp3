// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { openMenu, closeMenu } from '../src/ui/menu.js';

beforeEach(() => { document.body.innerHTML = '<div id="app"></div>'; vi.useFakeTimers(); });
afterEach(() => { closeMenu(); vi.useRealTimers(); document.body.replaceChildren(); });

// A submenu the pointer opened listened for keys as the parent did, with the focus still on the parent:
// in the cell menu, which has no menu bar to move along, Left jumped from Cut to the item that opened the
// submenu, and a letter the parent had no item for moved the focus into the submenu.
const key = (k) => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
function open() {
  openMenu({ x: 10, y: 10, items: [
    { label: 'Cut', onSelect() {} },
    { label: 'Insert', submenu: [{ label: 'Row above', onSelect() {} }, { label: 'Column left', onSelect() {} }] },
  ] });
  const [cut, insert] = document.querySelectorAll('.menu-item');
  cut.focus();
  insert.dispatchEvent(new Event('pointerenter'));
  vi.advanceTimersByTime(150);
  expect(document.querySelectorAll('.menu')).toHaveLength(2);
  return { cut, insert };
}

it('leaves Left to the parent while the focus is there', () => {
  const { cut } = open();
  key('ArrowLeft');
  expect(document.activeElement).toBe(cut);
});

it('does not move the focus into the submenu on a letter the parent has no item for', () => {
  const { cut } = open();
  key('r');
  expect(document.activeElement).toBe(cut);
});

it('still answers the keys once the focus is inside the submenu', () => {
  const { insert } = open();
  key('ArrowDown');
  expect(document.activeElement).toBe(insert);
  key('ArrowRight');
  expect(document.activeElement.textContent).toBe('Row above');
  key('ArrowDown');
  expect(document.activeElement.textContent).toBe('Column left');
  key('ArrowLeft');
  expect(document.activeElement).toBe(insert);
});
