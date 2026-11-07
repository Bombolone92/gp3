import { describe, expect, it } from 'vitest';
import { CELLS, PEERS, maskOf } from '../src/engine/grid.js';
import { generate } from '../src/engine/generator.js';
import { analysisFor, nextHint } from '../src/game/hints.js';
import { applyEliminations, createGame, setValue, toggleNote } from '../src/game/state.js';

const fresh = (difficulty, seed) => {
  const { puzzle, solution } = generate({ difficulty, seed });
  return createGame({ puzzle, solution, difficulty, seed });
};

const firstEmpty = (game) => [...game.values].findIndex((v) => v === 0);

describe('nextHint', () => {
  it('describes a real next step on a fresh puzzle', () => {
    const game = fresh('medium', 'hint-fresh');
    const hint = nextHint(game);
    expect(hint.kind).toBe('step');
    expect(hint.message.length).toBeGreaterThan(10);
    expect(hint.focus.length).toBeGreaterThan(0);
    expect(hint.step.label).toBeTruthy();
  });

  it('reports the mistake first, before any other reasoning', () => {
    // Correct logic elsewhere cannot rescue a board with a wrong digit on it,
    // and pointing at a naked single across the grid would actively mislead.
    const game = fresh('medium', 'hint-mistake');
    const cell = firstEmpty(game);
    const wrong = (game.solution[cell] % 9) + 1;
    setValue(game, cell, wrong);

    const hint = nextHint(game);
    expect(hint.kind).toBe('mistake');
    expect(hint.cells).toContain(cell);
    expect(hint.message).toContain('cannot be');
  });

  it('counts several mistakes together', () => {
    const game = fresh('medium', 'hint-mistakes');
    const empties = [...Array(CELLS).keys()].filter((i) => !game.values[i]).slice(0, 2);
    for (const cell of empties) setValue(game, cell, (game.solution[cell] % 9) + 1);
    const hint = nextHint(game);
    expect(hint.kind).toBe('mistake');
    expect(hint.cells.length).toBeGreaterThanOrEqual(2);
    expect(hint.message).toMatch(/cells hold/);
  });

  it('says so when the grid is finished', () => {
    const game = fresh('easy', 'hint-solved');
    for (let i = 0; i < CELLS; i++) if (!game.puzzle[i]) setValue(game, i, game.solution[i]);
    expect(nextHint(game).kind).toBe('solved');
  });

  it('only ever proposes the true digit', () => {
    const game = fresh('expert', 'hint-true');
    for (let n = 0; n < 20; n++) {
      const hint = nextHint(game);
      if (hint.kind !== 'step') break;
      for (const { cell, digit } of hint.step.placements) {
        expect(digit).toBe(game.solution[cell]);
        setValue(game, cell, digit);
      }
      if (!hint.step.placements.length) {
        for (const { cell, digit } of hint.step.eliminations) {
          expect(digit).not.toBe(game.solution[cell]);
        }
        applyEliminations(game, hint.step.eliminations);
      }
    }
  });

  it('carries a puzzle all the way to solved, one hint at a time', () => {
    // The promise the hint button makes: it always has something true to say,
    // and following it can never dead-end. Checked on the hardest level, where
    // eliminations rather than placements are what keep the chain moving.
    const game = fresh('expert', 'hint-chain');
    for (let n = 0; n < 400; n++) {
      const hint = nextHint(game);
      if (hint.kind === 'solved') break;
      expect(hint.kind).toBe('step');
      for (const { cell, digit } of hint.step.placements) setValue(game, cell, digit);
      if (hint.step.eliminations.length) applyEliminations(game, hint.step.eliminations);
    }
    expect([...game.values].join('')).toBe([...game.solution].join(''));
  });
});

describe('analysisFor', () => {
  it('drops candidates the board rules out', () => {
    const game = fresh('medium', 'analysis-board');
    const cell = firstEmpty(game);
    const analysis = analysisFor(game);
    expect(analysis.board[cell]).toBe(0);
    expect(analysis.cands[cell]).toBeGreaterThan(0);
    // No digit a peer already holds survives in the mask.
    for (const peer of PEERS[cell]) {
      if (game.values[peer]) expect(analysis.cands[cell] & maskOf(game.values[peer])).toBe(0);
    }
    // And the true answer is always still among the candidates.
    expect(analysis.cands[cell] & maskOf(game.solution[cell])).not.toBe(0);
  });

  it('also drops candidates earlier hints ruled out', () => {
    // This is what stops repeated hints from restating the same deduction: the
    // knowledge a hint established is folded back into the next analysis.
    const game = fresh('hard', 'analysis-elim');
    const cell = firstEmpty(game);
    const before = analysisFor(game).cands[cell];
    const digit = [1, 2, 3, 4, 5, 6, 7, 8, 9].find(
      (d) => d !== game.solution[cell] && before & maskOf(d),
    );
    applyEliminations(game, [{ cell, digit }]);
    expect(analysisFor(game).cands[cell] & maskOf(digit)).toBe(0);
  });

  it('ignores the player’s own pencil marks, right or wrong', () => {
    // Notes are a scratchpad and may be mistaken. Deriving hints from them
    // would let a player's error become the app's reasoning.
    const game = fresh('medium', 'analysis-notes');
    const cell = firstEmpty(game);
    const before = analysisFor(game).cands[cell];
    toggleNote(game, cell, 1);
    toggleNote(game, cell, 2);
    expect(analysisFor(game).cands[cell]).toBe(before);
  });
});
