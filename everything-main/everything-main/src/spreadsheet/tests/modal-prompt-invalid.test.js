// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { promptDialog, closeAllModals } from '../src/ui/modal.js';

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(() => {
  closeAllModals();
  vi.runAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

// The field stayed marked invalid, with the message under it, after the value was corrected, and
// nothing tied the message to the field for a screen reader.
it('clears the invalid mark and the message once the value changes, and ties the message to the field', async () => {
  const answer = promptDialog({ title: 'Rename sheet', label: 'Name' });
  const input = document.querySelector('.modal-root input');
  const error = document.querySelector('.modal-root .field-error');
  expect(error.id).toBeTruthy();
  expect(input.getAttribute('aria-describedby')).toBe(error.id);
  document.querySelector('.modal-root form').requestSubmit();
  expect(error.hidden).toBe(false);
  expect(error.textContent).toBe('Enter a name');
  expect(input.getAttribute('aria-invalid')).toBe('true');
  input.value = 'Budget';
  input.dispatchEvent(new Event('input'));
  expect(error.hidden).toBe(true);
  expect(input.hasAttribute('aria-invalid')).toBe(false);
  document.querySelector('.modal-root form').requestSubmit();
  await expect(answer).resolves.toBe('Budget');
});

it.each([true, false])('validates and submits with trim=%s', async trim => {
  const validate = vi.fn(() => null);
  const answer = promptDialog({ title: 'Name', label: 'Name', trim, validate });
  document.querySelector('.modal-root input').value = '  Data  ';
  document.querySelector('.modal-root form').requestSubmit();
  const expected = trim ? 'Data' : '  Data  ';
  expect(validate).toHaveBeenCalledWith(expected);
  await expect(answer).resolves.toBe(expected);
});
