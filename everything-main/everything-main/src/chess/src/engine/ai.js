/**
 * Computer opponent: negamax search with alpha-beta pruning, MVV-LVA move
 * ordering, and an optional quiescence search, on top of a material +
 * piece-square-table evaluation ("Simplified Evaluation Function" tables) with
 * a mop-up term for mating a lone king. Moves that end the game by threefold
 * repetition or the fifty-move rule are scored as the draw they are.
 *
 * Difficulty is a combination of search depth and a randomness window: the
 * engine picks uniformly among root moves scoring within `window` centipawns
 * of the best move, so lower levels play plausible-but-imperfect chess.
 */

import { WHITE, indexToSquare } from './chess.js';

const MATE = 100000;
const INFINITY = 1000000;

export const PIECE_VALUES = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

// Piece-square tables from White's perspective, rank 8 first — which matches
// the engine's board indexing directly. Black uses the vertically mirrored
// square (index ^ 56).
const PST = {
  p: [
     0,  0,  0,  0,  0,  0,  0,  0,
    50, 50, 50, 50, 50, 50, 50, 50,
    10, 10, 20, 30, 30, 20, 10, 10,
     5,  5, 10, 25, 25, 10,  5,  5,
     0,  0,  0, 20, 20,  0,  0,  0,
     5, -5,-10,  0,  0,-10, -5,  5,
     5, 10, 10,-20,-20, 10, 10,  5,
     0,  0,  0,  0,  0,  0,  0,  0,
  ],
  n: [
    -50,-40,-30,-30,-30,-30,-40,-50,
    -40,-20,  0,  0,  0,  0,-20,-40,
    -30,  0, 10, 15, 15, 10,  0,-30,
    -30,  5, 15, 20, 20, 15,  5,-30,
    -30,  0, 15, 20, 20, 15,  0,-30,
    -30,  5, 10, 15, 15, 10,  5,-30,
    -40,-20,  0,  5,  5,  0,-20,-40,
    -50,-40,-30,-30,-30,-30,-40,-50,
  ],
  b: [
    -20,-10,-10,-10,-10,-10,-10,-20,
    -10,  0,  0,  0,  0,  0,  0,-10,
    -10,  0,  5, 10, 10,  5,  0,-10,
    -10,  5,  5, 10, 10,  5,  5,-10,
    -10,  0, 10, 10, 10, 10,  0,-10,
    -10, 10, 10, 10, 10, 10, 10,-10,
    -10,  5,  0,  0,  0,  0,  5,-10,
    -20,-10,-10,-10,-10,-10,-10,-20,
  ],
  r: [
     0,  0,  0,  0,  0,  0,  0,  0,
     5, 10, 10, 10, 10, 10, 10,  5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
     0,  0,  0,  5,  5,  0,  0,  0,
  ],
  q: [
    -20,-10,-10, -5, -5,-10,-10,-20,
    -10,  0,  0,  0,  0,  0,  0,-10,
    -10,  0,  5,  5,  5,  5,  0,-10,
     -5,  0,  5,  5,  5,  5,  0, -5,
      0,  0,  5,  5,  5,  5,  0, -5,
    -10,  5,  5,  5,  5,  5,  0,-10,
    -10,  0,  5,  0,  0,  0,  0,-10,
    -20,-10,-10, -5, -5,-10,-10,-20,
  ],
  k: [
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -20,-30,-30,-40,-40,-30,-30,-20,
    -10,-20,-20,-20,-20,-20,-20,-10,
     20, 20,  0,  0,  0,  0, 20, 20,
     20, 30, 10,  0,  0, 10, 30, 20,
  ],
  kEnd: [
    -50,-40,-30,-20,-20,-30,-40,-50,
    -30,-20,-10,  0,  0,-10,-20,-30,
    -30,-10, 20, 30, 30, 20,-10,-30,
    -30,-10, 30, 40, 40, 30,-10,-30,
    -30,-10, 30, 40, 40, 30,-10,-30,
    -30,-10, 20, 30, 30, 20,-10,-30,
    -30,-30,  0,  0,  0,  0,-30,-30,
    -50,-30,-30,-30,-30,-30,-30,-50,
  ],
};

export const LEVELS = {
  easy: { depth: 1, window: 150, quiescence: false, label: 'Easy' },
  medium: { depth: 2, window: 40, quiescence: true, label: 'Medium' },
  hard: { depth: 3, window: 0, quiescence: true, label: 'Hard' },
};

