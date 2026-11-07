import { describe, it, expect } from 'vitest';
import { Checkers, START_FEN, colorOf, isKing } from '../src/engine/checkers.js';

describe('position', () => {
  it('starts with Black to move and twelve men a side', () => {
    const game = new Checkers();
    expect(game.turn()).toBe('b');
    for (let n = 1; n <= 12; n++) expect(game.get(n)).toBe('b');
    for (let n = 13; n <= 20; n++) expect(game.get(n)).toBe(null);
    for (let n = 21; n <= 32; n++) expect(game.get(n)).toBe('w');
  });

  it('round-trips the start position through FEN', () => {
    expect(new Checkers().fen()).toBe(START_FEN);
    expect(new Checkers(START_FEN).fen()).toBe(START_FEN);
  });

  it('loads kings and an arbitrary position', () => {
    const game = new Checkers('W:WK32:B5,K6');
    expect(game.turn()).toBe('w');
    expect(game.get(32)).toBe('W');
    expect(game.get(5)).toBe('b');
    expect(game.get(6)).toBe('B');
    expect(game.get(1)).toBe(null);
    expect(game.fen()).toBe('W:WK32:B5,K6');
  });

  it('resets back to the start', () => {
    const game = new Checkers('W:WK32:B5');
    game.reset();
    expect(game.fen()).toBe(START_FEN);
  });

  it('rejects a malformed FEN', () => {
    expect(() => new Checkers('nonsense')).toThrow();
    expect(() => new Checkers('B:W99:B1')).toThrow();
  });

  it('reads colour and rank off a piece', () => {
    expect(colorOf('b')).toBe('b');
    expect(colorOf('W')).toBe('w');
    expect(isKing('B')).toBe(true);
    expect(isKing('b')).toBe(false);
  });
});
