import { describe, it, expect } from 'vitest';
import { Checkers } from '../src/engine/checkers.js';

const pdns = (game, opts) => game.moves(opts).map((m) => m.pdn).sort();

describe('move generation', () => {
  it('offers seven opening moves for Black', () => {
    expect(pdns(new Checkers())).toEqual(
      ['10-14', '10-15', '11-15', '11-16', '12-16', '9-13', '9-14'].sort(),
    );
  });

  it('offers seven opening moves for White', () => {
    // Equivalent to playing 11-15 and handing the turn to White: `move()`
    // does not exist until Task 5, so the position is built directly.
    const game = new Checkers('W:W21,22,23,24,25,26,27,28,29,30,31,32:B1,2,3,4,5,6,7,8,9,10,12,15');
    expect(game.moves()).toHaveLength(7);
  });

  it('filters by origin square', () => {
    expect(pdns(new Checkers(), { square: 9 })).toEqual(['9-13', '9-14']);
    expect(pdns(new Checkers(), { square: 1 })).toEqual([]);
  });

  it('makes capture mandatory', () => {
    // Black man on 15, White man on 19: the only legal move is the jump.
    const game = new Checkers('B:W19,28:B15,11');
    expect(game.mustCapture()).toBe(true);
    expect(pdns(game)).toEqual(['15x24']);
  });

  it('lets the player choose among several captures', () => {
    // A Black man on 14 can take either way.
    const game = new Checkers('B:W17,18:B14');
    expect(pdns(game)).toEqual(['14x21', '14x23'].sort());
  });

  it('chains a double jump into one move', () => {
    const game = new Checkers('B:W15,23:B11');
    const moves = game.moves();
    expect(moves).toHaveLength(1);
    expect(moves[0].path).toEqual([11, 18, 27]);
    expect(moves[0].captured).toEqual([15, 23]);
    expect(moves[0].pdn).toBe('11x18x27');
  });

  it('stops a chain at the crowning row', () => {
    // 24x31 crowns; a further jump from 31 is not offered.
    const game = new Checkers('B:W27,22:B24');
    const moves = game.moves();
    expect(moves).toHaveLength(1);
    expect(moves[0].path).toEqual([24, 31]);
    expect(moves[0].crowned).toBe(true);
  });

  // The hard case: a man crowning on 31 would have a real backward jump
  // available (over 27, landing on the empty 24) if crowning did not end
  // the turn there and then.
  it('ends the turn on crowning even when the new king could jump on', () => {
    const game = new Checkers('B:W26,27:B22');
    expect(game.moves().map((m) => m.pdn)).toEqual(['22x31']);
  });

  // A king can circle a diamond of four men and land back where it started.
  it('lets a jumping piece land on the square it came from', () => {
    const game = new Checkers('B:W6,7,14,15:BK2');
    expect(game.moves().map((m) => m.pdn).sort()).toEqual(
      ['2x11x18x9x2', '2x9x18x11x2'],
    );
  });

  it('never jumps the same piece twice in one sequence', () => {
    const game = new Checkers('B:WK18:BK15');
    // A king can circle, but 18 is gone after the first hop.
    for (const move of game.moves()) {
      expect(new Set(move.captured).size).toBe(move.captured.length);
    }
  });

  it('moves men forward only and kings every way', () => {
    expect(pdns(new Checkers('B:W32:B15'))).toEqual(['15-18', '15-19']);
    expect(pdns(new Checkers('B:W32:BK15'))).toEqual(
      ['15-10', '15-11', '15-18', '15-19'].sort(),
    );
  });

  it('gives a trapped side no moves at all', () => {
    // Black man on 9 is edge-boxed by 13 (off-board landing) and 14 (landing
    // square 18 occupied): no quiet step and no jump either way.
    expect(new Checkers('B:W13,14,18:B9').moves()).toEqual([]);
  });
});
