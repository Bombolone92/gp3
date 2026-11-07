/**
 * Puzzle generation.
 *
 * Two guarantees shape the whole approach, because both are things a player
 * notices immediately when they are missing:
 *
 *   1. Exactly one solution. Re-checked after every clue removed, so a puzzle
 *      can never be finished two different ways.
 *   2. Solvable by logic alone, specifically by the techniques in
 *      techniques.js, with no guessing. That is also what lets the hint button
 *      always have something true to say, at every point in every puzzle.
 *
 * The method is dig-and-check: start from a full grid, remove clues in a
 * seeded random order, and put a clue back whenever removing it broke
 * uniqueness or pushed the puzzle past the requested difficulty.
 *
 * Difficulty is defined by which techniques a puzzle *forces you to use*, not
 * by how many clues it shows. Measuring it that way turned up something worth
 * knowing: most minimal Sudoku grids fall to singles alone, and the ones
 * needing an X-Wing are rare. So the two easier levels are separated by how
 * much scanning they demand (clue count, singles only) and the two harder
 * levels by the deductions they require, which is both honest to the player
 * and reachable often enough to generate quickly.
 *
 * Clues are dug without imposing rotational symmetry. Symmetry looks tidier
 * but forces removals in pairs, which makes landing on a given difficulty
 * markedly harder; the difficulty label is the promise being made to the
 * player, so it wins.
 */

import { CELLS, cloneBoard } from './grid.js';
import { hasUniqueSolution, solve } from './solver.js';
import { createRng, shuffled } from './random.js';
import { gradePuzzle } from './techniques.js';

/**
 * The four difficulties.
 *
 * `cap` is the hardest technique tier the puzzle may need (see TECHNIQUES in
 * techniques.js); `requires` is the tier it must actually reach, which is what
 * stops a "Hard" puzzle from being solvable by scanning. `minGivens` stops
 * digging early: Easy could be dug into the twenties and still need nothing
 * but singles, but a sparse grid reads as intimidating whatever its logic
 * demands. `sample` is how many candidate removals the dig weighs at each
 * step, worth paying for when hunting the rarer hard positions and wasted on
 * the two levels that hit their target every time.
 */
export const DIFFICULTIES = {
  easy: {
    id: 'easy',
    label: 'Easy',
    cap: 1,
    requires: 1,
    minGivens: 38,
    sample: 1,
    blurb: 'Singles only, with plenty of clues to start from.',
  },
  medium: {
    id: 'medium',
    label: 'Medium',
    cap: 1,
    requires: 1,
    minGivens: 30,
    sample: 1,
    blurb: 'Still singles, but far fewer clues. Expect to scan.',
  },
  hard: {
    id: 'hard',
    label: 'Hard',
    cap: 2,
    requires: 2,
    minGivens: 25,
    sample: 5,
    blurb: 'Needs pointing pairs, box/line reductions and naked pairs.',
  },
  expert: {
    id: 'expert',
    label: 'Expert',
    cap: 4,
    requires: 3,
    minGivens: 22,
    sample: 6,
    blurb: 'Needs hidden subsets, X-Wings and Y-Wings.',
  },
};

export const DIFFICULTY_IDS = Object.keys(DIFFICULTIES);

export const isDifficulty = (id) => Object.hasOwn(DIFFICULTIES, id);

/**
 * A complete, valid, seeded-random grid.
 *
 * The solver does the work: given an empty board and a shuffled digit
 * preference, its search fills the grid, and a different preference order
 * yields a different grid.
 * @param {() => number} rng
 * @returns {Uint8Array}
 */
export function randomSolution(rng) {
  const order = shuffled([1, 2, 3, 4, 5, 6, 7, 8, 9], rng);
  const solved = solve(new Uint8Array(CELLS), { order });
  // The solver cannot fail on an empty board; guard anyway rather than let a
  // board of zeros travel on looking like a legitimate puzzle.
  if (!solved) throw new Error('Failed to build a solution grid.');
  return solved;
}

const countGivens = (board) => {
  let n = 0;
  for (let i = 0; i < CELLS; i++) if (board[i]) n++;
  return n;
};

