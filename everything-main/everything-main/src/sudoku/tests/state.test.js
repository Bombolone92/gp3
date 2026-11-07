import { beforeEach, describe, expect, it } from 'vitest';
import { CELLS, maskOf } from '../src/engine/grid.js';
import { generate } from '../src/engine/generator.js';
import {
  MAX_HISTORY,
  applyEliminations,
  canRedo,
  canUndo,
  clearCell,
  conflicts,
  createGame,
  isFlawless,
  isGiven,
  isSolved,
  mistakes,
  recordMistake,
  redo,
  remaining,
  setValue,
  toggleNote,
  undo,
} from '../src/game/state.js';

const { puzzle, solution } = generate({ difficulty: 'medium', seed: 'state-tests' });

const newGame = () => createGame({ puzzle, solution, difficulty: 'medium', seed: 'state-tests' });

/** The first empty cell, i.e. one the player is allowed to write in. */
const firstEmpty = (game) => [...game.values].findIndex((v) => v === 0);
const firstGiven = (game) => [...game.puzzle].findIndex((v) => v !== 0);

describe('createGame', () => {
  let game;
  beforeEach(() => {
    game = newGame();
  });

  it('starts with the clues on the board and nothing else', () => {
    expect([...game.values]).toEqual([...game.puzzle]);
    expect([...game.notes].every((n) => n === 0)).toBe(true);
    expect([...game.eliminated].every((n) => n === 0)).toBe(true);
  });

  it('starts with an empty history and no hints or mistakes counted', () => {
    expect(canUndo(game)).toBe(false);
    expect(canRedo(game)).toBe(false);
    expect(game.hintsUsed).toBe(0);
    expect(game.mistakesMade).toBe(0);
    expect(isFlawless(game)).toBe(true);
  });

  it('copies its inputs rather than aliasing them', () => {
    game.values[0] = 9;
    expect(puzzle[0]).not.toBe(9);
  });

  it('knows which cells are clues', () => {
    expect(isGiven(game, firstGiven(game))).toBe(true);
    expect(isGiven(game, firstEmpty(game))).toBe(false);
  });
});

describe('setValue', () => {
  let game;
  let cell;
  beforeEach(() => {
    game = newGame();
    cell = firstEmpty(game);
  });

  it('writes a digit', () => {
    setValue(game, cell, 4);
    expect(game.values[cell]).toBe(4);
    expect(canUndo(game)).toBe(true);
  });

  it('refuses to overwrite a clue', () => {
    const given = firstGiven(game);
    const before = game.values[given];
    expect(setValue(game, given, 5)).toBeNull();
    expect(game.values[given]).toBe(before);
    expect(canUndo(game)).toBe(false);
  });

  it('ignores digits outside 1 to 9', () => {
    expect(setValue(game, cell, 0)).toBeNull();
    expect(setValue(game, cell, 10)).toBeNull();
    expect(game.values[cell]).toBe(0);
  });

  it('records nothing when the digit is already there', () => {
    setValue(game, cell, 4);
    const historyLength = game.history.length;
    expect(setValue(game, cell, 4)).toBeNull();
    expect(game.history).toHaveLength(historyLength);
  });

  it('clears the cell’s own pencil marks', () => {
    toggleNote(game, cell, 3);
    toggleNote(game, cell, 7);
    setValue(game, cell, 4);
    expect(game.notes[cell]).toBe(0);
  });

  it('rubs the digit out of its peers’ pencil marks', () => {
    const peer = [...Array(CELLS).keys()].find(
      (i) => i !== cell && !game.values[i] && sharesUnit(cell, i),
    );
    toggleNote(game, peer, 4);
    toggleNote(game, peer, 5);
    setValue(game, cell, 4);
    expect(game.notes[peer] & maskOf(4)).toBe(0);
    expect(game.notes[peer] & maskOf(5)).not.toBe(0);
  });

  it('leaves peers alone when tidying is switched off', () => {
    const peer = [...Array(CELLS).keys()].find(
      (i) => i !== cell && !game.values[i] && sharesUnit(cell, i),
    );
    toggleNote(game, peer, 4);
    setValue(game, cell, 4, { autoClearNotes: false });
    expect(game.notes[peer] & maskOf(4)).not.toBe(0);
  });
});

