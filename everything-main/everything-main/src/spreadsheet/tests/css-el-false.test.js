// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { el } from '../src/ui/dom.js';
import { openCommandPalette, paletteCommands } from '../src/ui/palette.js';

afterEach(() => document.body.replaceChildren());

// `false` used to be dropped for every key, so `spellcheck: false` never reached a field: the
// formula bar, the name box and every dialog's range and formula fields were spell-checked, with
// red underlines beneath =SUM(A1:A9). A boolean property whose default is on must be switched off.
describe('el() and false values', () => {
  it('switches boolean properties off instead of leaving them at their default', () => {
    expect(el('textarea', { spellcheck: false }).getAttribute('spellcheck')).toBe('false');
    expect(el('input', { type: 'text', spellcheck: false }).getAttribute('spellcheck')).toBe('false');
    // Pictures are draggable by default; the sheet moves them with its own pointer handling.
    const img = el('img', { draggable: false });
    expect(img.draggable).toBe(false);
    expect(img.getAttribute('draggable')).toBe('false');
  });

  it('still omits attributes written as `condition && value`', () => {
    const node = el('button', { type: 'button', title: false, 'aria-label': false, 'data-kind': false, disabled: false, hidden: false });
    for (const name of ['title', 'aria-label', 'data-kind', 'disabled', 'hidden']) expect(node.hasAttribute(name), name).toBe(false);
    expect(node.disabled).toBe(false);
    expect(node.hidden).toBe(false);
    const box = el('input', { type: 'checkbox', checked: false, required: false });
    expect(box.checked).toBe(false);
    expect(box.required).toBe(false);
  });

  it('keeps the on states working', () => {
    const node = el('button', { type: 'button', disabled: true, hidden: true });
    expect(node.disabled).toBe(true);
    expect(node.hidden).toBe(true);
  });

  it('does not spell-check the command palette search', () => {
    const palette = openCommandPalette({ commands: paletteCommands({}), run() {} });
    expect(palette.input.getAttribute('spellcheck')).toBe('false');
    palette.close();
  });
});
