// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createKeypad } from '../src/ui/keypad.js';

const view = (overrides = {}) => ({
  remaining: () => 9,
  notesMode: false,
  showRemaining: true,
  selectedDigit: 0,
  ...overrides,
});

let root;
let keypad;
let onDigit;

beforeEach(() => {
  document.body.innerHTML = '<div id="keypad"></div>';
  root = document.getElementById('keypad');
  onDigit = vi.fn();
  keypad = createKeypad(root, { onDigit });
});

const keyFor = (digit) => root.querySelector(`.key[data-digit="${digit}"]`);

describe('structure', () => {
  it('builds one key per digit, in order', () => {
    const keys = [...root.querySelectorAll('.key')];
    expect(keys).toHaveLength(9);
    expect(keys.map((k) => k.dataset.digit)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9']);
  });

  it('reports the digit that was pressed', () => {
    keypad.render(view());
    keyFor(7).click();
    expect(onDigit).toHaveBeenCalledWith(7);
  });

  it('reports a press that lands on the label inside the key', () => {
    keypad.render(view());
    keyFor(3).querySelector('span').click();
    expect(onDigit).toHaveBeenCalledWith(3);
  });

  it('ignores a press on the gap between keys', () => {
    root.click();
    expect(onDigit).not.toHaveBeenCalled();
  });
});

describe('counts', () => {
  it('shows how many of each digit are still unplaced', () => {
    keypad.render(view({ remaining: (d) => d }));
    expect(keyFor(1).querySelector('.key-count').textContent).toBe('1');
    expect(keyFor(6).querySelector('.key-count').textContent).toBe('6');
  });

  it('hides the counts when that setting is off', () => {
    keypad.render(view({ remaining: () => 4, showRemaining: false }));
    expect(keyFor(1).querySelector('.key-count').textContent).toBe('');
    // The count is hidden, not the key.
    expect(keyFor(1).classList.contains('exhausted')).toBe(false);
  });

  it('puts the count in the accessible name either way', () => {
    keypad.render(view({ remaining: () => 3, showRemaining: false }));
    expect(keyFor(1).getAttribute('aria-label')).toBe('1, 3 remaining');
  });
});

describe('a fully placed digit', () => {
  it('dims the key and stops it responding, without removing it', () => {
    // Removing the key would reflow the row under the player's finger.
    keypad.render(view({ remaining: (d) => (d === 5 ? 0 : 4) }));
    const key = keyFor(5);
    expect(key.classList.contains('exhausted')).toBe(true);
    expect(key.getAttribute('aria-disabled')).toBe('true');
    expect(key.querySelector('.key-count').textContent).toBe('');
    key.click();
    expect(onDigit).not.toHaveBeenCalled();
    expect(root.querySelectorAll('.key')).toHaveLength(9);
  });

  it('comes back when the digit is erased again', () => {
    let left = 0;
    keypad.render(view({ remaining: () => left }));
    expect(keyFor(5).classList.contains('exhausted')).toBe(true);
    left = 1;
    keypad.render(view({ remaining: () => left }));
    expect(keyFor(5).classList.contains('exhausted')).toBe(false);
    keyFor(5).click();
    expect(onDigit).toHaveBeenCalledWith(5);
  });
});

describe('pencil-mark mode', () => {
  it('says the keys will write marks', () => {
    keypad.render(view({ notesMode: true }));
    expect(root.classList.contains('notes-mode')).toBe(true);
    expect(keyFor(4).getAttribute('aria-label')).toBe('Pencil in 4');
    expect(keyFor(4).title).toBe('Pencil in 4');
  });

  it('drops the mode when switched back off', () => {
    keypad.render(view({ notesMode: true }));
    keypad.render(view({ notesMode: false }));
    expect(root.classList.contains('notes-mode')).toBe(false);
  });

  it('does not mark a selected digit, since marks are not placements', () => {
    keypad.render(view({ notesMode: true, selectedDigit: 4 }));
    expect(keyFor(4).classList.contains('selected-digit')).toBe(false);
  });
});

describe('the selected digit', () => {
  it('is picked out on the keypad', () => {
    keypad.render(view({ selectedDigit: 8 }));
    expect(keyFor(8).classList.contains('selected-digit')).toBe(true);
    expect(keyFor(7).classList.contains('selected-digit')).toBe(false);
  });

  it('is dropped when the selection moves to an empty cell', () => {
    keypad.render(view({ selectedDigit: 8 }));
    keypad.render(view({ selectedDigit: 0 }));
    expect(root.querySelectorAll('.selected-digit')).toHaveLength(0);
  });
});

describe('a board that cannot be edited', () => {
  it('dims the whole pad and stops every key responding', () => {
    keypad.render(view({ disabled: true }));
    expect(root.classList.contains('is-disabled')).toBe(true);
    expect(keyFor(3).getAttribute('aria-disabled')).toBe('true');
    keyFor(3).click();
    expect(onDigit).not.toHaveBeenCalled();
  });

  it('answers again once the board comes back', () => {
    keypad.render(view({ disabled: true }));
    keypad.render(view({ disabled: false }));
    expect(root.classList.contains('is-disabled')).toBe(false);
    expect(keyFor(3).getAttribute('aria-disabled')).toBe('false');
    keyFor(3).click();
    expect(onDigit).toHaveBeenCalledWith(3);
  });

  it('leaves the keys in place, as a fully placed digit does', () => {
    keypad.render(view({ disabled: true }));
    expect(root.querySelectorAll('.key')).toHaveLength(9);
  });
});
