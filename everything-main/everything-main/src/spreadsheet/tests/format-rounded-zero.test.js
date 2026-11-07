import { afterEach, expect, it } from 'vitest';
import { formatValue, setLocale, LOCALES } from '../src/core/format.js';
import { formatWithCode } from '../src/core/numfmt.js';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import * as X from '../src/vendor/xlsx.mjs';

afterEach(() => setLocale('en-US'));

it.each(['number', 'currency', 'percent'])('suppresses only an automatically signed rounded zero in %s', fmt => {
  for (const dec of [0, 2, 7, 20]) {
    const scale = 10 ** (dec + (fmt === 'percent' ? 2 : 0));
    const style = { fmt, dec, cur: 'USD', group: false };
    expect(formatValue(-.4 / scale, style)).toBe(formatValue(0, style));
    expect(formatValue(-.5 / scale, style)).not.toBe(formatValue(.5 / scale, style));
    expect(formatValue(-1.1 / scale, style)).not.toBe(formatValue(1.1 / scale, style));
    expect(formatValue(-Number.MIN_VALUE, style)).toBe(formatValue(0, style));
  }
});

it('lets localized currency and percentage rounding determine the sign', () => {
  for (const [locale] of LOCALES) {
    setLocale(locale);
    for (const style of [{ fmt: 'number', dec: 2 }, { fmt: 'percent', dec: 3 },
      { fmt: 'currency', cur: 'JPY' }, { fmt: 'currency', cur: 'KWD' }]) {
      expect(formatValue(-1e-12, style)).toBe(formatValue(0, style));
      expect(formatValue(-2, style)).not.toBe(formatValue(2, style));
    }
  }
});

const codes = [
  [-.004, '0.00', '0.00'], [-.005, '0.00', '-0.01'],
  [-.00004, '0.00%', '0.00%'], [-.00005, '0.00%', '-0.01%'],
  [-.0000004, '0.00%%', '0.00%%'], [-.0000005, '0.00%%', '-0.01%%'],
  [-4, '0.00,', '0.00'], [-5, '0.00,', '-0.01'],
  [-.004, '0.00" units"', '0.00 units'],
  [-.004, '"100 "0.00', '100 0.00'],
  [-.004, '0.00;[Red](0.00);"ZERO"', '(0.00)'],
  [-.004, '0.00;-0.00', '-0.00'],
  [-.004, '[<0]0.00;0.00', '0.00'],
  [-.004, '"negative"', '-negative'],
  [-1e-20, '0.00E+00', '-1.00E-20'],
  [-.001, '# ?/?', '-0    '], [-.001, '?/?', '0/1'],
  [-.001, '# ?/8', '-0    '], [-.001, '?/8', '0/8'],
  [-.0625, '?/8', '-1/8'], [-.001, '?/8;(?/8)', '(0/8)'],
];
it.each(codes)('formats native rounded-zero control %s with %s', (value, code, text) => {
  expect(formatWithCode(value, code)).toBe(text);
});

it('keeps scientific/general signs, and uses the same custom behavior in TEXT', () => {
  expect(formatValue(-1e-20, { fmt: 'scientific', dec: 2 })).toBe('-1.00E-20');
  expect(formatValue(-1e-20, {})).toBe('-1E-20');
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '-0.00004');
  wb.setInput(id, 0, 1, '=TEXT(A1,"0.00%")');
  expect(wb.getValue(id, 0, 1)).toBe('0.00%');
  expect(wb.getValue(id, 0, 0)).toBe(-.00004);
  wb.setInput(id, 0, 0, '-0.00005');
  expect(wb.getValue(id, 0, 1)).toBe('-0.01%');
  wb.undo();
  expect(wb.getValue(id, 0, 1)).toBe('0.00%');
});

it('preserves underlying negative values and native formats across XLSX export', async () => {
  const sheet = X.utils.aoa_to_sheet(codes.map(([v, z]) => [{ t: 'n', v, z }]));
  const source = X.utils.book_new(); X.utils.book_append_sheet(source, sheet, 'Values');
  const wb = await workbookFromFile(X.write(source, { type: 'array', bookType: 'xlsx' }), 'values.xlsx');
  const bytes = new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer());
  const raw = X.read(bytes, { type: 'array', cellNF: true });
  const zip = X.CFB.read(bytes, { type: 'array' }), part = X.CFB.find(zip, '/xl/workbook.xml');
  part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  part.size = part.content.length;
  const restored = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'external.xlsx');
  for (const [r, [value, code, text]] of codes.entries()) {
    expect(raw.Sheets.Values[`A${r + 1}`]).toMatchObject({ v: value, z: code });
    expect(restored.getValue(restored.activeSheetId, r, 0)).toBe(value);
    expect(restored.getDisplay(restored.activeSheetId, r, 0)).toBe(text);
  }
});
