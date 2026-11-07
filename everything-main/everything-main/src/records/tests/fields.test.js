import { describe, it, expect } from 'vitest';
import { toText, parseText, convertValue, summarize, splitList } from '../src/data/fields.js';
import { parseNumber, parseDate, formatDate, parseDuration, formatDuration, formatCurrency } from '../src/lib/format.js';
import { rollup } from '../src/data/compute.js';
import { prepare } from '../src/data/formula.js';
import { parseCSV, toCSV, detectDelimiter, parseTSV, toTSV } from '../src/lib/csv.js';

const fld = (type, options = {}) => ({ id: 'fldX', name: 'X', type, options });

describe('formatting and parsing', () => {
  it('numbers', () => {
    expect(parseNumber('1,234.5')).toBe(1234.5);
    expect(parseNumber('$-12')).toBe(-12);
    expect(parseNumber('(30)')).toBe(-30);
    expect(parseNumber('50%')).toBe(0.5);
    expect(parseNumber('abc')).toBeNull();
    expect(formatCurrency(-1234.5, '€', 2)).toBe('-€1,234.50');
  });

  it('durations', () => {
    expect(parseDuration('1:30')).toBe(5400);
    expect(parseDuration('1:30:15', 'h:mm:ss')).toBe(5415);
    expect(parseDuration('90')).toBe(5400);
    expect(parseDuration('1h 20m')).toBe(4800);
    expect(formatDuration(5415, 'h:mm:ss')).toBe('1:30:15');
    expect(formatDuration(5415)).toBe('1:30');
  });

  it('dates', () => {
    const now = new Date(2026, 9, 12);
    expect(parseDate('2026-02-03')).toBe('2026-02-03');
    expect(parseDate('2/3/2026')).toBe('2026-02-03');
    expect(parseDate('2/3/2026', { dateFormat: 'european' })).toBe('2026-03-02');
    expect(parseDate('March 5, 2026')).toBe('2026-03-05');
    expect(parseDate('5 Mar')).toBe(`${new Date().getFullYear()}-03-05`);
    expect(parseDate('tomorrow', { now })).toBe('2026-10-13');
    expect(parseDate('2/30/2026')).toBeNull();
    expect(parseDate('nonsense')).toBeNull();
    const withTime = parseDate('2026-02-03 3:30pm', { includeTime: true });
    expect(new Date(withTime).getHours()).toBe(15);
    expect(formatDate('2026-02-03', { dateFormat: 'friendly' })).toBe('February 3, 2026');
    expect(formatDate('2026-02-03', { dateFormat: 'iso' })).toBe('2026-02-03');
  });
});

describe('field values', () => {
  const choices = [{ id: 'selA', name: 'Alpha', color: 'blue' }, { id: 'selB', name: 'Beta', color: 'red' }];

  it('shows values as text', () => {
    expect(toText(fld('currency', { symbol: '$', precision: 2 }), 1234.5)).toBe('$1,234.50');
    expect(toText(fld('percent', { precision: 1 }), 0.125)).toBe('12.5%');
    expect(toText(fld('multipleSelect', { choices }), ['selB', 'selA'])).toBe('Beta, Alpha');
    expect(toText(fld('checkbox'), true)).toBe('checked');
  });

  it('reads typed text, adding new options', () => {
    let n = 0;
    const ctx = { makeChoice: (name) => ({ id: `selN${n++}`, name, color: 'gray' }) };
    expect(parseText(fld('singleSelect', { choices }), 'beta', ctx)).toEqual({ value: 'selB', newChoices: [] });
    const r = parseText(fld('multipleSelect', { choices }), 'Alpha, Gamma, gamma', ctx);
    expect(r.value).toEqual(['selA', 'selN0']);
    expect(r.newChoices.map((c) => c.name)).toEqual(['Gamma']);
    expect(parseText(fld('checkbox'), 'Yes')).toBe(true);
    expect(parseText(fld('number', { precision: 1 }), '3.14159')).toBe(3.1);
    expect(parseText(fld('rating', { max: 5 }), '9')).toBe(5);
    expect(parseText(fld('text'), 'a\nb')).toBe('a b');
  });

  it('converts between types', () => {
    expect(convertValue(fld('number'), fld('text'), 42)).toBe('42');
    expect(convertValue(fld('text'), fld('number'), '1,000')).toBe(1000);
    expect(convertValue(fld('checkbox'), fld('number'), true)).toBe(1);
    expect(convertValue(fld('number', { precision: 2 }), fld('rating', { max: 5 }), 3.6)).toBe(4);
  });

  it('summarizes', () => {
    expect(summarize('number', [1, 2, 3, null], 'sum')).toBe('6.00');
    expect(summarize('number', [1, 2, 3, 4], 'median', String)).toBe('2.5');
    expect(summarize('text', ['a', '', 'a', 'b'], 'unique')).toBe('2');
    expect(summarize('text', ['a', '', null, 'b'], 'percentEmpty')).toBe('50%');
    expect(summarize('checkbox', [true, false, true], 'checked')).toBe('2');
  });

  it('splits lists with quotes', () => {
    expect(splitList('a, "b, c", d')).toEqual(['a', 'b, c', 'd']);
  });
});