/** Manhattan distance from the middle of the board: 0 centrally, 6 in a corner. */
function centerDistance(square) {
  const f = square & 7;
  const r = square >> 3;
  return Math.max(3 - f, f - 4) + Math.max(3 - r, r - 4);
}

/** Manhattan distance between two squares (kings: 2 apart at the closest). */
function kingDistance(a, b) {
  return Math.abs((a & 7) - (b & 7)) + Math.abs((a >> 3) - (b >> 3));
}

/**
 * Mop-up bonus for the side mating a lone king. Material and piece-square
 * tables go flat once the opponent has nothing left to lose, and a shallow
 * search then finds no reason to make progress — it shuffles a queen around
 * until the game is drawn by repetition or the fifty-move rule. This is what
 * every mating pattern with a lone king comes down to: drive it to the edge,
 * and bring the attacking king up to help.
 */
function mopUp(winnerKing, loserKing) {
  return 10 * centerDistance(loserKing) + 4 * (14 - kingDistance(winnerKing, loserKing));
}

/** Static evaluation in centipawns from White's perspective. */
export function evaluate(game) {
  const board = game._board;
  let score = 0;
  let nonPawnMaterial = 0;
  let whiteMaterial = 0;
  let blackMaterial = 0;
  for (let i = 0; i < 64; i++) {
    const piece = board[i];
    if (piece === null) continue;
    const isWhite = piece.charCodeAt(0) < 97;
    const type = piece.toLowerCase();
    if (type === 'k') continue;
    if (type !== 'p') nonPawnMaterial += PIECE_VALUES[type];
    const value = PIECE_VALUES[type] + PST[type][isWhite ? i : i ^ 56];
    if (isWhite) {
      score += value;
      whiteMaterial += PIECE_VALUES[type];
    } else {
      score -= value;
      blackMaterial += PIECE_VALUES[type];
    }
  }
  // The king tables give way to the mop-up terms against a lone king: the
  // endgame table rewards a centralized king, which is exactly what stops the
  // attacking king from walking over to help deliver mate.
  if (blackMaterial === 0 && whiteMaterial > 0) {
    score += mopUp(game._kw, game._kb);
  } else if (whiteMaterial === 0 && blackMaterial > 0) {
    score -= mopUp(game._kb, game._kw);
  } else {
    const kingTable = nonPawnMaterial <= 2000 ? PST.kEnd : PST.k;
    score += kingTable[game._kw];
    score -= kingTable[game._kb ^ 56];
  }
  return score;
}

function sideScore(game) {
  return game._turn === WHITE ? evaluate(game) : -evaluate(game);
}

function orderMoves(moves) {
  for (const m of moves) {
    let score = 0;
    if (m.captured) {
      score = 10 * PIECE_VALUES[m.captured.toLowerCase()] - PIECE_VALUES[m.piece.toLowerCase()] + 1000;
    }
    if (m.promotion) score += PIECE_VALUES[m.promotion] + 2000;
    m._order = score;
  }
  moves.sort((a, b) => b._order - a._order);
  return moves;
}

function quiescence(game, alpha, beta, ply) {
  const standPat = sideScore(game);
  if (standPat >= beta) return standPat;
  if (standPat > alpha) alpha = standPat;

  let best = standPat;
  const moves = orderMoves(
    game._pseudoMoves(game._turn).filter((m) => m.captured || m.promotion),
  );
  for (const m of moves) {
    game._makeMove(m);
    if (game._kingAttacked(m.color)) {
      game._undoMove();
      continue;
    }
    const score = -quiescence(game, -beta, -alpha, ply + 1);
    game._undoMove();
    if (score > best) best = score;
    if (score > alpha) alpha = score;
    if (alpha >= beta) break;
  }
  return best;
}

/**
 * Whether any position in the game so far has already occurred twice, so a
 * threefold repetition is possible in the next move or two. Set for each
 * search; when it is false the (comparatively costly) repetition check is
 * skipped, since the search's own make/unmake never adds to the counts.
 */
let repetitionsPossible = false;

/**
 * Does the position just reached end the game as a draw by rule? Threefold
 * repetition and the fifty-move rule are declared the moment they occur, so a
 * move that brings either about is worth exactly a draw, whatever the pieces
 * say — except that a checkmate on the hundredth half-move still wins, as it
 * does in the engine's own status().
 */
