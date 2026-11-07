import { describe, it, expect } from 'vitest';
import { Chess, START_FEN, squareToIndex, indexToSquare } from '../src/engine/chess.js';

describe('square conversion', () => {
  it('maps corners correctly', () => {
    expect(squareToIndex('a8')).toBe(0);
    expect(squareToIndex('h8')).toBe(7);
    expect(squareToIndex('a1')).toBe(56);
    expect(squareToIndex('h1')).toBe(63);
    expect(indexToSquare(0)).toBe('a8');
    expect(indexToSquare(63)).toBe('h1');
  });

  it('round-trips every square', () => {
    for (let i = 0; i < 64; i++) {
      expect(squareToIndex(indexToSquare(i))).toBe(i);
    }
  });

  it('rejects invalid squares', () => {
    expect(() => squareToIndex('i1')).toThrow();
    expect(() => squareToIndex('a9')).toThrow();
  });
});

describe('FEN', () => {
  it('round-trips the start position', () => {
    const game = new Chess();
    expect(game.fen()).toBe(START_FEN);
  });

  it('round-trips arbitrary positions', () => {
    const fens = [
      'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
      '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',
      'rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 2',
      '4k3/8/8/8/8/8/8/4K3 b - - 42 99',
    ];
    for (const fen of fens) {
      expect(new Chess(fen).fen()).toBe(fen);
    }
  });

  it('reads pieces off the board', () => {
    const game = new Chess();
    expect(game.get('e1')).toBe('K');
    expect(game.get('d8')).toBe('q');
    expect(game.get('e4')).toBe(null);
  });

  it('rejects malformed FENs', () => {
    expect(() => new Chess('not a fen')).toThrow();
    expect(() => new Chess('8/8/8/8/8/8/8 w - - 0 1')).toThrow(); // 7 ranks
    expect(() => new Chess('9/8/8/8/8/8/8/8 w - - 0 1')).toThrow(); // bad rank
    expect(() => new Chess('8/8/8/8/8/8/8/8 w - - 0 1')).toThrow(); // no kings
    expect(() => new Chess('4k3/8/8/8/8/8/8/4K3 x - - 0 1')).toThrow(); // bad turn
  });

  it('updates the FEN as moves are played', () => {
    const game = new Chess();
    game.move({ from: 'e2', to: 'e4' });
    expect(game.fen()).toBe(
      'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1',
    );
    game.move({ from: 'c7', to: 'c5' });
    expect(game.fen()).toBe(
      'rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq c6 0 2',
    );
  });
});
