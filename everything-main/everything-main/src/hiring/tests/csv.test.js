import { describe, it, expect } from 'vitest';
import { fromCSVCell, parseCSV, parseCSVWithLines, toCSV } from '../src/lib/csv.js';

describe('parseCSV', () => {
  it('parses plain rows with LF and CRLF endings', () => {
    expect(parseCSV('a,b\nc,d')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
    expect(parseCSV('a,b\r\nc,d\r\n')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('honors quoted fields with commas, escaped quotes, and newlines', () => {
    expect(parseCSV('"Doe, Ada",x')).toEqual([['Doe, Ada', 'x']]);
    expect(parseCSV('"say ""hi""",x')).toEqual([['say "hi"', 'x']]);
    expect(parseCSV('"line1\nline2",x')).toEqual([['line1\nline2', 'x']]);
  });

  it('drops fully empty rows and handles empty input', () => {
    expect(parseCSV('a,b\n\n\nc,d\n')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
    expect(parseCSV('')).toEqual([]);
    expect(parseCSV(null)).toEqual([]);
  });

  it('keeps empty cells inside a row', () => {
    expect(parseCSV('a,,c')).toEqual([['a', '', 'c']]);
  });

  it('treats a quote inside an unquoted field as a literal character', () => {
    expect(parseCSV('Ada,He said "hi", then left')).toEqual([['Ada', 'He said "hi"', ' then left']]);
    expect(parseCSV('5" x 3",cm')).toEqual([['5" x 3"', 'cm']]);
  });
});

describe('parseCSVWithLines', () => {
  it('reports the source line each row starts on, past blanks and embedded newlines', () => {
    const text = 'Name,Email\n\nAda,a@x.io\n"multi\nline",b@x.io\nBob,c@x.io\n';
    expect(parseCSVWithLines(text).map((r) => [r.cells[0], r.line])).toEqual([
      ['Name', 1],
      ['Ada', 3],
      ['multi\nline', 4],
      ['Bob', 6],
    ]);
  });

  it('counts CRLF endings as single line breaks', () => {
    expect(parseCSVWithLines('a\r\n\r\nb\r\n').map((r) => r.line)).toEqual([1, 3]);
  });
});

describe('toCSV', () => {
  it('quotes only when needed and escapes quotes', () => {
    expect(toCSV([['plain', 'with,comma', 'with "quote"', 'line\nbreak']])).toBe(
      'plain,"with,comma","with ""quote""","line\nbreak"\r\n'
    );
  });

  it('neutralizes formula triggers so exports are inert in spreadsheets', () => {
    expect(toCSV([['=HYPERLINK("http://evil")', '@SUM(A1)', 'safe']])).toBe(
      '"\'=HYPERLINK(""http://evil"")",\'@SUM(A1),safe\r\n'
    );
    expect(toCSV([['+31 6 1234', '-lead']])).toBe("'+31 6 1234,'-lead\r\n");
  });

  it('round-trips through parseCSV', () => {
    const rows = [
      ['Name', 'Notes'],
      ['Doe, Ada', 'said "hello"\nand left'],
      ['Bob', ''],
    ];
    expect(parseCSV(toCSV(rows))).toEqual(rows);
  });

  it('round-trips formula-triggering values through fromCSVCell', () => {
    const rows = [['+31 6 1234', '=SUM(A1)', '-lead', '@handle']];
    expect(parseCSV(toCSV(rows))[0].map(fromCSVCell)).toEqual(rows[0]);
    // Only the exact escape shape is stripped; other apostrophes are data.
    expect(fromCSVCell("'plain")).toBe("'plain");
    expect(fromCSVCell('safe')).toBe('safe');
    expect(fromCSVCell(null)).toBe('');
  });
});
