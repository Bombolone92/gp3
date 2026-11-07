import { afterEach, expect, it } from 'vitest';
import { formatWithCode } from '../src/core/numfmt.js';
import { getLocale, setLocale } from '../src/core/format.js';
import { Workbook } from '../src/core/workbook.js';

const previous = getLocale();
afterEach(() => setLocale(previous));

const noonish = 0.5 + 9.457 / 86400; // 12:00:09.457

it.each([
  ['de-DE', 'h:mm:ss.00', '12:00:09,46'],
  ['de-DE', '[s].000', '43209,457'],
  ['de-DE', 'mm:ss.0', '00:09,5'],
  ['fr-FR', 'hh:mm:ss.000', '12:00:09,457'],
  ['pt-BR', 'h:mm:ss.00 AM/PM', '12:00:09,46 PM'],
  ['en-US', 'h:mm:ss.00', '12:00:09.46'],
  ['en-GB', 'h:mm:ss.00', '12:00:09.46'],
])('writes fractional seconds with the %s decimal mark in %s', (locale, code, expected) => {
  setLocale(locale);
  expect(formatWithCode(noonish, code)).toBe(expected);
});

it('leaves quoted periods literal while the fraction takes the locale mark', () => {
  setLocale('de-DE');
  expect(formatWithCode(noonish, 'ss.000".00"')).toBe('09,457.00');
  expect(formatWithCode(noonish, 'ss".0"')).toBe('09.0');
  expect(formatWithCode(noonish, 'h.mm.ss.0')).toBe('12.00.09,5');
});

it('shows the locale mark in cell display and TEXT', () => {
  setLocale('de-DE');
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, noonish, { literal: true });
  wb.applyStyle(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, { fmt: 'custom', code: 'hh:mm:ss.000' });
  wb.setInput(id, 0, 1, '=TEXT(A1,"hh:mm:ss.000")');
  expect(wb.getDisplay(id, 0, 0)).toBe('12:00:09,457');
  expect(wb.getValue(id, 0, 1)).toBe('12:00:09,457');
});
