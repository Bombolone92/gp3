import { describe, expect, it } from 'vitest';
import { CELLS, findConflicts, isComplete } from '../src/engine/grid.js';
import {
  DIFFICULTIES,
  DIFFICULTY_IDS,
  generate,
  generateDaily,
  isDifficulty,
  localDateKey,
  randomSolution,
} from '../src/engine/generator.js';
import { hasUniqueSolution, solve } from '../src/engine/solver.js';
import { createRng } from '../src/engine/random.js';
import { gradePuzzle } from '../src/engine/techniques.js';
import { toText } from '../src/game/serialize.js';

const countGivens = (board) => [...board].filter(Boolean).length;

describe('randomSolution', () => {
  it('produces a complete, legal grid', () => {
    const grid = randomSolution(createRng('sol'));
    expect(isComplete(grid)).toBe(true);
    expect(findConflicts(grid).size).toBe(0);
  });

  it('is reproducible for a seed, and varies between seeds', () => {
    expect(toText(randomSolution(createRng('a')))).toBe(toText(randomSolution(createRng('a'))));
    expect(toText(randomSolution(createRng('a')))).not.toBe(toText(randomSolution(createRng('b'))));
  });
});

describe('difficulty catalogue', () => {
  it('describes four levels of increasing demand', () => {
    expect(DIFFICULTY_IDS).toEqual(['easy', 'medium', 'hard', 'expert']);
    let previousClues = Infinity;
    for (const id of DIFFICULTY_IDS) {
      const spec = DIFFICULTIES[id];
      expect(spec.minGivens).toBeLessThan(previousClues);
      previousClues = spec.minGivens;
      expect(spec.cap).toBeGreaterThanOrEqual(spec.requires);
      expect(spec.blurb.length).toBeGreaterThan(10);
    }
  });

  it('recognises its own ids and nothing else', () => {
    for (const id of DIFFICULTY_IDS) expect(isDifficulty(id)).toBe(true);
    expect(isDifficulty('impossible')).toBe(false);
    expect(isDifficulty('')).toBe(false);
    expect(isDifficulty('constructor')).toBe(false);
  });

  it('refuses an unknown difficulty rather than guessing one', () => {
    expect(() => generate({ difficulty: 'nightmare' })).toThrow(/difficulty/i);
  });
});