/** Ordering key for "hardest puzzle": tier first, then how much work it takes. */
const ratingOf = (grade) => grade.tier * 1000 + grade.score;

/**
 * Remove clues from `solution` while keeping the puzzle uniquely solvable and
 * within `cap`.
 *
 * At each step the dig weighs up to `sample` removals and takes whichever
 * leaves the hardest puzzle. With `sample` 1 that degenerates to "remove the
 * first clue that can come out", which is all the easy levels need; larger
 * samples steer toward the scarcer positions that force a subset or a wing.
 *
 * Clues found to be unremovable are dropped from the pool rather than
 * retried: removability only gets harder as the grid empties, so a clue that
 * cannot come out now never can.
 */
function dig(solution, rng, { cap, minGivens, sample }) {
  const puzzle = cloneBoard(solution);
  let givens = CELLS;
  let pool = shuffled([...Array(CELLS).keys()], rng);

  while (givens > minGivens && pool.length) {
    let bestCell = -1;
    let bestRating = -1;
    let weighed = 0;
    const survivors = [];

    for (const i of pool) {
      if (weighed >= sample) {
        survivors.push(i);
        continue;
      }
      const clue = puzzle[i];
      puzzle[i] = 0;
      // Uniqueness first: much the cheaper of the two checks, and it rejects
      // most candidate removals on its own.
      const grade = hasUniqueSolution(puzzle) ? gradePuzzle(puzzle, { maxTier: cap }) : null;
      puzzle[i] = clue;
      if (!grade?.solved) continue; // unremovable, and drops out of the pool

      weighed++;
      survivors.push(i);
      if (ratingOf(grade) > bestRating) {
        bestRating = ratingOf(grade);
        bestCell = i;
      }
    }

    if (bestCell === -1) break; // nothing left can come out
    puzzle[bestCell] = 0;
    givens--;
    pool = survivors.filter((i) => i !== bestCell);
  }

  return puzzle;
}

/**
 * Generate a puzzle.
 *
 * A dig can land below the requested difficulty (a grid whose clues happen to
 * fall out to singles will not become an Expert however cleverly it is dug), so
 * this retries with a fresh grid until the grade matches, then settles for
 * the closest attempt rather than looping forever. Every result is uniquely
 * solvable and logic-solvable either way; only the label can be optimistic,
 * and `onTarget` says when it is.
 *
 * @param {object} [options]
 * @param {string} [options.difficulty] One of DIFFICULTY_IDS.
 * @param {number|string} [options.seed] Same seed, same puzzle.
 * @param {number} [options.attempts] Fresh grids to try before settling.
 * @returns {{puzzle: Uint8Array, solution: Uint8Array, difficulty: string,
 *   givens: number, grade: object, seed: number|string, onTarget: boolean}}
 */
export function generate({ difficulty = 'medium', seed, attempts = 24 } = {}) {
  if (!isDifficulty(difficulty)) throw new Error(`Unknown difficulty: ${difficulty}`);
  const spec = DIFFICULTIES[difficulty];
  const resolvedSeed = seed ?? Math.floor(Math.random() * 0xffffffff);
  const rng = createRng(resolvedSeed);

  let best = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const solution = randomSolution(rng);
    const puzzle = dig(solution, rng, spec);
    const grade = gradePuzzle(puzzle, { maxTier: spec.cap });
    const result = {
      puzzle,
      solution,
      difficulty,
      givens: countGivens(puzzle),
      grade,
      seed: resolvedSeed,
      onTarget: grade.solved && grade.tier >= spec.requires,
    };
    if (result.onTarget) return result;
    if (!best || ratingOf(grade) > ratingOf(best.grade)) best = result;
  }
  return best;
}

/**
 * The puzzle for a given calendar day: the same board for every player, and
 * the same one again when they come back to it later.
 * @param {string} isoDate `YYYY-MM-DD`.
 * @param {string} [difficulty]
 */
export function generateDaily(isoDate, difficulty = 'medium') {
  return generate({ difficulty, seed: `sudoku-daily-${isoDate}-${difficulty}` });
}

/** Local calendar date as `YYYY-MM-DD`, the daily puzzle's identity. */
export function localDateKey(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
