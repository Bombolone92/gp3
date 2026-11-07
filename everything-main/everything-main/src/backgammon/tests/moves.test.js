import { describe, it, expect } from 'vitest';
import { Backgammon } from '../src/engine/backgammon.js';
import { position, describeMoves, playSet } from './helpers.js';

/**
 * The two obligations that make backgammon move generation more than "any
 * move that fits a die": you must use as many dice as you can, and when only
 * one of two unequal dice can be used, it has to be the larger.
 */
describe('using as many dice as possible', () => {
  it('will not play a move that strands a die another order would use', () => {
    // One checker on 13 with 6-5. Both 13/7 and 13/8 fit, but only 13/8 6/2
    // (or 13/7 7/2) can go on — and both do, so both dice must be played.
    const game = position({ white: { 13: 1 }, black: {}, turn: 'w', roll: [6, 5] });
    expect(game.maxUsed()).toBe(2);
    expect(game.play([{ from: 13, to: 7, die: 6, hit: false }])).toBe(null);
  });

  it('counts a double as four dice', () => {
    const game = position({ white: { 13: 4 }, black: {}, turn: 'w', roll: [2, 2] });
    expect(game.diceSequence()).toEqual([2, 2, 2, 2]);
    expect(game.maxUsed()).toBe(4);
  });

  it('plays what it can when a double runs out of room', () => {
    // Two checkers behind a wall: 13/11 is available twice and then nothing,
    // because 11/9 is blocked.
    const game = position({
      white: { 13: 2 },
      black: { 9: 2, 11: 0 },
      turn: 'w',
      roll: [2, 2],
    });
    expect(game.maxUsed()).toBe(2);
    expect(playSet(game)).toEqual(new Set(['13/11 13/11']));
  });

  it('leaves the player nothing to do when no die can be played', () => {
    const game = position({
      white: { 13: 1 },
      black: { 7: 2, 8: 2 },
      turn: 'w',
      roll: [6, 5],
    });
    expect(game.maxUsed()).toBe(0);
    expect(game.distinctPlays()).toEqual([
      { moves: [], points: game.points(), off: { w: 0, b: 0 } },
    ]);
  });
});

describe('the larger die when only one can be played', () => {
  it('forces the larger of two dice', () => {
    // 13/7 and 13/8 both fit, but each blocks the other die: 7-5 and 8-6 are
    // the same point, and Black holds it. Only one die can be played, so it
    // has to be the 6.
    const game = position({ white: { 13: 1 }, black: { 2: 2 }, turn: 'w', roll: [6, 5] });
    expect(game.maxUsed()).toBe(1);
    expect(describeMoves(game.legalMoves())).toBe('13/7');
    expect(game.play([{ from: 13, to: 8, die: 5, hit: false }])).toBe(null);
    expect(game.play([{ from: 13, to: 7, die: 6, hit: false }])).not.toBe(null);
  });

  it('allows the smaller die when the larger one cannot be played at all', () => {
    const game = position({ white: { 13: 1 }, black: { 7: 2, 2: 2 }, turn: 'w', roll: [6, 5] });
    expect(game.maxUsed()).toBe(1);
    expect(describeMoves(game.legalMoves())).toBe('13/8');
  });

  it('says nothing about which die to use when both are playable', () => {
    const game = position({ white: { 13: 1, 20: 1 }, black: {}, turn: 'w', roll: [6, 5] });
    expect(game.maxUsed()).toBe(2);
    const froms = new Set(game.legalMoves().map((m) => `${m.from}/${m.die}`));
    expect(froms).toEqual(new Set(['13/6', '13/5', '20/6', '20/5']));
  });
});

describe('distinct plays', () => {
  it('collapses the orders that reach the same position', () => {
    // 13/7 7/2 and 13/8 8/2 both end with one checker on 2 — one choice.
    const game = position({ white: { 13: 1 }, black: {}, turn: 'w', roll: [6, 5] });
    expect(playSet(game)).toEqual(new Set(['13/7 7/2']));
  });

  // Four checkers-on-points outcomes — {2,20} {7,15} {8,14} {9,13} — each
  // reachable several ways and each listed once, under whichever order the
  // generator happened to reach it first.
  it('keeps genuinely different plays apart', () => {
    const game = position({ white: { 13: 1, 20: 1 }, black: {}, turn: 'w', roll: [6, 5] });
    expect(playSet(game)).toEqual(
      new Set(['13/7 7/2', '13/7 20/15', '20/14 13/8', '20/14 14/9']),
    );
  });

  it('stays a manageable size from the opening position', () => {
    // A double from the opening board is the widest this ever gets. If this
    // ever ran to thousands the search below it would stop being affordable.
    const game = new Backgammon();
    game.setRoll(6, 5);
    game.play([
      { from: 24, to: 18, die: 6, hit: false },
      { from: 18, to: 13, die: 5, hit: false },
    ]);
    game.setRoll(3, 3);
    const plays = game.distinctPlays();
    expect(plays.length).toBeGreaterThan(5);
    expect(plays.length).toBeLessThan(200);
    for (const play of plays) expect(play.moves).toHaveLength(4);
  });

  it('agrees with what the move list would allow, play by play', () => {
    const game = new Backgammon();
    game.setRoll(4, 2);
    for (const play of game.distinctPlays()) {
      const checked = [];
      for (const move of play.moves) {
        const legal = game
          .legalMoves(checked)
          .find((m) => m.from === move.from && m.to === move.to && m.die === move.die);
        expect(legal, describeMoves(play.moves)).toBeTruthy();
        checked.push(legal);
      }
      expect(game.isPlayComplete(checked)).toBe(true);
    }
  });
});

describe('entering from the bar', () => {
  it('has to be done before anything else, twice over if need be', () => {
    const game = position({
      white: { 25: 2, 13: 3 },
      black: { 22: 2 },
      turn: 'w',
      roll: [3, 4],
    });
    // 25-3 = 22 is blocked, so only the 4 enters. One checker comes in and
    // the other stays: the 3 cannot be used while the bar is occupied.
    expect(game.maxUsed()).toBe(1);
    expect(describeMoves(game.legalMoves())).toBe('bar/21');
  });

  it('frees the rest of the board once the bar is clear', () => {
    const game = position({ white: { 25: 1, 13: 3 }, black: {}, turn: 'w', roll: [3, 4] });
    const first = game.legalMoves();
    expect(first.every((m) => m.from === 25)).toBe(true);
    const entered = first.find((m) => m.die === 3);
    expect(game.legalMoves([entered]).some((m) => m.from === 13)).toBe(true);
  });

  it('hits on the way in', () => {
    const game = position({ white: { 25: 1 }, black: { 21: 1, 5: 5 }, turn: 'w', roll: [4, 4] });
    const enter = game.legalMoves().find((m) => m.to === 21);
    expect(enter.hit).toBe(true);
    game.play([enter, ...replay(game, [enter])]);
    expect(game.bar('b')).toBe(1);
  });
});

/** Finish a turn by taking the first legal move at each step. */
function replay(game, pending) {
  const chosen = [];
  let moves = game.legalMoves([...pending]);
  while (moves.length) {
    chosen.push(moves[0]);
    moves = game.legalMoves([...pending, ...chosen]);
  }
  return chosen;
}
