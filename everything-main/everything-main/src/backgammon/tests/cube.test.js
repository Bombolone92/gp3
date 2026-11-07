import { describe, it, expect } from 'vitest';
import { Backgammon } from '../src/engine/backgammon.js';
import { position } from './helpers.js';

/** A game with the opening roll behind it, so it is somebody's turn to roll. */
function afterOpening() {
  const game = new Backgammon();
  game.setRoll(6, 5);
  game.play([
    { from: 24, to: 18, die: 6, hit: false },
    { from: 18, to: 13, die: 5, hit: false },
  ]);
  return game; // Black to roll
}

describe('when the cube may be turned', () => {
  it('is at the start of your own turn, before the dice', () => {
    const game = afterOpening();
    expect(game.phase()).toBe('roll');
    expect(game.canDouble('b')).toBe(true);
    expect(game.canDouble('w')).toBe(false);
  });

  it('is never in the middle of a turn', () => {
    const game = afterOpening();
    game.setRoll(3, 1);
    expect(game.canDouble('b')).toBe(false);
    expect(game.double()).toBe(null);
  });

  it('is never before the opening roll', () => {
    const game = new Backgammon();
    expect(game.canDouble('w')).toBe(false);
    expect(game.canDouble('b')).toBe(false);
  });

  it('belongs to whoever owns the cube once it has been turned', () => {
    const game = afterOpening();
    game.double();
    game.take();
    // White owns the cube now, so only White may turn it again.
    expect(game.cube()).toEqual({ value: 2, owner: 'w' });
    expect(game.canDouble('b')).toBe(false);
    game.setRoll(3, 1);
    game.play(firstPlay(game));
    expect(game.canDouble('w')).toBe(true);
  });

  it('stops at 64', () => {
    const game = position({ white: { 13: 1 }, black: { 12: 1 }, turn: 'w' });
    game.load({ ...game.snapshot(), cube: { value: 64, owner: 'w' }, phase: 'roll' });
    expect(game.canDouble('w')).toBe(false);
  });
});

describe('a game without the cube', () => {
  it('will not turn it, whoever asks and whenever', () => {
    const game = afterOpening();
    game.setCubeless(true);
    expect(game.cubeless()).toBe(true);
    expect(game.canDouble('b')).toBe(false);
    expect(game.canDouble('w')).toBe(false);
    expect(game.double()).toBe(null);
    expect(game.phase()).toBe('roll');
    expect(game.history()).toHaveLength(1);
  });

  it('still scores gammons and backgammons', () => {
    const game = position({
      white: { 1: 1 },
      black: { 3: 2, 13: 13 },
      off: { w: 14 },
      turn: 'w',
      roll: [1, 1],
    });
    game.setCubeless(true);
    game.play([{ from: 1, to: 0, die: 1, hit: false }]);
    expect(game.status().multiplier).toBe(3);
    expect(game.status().points).toBe(3); // the cube is 1 and stays there
  });

  it('keeps the setting across a new game', () => {
    const game = new Backgammon();
    game.setCubeless(true);
    game.reset();
    expect(game.cubeless()).toBe(true);
  });

  it('carries the setting through a snapshot', () => {
    const game = new Backgammon();
    game.setCubeless(true);
    const copy = new Backgammon(game.snapshot());
    expect(copy.cubeless()).toBe(true);
    expect(new Backgammon(new Backgammon().snapshot()).cubeless()).toBe(false);
  });
});

describe('taking and dropping', () => {
  it('doubles the stake and hands the cube over on a take', () => {
    const game = afterOpening();
    const offer = game.double();
    expect(offer).toEqual({ kind: 'double', color: 'b', from: 1, to: 2 });
    expect(game.phase()).toBe('double');
    expect(game.doubledTo()).toBe('w');
    game.take();
    expect(game.cube()).toEqual({ value: 2, owner: 'w' });
    expect(game.phase()).toBe('roll');
    expect(game.turn()).toBe('b'); // the doubler still owes a roll
  });

  it('ends the game at the old stake on a drop', () => {
    const game = afterOpening();
    game.double();
    game.drop();
    const status = game.status();
    expect(status.over).toBe(true);
    expect(status.winner).toBe('b');
    expect(status.points).toBe(1);
    expect(status.reason).toBe('dropped');
  });

  it('drops a redouble at the stake that was already agreed', () => {
    const game = afterOpening();
    game.double();
    game.take(); // cube 2, White owns it
    game.setRoll(3, 1);
    game.play(firstPlay(game));
    expect(game.canDouble('w')).toBe(true);
    game.double(); // White offers 4
    game.drop();
    expect(game.status().winner).toBe('w');
    expect(game.status().points).toBe(2);
  });

  it('multiplies a gammon by the cube', () => {
    const game = position({
      white: { 1: 1 },
      black: { 20: 2, 13: 13 },
      off: { w: 14 },
      turn: 'w',
      roll: [1, 1],
    });
    game.load({ ...game.snapshot(), cube: { value: 4, owner: 'w' }, phase: 'move' });
    game.play([{ from: 1, to: 0, die: 1, hit: false }]);
    expect(game.status().multiplier).toBe(2);
    expect(game.status().points).toBe(8);
  });
});

describe('undoing a cube action', () => {
  it('takes back a take, offer and all', () => {
    const game = afterOpening();
    game.double();
    game.take();
    game.undo();
    expect(game.phase()).toBe('double');
    expect(game.cube()).toEqual({ value: 1, owner: null });
    expect(game.doubledTo()).toBe('w');
    game.undo();
    expect(game.phase()).toBe('roll');
    expect(game.turn()).toBe('b');
    expect(game.doubledTo()).toBe(null);
  });

  it('takes back a drop, putting the game back on the table', () => {
    const game = afterOpening();
    game.double();
    game.drop();
    expect(game.status().over).toBe(true);
    game.undo();
    expect(game.status().over).toBe(false);
    expect(game.phase()).toBe('double');
  });
});

describe('resigning', () => {
  it('hands the game to the other side at the size offered', () => {
    const game = afterOpening();
    game.resign('b', 2);
    const status = game.status();
    expect(status.over).toBe(true);
    expect(status.winner).toBe('w');
    expect(status.points).toBe(2);
    expect(status.reason).toBe('resigned');
  });

  it('puts the game back exactly as it stood when undone', () => {
    const game = afterOpening();
    game.setRoll(4, 2);
    game.resign('b');
    game.undo();
    expect(game.phase()).toBe('move');
    expect(game.turn()).toBe('b');
    expect(game.roll()).toEqual([4, 2]);
    expect(game.status().over).toBe(false);
  });

  it('puts a double back on the table when the resignation came while it waited', () => {
    const game = afterOpening(); // Black to roll
    game.double();
    expect(game.doubledTo()).toBe('w');
    game.resign('w');
    game.undo();
    expect(game.phase()).toBe('double');
    expect(game.doubledTo()).toBe('w');
    expect(game.take()).toMatchObject({ kind: 'take', color: 'w', value: 2 });
    expect(game.cube()).toEqual({ value: 2, owner: 'w' });
    expect(game.turn()).toBe('b');
  });
});

/** Any complete legal play, taken greedily. */
function firstPlay(game) {
  const chosen = [];
  let moves = game.legalMoves(chosen);
  while (moves.length) {
    chosen.push(moves[0]);
    moves = game.legalMoves(chosen);
  }
  return chosen;
}
