import { describe, it, expect } from 'vitest';
import { Chess, perft } from '../src/engine/chess.js';

/**
 * Perft counts every legal move sequence to a fixed depth and compares
 * against independently verified reference values (chessprogramming.org).
 * These positions collectively exercise castling, en passant, promotions,
 * pins, and discovered checks.
 */
describe('perft', () => {
  it('start position', () => {
    const game = new Chess();
    expect(perft(game, 1)).toBe(20);
    expect(perft(game, 2)).toBe(400);
    expect(perft(game, 3)).toBe(8902);
    expect(perft(game, 4)).toBe(197281);
  });

  it('kiwipete (castling, pins, discovered checks)', () => {
    const game = new Chess(
      'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
    );
    expect(perft(game, 1)).toBe(48);
    expect(perft(game, 2)).toBe(2039);
    expect(perft(game, 3)).toBe(97862);
  });

  it('position 3 (en passant, pinned pawns)', () => {
    const game = new Chess('8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1');
    expect(perft(game, 1)).toBe(14);
    expect(perft(game, 2)).toBe(191);
    expect(perft(game, 4)).toBe(43238);
  });

  it('position 4 (promotions)', () => {
    const game = new Chess(
      'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1',
    );
    expect(perft(game, 1)).toBe(6);
    expect(perft(game, 3)).toBe(9467);
  });

  it('position 5 (castling under threat)', () => {
    const game = new Chess(
      'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8',
    );
    expect(perft(game, 1)).toBe(44);
    expect(perft(game, 2)).toBe(1486);
    expect(perft(game, 3)).toBe(62379);
  });

  it('perft leaves the position unchanged', () => {
    const game = new Chess();
    const before = game.fen();
    perft(game, 3);
    expect(game.fen()).toBe(before);
  });
});
