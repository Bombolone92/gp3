// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { createFormulaHints } from '../src/ui/autocomplete.js';

function make(extra = {}) {
  const host = document.createElement('div');
  document.body.replaceChildren(host);
  const accepted = [];
  const hints = createFormulaHints({ host, onAccept: (a) => accepted.push(a), ...extra });
  return { host, hints, accepted };
}
const rect = { left: 0, top: 0, right: 100, bottom: 20, width: 100, height: 20 };
const enter = () => new KeyboardEvent('keydown', { key: 'Enter', cancelable: true });

// A fully typed mixed-case name kept a one-item list open, so Enter picked it again instead of committing the cell.
it.each(['=TotalQty', '=totalqty', '=TOTALQTY'])('closes the list once %s is typed in full', (text) => {
  const { hints, accepted } = make({ extraNames: () => ['TotalQty'] });
  hints.update(text, text.length, rect);
  expect(hints.isOpen).toBe(false);
  expect(hints.handleKey(enter())).toBe(false);
  expect(accepted).toEqual([]);
});

it('still offers the name while it is only partly typed', () => {
  const { host, hints, accepted } = make({ extraNames: () => ['TotalQty'] });
  hints.update('=totalq', 7, rect);
  expect(hints.isOpen).toBe(true);
  expect([...host.querySelectorAll('.fx-name')].map((n) => n.textContent)).toEqual(['TotalQty']);
  expect(hints.handleKey(enter())).toBe(true);
  expect(accepted[0]).toEqual({ start: 1, end: 7, text: 'TotalQty' });
});
