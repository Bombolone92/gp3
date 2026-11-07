// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { createMenubar } from '../src/ui/menubar.js';
import { openMenu, closeMenu, isMenuOpen } from '../src/ui/menu.js';

afterEach(() => { closeMenu(); document.body.replaceChildren(); });

const keydown = (key, extra = {}) => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra }));

// The editor put focus back on the grid whenever a menu-bar menu closed, Escape included, which undid
// the menu's own return of focus to its title. A menu now says why it closed, so the editor can leave
// focus where the keyboard put it after Escape or Tab and take it back to the grid after a choice.
describe('why a menu closed', () => {
  it('is passed by the menu bar to its onClose: escape, tab, select, outside, api', () => {
    const reasons = [];
    const bar = createMenubar({ flags: () => ({ hasNote: true }), run() {}, onClose: (reason) => reasons.push(reason) });
    document.body.append(bar.el);
    const title = (label) => [...bar.el.querySelectorAll('.menubar-btn')].find((b) => b.textContent === label);
    const item = (text) => [...document.querySelectorAll('.menu:not(.submenu) .menu-item')].find((b) => b.textContent.includes(text));

    bar.open('edit');
    keydown('Escape');
    expect(isMenuOpen()).toBe(false);
    expect(document.activeElement).toBe(title('Edit'));

    bar.open('edit');
    keydown('Tab');
    expect(isMenuOpen()).toBe(false);
    expect(document.activeElement).toBe(title('Edit'));

    bar.open('insert');
    item('Edit note').click();
    expect(isMenuOpen()).toBe(false);

    bar.open('file');
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(isMenuOpen()).toBe(false);

    bar.open('view');
    bar.close();
    expect(reasons).toEqual(['escape', 'tab', 'select', 'outside', 'api']);
    // Handing over from one title to another is not a close of the bar's menu.
    bar.open('file');
    bar.open('edit');
    expect(reasons).toHaveLength(5);
    bar.destroy();
    expect(reasons).toEqual(['escape', 'tab', 'select', 'outside', 'api', 'api']);
  });

  it('is passed by a menu to its own onClose, for a submenu selection and the window events too', () => {
    const reasons = [];
    const anchor = document.createElement('button');
    document.body.append(anchor);
    const open = () => openMenu({ anchor, items: [{ label: 'Plain' }, { label: 'More', submenu: [{ label: 'Deep' }] }], onClose: (reason) => reasons.push(reason) });
    open();
    document.querySelectorAll('.menu-item')[1].click();
    document.querySelector('.submenu .menu-item').click();
    expect(isMenuOpen()).toBe(false);
    open();
    document.dispatchEvent(new Event('scroll', { bubbles: true }));
    open();
    window.dispatchEvent(new Event('blur'));
    open();
    anchor.focus(); // focus outside the menu: the resize is not the on-screen keyboard under a field
    window.dispatchEvent(new Event('resize'));
    open();
    closeMenu();
    expect(reasons).toEqual(['select', 'scroll', 'blur', 'resize', 'api']);
  });
});
