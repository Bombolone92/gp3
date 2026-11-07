import { expect, it } from 'vitest';
import { formatWithCode } from '../src/core/numfmt.js';
import { calcValues } from './helpers/calc.js';

const bits = new DataView(new ArrayBuffer(8));
const adjacent = (value, offset) => {
  bits.setFloat64(0, value);
  bits.setBigUint64(0, bits.getBigUint64(0) + BigInt(offset));
  return bits.getFloat64(0);
};
// Desktop Excel's observed carry offsets among seven adjacent doubles. A
// decimal clamp or a different multiplication order fails these controls.
it.each([
  [0, 0.5, 0, -3], [0, 59.5, 59, 0], [0, 3599.5, 3599, -1],
  [2, 0.5, 172800, -1], [2, 59.5, 172859, 0], [2, 3599.5, 176399, 0],
  [45000, 0.5, 3888000000, 0], [45000, 59.5, 3888000059, 0], [45000, 3599.5, 3888003599, 0],
  [2958465, 0.5, 255611376000, -2], [2958465, 59.5, 255611376059, -1], [2958465, 3599.5, 255611379599, -1],
])('rounds absolute totals at day %s plus %s seconds', (day, seconds, lower, carryOffset) => {
  for (let offset = -3; offset <= 3; offset++) {
    const value = adjacent(day + seconds / 86400, offset);
    const expected = lower + (offset >= carryOffset ? 1 : 0);
    expect(formatWithCode(value, '[s]')).toBe(String(expected));
    // Native minute controls for this set equal these integral minute totals.
    expect(formatWithCode(value, '[m]')).toBe(String(Math.floor(expected / 60)));
    expect(calcValues('TEXT(A1,B1)', {A1:value,B1:'[s]'})).toBe(String(expected));
  }
});

it.each([
  [30 / 86400, '[m]', '0'], [59.49 / 86400, '[m]', '0'],
  [59.5 / 86400, '[m]', '1'], [59.5 / 86400, '[s]', '60'],
  [59.5 / 86400, '[m]:ss', '1:59'],
  [2 + 12345.125 / 86400, '[m] m', '3085 1'],
  [45000 + 3599.5 / 86400, '[m]:ss', '64800060:59'],
  [2958465 + 59.4999 / 86400, '[m]', '4260189600'],
  [2958465 + 59.4999 / 86400, '[s]', '255611376059'],
  [2958465 + 86399.4999 / 86400, '[s]', '255611462399'],
  [2 + 12345.125 / 86400, '[s].000 s', '185145.125 10843199'],
])('formats %s with %s without rounding away real subsecond differences', (value, code, expected) => {
  expect(formatWithCode(value, code)).toBe(expected);
  expect(calcValues('TEXT(A1,B1)', {A1:value,B1:code})).toBe(expected);
});

// Fractional fields have their own clock remainder. At adjacent boundaries,
// the cumulative unit can carry before that remainder does.
it.each([
  [0.0006938657407407407, '[m].0', '1.9'],
  [0.0006938657407407407, '[s].0', '60.9'],
  [0.0006938657407407408, '[s].0', '60.0'],
  [45000.00069386573, '[s].0', '3888000059.9'],
  [45000.00069386574, '[m].0', '64800001.9'],
  [2958465.0006944383, '[m].000', '4260189600.999'],
  [2958465.000694439, '[m].000', '4260189601.999'],
  [2958465.000694439, '[s].000', '255611376060.999'],
  [2958465.0006944393, '[s].000', '255611376060.000'],
])('keeps native fractional boundaries for %s with %s', (value, code, expected) => {
  expect(formatWithCode(value, code)).toBe(expected);
  expect(calcValues('TEXT(A1,B1)', {A1:value,B1:code})).toBe(expected);
});
