import { expect, it, vi } from 'vitest';
import { rowsFromDelimited } from '../src/core/importrange.js';
import { detectDelimiter } from '../src/core/io.js';
import { parseDelimited } from '../src/core/tsv.js';
import { parseInput } from '../src/core/format.js';
import { Workbook } from '../src/core/workbook.js';

const helpers = { detectDelimiter, parseDelimited, parseInput };

it.each([',', '\t', ';'])('preserves leading, interior, and explicitly trailing empty rows with delimiter %j', (d) => {
  const source = `${d}\r\nItem${d}Value\r\nFirst${d}10\r\n${d}\r\nLast${d}20\r\n${d}\r\n`;
  expect(rowsFromDelimited(source, d, helpers)).toEqual([
    [null, null], ['Item', 'Value'], ['First', 10], [null, null], ['Last', 20], [null, null],
  ]);
});

it('retains blank lines and quoted empty fields while ignoring a terminating newline', () => {
  expect(rowsFromDelimited('A,B\n\n"",""\nC,D\n', ',', helpers)).toEqual([
    ['A', 'B'], [null], [null, null], ['C', 'D'],
  ]);
  expect(rowsFromDelimited('\n,\n', ',', helpers)).toEqual({ error: '#N/A' });
});

it('includes empty rows in the import cell budget before parsing typed values', () => {
  const parse = vi.fn(parseInput);
  const source = `A,B\n${',\n'.repeat(100000)}`;
  expect(rowsFromDelimited(source, ',', { ...helpers, parseInput: parse })).toEqual({ error: '#NUM!' });
  expect(parse).not.toHaveBeenCalled();
});

it('keeps blank rows in the spill so references still address their original records', async () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setAsyncProvider('IMPORTDATA', () => rowsFromDelimited('Item,Value\nFirst,10\n,\nLast,20\n', ',', helpers));
  wb.setInput(id, 0, 0, '=IMPORTDATA("https://example.com/data.csv")');
  wb.setInput(id, 0, 3, '=B4');
  expect(wb.getValue(id, 0, 0)).toEqual({ error: '#BUSY!' });
  await new Promise(setImmediate);
  expect(wb.getValue(id, 2, 0)).toBe('');
  expect(wb.getValue(id, 3, 0)).toBe('Last');
  expect(wb.getValue(id, 0, 3)).toBe(20);
});
