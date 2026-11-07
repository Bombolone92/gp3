// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { parseInput, parseDate, parseTime, typedDecimals, setLocale, ymdToSerial } from '../src/core/format.js';
import { Workbook } from '../src/core/workbook.js';
import { parseHtmlClipboard, cellsFromHtmlRows, cellsToHtml } from '../src/core/clipboard.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { calc } from './helpers/calc.js';
import native from './fixtures/reference-numeric-input-digits.json';

afterEach(() => setLocale('en-US'));
const literal = text => `"${text.replaceAll('"', '""')}"`;
const pasted = html => cellsFromHtmlRows(parseHtmlClipboard(html).rows).map(x => x.cell);
const localize = text => text.replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[d]);

it('matches native numeric inference and coercion across supported and unsupported Unicode alphabets', () => {
  expect(native.alphabets).toHaveLength(83);
  const html = pasted(`<table>${native.alphabets.map(x => `<tr><td>${x.text}</td></tr>`).join('')}</table>`);
  for (const [i, row] of native.alphabets.entries()) {
    expect(parseInput(row.text).v, row.text).toEqual(row.html);
    expect(html[i].v, row.text).toEqual(row.html);
    expect(calc(`VALUE(${literal(row.text)})`), row.text).toEqual(row.value);
    expect(calc(`NUMBERVALUE(${literal(row.text)})`), row.text).toEqual(row.numbervalue);
    expect(calc(`${literal(row.text)}+0`), row.text).toEqual(row.arithmetic);
  }
  for (const row of native.allDigits) {
    expect(calc(`VALUE(${literal(row.text)})`), row.text).toEqual(row.value);
    expect(calc(`NUMBERVALUE(${literal(row.text)})`), row.text).toEqual(row.numbervalue);
  }
  for (const row of native.boundaries) {
    expect(parseInput(row.text).v).toEqual(row.html);
    expect(pasted(`<table><tr><td>${row.text}</td></tr></table>`)[0].v).toEqual(row.html);
    expect(calc(`VALUE(${literal(row.text)})`)).toEqual(row.value);
  }
});

it('applies existing numeric and date syntax consistently without transforming unparsed text', () => {
  for (const row of native.syntax) {
    // Native paired controls establish that the supported digits do not alter
    // syntax, independently of the machine's configured date grammar.
    expect(row.value).toEqual(row.asciiValue);
    expect(row.numbervalue).toEqual(row.asciiNumbervalue);
    const ascii = parseInput(row.ascii), actual = parseInput(row.text);
    expect(actual).toEqual(typeof ascii.v === 'string' ? { ...ascii, v: row.text } : ascii);
    for (const fn of ['VALUE', 'NUMBERVALUE', 'DATEVALUE', 'TIMEVALUE']) {
      expect(calc(`${fn}(${literal(row.text)})`), `${fn}: ${row.text}`).toEqual(calc(`${fn}(${literal(row.ascii)})`));
    }
  }
  for (const locale of ['en-US', 'de-DE', 'fr-FR', 'en-IN', 'ja-JP']) {
    setLocale(locale);
    for (const ascii of ['12.5%', '12,5%', '1.234,56', '1,234.56', '12,34,567.5', '1 234,50 €', '2024-02-29 12:34:56']) {
      const expected = parseInput(ascii), text = localize(ascii);
      expect(parseInput(text)).toEqual(typeof expected.v === 'string' ? { ...expected, v: text } : expected);
      expect(typedDecimals(text)).toBe(typedDecimals(ascii));
      expect(calc(`VALUE(${literal(text)})`)).toEqual(calc(`VALUE(${literal(ascii)})`));
    }
  }
  expect(parseDate('٢٠٢٤-٠٢-٢٩').serial).toBe(ymdToSerial(2024, 2, 29));
  expect(parseTime('١٢:٣٤:٥٦')).toBe(parseTime('12:34:56'));
  expect(parseTime('٢٥:٣٠', { elapsed: true })).toBe(1.0625);
  for (const ascii of ['1e400', '1e-400', '0.0000000000000001', '-1.25e100']) {
    for (const fn of ['VALUE', 'TEXT']) {
      const tail = fn === 'TEXT' ? ',"0.00"' : '';
      const expected = calc(`${fn}(${literal(ascii)}${tail})`);
      expect(calc(`${fn}(${literal(localize(ascii))}${tail})`)).toEqual(expected === ascii ? localize(ascii) : expected);
    }
  }
});

