// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { createFormulaHints } from '../src/ui/autocomplete.js';

afterEach(() => { document.body.replaceChildren(); });

const rect = { left: 0, top: 0, right: 100, bottom: 20, width: 100, height: 20 };

/** The signature hint's parameters for `text` with the caret at its end, and which one is current. */
function signature(text) {
  const host = document.createElement('div');
  document.body.replaceChildren(host);
  const hints = createFormulaHints({ host, onAccept() {} });
  hints.update(text, text.length, rect);
  const args = [...host.querySelectorAll('.fx-arg')];
  return { params: args.map((n) => n.textContent), current: args.find((n) => n.classList.contains('current'))?.textContent };
}

// A parameter written as lambda(accumulator, value) was split at its own comma, so the hint showed
// "[lambda(accumulator" and "value)" as two parameters and pointed at the wrong one.
it('keeps a parameter whose description holds commas inside parentheses or brackets in one piece', () => {
  expect(signature('=REDUCE(0,A1:A3,')).toEqual({ params: ['initial_value', 'array', 'lambda(accumulator, value)'], current: 'lambda(accumulator, value)' });
  expect(signature('=MAKEARRAY(2,')).toEqual({ params: ['rows', 'columns', 'lambda(row, column)'], current: 'columns' });
  expect(signature('=LET(x,1,')).toEqual({ params: ['name1', 'value1', '[name2, value2]', '...', 'result'], current: '[name2, value2]' });
  expect(signature('=IFS(A1>1,"a",')).toEqual({ params: ['condition1', 'value1', '[condition2, value2]', '...'], current: '[condition2, value2]' });
});
