/**
 * Turning a game into something storable, and back.
 *
 * The format is deliberately plain and versioned. It travels to two places
 * with different failure modes (localStorage on this device and puter.kv in the
 * player's account), and a save that cannot be read is a game lost, so
 * `decode` validates rather than trusts: wrong version, wrong length, a digit
 * outside 1-9, or a "solution" that is not a solved grid all return null and
 * the app starts fresh instead of rendering nonsense.
 *
 * Undo history is not saved. It would multiply the payload for something no
 * player expects to survive a reload.
 */

import { CELLS, isComplete } from '../engine/grid.js';
import { createGame } from './state.js';

export const SAVE_VERSION = 2;

const boardToText = (board) => Array.from(board, (v) => (v ? String(v) : '.')).join('');

function textToBoard(text) {
  if (typeof text !== 'string' || text.length !== CELLS) return null;
  const board = new Uint8Array(CELLS);
  for (let i = 0; i < CELLS; i++) {
    const ch = text[i];
    if (ch === '.' || ch === '0') continue;
    const digit = ch.charCodeAt(0) - 48;
    if (digit < 1 || digit > 9) return null;
    board[i] = digit;
  }
  return board;
}

/** Pencil marks as a sparse "cell:mask" list, since most cells have none. */
const notesToText = (notes) =>
  Array.from(notes)
    .map((mask, i) => (mask ? `${i}:${mask.toString(36)}` : null))
    .filter(Boolean)
    .join(',');

function textToNotes(text) {
  const notes = new Uint16Array(CELLS);
  if (!text) return notes;
  if (typeof text !== 'string') return null;
  for (const entry of text.split(',')) {
    const [rawCell, rawMask] = entry.split(':');
    const cell = Number.parseInt(rawCell, 10);
    const mask = Number.parseInt(rawMask, 36);
    if (!Number.isInteger(cell) || cell < 0 || cell >= CELLS) return null;
    if (!Number.isInteger(mask) || mask < 0 || mask > 0x1ff) return null;
    notes[cell] = mask;
  }
  return notes;
}

/**
 * A JSON-safe snapshot of `game`.
 * @param {object} game
 * @param {number} [now] Stamped so two devices' saves can be compared.
 */
export function encode(game, now = Date.now()) {
  return {
    v: SAVE_VERSION,
    difficulty: game.difficulty,
    seed: game.seed,
    daily: game.daily,
    puzzle: boardToText(game.puzzle),
    solution: boardToText(game.solution),
    values: boardToText(game.values),
    notes: notesToText(game.notes),
    eliminated: notesToText(game.eliminated),
    elapsedMs: Math.max(0, Math.round(game.elapsedMs) || 0),
    hintsUsed: game.hintsUsed | 0,
    mistakesMade: game.mistakesMade | 0,
    ts: now,
  };
}

/**
 * Rebuild a game from `encode` output, or null when it cannot be trusted.
 * @param {unknown} data
 * @returns {object|null}
 */
export function decode(data) {
  if (!data || typeof data !== 'object' || data.v !== SAVE_VERSION) return null;

  const puzzle = textToBoard(data.puzzle);
  const solution = textToBoard(data.solution);
  const values = textToBoard(data.values);
  const notes = textToNotes(data.notes);
  // Absent in v2 saves written before hints tracked their own eliminations;
  // an empty mask is the right reading of "we knew nothing yet".
  const eliminated = textToNotes(data.eliminated ?? '');
  if (!puzzle || !solution || !values || !notes || !eliminated) return null;
  // A corrupt solution would make every later hint and mistake check wrong,
  // which is worse than losing the save.
  if (!isComplete(solution)) return null;
  // The givens must still agree with the solution and with what is on screen.
  for (let i = 0; i < CELLS; i++) {
    if (puzzle[i] && puzzle[i] !== solution[i]) return null;
    if (puzzle[i] && values[i] !== puzzle[i]) return null;
  }

  const game = createGame({
    puzzle,
    solution,
    difficulty: typeof data.difficulty === 'string' ? data.difficulty : 'medium',
    seed: data.seed ?? null,
    daily: typeof data.daily === 'string' ? data.daily : null,
  });
  game.values = values;
  game.notes = notes;
  game.eliminated = eliminated;
  game.elapsedMs = Number.isFinite(data.elapsedMs) ? Math.max(0, data.elapsedMs) : 0;
  game.hintsUsed = Number.isFinite(data.hintsUsed) ? Math.max(0, data.hintsUsed | 0) : 0;
  game.mistakesMade = Number.isFinite(data.mistakesMade) ? Math.max(0, data.mistakesMade | 0) : 0;
  return game;
}

/** Board as 81 characters, for tests and for sharing a puzzle as text. */
export const toText = boardToText;
/** Parse 81 characters of board, tolerating both `.` and `0` for empty. */
export const fromText = textToBoard;