describe('pencil marks', () => {
  let game;
  let cell;
  beforeEach(() => {
    game = newGame();
    cell = firstEmpty(game);
  });

  it('toggles a digit on and off', () => {
    toggleNote(game, cell, 6);
    expect(game.notes[cell] & maskOf(6)).not.toBe(0);
    toggleNote(game, cell, 6);
    expect(game.notes[cell] & maskOf(6)).toBe(0);
  });

  it('holds several digits at once', () => {
    for (const d of [1, 5, 9]) toggleNote(game, cell, d);
    for (const d of [1, 5, 9]) expect(game.notes[cell] & maskOf(d)).not.toBe(0);
  });

  it('refuses a cell that already holds a digit', () => {
    setValue(game, cell, 3);
    expect(toggleNote(game, cell, 6)).toBeNull();
    expect(game.notes[cell]).toBe(0);
  });

  it('refuses a clue', () => {
    expect(toggleNote(game, firstGiven(game), 6)).toBeNull();
  });
});

describe('clearCell', () => {
  it('empties a digit and its pencil marks together', () => {
    const game = newGame();
    const cell = firstEmpty(game);
    setValue(game, cell, 2);
    clearCell(game, cell);
    expect(game.values[cell]).toBe(0);
    expect(game.notes[cell]).toBe(0);
  });

  it('refuses a clue', () => {
    const game = newGame();
    expect(clearCell(game, firstGiven(game))).toBeNull();
  });

  it('records nothing for an already-empty cell', () => {
    const game = newGame();
    expect(clearCell(game, firstEmpty(game))).toBeNull();
  });
});

describe('undo and redo', () => {
  let game;
  let cell;
  beforeEach(() => {
    game = newGame();
    cell = firstEmpty(game);
  });

  it('walks back and forward through moves', () => {
    setValue(game, cell, 1);
    setValue(game, cell, 2);
    expect(game.values[cell]).toBe(2);
    undo(game);
    expect(game.values[cell]).toBe(1);
    undo(game);
    expect(game.values[cell]).toBe(0);
    redo(game);
    expect(game.values[cell]).toBe(1);
    redo(game);
    expect(game.values[cell]).toBe(2);
  });

  it('restores the pencil marks a placement wiped from peers', () => {
    // The reason moves record every cell they touched: undoing a digit has to
    // bring back the marks it cleared, not just the digit itself.
    const peer = [...Array(CELLS).keys()].find(
      (i) => i !== cell && !game.values[i] && sharesUnit(cell, i),
    );
    toggleNote(game, peer, 4);
    setValue(game, cell, 4);
    expect(game.notes[peer] & maskOf(4)).toBe(0);
    undo(game);
    expect(game.notes[peer] & maskOf(4)).not.toBe(0);
    expect(game.values[cell]).toBe(0);
  });

  it('reports nothing to undo on a fresh game', () => {
    expect(undo(game)).toBeNull();
    expect(redo(game)).toBeNull();
  });

  it('discards the redo branch once a new move is made', () => {
    setValue(game, cell, 1);
    undo(game);
    expect(canRedo(game)).toBe(true);
    setValue(game, cell, 5);
    expect(canRedo(game)).toBe(false);
  });

  it('caps the history rather than growing without bound', () => {
    const empties = [...Array(CELLS).keys()].filter((i) => !game.puzzle[i]);
    for (let n = 0; n < MAX_HISTORY + 20; n++) {
      const target = empties[n % empties.length];
      toggleNote(game, target, (n % 9) + 1);
    }
    expect(game.history.length).toBeLessThanOrEqual(MAX_HISTORY);
  });
});

