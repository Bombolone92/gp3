/**
 * Second review of the first wave: CSV files that read correctly before
 * must still read the same.
 */
import { describe, it, expect } from 'vitest';
import { parseCSV } from '../src/core/csv.js';

describe('CSV with a space after the comma', () => {
  it('still reads a quoted field that holds a comma as one field', () => {
    expect(parseCSV('Name, Notes\nVan 7, "Front, left"\n').map((r) => r.map((c) => c.trim()))).toEqual([
      ['Name', 'Notes'],
      ['Van 7', 'Front, left'],
    ]);
  });

  it('keeps inch marks inside unquoted text', () => {
    expect(parseCSV('Van 7,16" wheels\n')).toEqual([['Van 7', '16" wheels']]);
  });
});
