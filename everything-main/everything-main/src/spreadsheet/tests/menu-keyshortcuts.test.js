// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { openMenu, closeMenu, ariaKeyShortcuts } from '../src/ui/menu.js';

afterEach(closeMenu);

// The shortcut printed beside a menu item is aria-hidden, so a screen reader never heard it.
// The item now carries the same key combination as aria-keyshortcuts, in the attribute's own
// spelling: ⌘ is Meta, Ctrl is Control, ⇧ Shift and ⌥ Alt, arrows are ArrowLeft and so on.
describe('aria-keyshortcuts from a shortcut hint', () => {
  it('spells modifiers and keys the way the attribute expects', () => {
    expect(ariaKeyShortcuts('⌘+Shift+P')).toBe('Meta+Shift+P');
    expect(ariaKeyShortcuts('Ctrl+Shift+P')).toBe('Control+Shift+P');
    expect(ariaKeyShortcuts('⌘+B')).toBe('Meta+B');
    expect(ariaKeyShortcuts('⌥+⇧+→')).toBe('Alt+Shift+ArrowRight');
    expect(ariaKeyShortcuts('Alt+Shift+Left')).toBe('Alt+Shift+ArrowLeft');
    expect(ariaKeyShortcuts('Shift+F11')).toBe('Shift+F11');
    expect(ariaKeyShortcuts('F9')).toBe('F9');
    expect(ariaKeyShortcuts('Delete')).toBe('Delete');
    expect(ariaKeyShortcuts('Esc')).toBe('Escape');
    expect(ariaKeyShortcuts('⌘+;')).toBe('Meta+;');
    expect(ariaKeyShortcuts("⌘+'")).toBe("Meta+'");
    expect(ariaKeyShortcuts('⌘+`')).toBe('Meta+`');
    expect(ariaKeyShortcuts('⌘+\\')).toBe('Meta+\\');
    expect(ariaKeyShortcuts('Alt+=')).toBe('Alt+=');
    expect(ariaKeyShortcuts('⌘+Shift+>')).toBe('Meta+Shift+>');
    expect(ariaKeyShortcuts('Ctrl++')).toBe('Control+Plus');
    expect(ariaKeyShortcuts('Ctrl+Space')).toBe('Control+Space');
  });

  it('gives nothing for a hint that is not a key combination', () => {
    // Menus also use the hint slot for sample values, colours and names.
    for (const hint of ['1,234.50', '$1,234.50', '12.35%', '2026-08-27', 'Aug 27, 2026', '13:45', 'as typed', '', 'Default', '#c22a2a', 'Thin', '$ USD', 'English (United States)', 'Shift', '⌘+', 'Ctrl+Shift', null, undefined]) {
      expect(ariaKeyShortcuts(hint), String(hint)).toBeNull();
    }
  });

  it('is set on the menu item, and only where the hint is a shortcut', () => {
    openMenu({ x: 10, y: 10, label: 'Test', items: [
      { label: 'Bold', shortcut: '⌘+B' },
      { label: 'Currency', shortcut: '$1,234.50' },
      { label: 'Plain' },
      { label: 'Recalculate', shortcut: 'F9', checked: true },
    ] });
    const items = [...document.querySelectorAll('.menu-item')];
    expect(items[0].getAttribute('aria-keyshortcuts')).toBe('Meta+B');
    expect(items[0].querySelector('.menu-shortcut').getAttribute('aria-hidden')).toBe('true');
    expect(items[1].hasAttribute('aria-keyshortcuts')).toBe(false);
    expect(items[2].hasAttribute('aria-keyshortcuts')).toBe(false);
    expect(items[3].getAttribute('aria-keyshortcuts')).toBe('F9');
  });
});