describe('reading the board', () => {
  it('counts how many of a digit are unplaced', () => {
    const game = newGame();
    const placedFives = [...game.values].filter((v) => v === 5).length;
    expect(remaining(game, 5)).toBe(9 - placedFives);
    const cell = [...Array(CELLS).keys()].find((i) => !game.values[i]);
    setValue(game, cell, 5);
    expect(remaining(game, 5)).toBe(8 - placedFives);
  });

  it('never reports a negative remainder', () => {
    const game = newGame();
    for (const i of [...Array(CELLS).keys()]) if (!game.puzzle[i]) setValue(game, i, 5);
    expect(remaining(game, 5)).toBeGreaterThanOrEqual(0);
  });

  it('finds a digit that repeats within a unit', () => {
    const game = newGame();
    const cell = firstEmpty(game);
    const peerDigit = findPeerDigit(game, cell);
    setValue(game, cell, peerDigit);
    expect(conflicts(game).has(cell)).toBe(true);
  });

  it('separates a rule-breaking entry from a merely wrong one', () => {
    const game = newGame();
    const cell = firstEmpty(game);
    // A digit that breaks no rule where it sits but is not the answer: legal to
    // the eye, still wrong. Conflicts cannot see it; the solution can.
    const wrong = [1, 2, 3, 4, 5, 6, 7, 8, 9].find(
      (d) => d !== solution[cell] && !conflictsWith(game, cell, d),
    );
    setValue(game, cell, wrong);
    expect(conflicts(game).has(cell)).toBe(false);
    expect(mistakes(game).has(cell)).toBe(true);
  });

  it('calls a fully and correctly filled board solved', () => {
    const game = newGame();
    for (let i = 0; i < CELLS; i++) if (!game.puzzle[i]) setValue(game, i, solution[i]);
    expect(isSolved(game)).toBe(true);
    expect(mistakes(game).size).toBe(0);
  });

  it('does not call a full but wrong board solved', () => {
    const game = newGame();
    for (let i = 0; i < CELLS; i++) if (!game.puzzle[i]) setValue(game, i, solution[i]);
    const cell = firstEmpty(newGame());
    setValue(game, cell, findPeerDigit(game, cell));
    expect(isSolved(game)).toBe(false);
  });
});

describe('hint support', () => {
  it('remembers ruled-out candidates and clears matching pencil marks', () => {
    const game = newGame();
    const cell = firstEmpty(game);
    toggleNote(game, cell, 3);
    toggleNote(game, cell, 4);
    const ruledOut = applyEliminations(game, [{ cell, digit: 3 }]);
    expect(ruledOut).toBe(1);
    expect(game.eliminated[cell] & maskOf(3)).not.toBe(0);
    expect(game.notes[cell] & maskOf(3)).toBe(0);
    expect(game.notes[cell] & maskOf(4)).not.toBe(0);
  });

  it('does not double-count an elimination it already knew', () => {
    const game = newGame();
    const cell = firstEmpty(game);
    applyEliminations(game, [{ cell, digit: 3 }]);
    expect(applyEliminations(game, [{ cell, digit: 3 }])).toBe(0);
  });

  it('stops calling a game flawless once a hint has been used', () => {
    const game = newGame();
    expect(isFlawless(game)).toBe(true);
    game.hintsUsed++;
    expect(isFlawless(game)).toBe(false);
  });

  it('counts a mistake only when told to', () => {
    const game = newGame();
    expect(game.mistakesMade).toBe(0);
    recordMistake(game);
    expect(game.mistakesMade).toBe(1);
    expect(isFlawless(game)).toBe(false);
  });
});

/* Helpers */

const rowOf = (i) => Math.floor(i / 9);
const colOf = (i) => i % 9;
const boxOf = (i) => 3 * Math.floor(rowOf(i) / 3) + Math.floor(colOf(i) / 3);
const sharesUnit = (a, b) => rowOf(a) === rowOf(b) || colOf(a) === colOf(b) || boxOf(a) === boxOf(b);

/** A digit already present in one of `cell`'s units, so placing it conflicts. */
function findPeerDigit(game, cell) {
  for (let i = 0; i < CELLS; i++) {
    if (i !== cell && game.values[i] && sharesUnit(cell, i)) return game.values[i];
  }
  throw new Error('no peer digit found');
}

const conflictsWith = (game, cell, digit) => {
  for (let i = 0; i < CELLS; i++) {
    if (i !== cell && game.values[i] === digit && sharesUnit(cell, i)) return true;
  }
  return false;
};
