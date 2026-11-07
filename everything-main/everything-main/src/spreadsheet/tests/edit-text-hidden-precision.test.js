import { describe, it, expect } from 'vitest';
import { editText, parseInput, setLocale } from '../src/core/format.js';

// Opening a cell and pressing Enter must never change its value. A date cell
// that secretly holds a time of day, or a time cell holding more than a day,
// used to be shown as readable text that read back as a different number.
describe('edit text for date and time formats with hidden precision', () => {
  it('shows readable text when it reads back exactly', () => {
    setLocale('en-US');
    expect(editText({ v: 45355, s: { fmt: 'date' } })).toBe('2024-03-04');
    expect(editText({ v: 0.5, s: { fmt: 'time' } })).toBe('12:00:00');
    expect(editText({ v: 45355.5, s: { fmt: 'datetime' } })).toBe('2024-03-04 12:00:00');
    expect(editText({ v: 0.07, s: { fmt: 'percent' } })).toBe('7%');
  });

  it.each([
    [{ v: 45355.5, s: { fmt: 'date' } }, '45355.5'],
    [{ v: 1.5, s: { fmt: 'time' } }, '1.5'],
    [{ v: 45355.500004629626, s: { fmt: 'datetime' } }, '45355.5000046296'], // 15 significant digits, as the formula bar shows numbers
  ])('falls back to the serial when the text would lose part of %o', (cell, expected) => {
    setLocale('en-US');
    const text = editText(cell);
    expect(text).toBe(expected);
    expect(parseInput(text).v).toBeCloseTo(cell.v, 9);
  });

  it('still shows readable text when the value only differs by floating-point noise', () => {
    setLocale('en-US');
    expect(editText({ v: 13 / 24 + 1e-15, s: { fmt: 'time' } })).toBe('13:00:00');
    expect(editText({ v: 45355 + 13 / 24 - 1e-12, s: { fmt: 'datetime' } })).toBe('2024-03-04 13:00:00');
  });
});
