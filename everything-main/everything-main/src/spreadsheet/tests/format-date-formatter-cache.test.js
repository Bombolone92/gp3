import { afterEach, expect, it, vi } from 'vitest';
import { formatValue, getLocale, setLocale } from '../src/core/format.js';

afterEach(() => vi.restoreAllMocks());

it('builds the Intl formatter for a medium or long date once per locale and style, not once per cell', () => {
  const Original = Intl.DateTimeFormat;
  const spy = vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function (...args) { return new Original(...args); });
  const out = [];
  for (let i = 0; i < 500; i++) out.push(formatValue(45000 + i, { fmt: 'date', dateStyle: 'long' }));
  for (let i = 0; i < 500; i++) out.push(formatValue(45000 + i, { fmt: 'date', dateStyle: 'medium' }));
  for (let i = 0; i < 500; i++) out.push(formatValue(45000 + i + 0.5, { fmt: 'datetime', dateStyle: 'medium' }));
  // At most one formatter per style: the same two the number formats already cache for.
  expect(spy.mock.calls.length).toBeLessThanOrEqual(2);
  expect(out[0]).toBe('March 15, 2023');
  expect(out[500]).toBe('Mar 15, 2023');
  expect(out[1000]).toBe('Mar 15, 2023 12:00');
});

it('keeps the cached formatter to its own locale', () => {
  const previous = getLocale();
  try {
    expect(formatValue(45000, { fmt: 'date', dateStyle: 'long' })).toBe('March 15, 2023');
    setLocale('de-DE');
    expect(formatValue(45000, { fmt: 'date', dateStyle: 'long' })).toBe('15. März 2023');
    setLocale('en-US');
    expect(formatValue(45000, { fmt: 'date', dateStyle: 'long' })).toBe('March 15, 2023');
  } finally { setLocale(previous); }
});
