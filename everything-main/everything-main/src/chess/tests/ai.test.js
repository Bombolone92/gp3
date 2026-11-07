import { describe, it, expect } from 'vitest';
import { Chess } from '../src/engine/chess.js';
import { findBestMove, evaluate, LEVELS } from '../src/engine/ai.js';

describe('evaluation', () => {
  it('scores the start position as balanced', () => {
    expect(evaluate(new Chess())).toBe(0);
  });

  it('favors the side with more material', () => {
    const whiteUp = new Chess('k7/8/8/8/8/8/8/K2Q4 w - - 0 1');
    expect(evaluate(whiteUp)).toBeGreaterThan(500);
    const blackUp = new Chess('k2q4/8/8/8/8/8/8/K7 w - - 0 1');
    expect(evaluate(blackUp)).toBeLessThan(-500);
  });
});

describe('findBestMove', () => {
  it('returns a legal move from the start position at every level', () => {
    for (const level of Object.keys(LEVELS)) {
      const game = new Chess();
      const move = findBestMove(game, level);
      expect(game.move(move)).not.toBe(null);
      game.undo();
    }
  });

  it('returns null when the game is over', () => {
    const mated = new Chess('7k/5ppp/R7/8/8/8/8/6K1 b - - 0 1');
    // Not actually mate; construct a mated position by playing Ra8.
    const game = new Chess('7k/5ppp/8/8/8/8/8/R5K1 w - - 0 1');
    game.move({ from: 'a1', to: 'a8' });
    expect(game.isCheckmate()).toBe(true);
    expect(findBestMove(game, 'hard')).toBe(null);
    expect(mated.isCheckmate()).toBe(false);
  });

  it('finds mate in one as white', () => {
    const game = new Chess('7k/5ppp/8/8/8/8/8/R5K1 w - - 0 1');
    const move = findBestMove(game, 'hard');
    expect(`${move.from}${move.to}`).toBe('a1a8');
  });

  it('finds mate in one as black', () => {
    const game = new Chess('r5k1/8/8/8/8/8/5PPP/7K b - - 0 1');
    const move = findBestMove(game, 'hard');
    expect(`${move.from}${move.to}`).toBe('a8a1');
  });

  it('prefers mate over material', () => {
    // Rxd5 wins a knight, but Ra8 is mate (the knight cannot block or capture).
    const game = new Chess('7k/5ppp/8/3n4/8/8/3R4/R5K1 w - - 0 1');
    const move = findBestMove(game, 'hard');
    expect(`${move.from}${move.to}`).toBe('a1a8');
  });

  it('captures a hanging queen', () => {
    const game = new Chess('k7/8/8/3q4/8/8/8/K2R4 w - - 0 1');
    const move = findBestMove(game, 'hard');
    expect(`${move.from}${move.to}`).toBe('d1d5');
  });

  it('does not hang its queen to an obvious recapture', () => {
    // Qxe5 would be met by dxe5; medium and hard must see the recapture.
    const game = new Chess('k7/8/3p4/4p3/8/8/4Q3/K7 w - - 0 1');
    const move = findBestMove(game, 'hard', () => 0);
    expect(`${move.from}${move.to}`).not.toBe('e2e5');
  });

  it('promotes when a pawn reaches the last rank', () => {
    const game = new Chess('8/P6k/8/8/8/8/8/K7 w - - 0 1');
    const move = findBestMove(game, 'hard');
    expect(move.from).toBe('a7');
    expect(move.to).toBe('a8');
    expect(move.promotion).toBe('q');
  });

  it('is deterministic with a fixed rng and zero window', () => {
    const a = findBestMove(new Chess(), { depth: 2, window: 0, quiescence: true }, () => 0);
    const b = findBestMove(new Chess(), { depth: 2, window: 0, quiescence: true }, () => 0);
    expect(a).toEqual(b);
  });

  it('leaves the game state untouched', () => {
    const game = new Chess();
    const before = game.fen();
    findBestMove(game, 'hard');
    expect(game.fen()).toBe(before);
  });

  it('never picks a move outside the difficulty window', () => {
    // Regression: root moves cut off by the windowed search returned upper
    // bounds that could land exactly on the candidate threshold, letting
    // moves worse than the window intends into the random pool.
    const fen = 'rnbqkbnr/p1ppp1pp/5p2/1p6/6P1/P4P1P/1PPPP3/RNBQKBNR b KQkq - 0 4';
    // Exact value of playing `mv`, searched at the same total depth and
    // quiescence setting the level uses: the move itself plus a depth-1 reply
    // search with a full window.
    const exactScore = (game, mv, cfg) => {
      game.move(mv);
      const reply = findBestMove(game, {
        depth: cfg.depth - 1,
        window: 0,
        quiescence: cfg.quiescence,
      });
      game.undo();
      return -reply.score;
    };
    for (const level of ['medium', 'hard']) {
      const cfg = LEVELS[level];
      const game = new Chess(fen);
      const exact = new Map(
        game.moves().map((mv) => [`${mv.from}${mv.to}`, exactScore(game, mv, cfg)]),
      );
      const best = Math.max(...exact.values());
      // Sweep the rng so every candidate the pool can produce gets returned.
      const n = 4 * exact.size;
      for (let k = 0; k < n; k++) {
        const pick = findBestMove(game, level, () => k / n);
        expect(exact.get(`${pick.from}${pick.to}`)).toBeGreaterThanOrEqual(
          best - cfg.window,
        );
      }
    }
  });
});

