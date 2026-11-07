import { describe, it, expect } from 'vitest';
import { Backgammon } from '../src/engine/backgammon.js';
import {
  LEVELS,
  evaluate,
  findBestPlay,
  inContact,
  shouldDouble,
  shouldTake,
  winProbability,
} from '../src/engine/ai.js';
import { position, describeMoves } from './helpers.js';

/** The play the computer makes for the opening roll `d1`-`d2`, as notation. */
function openingPlay(d1, d2, level = 'hard') {
  const game = new Backgammon();
  game.setRoll(d1, d2);
  return describeMoves(findBestPlay(game, level));
}

describe('evaluation', () => {
  it('reads the opening position as level', () => {
    const game = new Backgammon();
    expect(evaluate(game.points(), { w: 0, b: 0 }, 'w')).toBeCloseTo(
      evaluate(game.points(), { w: 0, b: 0 }, 'b'),
      6,
    );
  });

  it('prefers being ahead in the race', () => {
    const behind = position({ white: { 13: 15 }, black: { 12: 15 } });
    const ahead = position({ white: { 6: 15 }, black: { 12: 15 } });
    const off = { w: 0, b: 0 };
    expect(evaluate(ahead.points(), off, 'w')).toBeGreaterThan(
      evaluate(behind.points(), off, 'w'),
    );
  });

  it('prefers a made point to a pair of blots on the same pips', () => {
    const made = position({ white: { 5: 2, 13: 13 }, black: { 20: 2, 12: 13 } });
    const split = position({ white: { 4: 1, 6: 1, 13: 13 }, black: { 20: 2, 12: 13 } });
    const off = { w: 0, b: 0 };
    expect(evaluate(made.points(), off, 'w')).toBeGreaterThan(
      evaluate(split.points(), off, 'w'),
    );
  });

  it('knows when the sides have run past each other', () => {
    const engaged = new Backgammon();
    expect(inContact(engaged.points())).toBe(true);
    const race = position({ white: { 6: 15 }, black: { 19: 15 } });
    expect(inContact(race.points())).toBe(false);
  });
});

describe('choosing a play', () => {
  // The standard best openings, which any competent bot agrees on. Getting
  // these right is the cheapest evidence that the evaluation is pointed the
  // right way; getting them wrong means the weights are wrong.
  it('makes the five point with 3-1', () => {
    expect(openingPlay(3, 1)).toBe('8/5 6/5');
  });

  it('makes the bar point with 6-1', () => {
    expect(openingPlay(6, 1)).toBe('13/7 8/7');
  });

  it('makes the three point with 4-2', () => {
    expect(openingPlay(4, 2)).toBe('8/4 6/4');
  });

  it('returns null when there is nothing to play', () => {
    const game = position({
      white: { 25: 1 },
      black: { 20: 2, 21: 2, 22: 2, 23: 2, 24: 2, 19: 2 },
      turn: 'w',
      roll: [4, 3],
    });
    expect(findBestPlay(game, 'medium')).toEqual([]);
  });

  it('bears a checker off rather than shuffling, when it is a pure race', () => {
    const game = position({
      white: { 6: 2, 5: 2, 4: 2, 3: 2, 2: 2, 1: 5 },
      black: { 19: 15 },
      turn: 'w',
      roll: [6, 3],
    });
    const moves = findBestPlay(game, 'medium');
    expect(moves.some((m) => m.to === 0)).toBe(true);
  });

  it('takes an open shot at a lone checker in front of a prime', () => {
    const game = position({
      white: { 13: 2, 8: 2, 6: 2 },
      black: { 7: 1, 24: 2, 23: 2 },
      turn: 'w',
      roll: [6, 5],
    });
    const moves = findBestPlay(game, 'hard');
    expect(moves.some((m) => m.hit)).toBe(true);
  });

  it('plays weaker at the easy level than at the expert one', () => {
    // Not a claim about any single play — only that the window is doing
    // something, i.e. easy does not always land on the expert's choice.
    const expert = openingPlay(3, 1, 'hard');
    const easy = new Set();
    for (let i = 0; i < 40; i++) easy.add(openingPlay(3, 1, 'easy'));
    expect(easy.size).toBeGreaterThan(1);
    expect(LEVELS.easy.window).toBeGreaterThan(LEVELS.medium.window);
    expect(expert).toBe('8/5 6/5');
  });
});

describe('the cube', () => {
  it('does not double from an even position', () => {
    const game = new Backgammon();
    game.setRoll(6, 5);
    game.play([
      { from: 24, to: 18, die: 6, hit: false },
      { from: 18, to: 13, die: 5, hit: false },
    ]);
    expect(winProbability(game, 'b')).toBeGreaterThan(0.35);
    expect(winProbability(game, 'b')).toBeLessThan(0.65);
    expect(shouldDouble(game, 'b')).toBe(false);
  });

  it('doubles a clear but not overwhelming lead', () => {
    const game = position({
      white: { 6: 5, 5: 5, 4: 5 },
      black: { 17: 5, 18: 5, 19: 5 },
      turn: 'w',
    });
    // 75 pips against 105, with the sides long past each other: a race White
    // is winning comfortably and Black has no business taking.
    expect(winProbability(game, 'w')).toBeGreaterThan(0.68);
    expect(winProbability(game, 'w')).toBeLessThan(0.87);
    expect(shouldDouble(game, 'w')).toBe(true);
    expect(shouldTake(game, 'b')).toBe(false);
  });

  it('takes while it still has real chances', () => {
    const game = position({
      white: { 6: 5, 5: 5, 4: 4, 8: 1 },
      black: { 19: 5, 20: 5, 21: 5 },
      turn: 'w',
    });
    expect(shouldTake(game, 'b')).toBe(true);
  });

  it('refuses to double a position it cannot turn the cube in', () => {
    const game = new Backgammon();
    expect(shouldDouble(game, 'w')).toBe(false);
  });
});

describe('affordability', () => {
  it('answers an expert-level turn inside the think-time budget', () => {
    const game = new Backgammon();
    game.setRoll(6, 5);
    game.play([
      { from: 24, to: 18, die: 6, hit: false },
      { from: 18, to: 13, die: 5, hit: false },
    ]);
    // Double 3s from a fresh board is close to the widest choice there is.
    game.setRoll(3, 3);
    const started = performance.now();
    findBestPlay(game, 'hard');
    const elapsed = performance.now() - started;
    expect(elapsed).toBeLessThan(2500);
  });
});
