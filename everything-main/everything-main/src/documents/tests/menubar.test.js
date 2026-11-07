// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { createMenubar } from '../src/ui/menubar.js';
import { openMenu, isMenuOpen, menuAnchor, closeMenu } from '../src/ui/menu.js';

function makeBar() {
  const opened = [];
  const entry = (label) => ({ label, open: (anchor) => { opened.push(label); openMenu({ anchor, label, items: [{ label: `${label} item`, onSelect() {} }] }); } });
  const mb = createMenubar([entry('File'), entry('Edit'), entry('View')], { label: 'Document menus' });
  document.body.append(mb.el);
  return { mb, opened, buttons: mb.buttons };
}

const openLabel = () => document.querySelector('.menu')?.getAttribute('aria-label') || null;
const press = (target, key) => target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
const pointer = (target, type, pointerType) => {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true });
  if (pointerType) Object.defineProperty(e, 'pointerType', { value: pointerType });
  target.dispatchEvent(e);
};

let bars = [];
afterEach(() => {
  closeMenu();
  for (const b of bars) b.destroy();
  bars = [];
  document.body.innerHTML = '';
});

describe('createMenubar', () => {
  it('is one tab stop of menu items that the arrow keys move between', () => {
    const { mb, buttons } = makeBar(); bars.push(mb);
    expect(mb.el.getAttribute('role')).toBe('menubar');
    expect(mb.el.getAttribute('aria-label')).toBe('Document menus');
    expect(buttons.map((b) => b.textContent)).toEqual(['File', 'Edit', 'View']);
    for (const b of buttons) {
      expect(b.getAttribute('role')).toBe('menuitem');
      expect(b.getAttribute('aria-haspopup')).toBe('menu');
      expect(b.getAttribute('aria-expanded')).toBe('false');
    }
    expect(buttons.map((b) => b.getAttribute('tabindex'))).toEqual(['0', '-1', '-1']);

    buttons[0].focus();
    press(buttons[0], 'ArrowRight');
    expect(document.activeElement).toBe(buttons[1]);
    expect(buttons.map((b) => b.getAttribute('tabindex'))).toEqual(['-1', '0', '-1']);
    press(buttons[1], 'ArrowLeft');
    press(buttons[0], 'ArrowLeft');
    expect(document.activeElement).toBe(buttons[2]);
    press(buttons[2], 'Home');
    expect(document.activeElement).toBe(buttons[0]);
    press(buttons[0], 'End');
    expect(document.activeElement).toBe(buttons[2]);
    expect(isMenuOpen()).toBe(false);
  });

  it('opens a menu from a click or the down arrow, anchored to its name', () => {
    const { mb, buttons, opened } = makeBar(); bars.push(mb);
    buttons[0].click();
    expect(openLabel()).toBe('File');
    expect(menuAnchor()).toBe(buttons[0]);
    expect(buttons[0].getAttribute('aria-expanded')).toBe('true');
    closeMenu();
    expect(buttons[0].getAttribute('aria-expanded')).toBe('false');
    press(buttons[1], 'ArrowDown');
    expect(openLabel()).toBe('Edit');
    expect(opened).toEqual(['File', 'Edit']);
  });

  it('switches menus with left and right while one is open, wrapping at the ends', () => {
    const { mb, buttons } = makeBar(); bars.push(mb);
    buttons[0].click();
    press(document.activeElement, 'ArrowRight');
    expect(openLabel()).toBe('Edit');
    expect(buttons[0].getAttribute('aria-expanded')).toBe('false');
    expect(buttons[1].getAttribute('aria-expanded')).toBe('true');
    press(document.activeElement, 'ArrowLeft');
    press(document.activeElement, 'ArrowLeft');
    expect(openLabel()).toBe('View');
    press(document.activeElement, 'ArrowRight');
    expect(openLabel()).toBe('File');
  });

  it('leaves left and right to a color grid or radio group inside the open menu', () => {
    const opened = [];
    const grid = document.createElement('div');
    grid.className = 'menu-custom-grid';
    const swatch = document.createElement('button');
    swatch.className = 'swatch';
    grid.append(swatch);
    const group = document.createElement('div');
    group.setAttribute('role', 'radiogroup');
    const radio = document.createElement('button');
    radio.setAttribute('role', 'radio');
    group.append(radio);
    const entry = (label) => ({ label, open: (anchor) => { opened.push(label); openMenu({ anchor, label, items: [{ custom: grid }, { custom: group }, { label: `${label} item`, onSelect() {} }] }); } });
    const mb = createMenubar([entry('File'), entry('Edit')], { label: 'Document menus' });
    bars.push(mb);
    document.body.append(mb.el);
    mb.buttons[0].click();
    expect(openLabel()).toBe('File');
    swatch.focus();
    press(swatch, 'ArrowRight');
    expect(openLabel()).toBe('File');
    radio.focus();
    press(radio, 'ArrowLeft');
    expect(openLabel()).toBe('File');
    expect(opened).toEqual(['File']);
  });

  it('sweeps between menus under the mouse, but not under a finger', () => {
    const { mb, buttons } = makeBar(); bars.push(mb);
    pointer(buttons[1], 'pointerenter', 'mouse');
    expect(isMenuOpen()).toBe(false);
    buttons[0].click();
    pointer(buttons[1], 'pointerenter', 'mouse');
    expect(openLabel()).toBe('Edit');
    pointer(buttons[2], 'pointerenter', 'touch');
    expect(openLabel()).toBe('Edit');
  });

  it('closes the open menu when its own name is clicked again', () => {
    const { mb, buttons } = makeBar(); bars.push(mb);
    buttons[0].click();
    expect(openLabel()).toBe('File');
    // The press lands outside the menu and closes it; the click that follows must not reopen it.
    pointer(buttons[0].firstChild || buttons[0], 'pointerdown');
    expect(isMenuOpen()).toBe(false);
    buttons[0].click();
    expect(isMenuOpen()).toBe(false);
    // A later click opens it as usual.
    buttons[0].click();
    expect(openLabel()).toBe('File');
    // Pressing another name closes this menu and the click opens that one.
    pointer(buttons[1], 'pointerdown');
    buttons[1].click();
    expect(openLabel()).toBe('Edit');
  });

  it('returns focus to the name when the menu closes with Escape', () => {
    const { mb, buttons } = makeBar(); bars.push(mb);
    buttons[1].click();
    expect(document.activeElement.classList.contains('menu-item')).toBe(true);
    press(document.activeElement, 'Escape');
    expect(isMenuOpen()).toBe(false);
    expect(document.activeElement).toBe(buttons[1]);
  });

  it('stops listening for the arrow keys after destroy', () => {
    const { mb, buttons } = makeBar();
    mb.destroy();
    buttons[0].click();
    press(document.activeElement, 'ArrowRight');
    expect(openLabel()).toBe('File');
  });
});