describe('draws by rule', () => {
  // King and queen against a lone king. Shuffling the queen between e2 and e3
  // while the king steps d5-d6 brings every position round a second time.
  const KQ = '8/8/8/3k4/8/8/4Q3/4K3 w - - 0 1';
  const play = (game, ...moves) => {
    for (const [from, to] of moves) {
      expect(game.move({ from, to })).not.toBe(null);
    }
  };
  const cycle = [['e2', 'e3'], ['d5', 'd6'], ['e3', 'e2'], ['d6', 'd5']];

  it('does not repeat a position for the third time while winning', () => {
    const game = new Chess(KQ);
    // The position after Qe3 (queen e3, king d5) has come up twice; reaching
    // it again from h3 would be the third time.
    play(game, ...cycle, ['e2', 'e3'], ['d5', 'd6'], ['e3', 'h3'], ['d6', 'd5']);
    const move = findBestMove(game, 'hard', () => 0);
    expect(`${move.from}${move.to}`).not.toBe('h3e3');
    game.move(move);
    expect(game.isThreefoldRepetition()).toBe(false);
  });

  it('does not let the opponent repeat a position for the third time either', () => {
    const game = new Chess(KQ);
    // The start position has come up twice: after Qe2 Black could play ...Kd5
    // and draw on the spot.
    play(game, ...cycle, ['e2', 'e3'], ['d5', 'd6']);
    const move = findBestMove(game, 'hard', () => 0);
    expect(`${move.from}${move.to}`).not.toBe('e3e2');
    game.move(move);
    for (const reply of game.moves()) {
      game.move(reply);
      expect(game.isThreefoldRepetition()).toBe(false);
      game.undo();
    }
  });

  it('claims a draw by repetition when losing', () => {
    const game = new Chess(KQ);
    play(game, ...cycle, ['e2', 'e3'], ['d5', 'd6'], ['e3', 'e2']);
    // Black, a lone king against a queen, can make the third repetition.
    const move = findBestMove(game, 'hard', () => 0);
    expect(`${move.from}${move.to}`).toBe('d6d5');
    expect(move.score).toBe(0);
  });

  it('does not walk into the fifty-move rule while winning', () => {
    // One more quiet move draws; only the pawn can reset the count.
    const game = new Chess('8/8/8/3k4/8/8/P3Q3/4K3 w - - 99 60');
    const move = findBestMove(game, 'hard', () => 0);
    expect(move.from).toBe('a2');
    game.move(move);
    expect(game.isFiftyMoveRule()).toBe(false);
  });

  it('still mates on the hundredth half-move', () => {
    // Ra8 is the move that reaches the fifty-move count, but mate comes first.
    const game = new Chess('7k/5ppp/8/8/8/8/8/R5K1 w - - 99 60');
    const move = findBestMove(game, 'hard', () => 0);
    expect(`${move.from}${move.to}`).toBe('a1a8');
    game.move(move);
    expect(game.status().reason).toBe('checkmate');
  });
});

describe('mating a lone king', () => {
  const playOut = (fen, maxPlies = 120) => {
    const game = new Chess(fen);
    let plies = 0;
    while (!game.isGameOver() && plies < maxPlies) {
      const move = findBestMove(game, 'hard', () => 0);
      game.move(move);
      plies++;
    }
    return game.status();
  };

  it('mates with king and queen', () => {
    expect(playOut('8/8/8/3k4/8/8/4Q3/4K3 w - - 0 1').reason).toBe('checkmate');
    expect(playOut('8/3k4/8/8/8/8/8/QK6 w - - 0 1').reason).toBe('checkmate');
  });

  it('mates with king and rook', () => {
    expect(playOut('8/8/8/3k4/8/8/4R3/4K3 w - - 0 1').reason).toBe('checkmate');
  });

  it('mates as black too', () => {
    expect(playOut('4k3/4q3/8/8/8/8/8/3K4 b - - 0 1').result).toBe('0-1');
  });
});
