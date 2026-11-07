import { describe, it, expect } from 'vitest';
import { Checkers } from '../src/engine/checkers.js';
import { LEVELS, evaluate, findBestMove } from '../src/engine/ai.js';

const level = (over) => ({ depth: 2, window: 0, ...over });

describe('evaluation', () => {
  it('is even at the start', () => {
    expect(evaluate(new Checkers())).toBe(0);
  });

  it('prefers having more material', () => {
    expect(evaluate(new Checkers('B:W21:B1,2'))).toBeGreaterThan(0);
    expect(evaluate(new Checkers('B:W21,22:B1'))).toBeLessThan(0);
  });

  it('values a king above a man', () => {
    const withKing = evaluate(new Checkers('B:W21:BK1'));
    const withMan = evaluate(new Checkers('B:W21:B1'));
    expect(withKing).toBeGreaterThan(withMan);
  });
});

describe('search', () => {
  it('returns null when there is nothing to play', () => {
    expect(findBestMove(new Checkers('B:W13,14,18:B9'), level())).toBe(null);
  });

  it('returns a legal move', () => {
    const game = new Checkers();
    const move = findBestMove(game, level());
    expect(game.moves().some((m) => m.pdn === move.pdn)).toBe(true);
  });

  it('takes a free piece', () => {
    // Black to move with one capture available and nothing to fear.
    const game = new Checkers('B:W19:B15,11,12');
    expect(findBestMove(game, level()).pdn).toBe('15x24');
  });

  it('prefers the capture that wins more material', () => {
    // Black can take one man with 14x21, or two with either 14x23 chain.
    const game = new Checkers('B:W17,18,26,27:B14');
    const move = findBestMove(game, level({ depth: 4 }));
    expect(move.captured).toHaveLength(2);
  });

  it('avoids walking into a capture', () => {
    // 11-16 hangs the man to 20x11; 11-15 does not.
    const game = new Checkers('B:W20,32:B11,1');
    const move = findBestMove(game, level({ depth: 3 }));
    expect(move.pdn).not.toBe('11-16');
  });

  it('sees a shot that wins the game inside the capture horizon', () => {
    // 24-27 gives a man away: White must take it (31x24), and 20x27 then
    // takes White's last piece. The win lands in quiescence at depth 2.
    const game = new Checkers('B:W31:B24,3,20');
    expect(findBestMove(game, level()).pdn).toBe('24-27');
  });

  it('leaves the position untouched', () => {
    const game = new Checkers();
    const fen = game.fen();
    findBestMove(game, LEVELS.medium);
    expect(game.fen()).toBe(fen);
    expect(game.history()).toHaveLength(0);
  });

  it('is deterministic with a fixed rng', () => {
    const pick = () => findBestMove(new Checkers(), LEVELS.easy, () => 0).pdn;
    expect(pick()).toBe(pick());
  });

  it('defines three levels of increasing depth', () => {
    expect(LEVELS.easy.depth).toBeLessThan(LEVELS.medium.depth);
    expect(LEVELS.medium.depth).toBeLessThan(LEVELS.hard.depth);
    expect(LEVELS.easy.window).toBeGreaterThan(LEVELS.hard.window);
  });
});
