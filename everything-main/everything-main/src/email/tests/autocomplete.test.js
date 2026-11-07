import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openCompose } from '../src/ui/compose.js';

/**
 * Completing a recipient against the address book. The ranking itself is
 * covered in contacts.test.js; what is covered here is the field -- what makes
 * the list appear, what accepting one does to the chips, and the two things
 * that would make an autocomplete dangerous rather than useful: Enter meaning
 * something other than what was typed, and Escape closing the dialog instead
 * of the list.
 */

const BOOK = [
  { name: 'Ana Petrova', email: 'ana@meridianlabs.example', seconds: 500, written: true },
  { name: 'Sam Okafor', email: 'sam@meridianlabs.example', seconds: 400, written: true },
  { name: '', email: 'noreply@newsletter.example', seconds: 900, written: false },
];

const open = (over = {}) => openCompose({
  username: 'me',
  mailPath: '/me/.mail',
  prefill: {},
  contacts: () => BOOK,
  ...over,
});

const inputOf = (modal, field = 'to') => modal.panel.querySelector(`#compose-${field}`);
const listOf = (modal, field = 'to') => modal.panel.querySelector(`#compose-${field}-suggestions`);
const optionsOf = (modal, field) => [...listOf(modal, field).querySelectorAll('.suggestion')];
const offered = (modal, field) => optionsOf(modal, field)
  .map((node) => node.querySelector('.suggestion-address').textContent);
// The addresses the field holds. A chip *shows* the name the address book
// has for an address, so its label is not what it stands for; the address is.
const chipsOf = (modal, field = 'to') => [...modal.panel
  .querySelector(`#compose-${field}`).parentElement
  .querySelectorAll('.recipient-chip')].map((node) => node.dataset.address);
const chipLabels = (modal, field = 'to') => [...modal.panel
  .querySelector(`#compose-${field}`).parentElement
  .querySelectorAll('.recipient-chip .chip-name')].map((node) => node.textContent);

const type = (modal, text, field = 'to') => {
  const input = inputOf(modal, field);
  input.value = text;
  input.dispatchEvent(new Event('input'));
  return input;
};

const press = (modal, key, field = 'to') => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  inputOf(modal, field).dispatchEvent(event);
  return event;
};

let modal;

beforeEach(() => {
  globalThis.puter = { ui: {}, fs: {}, APIOrigin: 'https://api.example', authToken: 't' };
});

afterEach(() => {
  modal?.close(true);
  modal = null;
  document.querySelectorAll('.modal-root').forEach((node) => node.remove());
  document.getElementById('app')?.remove();
  delete globalThis.puter;
});

describe('completing a recipient', () => {
  it('offers nothing until something has been typed', () => {
    modal = open();
    // The dialog opens with To focused; a list over the form on every Compose
    // would be a lid, not a suggestion.
    expect(listOf(modal).hidden).toBe(true);
    expect(inputOf(modal).getAttribute('aria-expanded')).toBe('false');
  });

  it('offers what matches, best first', () => {
    modal = open();
    type(modal, 'meridian');
    expect(listOf(modal).hidden).toBe(false);
    expect(offered(modal)).toEqual(['ana@meridianlabs.example', 'sam@meridianlabs.example']);
  });

  it('shows the name beside the address, and the address alone without one', () => {
    modal = open();
    type(modal, 'a');
    const withName = optionsOf(modal)
      .find((node) => node.textContent.includes('ana@meridianlabs.example'));
    expect(withName.querySelector('.suggestion-name').textContent).toBe('Ana Petrova');
    const without = optionsOf(modal)
      .find((node) => node.textContent.includes('noreply@newsletter.example'));
    expect(without.querySelector('.suggestion-name')).toBeNull();
  });

  it('puts the list away again when nothing matches', () => {
    modal = open();
    type(modal, 'meridian');
    expect(listOf(modal).hidden).toBe(false);
    type(modal, 'zzzz');
    expect(listOf(modal).hidden).toBe(true);
  });

  it('offers nothing at all where there is no address book', () => {
    modal = open({ contacts: undefined });
    type(modal, 'ana');
    expect(listOf(modal).hidden).toBe(true);
  });

  it('does not offer someone the field already holds', () => {
    modal = open({ prefill: { to: 'ana@meridianlabs.example' } });
    type(modal, 'meridian');
    expect(offered(modal)).toEqual(['sam@meridianlabs.example']);
  });

  it('completes To and Cc separately', () => {
    modal = open();
    type(modal, 'meridian', 'cc');
    expect(listOf(modal, 'cc').hidden).toBe(false);
    expect(listOf(modal, 'to').hidden).toBe(true);
  });
});

