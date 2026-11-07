import { describe, it, expect } from 'vitest';
import {
  squareToRowCol, rowColToSquare, STEPS, JUMPS, isCrowningSquare,
} from '../src/engine/geometry.js';

describe('square numbering', () => {
  it('puts square 1 on the top row and 32 on the bottom', () => {
    expect(squareToRowCol(1)).toEqual([0, 1]);
    expect(squareToRowCol(4)).toEqual([0, 7]);
    expect(squareToRowCol(29)).toEqual([7, 0]);
    expect(squareToRowCol(32)).toEqual([7, 6]);
  });

  it('round-trips every square', () => {
    for (let n = 1; n <= 32; n++) {
      const [r, c] = squareToRowCol(n);
      expect(rowColToSquare(r, c)).toBe(n);
    }
  });

  it('reports light squares as 0', () => {
    expect(rowColToSquare(0, 0)).toBe(0);
    expect(rowColToSquare(7, 7)).toBe(0);
  });

  // Guards against a mirrored board: these are the two most-played opening
  // moves in checkers, and both must be single diagonal steps in the right
  // direction. 11-15 is Black's "Old Faithful"; 23-19 is a standard reply.
  it('makes the classic openings legal single steps', () => {
    expect(STEPS[11][2]).toBe(15);  // Black steps down-left
    expect(STEPS[23][1]).toBe(19);  // White steps up-right
  });

  it('gives edge squares no off-board neighbours', () => {
    expect(STEPS[1][0]).toBe(0);    // top row has nothing above it
    expect(STEPS[5][0]).toBe(0);    // left file has nothing up-left
    expect(STEPS[29][2]).toBe(0);   // bottom row has nothing below it
  });

  it('builds jumps as a step onto a landing square two away', () => {
    expect(JUMPS[11][2]).toEqual({ over: 15, land: 18 });
    expect(JUMPS[1][2]).toBe(null); // no landing square: 1 is on the edge file
  });

  it('knows the crowning rows', () => {
    expect(isCrowningSquare(29, 'b')).toBe(true);
    expect(isCrowningSquare(32, 'b')).toBe(true);
    expect(isCrowningSquare(1, 'b')).toBe(false);
    expect(isCrowningSquare(1, 'w')).toBe(true);
    expect(isCrowningSquare(29, 'w')).toBe(false);
  });
});
