import { describe, it, expect } from 'vitest';
import { parse, prepare, toDisplay, fromDisplay, inferKind, FormulaError } from '../src/data/formula.js';

const run = (src, fields = {}, record = { id: 'rec1', ct: 0, mt: 0 }) => {
  const p = prepare(src);
  if (p.error) throw new Error(p.error);
  return p.run({ get: (id) => fields[id], record, now: () => new Date(2026, 9, 12, 9, 30) });
};

describe('formula parser', () => {
  it('respects precedence', () => {
    expect(run('1 + 2 * 3')).toBe(7);
    expect(run('(1 + 2) * 3')).toBe(9);
    expect(run('-2 ^ 2'.replace('^', '*'))).toBe(-4);
    expect(run('10 - 4 - 3')).toBe(3);
    expect(run('"a" & 1 + 2')).toBe('a3');
    expect(run('1 + 1 = 2')).toBe(true);
    expect(run('50%')).toBe(0.5);
  });

  it('reads field references and string escapes', () => {
    expect(run('{a} & " " & {b}', { a: 'Ada', b: 'Lovelace' })).toBe('Ada Lovelace');
    expect(run('"say \\"hi\\""')).toBe('say "hi"');
  });

  it('reports useful errors', () => {
    expect(prepare('').error).toMatch(/empty/);
    expect(prepare('NOPE(1)').error).toMatch(/Unknown function/);
    expect(prepare('IF(1)').error).toMatch(/at least 2/);
    expect(prepare('1 +').error).toBeTruthy();
    expect(prepare('Status = 1').error).toMatch(/braces/);
    expect(() => parse('{a')).toThrow(FormulaError);
  });
});

