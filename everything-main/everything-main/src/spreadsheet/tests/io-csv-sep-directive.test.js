import { expect, it } from 'vitest';
import { workbookFromFile } from '../src/core/io.js';

const open = (text, name = 'data.csv') => workbookFromFile(new TextEncoder().encode(text), name);
const grid = (wb, rows, cols) => Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => wb.getValue(wb.activeSheetId, r, c)));

// Excel reads a first line of "sep=;" as naming the separator of the file (programs
// writing for a ";" locale add it); it was read as data, putting "sep=" in A1 and every
// row one lower.
it('takes a leading sep= line as the separator and leaves it out of the data', async () => {
  const wb = await open('sep=;\na;b\n1;2\n');
  expect(grid(wb, 3, 2)).toEqual([['a', 'b'], [1, 2], [null, null]]);
  expect(wb.activeSheet.cells.size).toBe(4);
});

it.each([
  ['sep=,\r\nx,y\r\n1,2\r\n', [['x', 'y'], [1, 2]]],
  ['sep=|\nx|y\n1|2\n', [['x', 'y'], [1, 2]]],
  ['sep=\t\nx\ty\n1\t2\n', [['x', 'y'], [1, 2]]],
  ['SEP=;\nx;y\n1;2\n', [['x', 'y'], [1, 2]]],
  ['﻿sep=;\nx;y\n1;2\n', [['x', 'y'], [1, 2]]],
])('honours the directive %j over what the data suggests', async (text, expected) => {
  const wb = await open(text);
  expect(grid(wb, 2, 2)).toEqual(expected);
});

it('follows the directive even where the lines would detect another separator', async () => {
  const wb = await open('sep=;\n1,5;2,5\n3,5;4,5\n', 'data.tsv');
  expect(grid(wb, 2, 2)).toEqual([['1,5', '2,5'], ['3,5', '4,5']]);
});

it('keeps sep= as data where it is not alone on the first line, and a plain first cell as it was', async () => {
  const wb = await open('sep=;x,y\n1,2\n');
  expect(grid(wb, 2, 2)).toEqual([['sep=;x', 'y'], [1, 2]]);
  const plain = await open('separate,thing\n1,2\n');
  expect(grid(plain, 2, 2)).toEqual([['separate', 'thing'], [1, 2]]);
});

it('opens a file that is only the directive as an empty sheet', async () => {
  const wb = await open('sep=;');
  expect(wb.activeSheet.cells.size).toBe(0);
});
