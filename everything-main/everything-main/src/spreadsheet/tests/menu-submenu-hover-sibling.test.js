// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { openMenu, closeMenu } from '../src/ui/menu.js';

beforeEach(() => { document.body.innerHTML = '<div id="app"></div>'; vi.useFakeTimers(); });
afterEach(() => { closeMenu(); vi.useRealTimers(); document.body.replaceChildren(); });

const menus = () => document.querySelectorAll('.menu').length;
const pointer = (node, type) => node.dispatchEvent(new Event(type));

// A hover-opened submenu closed 200 ms after the pointer entered any plain item of its parent, and nothing
// cancelled that when the pointer went on into the submenu: the usual diagonal move from "Paste special"
// down into the third item of its submenu brushes the item below the opener for a few milliseconds, and
// the submenu vanished under the pointer that was by then inside it.
function open() {
  openMenu({ x: 10, y: 10, items: [
    { label: 'Paste special', submenu: [{ label: 'Values only', onSelect() {} }, { label: 'Formats only', onSelect() {} }, { label: 'Transposed', onSelect() {} }] },
    { label: 'Copy link to this cell', onSelect() {} },
    { label: 'Clear', onSelect() {} },
  ] });
  const [opener, sibling] = document.querySelectorAll('.menu-item');
  pointer(opener, 'pointerenter');
  vi.advanceTimersByTime(150);
  expect(menus()).toBe(2);
  expect(opener.getAttribute('aria-expanded')).toBe('true');
  pointer(opener, 'pointerleave');
  const submenu = document.querySelectorAll('.menu')[1];
  return { opener, sibling, submenu, third: submenu.querySelectorAll('.menu-item')[2] };
}

it('keeps a submenu the pointer entered after brushing the item below its opener', () => {
  const { opener, sibling, submenu, third } = open();
  pointer(sibling, 'pointerenter');
  vi.advanceTimersByTime(50);
  pointer(sibling, 'pointerleave');
  pointer(submenu, 'pointerenter');
  pointer(third, 'pointerenter');
  vi.advanceTimersByTime(400);
  expect(menus()).toBe(2);
  expect(opener.getAttribute('aria-expanded')).toBe('true');
  expect(submenu.isConnected).toBe(true);
});

it('keeps it when the pointer reaches the submenu before the browser reports leaving the sibling', () => {
  const { sibling, submenu } = open();
  pointer(sibling, 'pointerenter');
  vi.advanceTimersByTime(50);
  pointer(submenu, 'pointerenter'); // arriving in the submenu is enough on its own
  vi.advanceTimersByTime(400);
  expect(menus()).toBe(2);
});

it('still closes the submenu when the pointer rests on another item', () => {
  const { opener, sibling } = open();
  pointer(sibling, 'pointerenter');
  vi.advanceTimersByTime(250);
  expect(menus()).toBe(1);
  expect(opener.getAttribute('aria-expanded')).toBe('false');
});

it('closes it when the pointer comes back from the submenu and rests on another item', () => {
  const { sibling, submenu, third } = open();
  pointer(submenu, 'pointerenter');
  pointer(third, 'pointerenter');
  vi.advanceTimersByTime(400);
  expect(menus()).toBe(2);
  pointer(third, 'pointerleave');
  pointer(sibling, 'pointerenter');
  vi.advanceTimersByTime(250);
  expect(menus()).toBe(1);
});

// A click on the opener puts focus in the submenu; resting on a sibling then closed the submenu with focus
// inside it, and focus fell to the page: no focus ring, and a screen reader lost its place in the menu.
it('gives focus back to the opener when resting on a sibling closes a submenu that held it', () => {
  openMenu({ x: 10, y: 10, items: [
    { label: 'Import', submenu: [{ label: 'From file', onSelect() {} }, { label: 'From URL', onSelect() {} }] },
    { label: 'Save', onSelect() {} },
  ] });
  const [opener, sibling] = document.querySelectorAll('.menu-item');
  opener.click();
  expect(document.querySelectorAll('.menu')[1].contains(document.activeElement)).toBe(true);
  pointer(sibling, 'pointerenter');
  vi.advanceTimersByTime(250);
  expect(menus()).toBe(1);
  expect(document.activeElement).toBe(opener);
  expect(opener.getAttribute('aria-expanded')).toBe('false');
});
