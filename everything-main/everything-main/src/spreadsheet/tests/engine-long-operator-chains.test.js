import { describe, expect, it } from 'vitest';
import { calc } from './helpers/calc.js';
import { parseFormula } from '../src/core/formula/parser.js';
import { astToText } from '../src/core/formula/print.js';
import { isVolatile } from '../src/core/formula/evaluator.js';

// A chain of operators parses left-deep, so 1+1+… with a couple of thousand terms, legal within
// the 8,192-character formula limit, recursed once per term and overflowed the stack into #ERROR!.
describe('long operator chains', () => {
  const chain = (term, op, n) => Array(n).fill(term).join(op);

  it('evaluate however many terms fit a formula', () => {
    expect(calc(chain('1', '+', 3000))).toBe(3000);
    expect(calc(chain('2', '*', 1000))).toBe(2 ** 1000);
    expect(calc(chain('1', '-', 2500))).toBe(1 - 2499);
    expect(calc(chain('"a"', '&', 2000).length > 8000 ? chain('"ab"', '&', 1500) : chain('"a"', '&', 2000))).toBe('a'.repeat(2000));
    expect(calc(`SUM(${chain('A1', '+', 2000)})`, { A1: '2' })).toBe(4000);
    expect(calc(chain('1', '+', 2000) + '=' + chain('2', '+', 1000))).toBe(true);
  });

  it('keep mixed precedence and parse, print and inspect without overflowing', () => {
    const mixed = Array.from({ length: 1200 }, (_, i) => (i % 2 ? '2*3' : '1')).join('+');
    expect(calc(mixed)).toBe(600 * 1 + 600 * 6);
    const text = chain('1', '+', 3000);
    expect(astToText(parseFormula(text))).toBe(text);
    expect(isVolatile(parseFormula(text))).toBe(false);
    expect(isVolatile(parseFormula(`${text}+RAND()`))).toBe(true);
  });
});
