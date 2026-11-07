import { describe, it, expect } from 'vitest';
import { Checkers } from '../src/engine/checkers.js';

describe('applying turns', () => {
  it('moves a man and hands over the turn', () => {
    const game = new Checkers();
    const move = game.move({ path: [11, 15] });
    expect(move.pdn).toBe('11-15');
    expect(game.get(11)).toBe(null);
    expect(game.get(15)).toBe('b');
    expect(game.turn()).toBe('w');
    expect(game.history()).toHaveLength(1);
    expect(game.lastMove().pdn).toBe('11-15');
  });

  it('removes every piece a chain jumps', () => {
    const game = new Checkers('B:W15,23:B11');
    game.move({ path: [11, 18, 27] });
    expect(game.get(15)).toBe(null);
    expect(game.get(23)).toBe(null);
    expect(game.get(27)).toBe('b');
  });

  it('crowns a man that reaches the far row', () => {
    const game = new Checkers('B:W1:B25');
    game.move({ path: [25, 29] });
    expect(game.get(29)).toBe('B');
  });

  // 11-18 is shaped like a jump but there is nothing on 15 to capture, and
  // 11-7 is backwards for a man. (11-16 would NOT do here: it is legal.)
  it('refuses an illegal path', () => {
    const game = new Checkers();
    expect(game.move({ path: [11, 18] })).toBe(null);
    expect(game.move({ path: [11, 7] })).toBe(null);
    expect(game.turn()).toBe('b');
  });

  it('refuses a quiet move when a capture is available', () => {
    const game = new Checkers('B:W19,28:B15,11');
    expect(game.move({ path: [11, 16] })).toBe(null);
    expect(game.move({ path: [15, 24] })).not.toBe(null);
  });

  it('undoes a chain, restoring captures and crowning', () => {
    const game = new Checkers('B:W15,23:B11');
    const before = game.fen();
    game.move({ path: [11, 18, 27] });
    game.undo();
    expect(game.fen()).toBe(before);
    expect(game.history()).toHaveLength(0);
    expect(game.turn()).toBe('b');
  });

  it('undoes a crowning back to a man', () => {
    const game = new Checkers('B:W1:B25');
    game.move({ path: [25, 29] });
    game.undo();
    expect(game.get(25)).toBe('b');
  });

  it('previews a partial sequence without changing the position', () => {
    const game = new Checkers('B:W15,23:B11');
    const board = game.preview([11, 18]);
    expect(board[11]).toBe(null);
    expect(board[15]).toBe(null);
    expect(board[18]).toBe('b');
    expect(board[23]).toBe('w');   // not yet taken
    expect(game.get(11)).toBe('b'); // real position untouched
  });
});

describe('endings', () => {
  it('is a loss for the side with no move', () => {
    const game = new Checkers('B:W13,14,18:B9');
    const status = game.status();
    expect(status.over).toBe(true);
    expect(status.reason).toBe('no moves');
    expect(status.result).toBe('1-0'); // Black cannot move, so White wins
    expect(game.isGameOver()).toBe(true);
  });

  it('is a loss for a side with no pieces', () => {
    const game = new Checkers('W:W:B1,2');
    expect(game.status().result).toBe('0-1');
  });

  it('is not over at the start', () => {
    const status = new Checkers().status();
    expect(status.over).toBe(false);
    expect(status.result).toBe('*');
    expect(status.reason).toBe(null);
  });

  it('reports the forced-capture obligation', () => {
    expect(new Checkers().status().mustCapture).toBe(false);
    expect(new Checkers('B:W19,27:B15').status().mustCapture).toBe(true);
  });

  it('draws on threefold repetition', () => {
    // Two kings shuffling between the same squares.
    const game = new Checkers('B:WK32:BK1');
    const cycle = [[1, 5], [32, 28], [5, 1], [28, 32]];
    for (let i = 0; i < 2; i++) {
      for (const path of cycle) game.move({ path });
    }
    expect(game.isThreefoldRepetition()).toBe(true);
    expect(game.status().result).toBe('1/2-1/2');
    expect(game.status().reason).toBe('threefold repetition');
  });

  it('resets the 40-move counter on a man move', () => {
    const game = new Checkers();
    game.move({ path: [11, 15] });
    expect(game.isFortyMoveRule()).toBe(false);
  });
});
