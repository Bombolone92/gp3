// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { createFormulaHints } from '../src/ui/autocomplete.js';

function make(extra = {}) {
  const host = document.createElement('div');
  document.body.replaceChildren(host);
  const accepted = [];
  const hints = createFormulaHints({ host, onAccept: (a) => accepted.push(a), ...extra });
  return { host, hints, accepted };
}
const rect = { left: 0, top: 0, right: 100, bottom: 20, width: 100, height: 20 };

describe('formula autocomplete', () => {
  it('offers sheet names and inserts them with the ! separator, quoted when needed', () => {
    const { host, hints, accepted } = make({ extraSheets: () => ['Expenses', 'Q1 data'], extraNames: () => ['Rate'] });
    hints.update('=SUM(Exp', 8, rect);
    const items = [...host.querySelectorAll('.fx-item')].map((n) => n.querySelector('.fx-name').textContent);
    expect(items[0]).toBe('Expenses');
    expect(host.querySelector('.fx-item .fx-desc').textContent).toBe('Sheet');
    hints.handleKey(new KeyboardEvent('keydown', { key: 'Tab', cancelable: true }));
    expect(accepted[0]).toEqual({ start: 5, end: 8, text: 'Expenses!' });
    hints.update('=Q', 2, rect);
    hints.handleKey(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
    expect(accepted[1].text).toBe("'Q1 data'!");
    // Named ranges keep winning over a sheet of the same name, and functions still get their paren.
    const two = make({ extraSheets: () => ['Rate'], extraNames: () => ['Rate'] });
    two.hints.update('=Ra', 3, rect);
    two.hints.handleKey(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
    expect(two.accepted[0].text).toBe('Rate');
    const three = make({ extraSheets: () => ['Expenses'] });
    three.hints.update('=SU', 3, rect);
    three.hints.handleKey(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
    expect(three.accepted[0].text).toMatch(/^SU\w+\($/);
  });
});

it.each([
  ['Enter', { ctrlKey: true }], ['Enter', { metaKey: true }], ['Enter', { altKey: true }],
  ['Enter', { shiftKey: true }], ['Tab', { shiftKey: true }], ['ArrowDown', { shiftKey: true }],
  ['ArrowUp', { ctrlKey: true }],
])('does not consume modified %s meant for the editor', (key, modifiers) => {
  const { hints, accepted } = make();
  hints.update('=SU', 3, rect);
  const event = new KeyboardEvent('keydown', { key, ...modifiers, cancelable: true });
  expect(hints.handleKey(event)).toBe(false);
  expect(event.defaultPrevented).toBe(false);
  expect(accepted).toEqual([]);
});

it.each([
  ['=SUM(A1)', 3, '=SUM(A1)'],
  ['=SU(A1)+2', 3, '=SUM(A1)+2'],
  ['=SU (A1)', 3, '=SUM(A1)'],
])('replaces the complete function token without duplicating parentheses in %s', (text, caret, expected) => {
  const { hints, accepted } = make();
  hints.update(text, caret, rect);
  hints.handleKey(new KeyboardEvent('keydown', { key: 'Tab', cancelable: true }));
  const choice = accepted[0];
  expect(choice).toBeDefined();
  expect(text.slice(0, choice.start) + choice.text + text.slice(choice.end)).toBe(expected);
});

it.each([
  ['=Sales[Amount]', 9, '=Sales[Amount]'],
  ['=Sales[[Unit Price]]', 11, '=Sales[[Unit Price]]'],
])('does not duplicate the column suffix in %s', (text, caret, expected) => {
  const { hints, accepted } = make({ columnsFor: () => ['Amount', 'Unit Price'] });
  hints.update(text, caret, rect);
  hints.handleKey(new KeyboardEvent('keydown', { key: 'Tab', cancelable: true }));
  const choice = accepted[0];
  expect(choice).toBeDefined();
  expect(text.slice(0, choice.start) + choice.text + text.slice(choice.end)).toBe(expected);
});

it('associates keyboard suggestions with their input and clears the association on close', () => {
  const { host, hints } = make();
  const input = document.createElement('textarea');
  host.append(input);
  hints.update('=SU', 3, rect, input);
  expect(input.getAttribute('aria-controls')).toBe(hints.el.id);
  expect(hints.el.id).not.toBe('');
  const active = () => document.getElementById(input.getAttribute('aria-activedescendant'));
  expect(active()?.textContent).toContain('SUM');
  hints.handleKey(new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true }));
  expect(active()?.getAttribute('aria-selected')).toBe('true');
  expect(active()?.textContent).toContain('SUMIF');
  hints.close();
  expect(input.hasAttribute('aria-activedescendant')).toBe(false);
  expect(input.hasAttribute('aria-controls')).toBe(false);
});

it('keeps suggestions inside the grid when editing near its bottom edge', () => {
  const { host, hints } = make();
  host.getBoundingClientRect = () => ({ left: 0, top: 0, width: 500, height: 300 });
  Object.defineProperty(hints.el, 'offsetHeight', { configurable: true, value: 180 });
  Object.defineProperty(hints.el, 'offsetWidth', { configurable: true, value: 240 });
  hints.update('=SU', 3, { left: 20, top: 260, bottom: 280 });
  expect(parseFloat(hints.el.style.top)).toBeGreaterThanOrEqual(0);
  expect(parseFloat(hints.el.style.top) + 180).toBeLessThanOrEqual(300);
});
