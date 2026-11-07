/**
 * Computer opponent: negamax with alpha-beta pruning over the checkers
 * engine's whole-turn move list.
 *
 * Two things are easier here than in chess. Checkers branches about eight
 * ways rather than thirty-five, so the same budget searches far deeper; and
 * quiescence is exact rather than heuristic, because capture is mandatory —
 * a position is quiet precisely when the side to move has no jump.
 *
 * Difficulty combines depth with a randomness window: the engine picks
 * uniformly among root moves scoring within `window` of the best, so lower
 * levels play plausible-but-imperfect checkers.
 */

import { colorOf, isKing } from './checkers.js';
import { squareToRowCol } from './geometry.js';

const WIN = 100000;
const INFINITY = 1000000;

export const MAN = 100;
export const KING = 175;

// Measured (Step 5, this machine): depth 10 spikes to ~3.6s on a single
// opening move (avg 1.66s/move over 8 plies) — over the ~1500ms budget.
// Depth 9 still spikes to ~1.2s on an open king-heavy position, too close to
// the budget for headroom. Depth 8 stayed under 500ms worst-case across the
// opening, a man-heavy middlegame, and a king-heavy open position (typical
// 30-300ms/move), so hard was lowered from the brief's starting depth 10.
export const LEVELS = {
  easy: { depth: 2, window: 120, label: 'Easy' },
  medium: { depth: 6, window: 30, label: 'Medium' },
  hard: { depth: 8, window: 0, label: 'Hard' },
};

/**
 * Static evaluation from Black's perspective.
 *
 * Material and shape only. A mobility term would have to call moves(), which
 * generates every jump chain on the board — at every leaf of a depth-10
 * search that costs more than it is worth, and the search already sees
 * mobility directly in the moves it enumerates.
 */
export function evaluate(game) {
  const board = game.board();
  let score = 0;
  for (let n = 1; n <= 32; n++) {
    const piece = board[n];
    if (!piece) continue;
    const black = colorOf(piece) === 'b';
    const [row, col] = squareToRowCol(n);
    let value = isKing(piece) ? KING : MAN;
    if (!isKing(piece)) {
      // Men are worth more the closer they are to crowning.
      value += (black ? row : 7 - row) * 4;
      // Holding your own back row denies the opponent a crowning square.
      if ((black && row === 0) || (!black && row === 7)) value += 6;
    }
    // An edge piece cannot be jumped, but cannot jump either.
    value += col === 0 || col === 7 ? -4 : 2;
    score += black ? value : -value;
  }
  return score;
}

/** Evaluation from the point of view of the side to move. */
function sideScore(game) {
  return game.turn() === 'b' ? evaluate(game) : -evaluate(game);
}

/** Captures first, longest chain first: the cheapest useful ordering. */
function orderMoves(moves) {
  return moves.slice().sort((a, b) => b.captured.length - a.captured.length);
}

/**
 * Search on while the side to move is obliged to jump. Forced capture makes
 * this exact: there is no "quiet" position in which a capture is pending, so
 * the horizon can never fall in the middle of an exchange. A quiet position
 * can still be over, though — the exchange that led here may have taken the
 * last piece, or left every remaining one blocked — and that is a loss, not a
 * material count.
 */
function quiescence(game, alpha, beta, ply) {
  if (!game.mustCapture()) {
    return game.moves().length === 0 ? -WIN + ply : sideScore(game);
  }
  const moves = game.moves();
  if (moves.length === 0) return -WIN + ply;
  let best = -INFINITY;
  for (const move of moves) {
    game.move({ path: move.path });
    const score = -quiescence(game, -beta, -alpha, ply + 1);
    game.undo();
    if (score > best) best = score;
    if (score > alpha) alpha = score;
    if (alpha >= beta) break;
  }
  return best;
}

function search(game, depth, alpha, beta, ply) {
  const moves = orderMoves(game.moves());
  // No move is a loss in checkers, not a draw — there is no stalemate.
  if (moves.length === 0) return -WIN + ply;
  if (game.isDraw()) return 0;
  if (depth === 0) return quiescence(game, alpha, beta, ply);
  let best = -INFINITY;
  for (const move of moves) {
    game.move({ path: move.path });
    const score = -search(game, depth - 1, -beta, -alpha, ply + 1);
    game.undo();
    if (score > best) best = score;
    if (score > alpha) alpha = score;
    if (alpha >= beta) break;
  }
  return best;
}

export function findBestMove(game, level = 'medium', rng = Math.random) {
  const cfg = typeof level === 'string' ? LEVELS[level] : level;
  if (!cfg) throw new Error(`Unknown difficulty level: ${level}`);

  const rootMoves = orderMoves(game.moves());
  if (rootMoves.length === 0) return null;

  const scored = [];
  let alpha = -INFINITY;
  for (const move of rootMoves) {
    game.move({ path: move.path });
    const score = -search(game, cfg.depth - 1, -INFINITY, -alpha + cfg.window, 1);
    game.undo();
    // A beta cutoff in the child search means `score` is only an upper bound.
    scored.push({ move, score, exact: score > alpha - cfg.window });
    if (score > alpha) alpha = score;
  }

  const best = Math.max(...scored.map((s) => s.score));
  // An upper bound can land exactly on the threshold while the true value is
  // far below it; re-search those with a full window so the random pick never
  // selects a move from outside the intended band.
  for (const s of scored) {
    if (!s.exact && s.score >= best - cfg.window) {
      game.move({ path: s.move.path });
      s.score = -search(game, cfg.depth - 1, -INFINITY, INFINITY, 1);
      game.undo();
    }
  }
  const candidates = scored.filter((s) => s.score >= best - cfg.window);
  return candidates[Math.floor(rng() * candidates.length)].move;
}

/**
 * Async wrapper: yields to the event loop so the UI can paint a "thinking"
 * state, and enforces a minimum think time so replies feel deliberate.
 */
export function chooseMove(game, level, { minThinkMs = 450 } = {}) {
  return new Promise((resolve) => {
    setTimeout(() => {
      const started = performance.now();
      const move = findBestMove(game, level);
      const elapsed = performance.now() - started;
      setTimeout(() => resolve(move), Math.max(0, minThinkMs - elapsed));
    }, 30);
  });
}
