import { describe, expect, it } from 'vitest';
import { CELLS, findConflicts, indexOf, isComplete } from '../src/engine/grid.js';
import {
  candidatesFor,
  countSolutions,
  hasUniqueSolution,
  solve,
} from '../src/engine/solver.js';
import { fromText, toText } from '../src/game/serialize.js';

/** Published puzzles, used so the solver is checked against known answers. */
const PUZZLES = {
  newspaper: '530070000600195000098000060800060003400803001700020006060000280000419005000080079',
  // Built to defeat naive left-to-right backtracking. Included because it is
  // the case a slow solver fails on, and generation solves thousands of these.
  antiBruteForce: '000000010400000000020000000000050407008000300001090000300400200050100000000806000',
  // 17 clues is the proven minimum for a unique Sudoku.
  minimal17: '000000010400000000020000000000050407008000300001090000300400200050100000000806000',
};

const SOLUTIONS = {
  newspaper: '534678912672195348198342567859761423426853791713924856961537284287419635345286179',
};

/**
 * Two rows and two columns whose four intersections hold just two digits,
 * arranged a/b over b/a, with both rows in one band and both columns in one
 * stack so the four cells span exactly two boxes.
 */
function findDeadlyRectangle(solved) {
  for (let r1 = 0; r1 < 9; r1++) {
    for (let r2 = r1 + 1; r2 < 9; r2++) {
      for (let c1 = 0; c1 < 9; c1++) {
        for (let c2 = c1 + 1; c2 < 9; c2++) {
          if (((c1 / 3) | 0) !== ((c2 / 3) | 0)) continue;
          const cells = [indexOf(r1, c1), indexOf(r1, c2), indexOf(r2, c1), indexOf(r2, c2)];
          const [a, b, c, d] = cells.map((i) => solved[i]);
          if (a === d && b === c && a !== b) return cells;
        }
      }
    }
  }
  return null;
}

describe('solve', () => {
  it('solves a newspaper puzzle to the published answer', () => {
    const solved = solve(fromText(PUZZLES.newspaper));
    expect(toText(solved)).toBe(SOLUTIONS.newspaper);
  });

  it('solves a puzzle designed against brute force', () => {
    const solved = solve(fromText(PUZZLES.antiBruteForce));
    expect(isComplete(solved)).toBe(true);
  });

  it('keeps every clue it was given', () => {
    const puzzle = fromText(PUZZLES.newspaper);
    const solved = solve(puzzle);
    for (let i = 0; i < CELLS; i++) {
      if (puzzle[i]) expect(solved[i]).toBe(puzzle[i]);
    }
  });

  it('fills an empty grid', () => {
    const solved = solve(new Uint8Array(CELLS));
    expect(isComplete(solved)).toBe(true);
  });

  it('returns null for a board that contradicts itself', () => {
    const board = new Uint8Array(CELLS);
    board[0] = 5;
    board[1] = 5;
    expect(solve(board)).toBeNull();
  });

  it('returns null for a board with no completion but no duplicate', () => {
    // Row 1 holds 1-8, so r1c9 must be 9; column 9 already has a 9 in row 2.
    // Nothing duplicates anything, and yet there is no way to finish.
    const board = new Uint8Array(CELLS);
    for (let d = 1; d <= 8; d++) board[d - 1] = d;
    board[indexOf(1, 8)] = 9;
    expect(findConflicts(board).size).toBe(0);
    expect(solve(board)).toBeNull();
  });

  it('produces different grids for different digit orders', () => {
    const a = solve(new Uint8Array(CELLS), { order: [1, 2, 3, 4, 5, 6, 7, 8, 9] });
    const b = solve(new Uint8Array(CELLS), { order: [9, 8, 7, 6, 5, 4, 3, 2, 1] });
    expect(toText(a)).not.toBe(toText(b));
    expect(isComplete(a)).toBe(true);
    expect(isComplete(b)).toBe(true);
  });
});

describe('countSolutions', () => {
  it('counts exactly one for a proper puzzle', () => {
    expect(countSolutions(fromText(PUZZLES.newspaper))).toBe(1);
    expect(hasUniqueSolution(fromText(PUZZLES.newspaper))).toBe(true);
  });

  it('counts none for a contradictory board', () => {
    const board = fromText(PUZZLES.newspaper);
    board[1] = 5; // duplicates the 5 already in row 1
    expect(countSolutions(board)).toBe(0);
    expect(hasUniqueSolution(board)).toBe(false);
  });

  it('stops at the limit rather than enumerating everything', () => {
    // An empty grid has 6.67e21 solutions; the limit is what keeps this fast.
    expect(countSolutions(new Uint8Array(CELLS), 2)).toBe(2);
    expect(countSolutions(new Uint8Array(CELLS), 5)).toBe(5);
  });

  it('spots the ambiguity left by emptying a deadly rectangle', () => {
    // Four cells forming a rectangle inside two boxes, holding a/b and b/a, can
    // always be filled two ways once emptied. It is the pattern uniqueness
    // checking exists to catch, so the solver has to see it.
    const solved = fromText(SOLUTIONS.newspaper);
    const rectangle = findDeadlyRectangle(solved);
    expect(rectangle).not.toBeNull();

    const board = Uint8Array.from(solved);
    for (const i of rectangle) board[i] = 0;
    expect(findConflicts(board).size).toBe(0);
    expect(countSolutions(board, 3)).toBe(2);
    expect(hasUniqueSolution(board)).toBe(false);
  });
});

describe('candidatesFor', () => {
  it('settles every cell of a solvable puzzle to one digit', () => {
    const cands = candidatesFor(fromText(PUZZLES.newspaper));
    expect(cands).not.toBeNull();
    // Propagation alone finishes this puzzle, so each mask is a single bit.
    for (let i = 0; i < CELLS; i++) {
      expect(cands[i] & (cands[i] - 1)).toBe(0);
      expect(cands[i]).not.toBe(0);
    }
  });

  it('returns null when the board contradicts itself', () => {
    const board = new Uint8Array(CELLS);
    board[0] = 3;
    board[4] = 3;
    expect(candidatesFor(board)).toBeNull();
  });

  it('never offers a candidate a peer already holds', () => {
    const board = new Uint8Array(CELLS);
    board[1] = 4;
    board[9] = 7;
    const mask = candidatesFor(board)[0];
    expect(mask & (1 << 3)).toBe(0); // no 4
    expect(mask & (1 << 6)).toBe(0); // no 7
    expect(mask & 1).not.toBe(0); // 1 is still open
  });
});

describe('solver output is always a legal grid', () => {
  it.each(Object.entries(PUZZLES))('%s', (_name, text) => {
    const solved = solve(fromText(text));
    expect(solved).not.toBeNull();
    expect(findConflicts(solved).size).toBe(0);
    expect(isComplete(solved)).toBe(true);
  });
});
