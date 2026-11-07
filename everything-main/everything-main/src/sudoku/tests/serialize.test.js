import { describe, expect, it } from 'vitest';
import { CELLS, maskOf } from '../src/engine/grid.js';
import { generate } from '../src/engine/generator.js';
import { SAVE_VERSION, decode, encode, fromText, toText } from '../src/game/serialize.js';
import { createGame, setValue, toggleNote, applyEliminations } from '../src/game/state.js';

const { puzzle, solution } = generate({ difficulty: 'hard', seed: 'serialize-tests' });

function playedGame() {
  const game = createGame({ puzzle, solution, difficulty: 'hard', seed: 'serialize-tests', daily: null });
  const empties = [...Array(CELLS).keys()].filter((i) => !game.puzzle[i]);
  setValue(game, empties[0], solution[empties[0]]);
  toggleNote(game, empties[1], 3);
  toggleNote(game, empties[1], 8);
  applyEliminations(game, [{ cell: empties[2], digit: 5 }]);
  game.elapsedMs = 91_500;
  game.hintsUsed = 2;
  game.mistakesMade = 1;
  return game;
}

describe('board text', () => {
  it('round-trips a board', () => {
    expect(toText(fromText(toText(puzzle)))).toBe(toText(puzzle));
  });

  it('writes empty cells as dots', () => {
    const text = toText(puzzle);
    expect(text).toHaveLength(CELLS);
    expect(text).toMatch(/^[1-9.]{81}$/);
  });

  it('reads 0 as empty too, since other Sudoku tools write it that way', () => {
    const dotted = toText(puzzle);
    const zeroed = dotted.replaceAll('.', '0');
    expect(toText(fromText(zeroed))).toBe(dotted);
  });

  it('rejects text of the wrong length or with junk in it', () => {
    expect(fromText('123')).toBeNull();
    expect(fromText('x'.repeat(81))).toBeNull();
    expect(fromText(null)).toBeNull();
    expect(fromText(undefined)).toBeNull();
  });
});

describe('encode and decode', () => {
  it('survives a trip through JSON with everything intact', () => {
    const game = playedGame();
    const restored = decode(JSON.parse(JSON.stringify(encode(game, 1234))));

    expect(restored).not.toBeNull();
    expect([...restored.values]).toEqual([...game.values]);
    expect([...restored.notes]).toEqual([...game.notes]);
    expect([...restored.eliminated]).toEqual([...game.eliminated]);
    expect([...restored.puzzle]).toEqual([...game.puzzle]);
    expect([...restored.solution]).toEqual([...game.solution]);
    expect(restored.difficulty).toBe('hard');
    expect(restored.elapsedMs).toBe(91_500);
    expect(restored.hintsUsed).toBe(2);
    expect(restored.mistakesMade).toBe(1);
  });

  it('stamps the version and a timestamp', () => {
    const encoded = encode(playedGame(), 555);
    expect(encoded.v).toBe(SAVE_VERSION);
    expect(encoded.ts).toBe(555);
  });

  it('carries the daily date so a restored daily still counts as one', () => {
    const game = createGame({ puzzle, solution, difficulty: 'medium', daily: '2026-08-21' });
    expect(decode(encode(game)).daily).toBe('2026-08-21');
  });

  it('starts a restored game with an empty undo history', () => {
    // History is deliberately not saved: nobody expects undo to reach back
    // across a reload, and it would multiply the payload.
    const restored = decode(encode(playedGame()));
    expect(restored.history).toEqual([]);
    expect(restored.future).toEqual([]);
  });

  it('keeps pencil marks sparse in the payload', () => {
    const game = playedGame();
    const encoded = encode(game);
    expect(encoded.notes).toMatch(/^\d+:[0-9a-z]+(,\d+:[0-9a-z]+)*$/);
    expect(JSON.stringify(encoded).length).toBeLessThan(1000);
  });

  it('writes an empty string when there is nothing pencilled in', () => {
    const game = createGame({ puzzle, solution });
    expect(encode(game).notes).toBe('');
    expect([...decode(encode(game)).notes].every((n) => n === 0)).toBe(true);
  });
});

describe('decode refuses anything it cannot trust', () => {
  const good = () => JSON.parse(JSON.stringify(encode(playedGame(), 1)));

  it('rejects nothing at all', () => {
    expect(decode(null)).toBeNull();
    expect(decode(undefined)).toBeNull();
    expect(decode('not an object')).toBeNull();
    expect(decode(42)).toBeNull();
  });

  it('rejects a save from another version', () => {
    expect(decode({ ...good(), v: SAVE_VERSION - 1 })).toBeNull();
    expect(decode({ ...good(), v: SAVE_VERSION + 1 })).toBeNull();
  });

  it('rejects a truncated or corrupt board', () => {
    expect(decode({ ...good(), values: 'short' })).toBeNull();
    expect(decode({ ...good(), puzzle: null })).toBeNull();
    expect(decode({ ...good(), solution: '.'.repeat(81) })).toBeNull();
  });

  it('rejects a solution that is not actually solved', () => {
    // Everything downstream trusts this grid: hints, the mistake check and the
    // solved test all read from it, so a broken one is worse than no save.
    const broken = good();
    broken.solution = broken.solution.slice(0, 80) + '.';
    expect(decode(broken)).toBeNull();
  });

  it('rejects clues that disagree with the solution', () => {
    const data = good();
    const clue = [...data.puzzle].findIndex((c) => c !== '.');
    const wrong = data.solution[clue] === '9' ? '8' : '9';
    data.puzzle = data.puzzle.slice(0, clue) + wrong + data.puzzle.slice(clue + 1);
    expect(decode(data)).toBeNull();
  });

  it('rejects a board whose clues have been overwritten', () => {
    const data = good();
    const clue = [...data.puzzle].findIndex((c) => c !== '.');
    data.values = data.values.slice(0, clue) + '.' + data.values.slice(clue + 1);
    expect(decode(data)).toBeNull();
  });

  it('rejects malformed pencil marks', () => {
    expect(decode({ ...good(), notes: '999:1' })).toBeNull();
    expect(decode({ ...good(), notes: '0:zzzz' })).toBeNull();
    expect(decode({ ...good(), notes: 42 })).toBeNull();
  });

  it('treats a missing eliminated field as nothing known yet', () => {
    // Saves written before hints tracked their own eliminations are still
    // perfectly playable; they simply start the hint engine from scratch.
    const data = good();
    delete data.eliminated;
    const restored = decode(data);
    expect(restored).not.toBeNull();
    expect([...restored.eliminated].every((n) => n === 0)).toBe(true);
  });

  it('repairs an implausible clock rather than refusing the save', () => {
    expect(decode({ ...good(), elapsedMs: -5 }).elapsedMs).toBe(0);
    expect(decode({ ...good(), elapsedMs: 'soon' }).elapsedMs).toBe(0);
    expect(decode({ ...good(), hintsUsed: -3 }).hintsUsed).toBe(0);
  });

  it('falls back to a known difficulty when the stored one is unusable', () => {
    expect(decode({ ...good(), difficulty: 12 }).difficulty).toBe('medium');
  });

  it('accepts pencil marks covering all nine digits', () => {
    const game = createGame({ puzzle, solution });
    const cell = [...Array(CELLS).keys()].find((i) => !game.puzzle[i]);
    for (let d = 1; d <= 9; d++) toggleNote(game, cell, d);
    const restored = decode(JSON.parse(JSON.stringify(encode(game))));
    for (let d = 1; d <= 9; d++) expect(restored.notes[cell] & maskOf(d)).not.toBe(0);
  });
});
