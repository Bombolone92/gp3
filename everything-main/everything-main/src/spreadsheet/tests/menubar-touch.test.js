// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { createMenubar } from '../src/ui/menubar.js';
import { closeMenu, isMenuOpen } from '../src/ui/menu.js';

afterEach(() => { closeMenu(); document.body.replaceChildren(); });

function setup() {
  const bar = createMenubar({ flags: () => ({}), run() {} });
  document.body.append(bar.el);
  return bar;
}
const title = (bar, label) => [...bar.el.querySelectorAll('.menubar-btn')].find((b) => b.textContent === label);
const openLabel = () => document.querySelector('.menu:not(.submenu)')?.getAttribute('aria-label') || null;
const pointer = (type, pointerType, extra = {}) => new PointerEvent(type, { pointerType, bubbles: true, cancelable: true, ...extra });

// A finger cannot hover, but a tap fires pointerenter on its way to click. The hover switch took
// the pointerenter as "hovering another title" and opened Edit, so the click that followed found
// Edit already open and closed it: on a touch screen, tapping a second title closed everything.
it('switches to a tapped title on a touch screen instead of closing every menu', () => {
  const bar = setup();
  title(bar, 'File').click();
  expect(bar.openId).toBe('file');
  const edit = title(bar, 'Edit');
  edit.dispatchEvent(pointer('pointerenter', 'touch'));
  expect(bar.openId).toBe('file'); // the tap's hover is not a hover
  edit.dispatchEvent(pointer('pointerdown', 'touch'));
  edit.dispatchEvent(pointer('pointerup', 'touch'));
  edit.click();
  expect(bar.openId).toBe('edit');
  expect(openLabel()).toBe('Edit');
  expect(isMenuOpen()).toBe(true);
});

it('still switches menus when a mouse or pen hovers another title', () => {
  const bar = setup();
  title(bar, 'File').click();
  title(bar, 'Edit').dispatchEvent(pointer('pointerenter', 'mouse'));
  expect(bar.openId).toBe('edit');
  title(bar, 'View').dispatchEvent(pointer('pointerenter', 'pen'));
  expect(bar.openId).toBe('view');
  expect(document.querySelectorAll('.menu').length).toBe(1);
});
