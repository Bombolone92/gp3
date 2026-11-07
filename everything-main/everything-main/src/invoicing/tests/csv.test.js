import { describe, it, expect } from 'vitest';
import { parseCsv, guessDelimiter, headerProblem } from '../src/lib/csv.js';

describe('parseCsv', () => {
  it('reads a plain file', () => {
    const { header, rows } = parseCsv('Name,Email\nMaya,maya@example.com\nSam,sam@example.com\n');
    expect(header).toEqual(['Name', 'Email']);
    expect(rows).toEqual([['Maya', 'maya@example.com'], ['Sam', 'sam@example.com']]);
  });

  it('keeps commas and newlines inside quoted fields', () => {
    const { rows } = parseCsv('Name,Address\n"Doe, Jane","12 Pier St\nSeattle"\n');
    expect(rows).toEqual([['Doe, Jane', '12 Pier St\nSeattle']]);
  });

  it('reads a doubled quote as one quote', () => {
    expect(parseCsv('Name\n"She said ""hi"""\n').rows).toEqual([['She said "hi"']]);
  });

  it('swallows a BOM and CRLF endings', () => {
    const { header, rows } = parseCsv('﻿Name,Email\r\nMaya,maya@example.com\r\n');
    expect(header).toEqual(['Name', 'Email']);
    expect(rows).toEqual([['Maya', 'maya@example.com']]);
  });

  it('reads CR-only endings, as old exports use', () => {
    expect(parseCsv('Name\rMaya\rSam').rows).toEqual([['Maya'], ['Sam']]);
  });

  it('finds the delimiter a European export uses', () => {
    expect(guessDelimiter('Name;Total;Currency\n')).toBe(';');
    expect(guessDelimiter('Name\tTotal\n')).toBe('\t');
    expect(guessDelimiter('Name,Total\n')).toBe(',');
    // A comma inside a quoted header does not get a vote.
    expect(guessDelimiter('"Name, full";Total\n')).toBe(';');
  });

  it('keeps a quote inside an unquoted field as a literal character', () => {
    const { rows } = parseCsv('Item,Rate\nMonitor 27" 4K,350\nCable,12\n');
    expect(rows).toEqual([['Monitor 27" 4K', '350'], ['Cable', '12']]);
    // Spaces before an opening quote still leave the field quoted.
    expect(parseCsv('Name,Total\n "Doe, Jane",5\n').rows).toEqual([['Doe, Jane', '5']]);
  });

  it('pads a short row and trims a long one to the header', () => {
    const { rows } = parseCsv('A,B,C\n1,2\n1,2,3,4\n');
    expect(rows).toEqual([['1', '2', ''], ['1', '2', '3']]);
  });

  it('ignores a trailing newline rather than inventing an empty row', () => {
    expect(parseCsv('A,B\n1,2\n\n').rows).toEqual([['1', '2']]);
  });

  it('keeps a row of empty fields, which is a real row', () => {
    expect(parseCsv('A,B\n,\n').rows).toEqual([['', '']]);
  });

  it('names what is wrong with a header instead of throwing', () => {
    expect(headerProblem(['Name', 'Email'])).toBe('');
    expect(headerProblem([])).toContain('no header row');
    expect(headerProblem(['Name', ''])).toContain('empty column name');
    expect(headerProblem(['Name', 'name'])).toContain('two columns named');
  });
});
