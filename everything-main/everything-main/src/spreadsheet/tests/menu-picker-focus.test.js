// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { closeMenu, openMenu } from '../src/ui/menu.js';

afterEach(() => { closeMenu(); document.body.replaceChildren(); });
const key = name => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));

it('starts a picker at the current radio value without applying it, then navigates adjacent values', () => {
  const chosen = vi.fn();
  openMenu({ focusChecked: true, items: [
    { label: 'Custom…' },
    { label: '20', radio: true, checked: false },
    { label: '24', radio: true, checked: true, onSelect: chosen },
    { label: '28', radio: true, checked: false },
  ] });
  expect(document.activeElement.textContent).toBe('24');
  expect(document.activeElement.tabIndex).toBe(0);
  expect(document.querySelectorAll('.menu-item[tabindex="0"]')).toHaveLength(1);
  expect(chosen).not.toHaveBeenCalled();
  key('ArrowDown'); expect(document.activeElement.textContent).toBe('28');
  expect(document.activeElement.tabIndex).toBe(0);
  expect(document.querySelectorAll('.menu-item[tabindex="0"]')).toHaveLength(1);
  key('ArrowUp'); expect(document.activeElement.textContent).toBe('24');
});

it('ignores checked checkboxes and disabled radio choices when finding initial focus', () => {
  openMenu({ focusChecked: true, items: [
    { label: 'Toggle', checked: true },
    { label: 'Unavailable', radio: true, checked: true, disabled: true },
    { label: 'Current', radio: true, checked: true },
  ] });
  expect(document.activeElement.textContent).toBe('Current');
});

it('falls back to the first enabled action when no current radio choice exists', () => {
  openMenu({ focusChecked: true, items: [{ label: 'Disabled', disabled: true }, { label: 'Custom…' }, { label: 'Default', radio: true, checked: false }] });
  expect(document.activeElement.textContent).toBe('Custom…');
});

it('leaves ordinary action menus at the beginning and respects explicit focus ownership', () => {
  const items = [{ label: 'Action' }, { label: 'Current', radio: true, checked: true }];
  openMenu({ items }); expect(document.activeElement.textContent).toBe('Action');
  closeMenu();
  const opener = document.createElement('button'); document.body.append(opener); opener.focus();
  openMenu({ items, focusChecked: true, autoFocus: false }); expect(document.activeElement).toBe(opener);
});

it('gives the search field priority in searchable pickers', () => {
  const { menu } = openMenu({ search: 'Search sheets', focusChecked: true, items: [{ label: 'Current', radio: true, checked: true }] });
  expect(document.activeElement).toBe(menu.querySelector('input'));
});
