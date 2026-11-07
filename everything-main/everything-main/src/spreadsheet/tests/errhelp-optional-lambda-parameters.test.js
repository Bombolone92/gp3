import { expect, it } from 'vitest';
import { explainError } from '../src/core/errhelp.js';

const lookup = { names: ['Total'], tables: [], hasSheet: () => true };

// An optional LAMBDA parameter, [b], is a bound name like any other: the #NAME? help
// must blame the unknown name in the body, not the parameter.
it('does not blame an optional LAMBDA parameter for a #NAME?', () => {
  expect(explainError('#NAME?', '=LAMBDA(a,[b],a+b+c)(1)', lookup)).toMatch(/^#NAME\?: c is not a named range/);
  expect(explainError('#NAME?', 'LAMBDA(a,[b],a+b+c)(1)', lookup)).not.toMatch(/\bb is not/);
  expect(explainError('#NAME?', 'LAMBDA(a, [b], a+b+Totl)(1)', lookup)).toMatch(/Totl is not a named range.*Did you mean Total/);
  expect(explainError('#NAME?', 'LET(f,LAMBDA(x,[step],x+step+missing),f(1))', lookup)).toMatch(/^#NAME\?: missing is not a named range/);
});

it('still reports the generic help when every name is bound', () => {
  expect(explainError('#NAME?', 'LAMBDA(a,[b],a+b)(1)', lookup)).toMatch(/^#NAME\?: Unknown function or name/);
});
