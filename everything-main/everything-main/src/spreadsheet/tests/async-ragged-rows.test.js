import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { rowsFromDelimited } from '../src/core/importrange.js';
import { detectDelimiter } from '../src/core/io.js';
import { parseDelimited } from '../src/core/tsv.js';
import { parseInput } from '../src/core/format.js';

const tick = () => new Promise(setImmediate);
const formula = 'IMPORTDATA("https://example.com/rows.csv")';

it('keeps fields beyond a short first record in spills and nested formulas', async () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setAsyncProvider('IMPORTDATA', () => rowsFromDelimited('Title\nA,2,3\nB,4,5\n', ',', { detectDelimiter, parseDelimited, parseInput }));
  wb.setInput(id, 0, 0, `=${formula}`);
  wb.setInput(id, 0, 5, `=INDEX(${formula},3,3)`);
  wb.setInput(id, 1, 5, '=SUM(A1#)');
  expect(wb.getValue(id, 0, 0)).toEqual({ error: '#BUSY!' });
  await tick();
  expect(wb.spillRangeAt(id, 0, 0)).toEqual({ r1: 0, c1: 0, r2: 2, c2: 2 });
  expect(wb.getValue(id, 0, 2)).toBe('');
  expect(wb.getValue(id, 2, 2)).toBe(5);
  expect(wb.getValue(id, 0, 5)).toBe(5);
  expect(wb.getValue(id, 1, 5)).toBe(14);
});

it('checks the entire imported rectangle for occupied cells and recovers after clearing them', async () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setAsyncProvider('IMPORTDATA', () => [['Title'], ['A', 2, 3]]);
  wb.setInput(id, 0, 0, `=${formula}`);
  wb.setInput(id, 1, 2, 'Keep');
  wb.getValue(id, 0, 0);
  await tick();
  expect(wb.getValue(id, 0, 0)).toEqual({ error: '#SPILL!' });
  expect(wb.getValue(id, 1, 2)).toBe('Keep');
  wb.setInput(id, 1, 2, '');
  expect(wb.getValue(id, 1, 2)).toBe(3);
  wb.undo();
  expect(wb.getValue(id, 0, 0)).toEqual({ error: '#SPILL!' });
});

it('handles an empty first array row and scalar rows without changing provider-owned data', async () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  const rows = Object.freeze([Object.freeze([]), 'Label', Object.freeze([1, 2])]);
  wb.setAsyncProvider('IMPORTDATA', () => rows);
  wb.setInput(id, 0, 0, `=${formula}`);
  wb.getValue(id, 0, 0);
  await tick();
  expect(wb.rangeValues(id, { r1: 0, c1: 0, r2: 2, c2: 1 })).toEqual([['', ''], ['Label', ''], [1, 2]]);
  expect(rows).toEqual([[], 'Label', [1, 2]]);
});

it('rejects an oversized rectangle before padding short rows', async () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  const rows = Array.from({ length: 1000 }, () => [1]);
  rows[999] = Array(1000).fill(2);
  wb.setAsyncProvider('IMPORTDATA', () => rows);
  wb.setInput(id, 0, 0, `=${formula}`);
  wb.getValue(id, 0, 0);
  await tick();
  expect(wb.getValue(id, 0, 0)).toEqual({ error: '#NUM!' });
  expect(wb.spillRangeAt(id, 0, 0)).toBeNull();
  expect(rows[0]).toEqual([1]);
});
