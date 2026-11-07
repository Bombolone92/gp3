// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { openCommandPalette, paletteCommands } from '../src/ui/palette.js';
import { stylesheet, declared } from './helpers/css.js';

let palette;
afterEach(() => { palette?.close(); document.body.replaceChildren(); });

const type = (text) => { palette.input.value = text; palette.input.dispatchEvent(new Event('input')); };

// With no match the palette put a note inside the listbox, where a screen reader finds a child that is
// not an option and hears nothing about it, while the combobox still claimed an expanded list.
it('announces that nothing matches from a status outside the listbox, and collapses the combobox', () => {
  palette = openCommandPalette({ commands: paletteCommands({}), run() {} });
  type('zzzzqqq');
  const list = document.getElementById('palette-list');
  expect(list.children).toHaveLength(0);
  const status = palette.panel.querySelector('[role="status"]');
  expect(status).toBeTruthy();
  expect(list.contains(status)).toBe(false);
  expect(status.textContent).toBe('No action matches that');
  expect(status.classList.contains('palette-empty')).toBe(true);
  expect(palette.input.getAttribute('aria-expanded')).toBe('false');
  expect(palette.input.hasAttribute('aria-activedescendant')).toBe(false);
  // Enter with nothing to run is harmless, and a match brings the list back with the status silent.
  palette.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  expect(palette.input.isConnected).toBe(true);
  type('pivot');
  expect(list.children.length).toBeGreaterThan(0);
  expect(status.textContent).toBe('');
  expect(palette.input.getAttribute('aria-expanded')).toBe('true');
  expect(palette.input.getAttribute('aria-activedescendant')).toBe(list.children[0].id);
});

it('takes up no room while it has nothing to say', () => {
  expect(declared(stylesheet('components.css'), '.palette-empty:empty').display).toBe('none');
});