function endsInDraw(game) {
  if (game._halfmove >= 100) return !game.isCheckmate();
  return (
    repetitionsPossible &&
    (game._positionCounts.get(game._positionKey()) || 0) >= 2
  );
}

/**
 * Positions up to this many plies deep are checked for a draw by rule. The
 * first two plies cover a repetition the mover causes and one the opponent
 * can answer with — the case that matters in practice, where a side with a
 * winning position lets its opponent shuffle back into a position seen twice.
 */
const DRAW_CHECK_PLIES = 2;

function search(game, depth, alpha, beta, ply, useQuiescence) {
  if (depth === 0) {
    return useQuiescence ? quiescence(game, alpha, beta, ply) : sideScore(game);
  }
  const moves = orderMoves(game._pseudoMoves(game._turn));
  let best = -INFINITY;
  let legal = 0;
  for (const m of moves) {
    game._makeMove(m);
    if (game._kingAttacked(m.color)) {
      game._undoMove();
      continue;
    }
    legal++;
    const score =
      ply < DRAW_CHECK_PLIES && endsInDraw(game)
        ? 0
        : -search(game, depth - 1, -beta, -alpha, ply + 1, useQuiescence);
    game._undoMove();
    if (score > best) best = score;
    if (score > alpha) alpha = score;
    if (alpha >= beta) break;
  }
  if (legal === 0) {
    return game._kingAttacked(game._turn) ? -MATE + ply : 0;
  }
  return best;
}

/**
 * Pick a move for the side to move. Returns `{from, to, promotion, score}`
 * with algebraic squares, or null if the game is over. `level` is a key of
 * LEVELS or a `{depth, window, quiescence}` object; `rng` is injectable for
 * deterministic tests.
 */
export function findBestMove(game, level = 'medium', rng = Math.random) {
  const cfg = typeof level === 'string' ? LEVELS[level] : level;
  if (!cfg) throw new Error(`Unknown difficulty level: ${level}`);

  const rootMoves = orderMoves(game._legalMoves());
  if (rootMoves.length === 0) return null;

  repetitionsPossible = false;
  for (const count of game._positionCounts.values()) {
    if (count >= 2) {
      repetitionsPossible = true;
      break;
    }
  }

  const scored = [];
  let alpha = -INFINITY;
  for (const m of rootMoves) {
    game._makeMove(m);
    if (endsInDraw(game)) {
      // The game stops here: the search below would value the position as if
      // play continued, so a side that is winning would happily repeat itself
      // into a draw, and a side that is losing would not know to claim one.
      game._undoMove();
      scored.push({ m, score: 0, exact: true });
      if (alpha < 0) alpha = 0;
      continue;
    }
    const score = -search(game, cfg.depth - 1, -INFINITY, -alpha + cfg.window, 1, cfg.quiescence);
    game._undoMove();
    // A beta cutoff in the child search (score <= alpha - window) means
    // `score` is only an upper bound on the move's true value, not exact.
    scored.push({ m, score, exact: score > alpha - cfg.window });
    if (score > alpha) alpha = score;
  }

  const best = Math.max(...scored.map((s) => s.score));
  // An upper bound can land exactly on the candidate threshold while the true
  // value is far below it; re-search those moves with a full window so the
  // random pick never selects a move outside the intended window.
  for (const s of scored) {
    if (!s.exact && s.score >= best - cfg.window) {
      game._makeMove(s.m);
      s.score = -search(game, cfg.depth - 1, -INFINITY, INFINITY, 1, cfg.quiescence);
      game._undoMove();
    }
  }
  const candidates = scored.filter((s) => s.score >= best - cfg.window);
  const pick = candidates[Math.floor(rng() * candidates.length)];
  return {
    from: indexToSquare(pick.m.from),
    to: indexToSquare(pick.m.to),
    promotion: pick.m.promotion,
    score: pick.score,
  };
}

/**
 * Async wrapper: yields to the event loop before searching so the UI can
 * paint a "thinking" state, and enforces a minimum think time so the
 * computer's replies feel deliberate rather than instant.
 */
export function chooseMove(game, level, { minThinkMs = 450 } = {}) {
  return new Promise((resolve) => {
    setTimeout(() => {
      const started = performance.now();
      const move = findBestMove(game, level);
      const elapsed = performance.now() - started;
      const wait = Math.max(0, minThinkMs - elapsed);
      setTimeout(() => resolve(move), wait);
    }, 30);
  });
}
