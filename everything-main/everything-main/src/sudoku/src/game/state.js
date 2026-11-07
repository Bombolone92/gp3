/**
 * Game state: the board a player is working on, and every way it can change.
 *
 * Every mutation goes through `commit`, which records the cells it touched
 * before and after. That single choice is what makes undo/redo total: placing
 * a digit can also wipe pencil marks from up to twenty peers, and "undo" has
 * to bring all of them back, not just the digit. The only thing here that reads
 * the solution grid is the mistake check, so the board cannot quietly leak
 * answers.
 *
 * Givens live in `puzzle` and are never written to; `values` holds them too,
 * so anything that needs to read the board (conflicts, candidate counts, the
 * hint engine) reads one array.
 */

import { CELLS, PEERS, findConflicts, isComplete, maskOf } from '../engine/grid.js';

export const MAX_HISTORY = 500;

/**
 * @param {object} options
 * @param {ArrayLike<number>} options.puzzle The givens; 0 for empty.
 * @param {ArrayLike<number>} options.solution The unique completion.
 * @param {string} [options.difficulty]
 * @param {number|string} [options.seed]
 * @param {string|null} [options.daily] ISO date when this is a daily puzzle.
 */
export function createGame({ puzzle, solution, difficulty = 'medium', seed = null, daily = null }) {
  return {
    puzzle: Uint8Array.from(puzzle),
    solution: Uint8Array.from(solution),
    values: Uint8Array.from(puzzle),
    notes: new Uint16Array(CELLS),
    /**
     * Digits ruled out by hints, per cell.
     *
     * Kept apart from the player's own pencil marks, and outside the undo
     * history, because it is knowledge rather than a move: every hint is
     * derived from a board with no mistakes in it by a sound technique, so an
     * eliminated digit is genuinely not the answer there and stays true
     * however the board is edited afterwards. Holding on to it is what makes
     * repeated hints progress instead of restating the same deduction.
     */
    eliminated: new Uint16Array(CELLS),
    difficulty,
    seed,
    daily,
    history: [],
    future: [],
    hintsUsed: 0,
    mistakesMade: 0,
    elapsedMs: 0,
    startedAt: null,
    solvedAt: null,
  };
}

/** Whether cell `i` is a clue the puzzle came with. */
export const isGiven = (game, i) => game.puzzle[i] !== 0;

/** Whether the board is full and consistent: the puzzle is done. */
export const isSolved = (game) => isComplete(game.values);

/** Cells whose digit repeats a peer's. */
export const conflicts = (game) => findConflicts(game.values);

/**
 * Cells holding a digit that is not the one the solution wants.
 *
 * This is the only place that compares against the solution for the player's
 * benefit, and it is behind the "check as I go" setting: a player who wants to
 * find their own mistakes should be able to.
 */
export function mistakes(game) {
  const bad = new Set();
  for (let i = 0; i < CELLS; i++) {
    if (game.values[i] && game.values[i] !== game.solution[i]) bad.add(i);
  }
  return bad;
}

/** How many of `digit` are still unplaced, 0 when all nine are down. */
export function remaining(game, digit) {
  let placed = 0;
  for (let i = 0; i < CELLS; i++) if (game.values[i] === digit) placed++;
  return Math.max(0, 9 - placed);
}

/** Snapshot of one cell, for the undo record. */
const snap = (game, i) => ({ i, value: game.values[i], notes: game.notes[i] });

const restore = (game, cell) => {
  game.values[cell.i] = cell.value;
  game.notes[cell.i] = cell.notes;
};

/**
 * Run `mutate`, record what it changed, and push the result onto the undo
 * stack. Returns the move, or null when nothing actually changed, so a
 * redundant tap does not consume an undo.
 */
function commit(game, kind, cells, mutate) {
  const before = cells.map((i) => snap(game, i));
  mutate();
  const after = cells.map((i) => snap(game, i));
  const changed = before.filter((b, n) => b.value !== after[n].value || b.notes !== after[n].notes);
  if (!changed.length) return null;

  const changedIndexes = changed.map((c) => c.i);
  const move = {
    kind,
    before: changed,
    after: after.filter((a) => changedIndexes.includes(a.i)),
  };
  game.history.push(move);
  if (game.history.length > MAX_HISTORY) game.history.shift();
  game.future.length = 0; // a new move discards any redo branch
  return move;
}

/**
 * Write `digit` into cell `i`.
 *
 * @param {object} game
 * @param {number} i
 * @param {number} digit 1..9.
 * @param {{autoClearNotes?: boolean}} [options] When set, placing a digit also
 *   removes it from the pencil marks of every peer: the bookkeeping a player
 *   would otherwise do by hand, and the reason the setting defaults on.
 */
export function setValue(game, i, digit, { autoClearNotes = true } = {}) {
  if (isGiven(game, i) || digit < 1 || digit > 9) return null;
  const touched = autoClearNotes ? [i, ...PEERS[i]] : [i];
  return commit(game, 'value', touched, () => {
    game.values[i] = digit;
    game.notes[i] = 0; // a filled cell has no pencil marks
    if (autoClearNotes) {
      for (const p of PEERS[i]) game.notes[p] &= ~maskOf(digit);
    }
  });
}

/** Add or remove `digit` from cell `i`'s pencil marks. */
export function toggleNote(game, i, digit) {
  if (isGiven(game, i) || game.values[i] || digit < 1 || digit > 9) return null;
  return commit(game, 'note', [i], () => {
    game.notes[i] ^= maskOf(digit);
  });
}

/** Empty cell `i` of both its digit and its pencil marks. */
export function clearCell(game, i) {
  if (isGiven(game, i)) return null;
  return commit(game, 'clear', [i], () => {
    game.values[i] = 0;
    game.notes[i] = 0;
  });
}

/**
 * Record the eliminations a hint established, and rub the same digits out of
 * the player's pencil marks so the board reflects what they now know.
 *
 * The pencil-mark edit is undoable; the recorded knowledge is not (see
 * `eliminated`).
 * @returns {number} How many candidates were newly ruled out.
 */
export function applyEliminations(game, eliminations) {
  let ruledOut = 0;
  for (const { cell, digit } of eliminations) {
    if (game.eliminated[cell] & maskOf(digit)) continue;
    game.eliminated[cell] |= maskOf(digit);
    ruledOut++;
  }
  const cells = [...new Set(eliminations.map((e) => e.cell))];
  commit(game, 'note', cells, () => {
    for (const { cell, digit } of eliminations) game.notes[cell] &= ~maskOf(digit);
  });
  return ruledOut;
}

export function undo(game) {
  const move = game.history.pop();
  if (!move) return null;
  for (const cell of move.before) restore(game, cell);
  game.future.push(move);
  return move;
}

export function redo(game) {
  const move = game.future.pop();
  if (!move) return null;
  for (const cell of move.after) restore(game, cell);
  game.history.push(move);
  return move;
}

export const canUndo = (game) => game.history.length > 0;
export const canRedo = (game) => game.future.length > 0;

/**
 * Count a wrong entry. Called by the UI when the check-as-you-go setting
 * catches one, so the tally reflects mistakes the player was shown, not
 * every keystroke they corrected themselves.
 */
export function recordMistake(game) {
  game.mistakesMade++;
}

/** Cleared without hints and without a flagged mistake. */
export const isFlawless = (game) => game.hintsUsed === 0 && game.mistakesMade === 0;
