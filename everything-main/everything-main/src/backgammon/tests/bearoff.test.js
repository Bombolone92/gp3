import { describe, it, expect } from 'vitest';
import { position, describeMoves, playSet } from './helpers.js';

describe('when bearing off is allowed', () => {
  it('needs every checker home', () => {
    const home = position({ white: { 6: 2, 5: 2, 4: 2, 3: 2, 2: 2, 1: 5 }, turn: 'w' });
    expect(home.canBearOff('w')).toBe(true);
    const straggler = position({
      white: { 8: 1, 6: 2, 5: 2, 4: 2, 3: 2, 2: 2, 1: 4 },
      turn: 'w',
    });
    expect(straggler.canBearOff('w')).toBe(false);
  });

  it('is suspended by a checker on the bar', () => {
    const game = position({
      white: { 25: 1, 6: 2, 5: 2, 4: 2, 3: 2, 2: 2, 1: 4 },
      turn: 'w',
    });
    expect(game.canBearOff('w')).toBe(false);
  });

  it('counts checkers already borne off toward the fifteen', () => {
    const game = position({ white: { 3: 1 }, off: { w: 14 }, turn: 'w' });
    expect(game.canBearOff('w')).toBe(true);
  });
});

describe('bearing off', () => {
  it('takes a checker off on an exact roll', () => {
    const game = position({
      white: { 6: 2, 5: 2, 4: 2, 3: 2, 2: 2, 1: 5 },
      turn: 'w',
      roll: [6, 6],
    });
    expect(game.maxUsed()).toBe(4);
    const off = game.legalMoves().filter((m) => m.to === 0);
    expect(off.map((m) => m.from)).toEqual([6]);
  });

  it('spends a larger die only when nothing is further from home', () => {
    // The 6-point is occupied, so a 6 may not lift a checker from the 4.
    const blocked = position({
      white: { 6: 2, 4: 1 },
      off: { w: 12 },
      turn: 'w',
      roll: [6, 6],
    });
    expect(blocked.legalMoves().every((m) => m.from === 6)).toBe(true);

    // With the 6-point cleared, the same 6 lifts the checker on the 4.
    const clear = position({ white: { 4: 1 }, off: { w: 14 }, turn: 'w', roll: [6, 6] });
    expect(describeMoves(clear.legalMoves())).toBe('4/off');
  });

  it('is still bound to use both dice, even when one of them bears off', () => {
    // One checker on the 5-point with 6-1: bearing off with the 6 wastes the
    // 1, so the legal play is 5/4 and then 4/off.
    const game = position({ white: { 5: 1 }, off: { w: 14 }, turn: 'w', roll: [6, 1] });
    expect(game.maxUsed()).toBe(2);
    expect(playSet(game)).toEqual(new Set(['5/4 4/off']));
  });

  it('mirrors for Black, whose home is the far end of the board', () => {
    const game = position({ black: { 20: 1 }, off: { b: 14 }, turn: 'b', roll: [6, 6] });
    expect(game.canBearOff('b')).toBe(true);
    expect(describeMoves(game.legalMoves())).toBe('20/off');
  });

  it('will not bear off Black with a checker further from home', () => {
    const game = position({ black: { 19: 2, 21: 1 }, off: { b: 12 }, turn: 'b', roll: [5, 5] });
    // 25 - 21 = 4, so a 5 overshoots; the checkers on 19 are further out.
    expect(game.legalMoves().every((m) => m.to !== 25)).toBe(true);
  });

  it('finishes the game as the fifteenth checker comes off', () => {
    const game = position({
      white: { 1: 2 },
      black: { 24: 2 },
      off: { w: 13, b: 13 },
      turn: 'w',
      roll: [1, 1],
    });
    expect(game.maxUsed()).toBe(2);
    game.play([
      { from: 1, to: 0, die: 1, hit: false },
      { from: 1, to: 0, die: 1, hit: false },
    ]);
    expect(game.off('w')).toBe(15);
    expect(game.status().over).toBe(true);
    expect(game.status().winner).toBe('w');
  });
});
