// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { openMenu, closeMenu } from '../src/ui/menu.js';
import { createMenubar } from '../src/ui/menubar.js';

// A menu bar hands the menu `onNavigate` so Left and Right at the top level
// move to the neighbouring title. Submenus did not receive it, so the bar
// listened to every keydown on the document to catch Right on a submenu item;
// the menu now carries the callback into its submenus itself.
afterEach(() => { closeMenu(); document.body.replaceChildren(); });

const press = (key) => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
const item = (text) => [...document.querySelectorAll('.menu-item')].find((b) => b.textContent.includes(text));

it('calls onNavigate for Right on a submenu item that opens nothing more, but not for Left there or Right on a deeper submenu', () => {
  const onNavigate = vi.fn();
  openMenu({ x: 10, y: 10, onNavigate, items: [
    { label: 'Plain', onSelect() {} },
    { label: 'More', submenu: [{ label: 'Leaf', onSelect() {} }, { label: 'Deeper', submenu: [{ label: 'Bottom', onSelect() {} }] }] },
  ] });
  item('More').focus();
  press('ArrowRight'); // opens the submenu, no hand-over
  expect(onNavigate).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(item('Leaf'));
  press('ArrowLeft'); // back to the parent item
  expect(onNavigate).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(item('More'));
  press('ArrowRight');
  press('ArrowDown');
  expect(document.activeElement).toBe(item('Deeper'));
  press('ArrowRight'); // a deeper submenu opens instead
  expect(onNavigate).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(item('Bottom'));
  press('ArrowRight'); // nothing more to open: on to the next menu
  expect(onNavigate).toHaveBeenCalledWith(1);
  // At the top level Left and Right both hand over.
  onNavigate.mockClear();
  closeMenu();
  openMenu({ x: 10, y: 10, onNavigate, items: [{ label: 'Plain', onSelect() {} }] });
  press('ArrowLeft');
  expect(onNavigate).toHaveBeenLastCalledWith(-1);
  press('ArrowRight');
  expect(onNavigate).toHaveBeenLastCalledWith(1);
});

it('leaves a menu without onNavigate alone on Right at a submenu leaf', () => {
  openMenu({ x: 10, y: 10, items: [{ label: 'More', submenu: [{ label: 'Leaf', onSelect() {} }] }] });
  item('More').focus();
  press('ArrowRight');
  expect(document.activeElement).toBe(item('Leaf'));
  press('ArrowRight');
  expect(document.activeElement).toBe(item('Leaf'));
});

it('lets the menu bar move on from a submenu item without a listener of its own on the document', () => {
  const bar = createMenubar({ flags: () => ({}), run() {} });
  document.body.append(bar.el);
  const title = (label) => [...bar.el.querySelectorAll('.menubar-btn')].find((b) => b.textContent === label);
  title('View').click();
  item('Freeze').focus();
  press('ArrowRight');
  expect(document.activeElement).toBe(item('First row'));
  press('ArrowRight');
  expect(document.querySelector('.menu:not(.submenu)').getAttribute('aria-label')).toBe('Insert');
  expect(document.querySelectorAll('.menu.submenu').length).toBe(0);
  // Escape returns to the title that took over, as it opened the menu.
  press('Escape');
  expect(document.activeElement).toBe(title('Insert'));
  bar.destroy();
  // With the bar gone, a stray Right on the document reaches nothing of it.
  const before = document.querySelectorAll('.menu').length;
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  expect(document.querySelectorAll('.menu').length).toBe(before);
});
