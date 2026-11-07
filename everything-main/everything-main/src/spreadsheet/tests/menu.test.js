// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { openMenu, isMenuOpen, closeMenu } from '../src/ui/menu.js';

afterEach(closeMenu);

describe('menus with submenus', () => {
  it('navigates custom menu items, including items replaced by a search', () => {
    const list = document.createElement('div');
    list.innerHTML = '<button role="menuitem">SUM</button><button role="menuitem" disabled>Unavailable</button><button role="menuitem">AVERAGE</button>';
    openMenu({ x: 10, y: 10, items: [{ custom: list }] });
    list.querySelector('button').focus();
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement.textContent).toBe('AVERAGE');
    list.innerHTML = '<button role="menuitem">ROUND</button><button role="menuitem">ROUNDUP</button>';
    list.querySelector('button').focus();
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    expect(document.activeElement.textContent).toBe('ROUNDUP');
  });

  it('lets custom swatch grids handle their own arrow keys exactly once', () => {
    const swatches = document.createElement('div');
    swatches.innerHTML = Array.from({ length: 12 }, (_, i) => `<button role="menuitemradio">${i}</button>`).join('');
    swatches.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowDown') return;
      e.preventDefault();
      e.stopPropagation();
      const all = [...swatches.children];
      all[Math.min(all.length - 1, all.indexOf(document.activeElement) + 6)].focus();
    });
    openMenu({ x: 10, y: 10, items: [{ custom: swatches }] });
    swatches.firstElementChild.focus();
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement.textContent).toBe('6');
  });

  function openThreeLevels() {
    openMenu({ x: 10, y: 10, items: [{ label: 'Level one', submenu: [
      { label: 'Level two', submenu: [{ label: 'First choice' }, { label: 'Second choice' }] },
    ] }] });
    document.querySelector('.menu-item').click();
    document.querySelector('.submenu .menu-item').click();
    return [...document.querySelectorAll('.menu')];
  }

  it('keeps every ancestor open when pressing a deeply nested menu item', () => {
    const menus = openThreeLevels();
    menus[2].querySelector('button').dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(document.querySelectorAll('.menu')).toHaveLength(3);
  });

  it('lets only the deepest focused menu handle navigation and Escape', () => {
    const menus = openThreeLevels();
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement.textContent).toContain('Second choice');
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelectorAll('.menu')).toHaveLength(2);
    expect(document.activeElement).toBe(menus[1].querySelector('button'));
  });

  it('opens a child menu beside an item and closes everything when a choice is made', () => {
    const picked = [];
    const menu = openMenu({
      x: 10, y: 10, label: 'Test',
      items: [
        { label: 'Plain', onSelect: () => picked.push('plain') },
        { label: 'More', submenu: [{ label: 'Deep one', onSelect: () => picked.push('deep') }, { label: 'Deep two', onSelect: () => picked.push('deep2') }] },
      ],
    });
    expect(isMenuOpen()).toBe(true);
    const more = [...document.querySelectorAll('.menu-item')].find((b) => b.textContent.includes('More'));
    expect(more.getAttribute('aria-haspopup')).toBe('menu');
    more.click();
    expect(document.querySelectorAll('.menu').length).toBe(2);
    expect(more.getAttribute('aria-expanded')).toBe('true');
    const deep = [...document.querySelectorAll('.menu.submenu .menu-item')].find((b) => b.textContent.includes('Deep one'));
    deep.click();
    expect(picked).toEqual(['deep']);
    expect(document.querySelectorAll('.menu').length).toBe(0);
    expect(isMenuOpen()).toBe(false);
    void menu;
  });

  it('closes just the child on Escape or Left, keeping the parent', () => {
    openMenu({ x: 10, y: 10, label: 'Test', items: [{ label: 'More', submenu: [{ label: 'Deep', onSelect() {} }] }] });
    const more = document.querySelector('.menu-item');
    more.click();
    expect(document.querySelectorAll('.menu').length).toBe(2);
    const deep = document.querySelector('.menu.submenu .menu-item');
    deep.focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelectorAll('.menu').length).toBe(1);
    expect(isMenuOpen()).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(isMenuOpen()).toBe(false);
  });
});


it('does not dismiss a search field during composition', () => {
  const input = document.createElement('input');
  openMenu({ items: [{ custom: input }] });
  input.focus();
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true }));
  expect(isMenuOpen()).toBe(true);
});


it('closes every menu on Tab from a submenu and restores a connected opener', () => {
  const opener = document.createElement('button');
  document.body.append(opener);
  opener.focus();
  openMenu({ anchor: opener, items: [{ label: 'More', submenu: [{ label: 'Choice' }] }] });
  document.activeElement.click();
  document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
  expect(isMenuOpen()).toBe(false);
  expect(document.querySelectorAll('.menu')).toHaveLength(0);
  expect(document.activeElement).toBe(opener);
});

it('leaves caret arrows inside submenu fields', () => {
  const input = document.createElement('input');
  openMenu({ items: [{ label: 'More', submenu: [{ custom: input }] }] });
  document.activeElement.click();
  input.focus();
  const event = new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true });
  input.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
  expect(input.isConnected).toBe(true);
  expect(document.activeElement).toBe(input);
});

it('keeps a tall menu inside the viewport while its opening animation still scales it down', () => {
  const heightDesc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
  const widthDesc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
  const rectProto = Element.prototype.getBoundingClientRect;
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get() { return this.classList.contains('menu') ? 600 : 0; } });
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get() { return this.classList.contains('menu') ? 240 : 0; } });
  // Mid-animation the bounding rect reports the 0.97-scaled size.
  Element.prototype.getBoundingClientRect = function () {
    const scaled = this.classList.contains('menu');
    return { left: 0, top: 0, right: scaled ? 232.8 : 0, bottom: scaled ? 582 : 0, width: scaled ? 232.8 : 0, height: scaled ? 582 : 0 };
  };
  window.innerHeight = 819;
  try {
    const { menu } = openMenu({ x: 300, y: 269, items: [{ label: 'One' }, { label: 'Two' }] });
    expect(parseFloat(menu.style.top)).toBeLessThanOrEqual(819 - 8 - 600);
  } finally {
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', heightDesc);
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', widthDesc);
    Element.prototype.getBoundingClientRect = rectProto;
  }
});
