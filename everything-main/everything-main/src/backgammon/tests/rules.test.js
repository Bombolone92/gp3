import { describe, it, expect } from 'vitest';
import { Backgammon, opponent } from '../src/engine/backgammon.js';
import { position, describeMoves } from './helpers.js';

describe('the opening position', () => {
  it('sets up fifteen checkers a side on the standard points', () => {
    const game = new Backgammon();
    const points = game.points();
    expect(points[24]).toBe(2);
    expect(points[13]).toBe(5);
    expect(points[8]).toBe(3);
    expect(points[6]).toBe(5);
    expect(points[1]).toBe(-2);
    expect(points[12]).toBe(-5);
    expect(points[17]).toBe(-3);
    expect(points[19]).toBe(-5);
    expect(game.off('w')).toBe(0);
    expect(game.off('b')).toBe(0);
  });

  it('starts both sides on 167 pips', () => {
    const game = new Backgammon();
    expect(game.pipCount('w')).toBe(167);
    expect(game.pipCount('b')).toBe(167);
  });

  it('has nobody on move until the opening roll', () => {
    const game = new Backgammon();
    expect(game.turn()).toBe(null);
    expect(game.phase()).toBe('opening');
    expect(game.legalMoves()).toEqual([]);
  });
});

describe('the opening roll', () => {
  it('gives the turn to the higher die and plays both', () => {
    const game = new Backgammon();
    expect(game.setRoll(6, 5)).toBe(true);
    expect(game.turn()).toBe('w');
    expect(game.roll()).toEqual([6, 5]);
    expect(game.phase()).toBe('move');
  });

  it('gives Black the turn when Black rolls higher', () => {
    const game = new Backgammon();
    game.setRoll(2, 4);
    expect(game.turn()).toBe('b');
  });

  it('decides nothing on a tie', () => {
    const game = new Backgammon();
    expect(game.setRoll(3, 3)).toBe(false);
    expect(game.phase()).toBe('opening');
    expect(game.turn()).toBe(null);
  });

  it('refuses a roll that is not two dice', () => {
    const game = new Backgammon();
    expect(game.setRoll(0, 4)).toBe(false);
    expect(game.setRoll(7, 4)).toBe(false);
    expect(game.setRoll(2.5, 4)).toBe(false);
  });
});

describe('playing a turn', () => {
  it('moves checkers, hands over the turn, and clears the dice', () => {
    const game = new Backgammon();
    game.setRoll(3, 1);
    const entry = game.play([
      { from: 8, to: 5, die: 3, hit: false },
      { from: 6, to: 5, die: 1, hit: false },
    ]);
    expect(entry.kind).toBe('move');
    expect(game.points()[5]).toBe(2);
    expect(game.points()[8]).toBe(2);
    expect(game.points()[6]).toBe(4);
    expect(game.turn()).toBe('b');
    expect(game.phase()).toBe('roll');
    expect(game.roll()).toBe(null);
    expect(game.pipCount('w')).toBe(163);
  });

  it('refuses a play that leaves a playable die unused', () => {
    const game = new Backgammon();
    game.setRoll(3, 1);
    expect(game.play([{ from: 8, to: 5, die: 3, hit: false }])).toBe(null);
    expect(game.turn()).toBe('w');
  });

  it('refuses a move onto a point the opponent holds', () => {
    const game = position({ white: { 13: 1 }, black: { 7: 2 }, turn: 'w', roll: [6, 5] });
    expect(game.play([{ from: 13, to: 7, die: 6, hit: false }])).toBe(null);
  });

  it('sends a lone opposing checker to the bar', () => {
    const game = position({ white: { 13: 1 }, black: { 7: 1, 20: 2 }, turn: 'w', roll: [6, 6] });
    const moves = game.legalMoves();
    expect(moves.find((m) => m.to === 7).hit).toBe(true);
    game.play([
      { from: 13, to: 7, die: 6, hit: true },
      { from: 7, to: 1, die: 6, hit: false },
    ]);
    expect(game.bar('b')).toBe(1);
    expect(game.points()[7]).toBe(0);
  });
});

describe('the bar', () => {
  it('lets nothing else move while a checker waits on it', () => {
    const game = position({
      white: { 25: 1, 13: 2 },
      black: { 20: 2 },
      turn: 'w',
      roll: [4, 3],
    });
    for (const move of game.legalMoves()) expect(move.from).toBe(25);
  });

  it('enters onto the point the die names, counting from the far side', () => {
    const game = position({ white: { 25: 1 }, black: {}, turn: 'w', roll: [4, 3] });
    const targets = game.legalMoves().map((m) => m.to);
    expect(targets).toContain(21);
    expect(targets).toContain(22);
  });

  it('enters Black from the other end of the board', () => {
    const game = position({ white: {}, black: { 0: 1 }, turn: 'b', roll: [4, 3] });
    const targets = game.legalMoves().map((m) => m.to);
    expect(targets).toContain(4);
    expect(targets).toContain(3);
  });

  it('leaves a turn with no play at all when every entry point is blocked', () => {
    const game = position({
      white: { 25: 1 },
      black: { 21: 2, 22: 2 },
      turn: 'w',
      roll: [4, 3],
    });
    expect(game.maxUsed()).toBe(0);
    expect(game.legalMoves()).toEqual([]);
    expect(game.isPlayComplete([])).toBe(true);
    expect(game.play([])).not.toBe(null);
    expect(game.turn()).toBe('b');
  });
});