describe('formula functions', () => {
  it('logic', () => {
    expect(run('IF({x} > 5, "big", "small")', { x: 9 })).toBe('big');
    expect(run('IF({x}, "y")', { x: '' })).toBe(null);
    expect(run('SWITCH({s}, "a", 1, "b", 2, 0)', { s: 'b' })).toBe(2);
    expect(run('SWITCH({s}, "a", 1, 0)', { s: 'z' })).toBe(0);
    expect(run('AND(1, "x", TRUE())')).toBe(true);
    expect(run('OR(0, "")')).toBe(false);
    expect(run('IFERROR(1/0, "oops")')).toBe('oops');
    expect(run('ISERROR(ERROR())')).toBe(true);
  });

  it('numbers', () => {
    expect(run('ROUND(2.345, 2)')).toBe(2.35);
    expect(run('ROUNDUP(2.301, 1)')).toBe(2.4);
    expect(run('ROUNDDOWN(-2.39, 1)')).toBe(-2.3);
    expect(run('MOD(-3, 5)')).toBe(2);
    expect(run('SUM({xs}, 4)', { xs: [1, 2, 3] })).toBe(10);
    expect(run('AVERAGE(2, 4)')).toBe(3);
    expect(run('MAX({xs})', { xs: [3, 9, 1] })).toBe(9);
    expect(run('COUNTA({xs})', { xs: ['a', '', null, 'b'] })).toBe(2);
    expect(() => run('1/0')).toThrow(/Division/);
  });

  it('text', () => {
    expect(run('UPPER(LEFT("hello", 2))')).toBe('HE');
    expect(run('MID("abcdef", 2, 3)')).toBe('bcd');
    expect(run('SUBSTITUTE("a-b-c", "-", "+")')).toBe('a+b+c');
    expect(run('SUBSTITUTE("abc", "b", "x", 0)')).toBe('abc');
    expect(run('SUBSTITUTE("abcb", "b", "x", 2)')).toBe('abcx');
    expect(run('SUBSTITUTE("a-b-c", "-", "+", 2)')).toBe('a-b+c');
    expect(run('TRIM("  a   b ")')).toBe('a b');
    expect(run('FIND("c", "abc")')).toBe(3);
    expect(run('REGEX_EXTRACT("order 123", "[0-9]+")')).toBe('123');
    expect(run('REGEX_MATCH("ABC", "(?i)abc")')).toBe(true);
    expect(run('REGEX_REPLACE("A-a", "(?i)a", "x")')).toBe('x-x');
    expect(run('REGEX_REPLACE("a1b2", "[0-9]", "")')).toBe('ab');
    expect(run('LEN({t})', { t: 'four' })).toBe(4);
  });

  it('dates', () => {
    expect(run('DATEADD("2026-01-31", 1, "month")')).toBe('2026-02-28');
    expect(run('DATEADD("2026-01-01", 10, "days")')).toBe('2026-01-11');
    expect(run('DATETIME_DIFF("2026-03-01", "2026-01-01", "days")')).toBe(59);
    expect(run('DATETIME_DIFF("2027-01-01", "2026-01-01", "months")')).toBe(12);
    expect(run('DATEADD("2024-01-31", 1, "M")')).toBe('2024-02-29');
    expect(run('DATETIME_DIFF("2024-05-15", "2024-01-15", "M")')).toBe(4);
    expect(run('DATETIME_DIFF("2024-02-29", "2024-01-31", "months")')).toBe(1);
    expect(run('DATETIME_DIFF("2024-02-28", "2024-01-31", "months")')).toBe(0);
    expect(run('DATETIME_DIFF("2024-03-14", "2024-01-15", "months")')).toBe(1);
    expect(run('DATETIME_DIFF("2024-01-31", "2024-02-29", "months")')).toBe(-1);
    expect(run('DATEADD("2024-01-31", 1, "hour")')).toMatch(/T/);
    expect(run('DATEADD("2024-01-31", 2, "w")')).toBe('2024-02-14');
    {
      const tz = process.env.TZ;
      process.env.TZ = 'America/New_York';
      try {
        // 2026-10-12T03:00Z is Oct 11, 11pm in New York.
        expect(run('{d} > TODAY()', { d: '2026-10-12T03:00:00.000Z' })).toBe(false);
        expect(run('"2024-01-05" < "2024-01-05T03:00:00.000Z"')).toBe(false);
      } finally {
        if (tz === undefined) delete process.env.TZ;
        else process.env.TZ = tz;
      }
    }
    expect(run('IS_SAME("2024-01-01", "2024-02-15", "quarter")')).toBe(true);
    expect(run('IS_SAME("2024-01-01", "2024-04-01", "quarter")')).toBe(false);
    expect(run('IS_SAME("2024-01-07", "2024-01-13", "week")')).toBe(true);
    expect(run('IS_SAME("2024-01-06", "2024-01-07", "week")')).toBe(false);
    expect(run('IS_SAME("2024-01-06T10:00:00.100Z", "2024-01-06T10:00:00.900Z", "second")')).toBe(true);
    expect(run('IS_SAME("2024-01-06", "2024-01-06", "d")')).toBe(true);
    expect(run('DATETIME_PARSE("05/01/2024", "DD/MM/YYYY")')).toBe(new Date(2024, 0, 5).toISOString());
    expect(run('DATETIME_PARSE("5 Jan 2024 3:30 pm", "D MMM YYYY h:mm a")')).toBe(new Date(2024, 0, 5, 15, 30).toISOString());
    expect(run('DATETIME_PARSE("2024.01.05", "YYYY.MM.DD")')).toBe(new Date(2024, 0, 5).toISOString());
    expect(run('DATETIME_PARSE("31/02/2024", "DD/MM/YYYY")')).toBe(null);
    expect(run('DATETIME_PARSE("2024-01-05")')).toBe(new Date(2024, 0, 5).toISOString());
    expect(run('DATETIME_FORMAT("2024-01-05", "Do MMMM")')).toBe('5th January');
    expect(run('DATETIME_FORMAT("2024-01-22", "Do")')).toBe('22nd');
    expect(run('DATETIME_FORMAT("2024-01-11", "Do")')).toBe('11th');
    expect(run('DATETIME_FORMAT("2024-05-05", "[Q]Q YYYY")')).toBe('Q2 2024');
    expect(run('DATETIME_FORMAT("2024-01-05", "LL")')).toBe('January 5, 2024');
    expect(run('DATETIME_FORMAT("2024-01-05", "L")')).toBe('01/05/2024');
    // Across a daylight saving change (in New York, 2024-03-10).
    const tz = process.env.TZ;
    process.env.TZ = 'America/New_York';
    try {
      expect(run('DATETIME_DIFF("2024-03-15", "2024-03-01", "days")')).toBe(14);
      expect(run('DATETIME_DIFF("2024-03-11", "2024-03-10", "days")')).toBe(1);
      expect(run('DATETIME_DIFF("2024-03-31", "2024-03-03", "weeks")')).toBe(4);
    } finally {
      if (tz === undefined) delete process.env.TZ;
      else process.env.TZ = tz;
    }
    expect(run('DATETIME_FORMAT("2026-10-12", "MMMM D, YYYY")')).toBe('October 12, 2026');
    expect(run('YEAR("2026-10-12")')).toBe(2026);
    expect(run('WEEKDAY("2026-10-12")')).toBe(1);
    expect(run('TODAY()')).toBe('2026-10-12');
    expect(run('WORKDAY("2026-10-09", 1)')).toBe('2026-10-12');
    expect(run('WORKDAY_DIFF("2026-10-12", "2026-10-16")')).toBe(5);
    expect(run('IS_BEFORE("2026-01-01", "2026-01-02")')).toBe(true);
    expect(run('IS_SAME("2026-01-01", "2026-01-31", "month")')).toBe(true);
  });

  it('arrays and records', () => {
    expect(run('ARRAYJOIN({xs}, "; ")', { xs: ['a', 'b'] })).toBe('a; b');
    expect(run('ARRAYUNIQUE({xs})', { xs: ['a', 'b', 'a'] })).toEqual(['a', 'b']);
    expect(run('ARRAYCOMPACT({xs})', { xs: ['a', '', null] })).toEqual(['a']);
    expect(run('RECORD_ID()')).toBe('rec1');
  });

  it('compares like a spreadsheet', () => {
    expect(run('{a} = 3', { a: '3' })).toBe(true);
    expect(run('{a} = ""', { a: null })).toBe(true);
    expect(run('{a} != "x"', { a: 'y' })).toBe(true);
    expect(run('"b" > "a"')).toBe(true);
    expect(run('"2026-02-01" > "2026-01-31"')).toBe(true);
  });
});

describe('field references by id', () => {
  const fields = [
    { id: 'fldAAAAAAAAAAAAAA', name: 'Price' },
    { id: 'fldBBBBBBBBBBBBBB', name: 'Qty' },
  ];
  it('round-trips names and ids', () => {
    const stored = fromDisplay('{Price} * {qty} & "{Price}"', fields);
    expect(stored).toBe('{fldAAAAAAAAAAAAAA} * {fldBBBBBBBBBBBBBB} & "{Price}"');
    expect(toDisplay(stored, fields)).toBe('{Price} * {Qty} & "{Price}"');
  });
  it('rejects unknown fields', () => {
    expect(() => fromDisplay('{Nope}', fields)).toThrow(/Unknown field/);
  });
  it('infers result kinds', () => {
    const kind = (src, k = 'number') => inferKind(parse(src), () => k);
    expect(kind('{a} * 2')).toBe('number');
    expect(kind('{a} & "x"')).toBe('text');
    expect(kind('IF({a} > 1, "x", "y")')).toBe('text');
    expect(kind('IF({a} > 1, 1, BLANK())')).toBe('number');
    expect(kind('DATEADD({a}, 1, "days")')).toBe('date');
    expect(kind('{a} > 1')).toBe('checkbox');
  });
});
