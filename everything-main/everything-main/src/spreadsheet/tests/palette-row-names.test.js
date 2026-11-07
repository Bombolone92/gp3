// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { openCommandPalette, paletteCommands } from '../src/ui/palette.js';
import { ariaKeyShortcuts } from '../src/ui/menu.js';
import { MOD_KEY } from '../src/ui/dom.js';

let palette;
afterEach(() => { palette?.close(); document.body.replaceChildren(); });

// A palette row's name was everything in it run together ("SaveFileCtrl+S"), and it carried no
// aria-keyshortcuts; the same action in the File menu is named "Save", its shortcut spoken from the
// attribute and its printed hint hidden. The rows now follow the menu items: the label is the name,
// the section describes it, and the shortcut is an attribute.
it('names a row by its label, describes it by its section, and carries its shortcut as aria-keyshortcuts', () => {
  palette = openCommandPalette({ commands: paletteCommands({}), run() {} });
  palette.input.value = 'save';
  palette.input.dispatchEvent(new Event('input'));
  const row = [...document.querySelectorAll('.palette-item')].find((r) => r.querySelector('.menu-label').firstChild.textContent === 'Save');
  expect(row.getAttribute('aria-label')).toBe('Save');
  expect(row.getAttribute('aria-keyshortcuts')).toBe(ariaKeyShortcuts(`${MOD_KEY}+S`));
  expect(row.querySelector('.menu-shortcut').getAttribute('aria-hidden')).toBe('true');
  const section = document.getElementById(row.getAttribute('aria-describedby'));
  expect(section.textContent).toBe('File');
  expect(row.contains(section)).toBe(true);
  // A row without a shortcut has no empty attribute.
  const plain = [...document.querySelectorAll('.palette-item')].find((r) => r.getAttribute('aria-label') === 'Save a copy…');
  expect(plain.hasAttribute('aria-keyshortcuts')).toBe(false);
  expect(plain.querySelector('.menu-shortcut')).toBeNull();
});