describe('generate', () => {
  // Fixed seeds so any failure is reproducible, and one puzzle per difficulty
  // is enough to assert the properties that must hold for all of them.
  const puzzles = Object.fromEntries(
    DIFFICULTY_IDS.map((id) => [id, generate({ difficulty: id, seed: `test-${id}` })]),
  );

  it.each(DIFFICULTY_IDS)('%s has exactly one solution', (id) => {
    expect(hasUniqueSolution(puzzles[id].puzzle)).toBe(true);
  });

  it.each(DIFFICULTY_IDS)('%s is solvable by logic alone, never by guessing', (id) => {
    // The hint engine can only help with puzzles the ladder can finish, so this
    // is the promise the whole hint feature rests on.
    expect(gradePuzzle(puzzles[id].puzzle).solved).toBe(true);
  });

  it.each(DIFFICULTY_IDS)('%s reports the difficulty it was asked for', (id) => {
    const result = puzzles[id];
    expect(result.difficulty).toBe(id);
    expect(result.onTarget).toBe(true);
    expect(result.grade.tier).toBeGreaterThanOrEqual(DIFFICULTIES[id].requires);
    expect(result.grade.tier).toBeLessThanOrEqual(DIFFICULTIES[id].cap);
  });

  it.each(DIFFICULTY_IDS)('%s keeps at least the clue floor for its level', (id) => {
    expect(puzzles[id].givens).toBe(countGivens(puzzles[id].puzzle));
    expect(puzzles[id].givens).toBeGreaterThanOrEqual(DIFFICULTIES[id].minGivens);
    // Any Sudoku needs at least 17 clues to be unique; well above it here.
    expect(puzzles[id].givens).toBeLessThan(CELLS);
  });

  it.each(DIFFICULTY_IDS)('%s agrees with its own solution', (id) => {
    const { puzzle, solution } = puzzles[id];
    expect(isComplete(solution)).toBe(true);
    for (let i = 0; i < CELLS; i++) {
      if (puzzle[i]) expect(solution[i]).toBe(puzzle[i]);
    }
    expect(toText(solve(puzzle))).toBe(toText(solution));
  });

  it('gives harder levels fewer clues than easier ones', () => {
    expect(puzzles.easy.givens).toBeGreaterThan(puzzles.hard.givens);
    expect(puzzles.medium.givens).toBeGreaterThan(puzzles.expert.givens);
  });

  it('needs harder techniques as the level rises', () => {
    expect(puzzles.easy.grade.tier).toBeLessThan(puzzles.hard.grade.tier);
    expect(puzzles.medium.grade.tier).toBeLessThan(puzzles.expert.grade.tier);
  });

  it('returns the same puzzle for the same seed', () => {
    const a = generate({ difficulty: 'medium', seed: 'repeat' });
    const b = generate({ difficulty: 'medium', seed: 'repeat' });
    expect(toText(a.puzzle)).toBe(toText(b.puzzle));
    expect(toText(a.solution)).toBe(toText(b.solution));
  });

  it('returns different puzzles for different seeds', () => {
    const a = generate({ difficulty: 'medium', seed: 'one' });
    const b = generate({ difficulty: 'medium', seed: 'two' });
    expect(toText(a.puzzle)).not.toBe(toText(b.puzzle));
  });

  it('still returns a valid puzzle when it cannot reach the target', () => {
    // One attempt is rarely enough for an Expert. Whatever comes back must
    // still be a real, unique, logically solvable puzzle; only the label is
    // allowed to be optimistic, and onTarget says so.
    const result = generate({ difficulty: 'expert', seed: 'one-shot', attempts: 1 });
    expect(result).not.toBeNull();
    expect(hasUniqueSolution(result.puzzle)).toBe(true);
    expect(gradePuzzle(result.puzzle).solved).toBe(true);
    expect(typeof result.onTarget).toBe('boolean');
  });
});

describe('generateDaily', () => {
  it('gives everyone the same puzzle for a date', () => {
    const a = generateDaily('2026-08-21');
    const b = generateDaily('2026-08-21');
    expect(toText(a.puzzle)).toBe(toText(b.puzzle));
  });

  it('gives a different puzzle the next day', () => {
    expect(toText(generateDaily('2026-08-21').puzzle)).not.toBe(
      toText(generateDaily('2026-08-22').puzzle),
    );
  });

  it('varies by difficulty on the same date', () => {
    expect(toText(generateDaily('2026-08-21', 'easy').puzzle)).not.toBe(
      toText(generateDaily('2026-08-21', 'hard').puzzle),
    );
  });

  it('is a real puzzle like any other', () => {
    const daily = generateDaily('2026-08-21');
    expect(hasUniqueSolution(daily.puzzle)).toBe(true);
    expect(gradePuzzle(daily.puzzle).solved).toBe(true);
  });
});

describe('localDateKey', () => {
  it('formats a local date as YYYY-MM-DD', () => {
    expect(localDateKey(new Date(2026, 7, 21))).toBe('2026-08-21');
    expect(localDateKey(new Date(2026, 0, 1))).toBe('2026-01-01');
    expect(localDateKey(new Date(2026, 11, 31))).toBe('2026-12-31');
  });

  it('reads the local calendar, not UTC', () => {
    // Late evening local time is already tomorrow in UTC in some zones. The
    // daily puzzle should follow the player's own calendar, so this uses the
    // local date components rather than toISOString.
    const lateEvening = new Date(2026, 7, 21, 23, 30);
    expect(localDateKey(lateEvening)).toBe('2026-08-21');
  });
});
