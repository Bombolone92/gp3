import { expect, it } from 'vitest';
import { calc } from './helpers/calc.js';

// CONVERT spells squared and cubed units both as "m2" and as "m^2".
it('reads a caret power the same as a bare digit', () => {
  expect(calc('CONVERT(1,"m^3","l")')).toBeCloseTo(1000, 9);
  expect(calc('CONVERT(1,"ft^2","in^2")')).toBeCloseTo(144, 9);
  expect(calc('CONVERT(1,"ang^2","m^2")')).toBeCloseTo(1e-20, 30);
  expect(calc('CONVERT(1,"ly^3","m^3")')).toBe(calc('CONVERT(1,"ly3","m3")'));
  expect(calc('CONVERT(1,"km^2","m2")')).toBeCloseTo(1e6, 6);
  expect(calc('CONVERT(2,"m2","m^2")')).toBe(2);
  expect(calc('CONVERT(1,"Pica^3","Picapt3")')).toBeCloseTo(1, 12);
});

it('keeps rejecting unknown units and carets elsewhere', () => {
  expect(calc('CONVERT(1,"m^4","m4")')).toEqual({ error: '#N/A' });
  expect(calc('CONVERT(1,"^2","m2")')).toEqual({ error: '#N/A' });
  expect(calc('CONVERT(1,"m^2","l")')).toEqual({ error: '#N/A' });
});
