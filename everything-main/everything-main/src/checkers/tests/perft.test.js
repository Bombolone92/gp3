import { describe, it, expect } from 'vitest';
import { Checkers, perft } from '../src/engine/checkers.js';

describe('perft', () => {
  // Depth 1: only the four men on squares 9-12 can move, into the empty
  // squares 13-16. 9→13,14  10→14,15  11→15,16  12→16 = 7.
  // Depth 2: no piece is in contact yet, so White has the mirror-image 7
  // replies to each = 49. Both are hand-derivable and need no source.
  it('counts the opening moves', () => {
    expect(perft(new Checkers(), 1)).toBe(7);
    expect(perft(new Checkers(), 2)).toBe(49);
  });

  // SOURCE: Aart J. C. Bik, "Computing Deep Perft and Divide Numbers for
  // Checkers," ICGA Journal 35(4):206-213 (Dec 2012), doi:10.3233/ICG-2012-35403.
  // The full depth-0..28 table for the American-checkers starting position is
  // published at https://www.aartbik.com/MISC/checkers.html, which lists
  // perft(3..6) = 302, 1469, 7361, 36768 exactly as asserted below. (Its
  // perft(7)=179740 and perft(8)=845931 also match this engine, though only
  // depths 1-6 are asserted here to keep the suite fast.)
  it('matches the published node counts', () => {
    expect(perft(new Checkers(), 3)).toBe(302);
    expect(perft(new Checkers(), 4)).toBe(1469);
    expect(perft(new Checkers(), 5)).toBe(7361);
    expect(perft(new Checkers(), 6)).toBe(36768);
  });

  it('leaves the position untouched', () => {
    const game = new Checkers();
    const fen = game.fen();
    perft(game, 4);
    expect(game.fen()).toBe(fen);
    expect(game.history()).toHaveLength(0);
  });
});