describe('choosing one', () => {
  it('highlights nothing until an arrow key does', () => {
    modal = open();
    type(modal, 'meridian');
    expect(optionsOf(modal).some((node) => node.classList.contains('is-active'))).toBe(false);
    expect(inputOf(modal).hasAttribute('aria-activedescendant')).toBe(false);
  });

  it('enters what was typed on Enter, not what was offered', () => {
    modal = open();
    type(modal, 'meridian');
    // Two people match, and neither is what Enter means: nothing was
    // highlighted, so the field takes the text it was given -- which here is
    // not an address, and is marked as one that isn't rather than quietly
    // replaced by a guess.
    expect(offered(modal)).toHaveLength(2);
    press(modal, 'Enter');
    expect(chipsOf(modal)).toEqual(['meridian']);
  });

  it('walks the list with the arrow keys and takes one on Enter', () => {
    modal = open();
    type(modal, 'meridian');
    press(modal, 'ArrowDown');
    press(modal, 'ArrowDown');
    expect(inputOf(modal).getAttribute('aria-activedescendant'))
      .toBe('compose-to-suggestions-1');
    press(modal, 'Enter');
    expect(chipsOf(modal)).toEqual(['sam@meridianlabs.example']);
    expect(inputOf(modal).value).toBe('');
    expect(listOf(modal).hidden).toBe(true);
  });

  it('reaches the last one by arrowing up from nothing, and wraps', () => {
    modal = open();
    type(modal, 'meridian');
    press(modal, 'ArrowUp');
    expect(optionsOf(modal)[1].classList.contains('is-active')).toBe(true);
    press(modal, 'ArrowDown');
    expect(optionsOf(modal)[0].classList.contains('is-active')).toBe(true);
  });

  it('takes the highlighted one on Tab as well', () => {
    modal = open();
    type(modal, 'meridian');
    press(modal, 'ArrowDown');
    const event = press(modal, 'Tab');
    expect(event.defaultPrevented).toBe(true);
    expect(chipsOf(modal)).toEqual(['ana@meridianlabs.example']);
  });

  it('takes one on a click without the press blurring the field first', () => {
    modal = open();
    type(modal, 'meridian');
    const option = optionsOf(modal)[1];
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    option.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    option.click();
    expect(chipsOf(modal)).toEqual(['sam@meridianlabs.example']);
  });

  it('chips the bare address, which is what a draft stores', () => {
    modal = open();
    type(modal, 'ana');
    press(modal, 'ArrowDown');
    press(modal, 'Enter');
    // Not "Ana Petrova <ana@…>": the field has always held addresses, and the
    // name would only be parsed back off again. The chip *shows* the name,
    // because the book has one; what it holds is the address.
    expect(chipsOf(modal)).toEqual(['ana@meridianlabs.example']);
    expect(chipLabels(modal)).toEqual(['Ana Petrova']);
  });
});

describe('putting the list away', () => {
  it('closes the list on Escape, and leaves the dialog open', () => {
    modal = open();
    type(modal, 'meridian');
    const event = press(modal, 'Escape');
    expect(event.defaultPrevented).toBe(true);
    expect(listOf(modal).hidden).toBe(true);
    expect(document.querySelector('.modal-root')).not.toBeNull();
  });

  it('closes it when an address is entered by hand', () => {
    modal = open();
    type(modal, 'sam@meridianlabs.example');
    expect(listOf(modal).hidden).toBe(false);
    press(modal, 'Enter');
    expect(listOf(modal).hidden).toBe(true);
    expect(chipsOf(modal)).toEqual(['sam@meridianlabs.example']);
  });

  it('closes it when the field is left', () => {
    modal = open();
    type(modal, 'meridian');
    inputOf(modal).dispatchEvent(new FocusEvent('blur'));
    expect(listOf(modal).hidden).toBe(true);
  });
});