describe('numbers', () => {
  it('read commas only as digit grouping', () => {
    expect(parseNumber('1,234')).toBe(1234);
    expect(parseNumber('1,234,567.5')).toBe(1234567.5);
    expect(parseNumber('1,23,456')).toBe(123456);
    expect(parseNumber('$1,234.50')).toBe(1234.5);
    expect(parseNumber('1,5')).toBe(null);
    expect(parseNumber('2,25')).toBe(null);
    expect(parseNumber('1234')).toBe(1234);
  });

  it('read a minus sign before a currency symbol', () => {
    expect(parseNumber('-$5.00')).toBe(-5);
    expect(parseNumber('-$1,234.50')).toBe(-1234.5);
    expect(parseNumber('-€5')).toBe(-5);
    expect(parseNumber('$-5')).toBe(-5);
    expect(parseNumber('(-$5)')).toBe(5);
    expect(parseNumber(formatCurrency(-12.5, '$', 2))).toBe(-12.5);
  });
});

describe('number fields', () => {
  it('round negative halves as they are shown', () => {
    const f = { id: 'n', name: 'N', type: 'number', options: { precision: 0 } };
    expect(parseText(f, '-2.5')).toBe(-3);
    expect(parseText(f, '2.5')).toBe(3);
    expect(Object.is(parseText(f, '-0.4'), 0)).toBe(true);
  });
});

describe('numbers that round to zero', () => {
  it('show no minus sign', () => {
    expect(toText({ type: 'number', options: { precision: 0 } }, -0.4)).toBe('0');
    expect(toText({ type: 'percent', options: { precision: 0 } }, -0.001)).toBe('0%');
    expect(formatCurrency(-0.001, '$', 2)).toBe('$0.00');
    expect(formatDuration(-29)).toBe('0:00');
    expect(formatCurrency(-5, '$', 2)).toBe('-$5.00');
    expect(formatDuration(-90)).toBe('-0:02');
  });
});

describe('summaries of many values', () => {
  it('find the minimum and maximum of 200,000 numbers', () => {
    const xs = Array.from({ length: 200_000 }, (_, i) => i - 5);
    expect(summarize('number', xs, 'min')).toBe('-5.00');
    expect(summarize('number', xs, 'max')).toBe('199,994.00');
    expect(summarize('number', xs, 'range')).toBe('199,999.00');
    expect(rollup('min', xs)).toBe(-5);
    expect(rollup('max', xs)).toBe(199_994);
    const p = prepare('MAX({a}) - MIN({a})');
    expect(p.run({ get: () => xs, record: { id: 'r' }, now: () => new Date() })).toBe(199_999);
  });
});

describe('durations', () => {
  it('read plural units', () => {
    expect(parseDuration('45 mins')).toBe(2700);
    expect(parseDuration('10 secs', 'h:mm:ss')).toBe(10);
    expect(parseDuration('1 hr 30 mins')).toBe(5400);
    expect(parseDuration('1h 20m')).toBe(4800);
    expect(parseDuration('2 minutes 5 seconds', 'h:mm:ss')).toBe(125);
  });
});

describe('month names', () => {
  it('read two-digit years as spreadsheets do', () => {
    expect(parseDate('Mar 3, 24')).toBe('2024-03-03');
    expect(parseDate('3 March 24')).toBe('2024-03-03');
    expect(parseDate('Mar 3, 2024')).toBe('2024-03-03');
    expect(parseDate('Jan 5 99')).toBe('1999-01-05');
    expect(parseDate('1/5/99')).toBe('1999-01-05');
    expect(parseDate('3/3/24')).toBe('2024-03-03');
  });
});

describe('gmt dates', () => {
  it('a typed date without a time is midnight GMT', () => {
    const tz = process.env.TZ;
    process.env.TZ = 'Asia/Tokyo';
    try {
      const f = { id: 'f', name: 'At', type: 'date', options: { includeTime: true, gmt: true } };
      for (const t of ['1/5/2024', '2024-01-05', 'Jan 5 2024']) expect(parseText(f, t)).toBe('2024-01-05T00:00:00.000Z');
      expect(parseText(f, '1/5/2024 3pm')).toBe('2024-01-05T15:00:00.000Z');
    } finally {
      if (tz === undefined) delete process.env.TZ;
      else process.env.TZ = tz;
    }
  });
});

describe('csv', () => {
  it('parses quotes, newlines and delimiters', () => {
    const text = 'name,notes\r\n"Smith, J","line1\nline2"\nplain,"say ""hi"""';
    expect(parseCSV(text)).toEqual([['name', 'notes'], ['Smith, J', 'line1\nline2'], ['plain', 'say "hi"']]);
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';');
    expect(detectDelimiter('a\tb\n1\t2')).toBe('\t');
  });

  it('round-trips', () => {
    const rows = [['a', 'b,c'], ['"q"', 'x\ny']];
    expect(parseCSV(toCSV(rows))).toEqual(rows);
    expect(parseTSV(toTSV(rows))).toEqual(rows);
    expect(parseTSV('single value\n')).toEqual([['single value']]);
    // Spreadsheets copy cells that start with a quote without quoting them.
    expect(parseTSV('"Hello" world\tB\n')).toEqual([['"Hello" world', 'B']]);
    expect(parseTSV('"a"b" x\t"q"\n')).toEqual([['"a"b" x', 'q']]);
    // Files keep reading a quoted field followed by a space as quoted.
    expect(parseCSV('"Smith, John" ,42\n')).toEqual([['Smith, John ', '42']]);
    // An empty last row survives a copy.
    for (const r of [[['a'], ['b'], ['']], [['a'], ['']], [['a', 'b'], ['', '']]]) expect(parseTSV(toTSV(r))).toEqual(r);
    expect(parseTSV('a\r\nb\r\n\r\n')).toEqual([['a'], ['b'], ['']]);
  });
});
