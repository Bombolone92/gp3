// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { openValuePicker } from '../src/ui/listpicker.js';
import { closeMenu } from '../src/ui/menu.js';

afterEach(() => { closeMenu(); document.body.replaceChildren(); });

const anchor = { getBoundingClientRect: () => ({ left: 0, right: 100, top: 0, bottom: 26, width: 100, height: 26 }), setAttribute() {} };

function open(count, selected, extra = {}) {
  // Each open is a fresh picker: a second open on the same anchor while one is up would toggle it closed, as a click on its button does.
  closeMenu();
  const labels = Array.from({ length: count }, (_, i) => `Option ${i + 1}`);
  const asked = [];
  const picked = vi.fn();
  const menu = openValuePicker({
    anchor, labels,
    itemAt: (i) => { asked.push(i); return { label: labels[i], checked: i === selected, onSelect: () => picked(i) }; },
    ...extra,
  });
  return { menu, labels, asked, picked };
}

// The dropdown opened on its first option whatever the cell held; past 200
// options the cell's value was not even on the page shown.
it('opens a short list on the option the cell holds', () => {
  open(5, 3);
  expect(document.activeElement.textContent).toBe('Option 4');
  expect(document.activeElement.getAttribute('aria-checked')).toBe('true');
  document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  expect(document.activeElement.textContent).toBe('Option 5');
});

it('opens a short list without a held value on its first option', () => {
  open(5, -1);
  expect(document.activeElement.textContent).toBe('Option 1');
});

it('opens a long list on the page holding the cell\'s value, focused on it', () => {
  const { picked } = open(450, 320);
  expect(document.querySelector('[role="status"]').textContent).toBe('201–400 of 450 options');
  expect(document.activeElement.textContent).toBe('Option 321');
  expect(document.activeElement.getAttribute('aria-checked')).toBe('true');
  // Up from the first shown option still reaches the search box.
  const first = document.querySelector('.fn-list button');
  first.focus();
  first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
  expect(document.activeElement.getAttribute('aria-label')).toBe('Search list options');
  document.querySelector('[aria-checked="true"]').click();
  expect(picked).toHaveBeenCalledWith(320);
});

it('opens a long list without a held value on the search box and the first page', () => {
  open(450, -1);
  expect(document.activeElement.getAttribute('aria-label')).toBe('Search list options');
  expect(document.querySelector('[role="status"]').textContent).toBe('1–200 of 450 options');
});

it('uses a given current index without asking every option', () => {
  const { asked } = open(450, 320, { current: 320 });
  expect(document.activeElement.textContent).toBe('Option 321');
  expect(Math.min(...asked)).toBe(200); // only the shown page was built
  const none = open(450, -1, { current: -1 });
  expect(document.activeElement.getAttribute('aria-label')).toBe('Search list options');
  expect(none.asked).toHaveLength(200);
});