// A roll of double 1 throughout: with a single checker left, an unequal roll
// would drag in the larger-die rule, which has its own tests in moves.test.js.
describe('finishing a game', () => {
  it('is a single game when the loser has borne a checker off', () => {
    const game = position({
      white: { 1: 1 },
      black: { 24: 1 },
      off: { w: 14, b: 14 },
      turn: 'w',
      roll: [1, 1],
    });
    game.play([{ from: 1, to: 0, die: 1, hit: false }]);
    const status = game.status();
    expect(status.over).toBe(true);
    expect(status.winner).toBe('w');
    expect(status.multiplier).toBe(1);
    expect(status.points).toBe(1);
    expect(status.reason).toBe('borne off');
  });

  it('is a gammon when the loser has borne nothing off', () => {
    const game = position({
      white: { 1: 1 },
      black: { 20: 2, 13: 13 },
      off: { w: 14 },
      turn: 'w',
      roll: [1, 1],
    });
    game.play([{ from: 1, to: 0, die: 1, hit: false }]);
    expect(game.status().multiplier).toBe(2);
  });

  it('is a backgammon when the loser is still in the winner’s home board', () => {
    const game = position({
      white: { 1: 1 },
      black: { 3: 2, 13: 13 },
      off: { w: 14 },
      turn: 'w',
      roll: [1, 1],
    });
    game.play([{ from: 1, to: 0, die: 1, hit: false }]);
    expect(game.status().multiplier).toBe(3);
  });

  it('is a backgammon when the loser is on the bar', () => {
    const game = position({
      white: { 1: 1 },
      black: { 0: 1, 13: 14 },
      off: { w: 14 },
      turn: 'w',
      roll: [1, 1],
    });
    game.play([{ from: 1, to: 0, die: 1, hit: false }]);
    expect(game.status().multiplier).toBe(3);
  });
});

describe('undo', () => {
  it('puts the board and the dice back exactly as they were', () => {
    const game = new Backgammon();
    game.setRoll(3, 1);
    const before = game.points().join(',');
    game.play([
      { from: 8, to: 5, die: 3, hit: false },
      { from: 6, to: 5, die: 1, hit: false },
    ]);
    game.undo();
    expect(game.points().join(',')).toBe(before);
    expect(game.turn()).toBe('w');
    expect(game.roll()).toEqual([3, 1]);
    expect(game.phase()).toBe('move');
    expect(game.history()).toHaveLength(0);
  });

  it('takes a hit checker back off the bar', () => {
    const game = position({ white: { 13: 1 }, black: { 7: 1, 20: 2 }, turn: 'w', roll: [6, 6] });
    const before = game.points().join(',');
    game.play([
      { from: 13, to: 7, die: 6, hit: true },
      { from: 7, to: 1, die: 6, hit: false },
    ]);
    expect(game.bar('b')).toBe(1);
    game.undo();
    expect(game.bar('b')).toBe(0);
    expect(game.points().join(',')).toBe(before);
  });

  it('takes a borne-off checker back onto its point', () => {
    const game = position({
      white: { 1: 1 },
      black: { 24: 1 },
      off: { w: 14, b: 14 },
      turn: 'w',
      roll: [1, 1],
    });
    game.play([{ from: 1, to: 0, die: 1, hit: false }]);
    expect(game.status().over).toBe(true);
    game.undo();
    expect(game.off('w')).toBe(14);
    expect(game.points()[1]).toBe(1);
    expect(game.status().over).toBe(false);
    expect(game.phase()).toBe('move');
  });
});

describe('the two colours are mirror images', () => {
  it('offers Black on point p exactly what White has on 25 - p', () => {
    const white = position({ white: { 13: 1 }, black: { 2: 2 }, turn: 'w', roll: [6, 5] });
    const black = position({ white: { 23: 2 }, black: { 12: 1 }, turn: 'b', roll: [6, 5] });
    const reflected = (moves) =>
      moves.map((m) => `${25 - m.from}/${25 - m.to}`).sort().join(' ');
    const plain = (moves) => moves.map((m) => `${m.from}/${m.to}`).sort().join(' ');
    expect(reflected(white.legalMoves())).toBe(plain(black.legalMoves()));
    expect(plain(black.legalMoves())).toBe('12/18');
    expect(opponent('w')).toBe('b');
  });

  it('marks a hit in the notation whichever colour makes it', () => {
    expect(describeMoves([{ from: 12, to: 18, die: 6, hit: true }])).toBe('12/18*');
    expect(describeMoves([{ from: 0, to: 6, die: 6, hit: false }])).toBe('bar/6');
    expect(describeMoves([{ from: 3, to: 0, die: 3, hit: false }])).toBe('3/off');
  });
});
