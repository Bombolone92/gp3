// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { el } from '../src/ui/dom.js';
import { openModal, closeAllModals } from '../src/ui/modal.js';

beforeEach(() => { vi.stubGlobal('matchMedia', () => ({ matches: true })); document.body.innerHTML = '<div id="app"></div>'; });
afterEach(() => { closeAllModals(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

// A dialog used to focus its first control even when that was an unchecked radio kept out
// of the tab order, so Tab jumped to Close and an arrow key silently changed the choice.
it('starts on the first control a Tab would reach', () => {
  const unchecked = el('button', { type: 'button', role: 'radio', 'aria-checked': 'false', tabindex: -1 }, 'Column');
  const checked = el('button', { type: 'button', role: 'radio', 'aria-checked': 'true', tabindex: 0 }, 'Pie');
  const disabled = el('button', { type: 'button', disabled: true }, 'Off');
  const input = el('input', { type: 'text' });
  openModal({ title: 'Chart', content: el('div', {}, unchecked, checked, disabled, input) });
  expect(document.activeElement).toBe(checked);
  closeAllModals();
  openModal({ title: 'Plain', content: el('div', {}, el('button', { type: 'button', tabindex: -1 }, 'skip'), input) });
  expect(document.activeElement).toBe(input);
});

// A dialog names the control it starts on; the screen-size guard that keeps a phone's keyboard down applies to it too.
it('starts on the named control on a large screen, and on the panel on a phone', () => {
  const first = el('input', { type: 'text', 'aria-label': 'First' });
  const named = el('input', { type: 'text', 'aria-label': 'Named' });
  openModal({ title: 'Named', content: el('div', {}, first, named), initialFocus: named });
  expect(document.activeElement).toBe(named);
  closeAllModals();
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  const { panel } = openModal({ title: 'Named', content: el('div', {}, first, named), initialFocus: named });
  expect(document.activeElement).toBe(panel);
});
