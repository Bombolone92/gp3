import { describe, it, expect } from 'vitest';
import { parseCSV, toCSV } from '../src/core/csv.js';

describe('csv', () => {
  it('parses quoted fields, escaped quotes and newlines', () => {
    const rows = parseCSV('a,"b,c","say ""hi"""\r\n1,"line\nbreak",3\n');
    expect(rows).toEqual([
      ['a', 'b,c', 'say "hi"'],
      ['1', 'line\nbreak', '3'],
    ]);
  });

  it('round-trips through toCSV', () => {
    const data = [['x', 'y,z', 'q"q'], ['1', '', 'multi\nline']];
    expect(parseCSV(toCSV(data))).toEqual(data);
  });

  it('neutralizes formula injection on export', () => {
    expect(toCSV([['=SUM(A1)']])).toBe("'=SUM(A1)\r\n");
  });
});
