import { it, expect } from 'vitest';
import { explainError } from '../src/core/errhelp.js';

// Any single letter is one edit away from N() and T(), so the #NAME? help
// used to suggest "the function N()" for every stray one-letter name.
it('does not offer a one-letter function for a short unknown name', () => {
  const text = explainError('#NAME?', 'LET(x,1,x+y)');
  expect(text).toContain('y is not a named range');
  expect(text).not.toMatch(/function [NT]\(\)/);
});

it('still suggests a function for a near-miss of a real name', () => {
  expect(explainError('#NAME?', 'SUMM(A1:A3)')).toMatch(/Did you mean SUM/);
});
