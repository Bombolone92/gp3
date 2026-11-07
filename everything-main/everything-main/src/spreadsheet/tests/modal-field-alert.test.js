// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { el } from '../src/ui/dom.js';
import { fieldAlert } from '../src/ui/modal.js';

afterEach(() => { document.body.replaceChildren(); });

function form() {
  const { alert, refuse, clear } = fieldAlert('t');
  const name = el('input.input', { type: 'text', 'aria-label': 'Name' });
  const ref = el('input.input', { type: 'text', 'aria-label': 'Refers to' });
  const node = el('form', {}, name, ref, alert, el('button', { type: 'submit' }, 'Save'));
  document.body.append(node);
  return { alert, refuse, clear, name, ref };
}

// A refusal shown as text alone leaves a screen reader with no way to find which field is at fault and
// a keyboard user on the Save button. The helper marks the field, ties the message to it and focuses it.
it('shows the message, marks and describes the field, focuses it, and answers false for the submit handler', () => {
  const { alert, refuse, name } = form();
  expect(alert.hidden).toBe(true);
  expect(alert.id).toBeTruthy();
  expect(refuse(name, 'Enter a name')).toBe(false);
  expect(alert.hidden).toBe(false);
  expect(alert.textContent).toBe('Enter a name');
  expect(name.getAttribute('aria-invalid')).toBe('true');
  expect(name.getAttribute('aria-describedby')).toBe(alert.id);
  expect(document.activeElement).toBe(name);
});

it('takes the mark and the message off once that field\'s value changes, and moves the mark with a later refusal', () => {
  const { alert, refuse, name, ref } = form();
  refuse(name, 'Enter a name');
  ref.dispatchEvent(new Event('input', { bubbles: true })); // another field: the refusal stands
  expect(alert.hidden).toBe(false);
  expect(name.getAttribute('aria-invalid')).toBe('true');
  name.value = 'Sales';
  name.dispatchEvent(new Event('input', { bubbles: true }));
  expect(alert.hidden).toBe(true);
  expect(name.hasAttribute('aria-invalid')).toBe(false);
  expect(name.hasAttribute('aria-describedby')).toBe(false);
  refuse(name, 'That name is already used');
  refuse(ref, 'Enter a reference');
  expect([...document.querySelectorAll('[aria-invalid="true"]')]).toEqual([ref]);
  expect(name.hasAttribute('aria-describedby')).toBe(false);
  expect(document.activeElement).toBe(ref);
});

it('lets a field that judges its value as it is typed show its own message after the clearing', () => {
  const { alert, refuse, name } = form();
  name.addEventListener('input', () => { if (!name.value) refuse(name, 'Enter a name', { focus: false }); });
  refuse(name, 'Enter a name');
  name.dispatchEvent(new Event('input', { bubbles: true })); // still empty: the live check speaks again
  expect(alert.hidden).toBe(false);
  expect(name.getAttribute('aria-invalid')).toBe('true');
  name.value = 'Sales';
  name.dispatchEvent(new Event('input', { bubbles: true }));
  expect(alert.hidden).toBe(true);
  expect(name.hasAttribute('aria-invalid')).toBe(false);
});

it('shows a message with no field to blame, taking the mark off the last one, and clear() resets by hand', () => {
  const { alert, refuse, clear, name } = form();
  refuse(name, 'Enter a name');
  refuse(null, 'This sheet is protected');
  expect(alert.textContent).toBe('This sheet is protected');
  expect(alert.hidden).toBe(false);
  expect(name.hasAttribute('aria-invalid')).toBe(false);
  refuse(name, 'Enter a name');
  clear();
  expect(alert.hidden).toBe(true);
  expect(name.hasAttribute('aria-invalid')).toBe(false);
  expect(name.hasAttribute('aria-describedby')).toBe(false);
});
