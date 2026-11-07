import { describe, expect, it } from 'vitest';
import {
  ALL_DIGITS,
  BOX_UNITS,
  CELLS,
  COL_UNITS,
  PEERS,
  ROW_UNITS,
  UNITS,
  boxOf,
  cellName,
  colOf,
  countBits,
  digitOf,
  digitsOf,
  findConflicts,
  indexOf,
  isComplete,
  maskOf,
  rowOf,
} from '../src/engine/grid.js';
import { fromText } from '../src/game/serialize.js';

describe('cell addressing', () => {
  it('round-trips row/column and index', () => {
    for (let i = 0; i < CELLS; i++) {
      expect(indexOf(rowOf(i), colOf(i))).toBe(i);
    }
  });

  it('assigns each cell to the box its 3x3 block covers', () => {
    expect(boxOf(0)).toBe(0);
    expect(boxOf(2)).toBe(0);
    expect(boxOf(3)).toBe(1);
    expect(boxOf(indexOf(4, 4))).toBe(4);
    expect(boxOf(80)).toBe(8);
  });

  it('names cells in the r1c1 notation solving literature uses', () => {
    expect(cellName(0)).toBe('r1c1');
    expect(cellName(80)).toBe('r9c9');
    expect(cellName(indexOf(4, 6))).toBe('r5c7');
  });
});

describe('units and peers', () => {
  it('has 27 units of 9 cells each', () => {
    expect(UNITS).toHaveLength(27);
    for (const unit of UNITS) expect(unit.cells).toHaveLength(9);
  });

  it('covers every cell exactly once per unit kind', () => {
    for (const family of [ROW_UNITS, COL_UNITS, BOX_UNITS]) {
      expect(new Set(family.flat()).size).toBe(CELLS);
    }
  });

  it('gives every cell exactly 20 peers, never including itself', () => {
    for (let i = 0; i < CELLS; i++) {
      expect(PEERS[i]).toHaveLength(20);
      expect(PEERS[i]).not.toContain(i);
    }
  });

  it('makes peerage symmetric', () => {
    for (let i = 0; i < CELLS; i++) {
      for (const p of PEERS[i]) expect(PEERS[p]).toContain(i);
    }
  });

  it('knows the peers of a corner cell', () => {
    // Row 1, column 1 and box 1, minus the double-counted block overlap.
    expect(PEERS[0]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 18, 19, 20, 27, 36, 45, 54, 63, 72]);
  });
});

describe('candidate bit masks', () => {
  it('maps digits to single bits', () => {
    expect(maskOf(1)).toBe(1);
    expect(maskOf(9)).toBe(256);
  });

  it('reads a single digit back out, and refuses to guess for more', () => {
    for (let d = 1; d <= 9; d++) expect(digitOf(maskOf(d))).toBe(d);
    expect(digitOf(maskOf(1) | maskOf(2))).toBe(0);
    expect(digitOf(0)).toBe(0);
  });

  it('lists the digits in a mask, ascending', () => {
    expect(digitsOf(maskOf(9) | maskOf(2) | maskOf(5))).toEqual([2, 5, 9]);
    expect(digitsOf(0)).toEqual([]);
    expect(digitsOf(ALL_DIGITS)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('counts set bits', () => {
    expect(countBits(0)).toBe(0);
    expect(countBits(ALL_DIGITS)).toBe(9);
    expect(countBits(maskOf(3) | maskOf(7))).toBe(2);
  });
});

describe('completeness and conflicts', () => {
  const solved = fromText(
    '534678912672195348198342567859761423426853791713924856961537284287419635345286179',
  );

  it('accepts a solved grid as complete', () => {
    expect(isComplete(solved)).toBe(true);
    expect(findConflicts(solved).size).toBe(0);
  });

  it('rejects a grid with an empty cell', () => {
    const holed = Uint8Array.from(solved);
    holed[40] = 0;
    expect(isComplete(holed)).toBe(false);
  });

  it('reports every cell involved in a duplicate, not just the newest', () => {
    const board = new Uint8Array(CELLS);
    board[0] = 5;
    board[8] = 5; // same row
    const bad = findConflicts(board);
    expect([...bad].sort((a, b) => a - b)).toEqual([0, 8]);
  });

  it('finds duplicates within a box as well as a line', () => {
    const board = new Uint8Array(CELLS);
    board[0] = 7;
    board[10] = 7; // same box, different row and column
    expect(findConflicts(board).size).toBe(2);
  });
});
