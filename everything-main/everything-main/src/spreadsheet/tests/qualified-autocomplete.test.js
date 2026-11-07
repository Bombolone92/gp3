// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { completionContext } from '../src/core/formula/hints.js';
import { createFormulaHints } from '../src/ui/autocomplete.js';

const rect = { left: 0, top: 0, right: 100, bottom: 20, width: 100, height: 20 };
function setup() {
  const host = document.createElement('div'); document.body.replaceChildren(host);
  const accepted = [], extraNames = vi.fn((sheet) => sheet === 'Two Data' ? ['Rate', 'Rate2026', 'SORT']
    : sheet === "O'Brien" || sheet === 'A"B' || sheet === 'A!B' ? ['Rate'] : sheet ? [] : ['CurrentOnly']);
  const hints = createFormulaHints({ host, extraNames, extraSheets: () => ['Two Data', 'RateSheet'], extraTables: () => ['RateTable'], onAccept: (a) => accepted.push(a) });
  return { host, hints, accepted, extraNames };
}

it.each([
  ["='Two Data'!Ra", 'Two Data', 'Ra'], ["='O''Brien'!Ra", "O'Brien", 'Ra'],
  ['=A1!Ra', 'A1', 'Ra'], ['=SUM(Two!Ra', 'Two', 'Ra'], ["='A!B'!Ra", 'A!B', 'Ra'],
  ["='A\"B'!Ra", 'A"B', 'Ra'], ["='Two Data'!Rate2", 'Two Data', 'Rate2'],
  ["='Two Data'!", 'Two Data', ''],
])('recognizes a qualified completion in %s', (text, sheet, prefix) => {
  expect(completionContext(text)).toEqual({ kind: 'name', sheet, prefix, start: text.length - prefix.length });
});

it('offers only matching names from the indicated sheet', () => {
  const { host, hints, extraNames } = setup();
  const text = "='Two Data'!Ra";
  hints.update(text, text.length, rect);
  expect([...host.querySelectorAll('.fx-name')].map((n) => n.textContent)).toEqual(['Rate', 'Rate2026']);
  expect(extraNames).toHaveBeenCalledWith('Two Data');
  expect([...host.querySelectorAll('.fx-desc')].map((n) => n.textContent)).toEqual(['Named range', 'Named range']);
});

it.each([
  ["='Two Data'!RaOld+1", 14, "='Two Data'!Rate+1"],
  ["='O''Brien'!Ra", 13, "='O''Brien'!Rate"],
  ["='Two Data'!SO(A1)", 14, "='Two Data'!SORT(A1)"],
  ["='Two Data'!SORTold(A1)", 16, "='Two Data'!SORT(A1)"],
])('replaces only the qualified name token in %s', (text, caret, expected) => {
  const { hints, accepted } = setup();
  hints.update(text, caret, rect);
  expect(hints.handleKey(new KeyboardEvent('keydown', { key: 'Tab', cancelable: true }))).toBe(true);
  const a = accepted[0];
  expect(text.slice(0, a.start) + a.text + text.slice(a.end)).toBe(expected);
});

it('accepts a qualified name with the pointer and maintains input accessibility', () => {
  const { host, hints, accepted } = setup(), input = document.createElement('textarea');
  host.append(input);
  const text = "='Two Data'!Rate2";
  hints.update(text, text.length, rect, input);
  expect(input.getAttribute('aria-autocomplete')).toBe('list');
  expect(document.getElementById(input.getAttribute('aria-activedescendant'))?.textContent).toContain('Rate2026');
  host.querySelector('.fx-item').dispatchEvent(new Event('pointerdown', { bubbles: true, cancelable: true }));
  expect(accepted[0].text).toBe('Rate2026');
  expect(input.hasAttribute('aria-activedescendant')).toBe(false);
});

it.each(['=Missing!RA', "='Two Data'!XLOOK", "='Two Data'!SORT(", "='Two Data'!A1", '=SUM("Two!Ra'])('does not show misleading suggestions for %s', (text) => {
  const { hints } = setup(); hints.update(text, text.length, rect);
  expect(hints.isOpen).toBe(false);
});

it('keeps built-in argument hints and caller-scope completion inside qualified calls', () => {
  const { host, hints } = setup();
  let text = "='Two Data'!SORT(SUM(";
  hints.update(text, text.length, rect); expect(host.querySelector('.fx-signature')?.textContent).toContain('SUM(');
  text = "='Two Data'!SORT(Current";
  hints.update(text, text.length, rect); expect(host.querySelector('.fx-name')?.textContent).toBe('CurrentOnly');
});