it('respects NUMBERVALUE separators before converting digits', () => {
  for (const row of native.separators) expect(calc(row.formula.replace(/^_xlfn\./, ''))).toBe(row.value);
  expect(calc('NUMBERVALUE("١٬٢٣٤٫٥٦","٫","٬")')).toBe(1234.56);
  expect(calc('NUMBERVALUE("١٢٣٤,٥٦",",",".")')).toBe(1234.56);
  expect(calc('NUMBERVALUE("١٢٣","٢",",")')).toBe(1.3);
  expect(calc('NUMBERVALUE("١٢٣",".","٢")')).toBe(13);
  expect(calc('NUMBERVALUE("١٫٢٬٣","٫","٬")')).toEqual({ error: '#VALUE!' });
});

it('preserves explicit text, raw clipboard types, formulas and malformed input', () => {
  const text = '١٢٣٤.٥٦';
  for (const input of [' ١٢٣abc ', '١٢٣٤٫٥٦', '一二三', '１２３', '²³', '①②']) expect(parseInput(input).v).toBe(input);
  // The supported digits are recognized inside typed error spellings too.
  expect(parseInput('#DIV/٠!').v).toEqual({ error: '#DIV/0!' });
  expect(pasted('<table><tr><td>#DIV/०!</td><td x:str>#DIV/٠!</td></tr></table>').map(c => c.v))
    .toEqual([{ error: '#DIV/0!' }, '#DIV/٠!']);
  expect(parseInput(`'${text}`)).toEqual({ v: text, f: null, fmt: 'text' });
  expect(parseInput('="١٢٣"')).toEqual({ v: null, f: '"١٢٣"', fmt: null });
  const cells = pasted(`<table><tr><td x:str>${text}</td><td style="mso-number-format:'@'">${text}</td><td x:num="42">${text}</td><td style="mso-number-format:'[$-2010409]0.00'">${text}</td></tr></table>`);
  expect(cells.map(c => c.v)).toEqual([text, text, 42, 1234.56]);
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.applyStyle(id, { r1: 0, r2: 0, c1: 0, c2: 0 }, { fmt: 'text' });
  wb.setInput(id, 0, 0, text);
  expect(wb.getValue(id, 0, 0)).toBe(text);
  wb.setInput(id, 1, 0, '١٢.٣%');
  expect(wb.getDisplay(id, 1, 0)).toBe('12.30%');
  wb.setInput(id, 2, 0, '١٢:٣٤:٥٦');
  expect(wb.getDisplay(id, 2, 0)).toContain('56');
});

it('preserves numeric values through edit, undo, HTML copy and XLSX export', async () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '١٢٣٤.٥٦');
  wb.applyStyle(id, { r1: 0, r2: 0, c1: 0, c2: 0 }, { fmt: 'custom', code: '[$-2010409]0.00' });
  wb.setInput(id, 0, 1, '=A1*2');
  wb.setInput(id, 0, 0, '१२.५');
  expect(wb.getValue(id, 0, 1)).toBe(25);
  wb.undo();
  expect(wb.getValue(id, 0, 1)).toBe(2469.12);
  const html = cellsToHtml([[wb.getDisplay(id, 0, 0)]], [[wb.getCell(id, 0, 0)]], null, [[1234.56]])
    .replace(/ data-spreadsheet-[\w-]+="[^"]*"/g, '');
  expect(pasted(html)[0].v).toBe(1234.56);
  const blob = await workbookToXlsx(wb);
  const bytes = await new Promise(resolve => { const r = new FileReader(); r.onload = () => resolve(new Uint8Array(r.result)); r.readAsArrayBuffer(blob); });
  const reopened = await workbookFromFile(bytes, 'digits.xlsx');
  expect(reopened.getValue(reopened.activeSheetId, 0, 0)).toBe(1234.56);
  expect(reopened.getValue(reopened.activeSheetId, 0, 1)).toBe(2469.12);
  expect(reopened.getDisplay(reopened.activeSheetId, 0, 0)).toBe('١٢٣٤.٥٦');
});
