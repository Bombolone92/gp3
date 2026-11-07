/**
 * Constraint-propagation solver.
 *
 * The whole engine leans on this being fast: generating one puzzle re-solves
 * candidate boards once per dug cell, and grading re-solves again for every
 * technique step. So propagation does the work and search is the fallback.
 *
 * The propagation is Norvig's pair of mutually recursive rules, over 9-bit
 * candidate masks instead of sets:
 *
 *   assign(i, d):    remove every other digit from cell i.
 *   eliminate(i, d): remove d from cell i, then:
 *                       * if one candidate is left, assign it (naked single),
 *                         which eliminates it from all 20 peers;
 *                       * if a unit now has exactly one place for d, assign it
 *                         there (hidden single).
 *
 * Either rule can reach a contradiction (a cell with no candidates, or a unit
 * with nowhere left for a digit) and reports it by returning false. Search
 * then backtracks. Puzzles at the difficulties this app ships almost always
 * fall out of propagation alone.
 */

import { ALL_DIGITS, CELLS, PEERS, UNITS_OF, countBits, digitOf, maskOf } from './grid.js';

/**
 * Candidate masks for every cell of `board`, with propagation already run.
 * Returns null when the board contradicts itself.
 * @param {ArrayLike<number>} board 81 cells, 0 for empty.
 * @returns {Int16Array|null}
 */
export function candidatesFor(board) {
  const cands = new Int16Array(CELLS).fill(ALL_DIGITS);
  for (let i = 0; i < CELLS; i++) {
    const d = board[i];
    if (d && !assign(cands, i, d)) return null;
  }
  return cands;
}

function assign(cands, i, digit) {
  const others = cands[i] & ~maskOf(digit);
  for (let d = 1; d <= 9; d++) {
    if (others & maskOf(d)) {
      if (!eliminate(cands, i, d)) return false;
    }
  }
  return cands[i] === maskOf(digit);
}

function eliminate(cands, i, digit) {
  const bit = maskOf(digit);
  if ((cands[i] & bit) === 0) return true; // already gone
  cands[i] &= ~bit;

  if (cands[i] === 0) return false; // cell has no candidate left
  const single = digitOf(cands[i]);
  if (single) {
    // Naked single: it can be nowhere else in any unit through this cell.
    for (const p of PEERS[i]) {
      if (!eliminate(cands, p, single)) return false;
    }
  }

  // Hidden single: `digit` may now have exactly one home in a shared unit.
  for (const unit of UNITS_OF[i]) {
    let places = 0;
    let last = -1;
    for (const c of unit.cells) {
      if (cands[c] & bit) {
        places++;
        last = c;
      }
    }
    if (places === 0) return false;
    if (places === 1 && cands[last] !== bit && !assign(cands, last, digit)) return false;
  }
  return true;
}

/** The cell with the fewest candidates above one, or -1 when all are settled. */
function mostConstrained(cands) {
  let best = -1;
  let bestCount = 10;
  for (let i = 0; i < CELLS; i++) {
    const n = countBits(cands[i]);
    if (n > 1 && n < bestCount) {
      bestCount = n;
      best = i;
      if (n === 2) break; // nothing beats a coin flip
    }
  }
  return best;
}

/** Turn settled candidate masks into a board of digits. */
function boardFrom(cands) {
  const board = new Uint8Array(CELLS);
  for (let i = 0; i < CELLS; i++) board[i] = digitOf(cands[i]);
  return board;
}

/**
 * Depth-first search over the most constrained cell first.
 * @param {Int16Array} cands
 * @param {number[]|null} order Digit preference, for seeded generation.
 * @returns {Int16Array|null}
 */
function search(cands, order) {
  const i = mostConstrained(cands);
  if (i === -1) return cands;
  for (const d of order ?? [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
    if ((cands[i] & maskOf(d)) === 0) continue;
    const next = Int16Array.from(cands);
    if (assign(next, i, d)) {
      const solved = search(next, order);
      if (solved) return solved;
    }
  }
  return null;
}

/**
 * One solution of `board`, or null when there is none.
 * @param {ArrayLike<number>} board
 * @param {{order?: number[]}} [options] `order` biases which digit is tried
 *   first, which is how the generator gets a different grid per seed.
 * @returns {Uint8Array|null}
 */
export function solve(board, { order } = {}) {
  const cands = candidatesFor(board);
  if (!cands) return null;
  const solved = search(cands, order);
  return solved ? boardFrom(solved) : null;
}

/**
 * How many solutions `board` has, counting no further than `limit`.
 *
 * The generator only ever asks "is this still exactly one?", so stopping at 2
 * turns an exhaustive count into a cheap check.
 * @param {ArrayLike<number>} board
 * @param {number} [limit] Stop once this many are found.
 * @returns {number}
 */
export function countSolutions(board, limit = 2) {
  const cands = candidatesFor(board);
  if (!cands) return 0;
  let found = 0;

  const walk = (state) => {
    if (found >= limit) return;
    const i = mostConstrained(state);
    if (i === -1) {
      found++;
      return;
    }
    for (let d = 1; d <= 9; d++) {
      if ((state[i] & maskOf(d)) === 0) continue;
      const next = Int16Array.from(state);
      if (assign(next, i, d)) walk(next);
      if (found >= limit) return;
    }
  };

  walk(cands);
  return found;
}

/** Whether `board` has exactly one solution. */
export const hasUniqueSolution = (board) => countSolutions(board, 2) === 1;
