import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

// The four-million-cell array budget was reset only for the cell the grid asked for, so every
// cell calculated on its behalf (a precedent, or an array formula settled while a blank cell was
// read) shared one budget, and the same sheet showed #NUM! or a number depending on which cell
// was read first.
const SPEND = 'SUM(SEQUENCE(100000))'; // 100,000 array cells: 42 such cells together exceed one budget
const SUM = 5000050000;
const N = 42;

function heavyColumn() {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  for (let r = 0; r < N; r++) wb.setInput(id, r, 0, `=${SPEND}`);
  wb.setInput(id, 0, 1, `=SUM(A1:A${N})`);
  return { wb, id };
}

it('gives a cell read by way of another cell its own array budget', { timeout: 60000 }, () => {
  const total = heavyColumn();
  expect(total.wb.getValue(total.id, 0, 1)).toBe(SUM * N); // the total first: its 42 precedents are calculated on its behalf
  for (let r = 0; r < N; r++) expect(total.wb.getValue(total.id, r, 0)).toBe(SUM);
  const cells = heavyColumn();
  for (let r = 0; r < N; r++) expect(cells.wb.getValue(cells.id, r, 0)).toBe(SUM); // the cells first
  expect(cells.wb.getValue(cells.id, 0, 1)).toBe(SUM * N);
});

function anchors() {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  for (let r = 0; r < 2 * N; r += 2) wb.setInput(id, r, 0, '=TAKE(SEQUENCE(100000),2)'); // 42 spills of two cells, each spending 100,000
  wb.setInput(id, 0, 3, '=C1+1'); // C1 is blank: reading it settles every spill on the sheet first
  return { wb, id };
}

it('gives the array formulas settled while a blank cell is read their own budgets', { timeout: 60000 }, () => {
  const blankFirst = anchors();
  expect(blankFirst.wb.getValue(blankFirst.id, 0, 3)).toBe(1);
  for (let r = 0; r < 2 * N; r += 2) {
    expect(blankFirst.wb.getValue(blankFirst.id, r, 0)).toBe(1);
    expect(blankFirst.wb.getValue(blankFirst.id, r + 1, 0)).toBe(2);
  }
  const anchorFirst = anchors();
  expect(anchorFirst.wb.getValue(anchorFirst.id, 0, 0)).toBe(1);
  expect(anchorFirst.wb.getValue(anchorFirst.id, 2 * N - 1, 0)).toBe(2);
  expect(anchorFirst.wb.getValue(anchorFirst.id, 0, 3)).toBe(1);
});

it('still stops one cell whose own arrays exceed the budget, without starving the next', { timeout: 60000 }, () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '=SUM(MAKEARRAY(40,40,LAMBDA(r,c,SUM(SEQUENCE(1000,100)))))');
  wb.setInput(id, 1, 0, '=A1+SUM(SEQUENCE(1000))');
  wb.setInput(id, 2, 0, '=SUM(SEQUENCE(1000))');
  expect(wb.getValue(id, 1, 0)).toEqual({ error: '#NUM!' }); // A1's error, not a budget A2 inherited
  expect(wb.getValue(id, 0, 0)).toEqual({ error: '#NUM!' });
  expect(wb.getValue(id, 2, 0)).toBe(500500);
});
