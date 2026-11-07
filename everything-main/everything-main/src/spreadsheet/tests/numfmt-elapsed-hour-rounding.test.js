import { expect, it } from 'vitest';
import { formatWithCode } from '../src/core/numfmt.js';

// Controls measured in desktop Excel at the seven adjacent doubles around each half-second
// boundary. The observed carry offset is independent reference data; these
// tests do not calculate their expectation with the formatter's arithmetic.
const bits = new DataView(new ArrayBuffer(8));
const adjacent = (value, offset) => {
  bits.setFloat64(0, value);
  bits.setBigUint64(0, bits.getBigUint64(0) + BigInt(offset));
  return bits.getFloat64(0);
};
it.each([
  [0, 3599.5, 0, -1], [0, 43199.5, 11, 0], [0, 86399.5, 23, 0],
  [2, 3599.5, 48, -1], [2, 43199.5, 59, 0], [2, 86399.5, 71, 0],
  [45000, 3599.5, 1080000, 0], [45000, 43199.5, 1080011, 0], [45000, 86399.5, 1080023, 0],
  [2958465, 3599.5, 71003160, -1], [2958465, 43199.5, 71003171, 0], [2958465, 86399.5, 71003183, 0],
])('rounds elapsed hours at day %s plus %s seconds', (day, seconds, lower, carryOffset) => {
  for (let offset = -3; offset <= 3; offset++) {
    const value = adjacent(day + seconds / 86400, offset);
    const expected = String(lower + (offset >= carryOffset ? 1 : 0));
    expect(formatWithCode(value, '[h]')).toBe(expected);
    expect(formatWithCode(value, '[h] h')).toBe(`${expected} ${expected}`);
  }
});
it.each([
  [86399 / 86400, '23:59'], [3599.49 / 86400, '0:59'],
  [2 + 3599.4999 / 86400, '48:59'], [45000 + 3599.4999 / 86400, '1080000:59'],
  [45000 + 3599.5 / 86400, '1080001:59'],
  [2 + 86399.5 / 86400, '72:00'],
])('keeps the native clock remainder alongside rounded hours for %s', (value, expected) => {
  expect(formatWithCode(value, '[h]:mm')).toBe(expected);
});
