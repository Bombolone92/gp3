import { expect, it } from 'vitest';
import { calc } from './helpers/calc.js';

// exp(lnΓ) carries only about 14 digits at these sizes; the running product
// COMBIN uses is exact while it fits and correctly rounded beyond.
it('MULTINOMIAL multiplies binomial coefficients instead of exponentiating log gammas', () => {
  // 45! / (15!)^3 = C(45,15) * C(30,15) = 344867425584 * 155117520 = 53494979785374631680 exactly
  expect(calc('MULTINOMIAL(15,15,15)')).toBe(53494979785374631680);
  expect(calc('MULTINOMIAL(2,3,4)')).toBe(1260);
  expect(calc('MULTINOMIAL(20,20)')).toBe(137846528820); // C(40,20)
  expect(calc('MULTINOMIAL(1,1,1,1,1,1,1,1,1,1)')).toBe(3628800); // 10!
  expect(calc('MULTINOMIAL(0,0)')).toBe(1);
  expect(calc('MULTINOMIAL(3.9,2.1)')).toBe(10); // arguments truncate: C(5,2)
  expect(calc('MULTINOMIAL(-1,2)')).toEqual({ error: '#NUM!' });
});

it('COMBINA is COMBIN(n+k-1,k) computed the same way', () => {
  // C(149,50) = 134191072731546215294934895873 * 10^11 to 30 digits: 1.34191072731546215294934895873E+40
  const v = calc('COMBINA(100,50)');
  expect(Math.abs(v / 1.34191072731546215e40 - 1)).toBeLessThan(1e-14);
  expect(calc('COMBINA(4,3)')).toBe(20);
  expect(calc('COMBINA(10,3)')).toBe(220);
  expect(calc('COMBINA(0,0)')).toBe(1);
  expect(calc('COMBINA(5,0)')).toBe(1);
  expect(calc('COMBINA(0,3)')).toEqual({ error: '#NUM!' });
  expect(calc('COMBINA(60,40)')).toBe(calc('COMBIN(99,40)'));
});
