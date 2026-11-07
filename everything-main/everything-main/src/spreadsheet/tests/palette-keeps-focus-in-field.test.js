// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { openCommandPalette } from '../src/ui/palette.js';

// A press on the palette's search icon, its Esc hint or a row moved the focus off the field and, the
// icon and hint taking none, onto the page: the arrows and Enter reached nothing, and Tab walked into the
// app behind the still-open palette.
afterEach(() => { document.body.replaceChildren(); });
const press = (node) => { const e = new MouseEvent('mousedown', { bubbles: true, cancelable: true }); node.dispatchEvent(e); return e; };

it('keeps the focus in the field when the panel is pressed elsewhere, and still runs a pressed row', () => {
  const run = vi.fn();
  const { panel, input, close } = openCommandPalette({ commands: [{ label: 'Bold', section: 'Format', cmd: 'bold' }, { label: 'Italic', section: 'Format', cmd: 'italic' }], run });
  expect(press(panel.querySelector('.palette-icon')).defaultPrevented).toBe(true);
  expect(press(panel.querySelector('.palette-kbd')).defaultPrevented).toBe(true);
  const row = panel.querySelector('.palette-item');
  expect(press(row.querySelector('.menu-label')).defaultPrevented).toBe(true);
  // The field itself, for placing the caret, and the list, whose scrollbar a press may be on, are left alone.
  expect(press(input).defaultPrevented).toBe(false);
  expect(press(panel.querySelector('.palette-list')).defaultPrevented).toBe(false);
  row.click();
  expect(run).toHaveBeenCalledWith('bold', undefined);
  close();
});
