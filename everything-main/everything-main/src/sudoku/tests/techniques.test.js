import { describe, expect, it } from 'vitest';
import { ALL_DIGITS, CELLS, cellName, indexOf, maskOf } from '../src/engine/grid.js';
import {
  LADDER_IDS,
  TECHNIQUES,
  __techniques,
  applyStep,
  createAnalysis,
  gradePuzzle,
  nextStep,
} from '../src/engine/techniques.js';
import { solve } from '../src/engine/solver.js';
import { generate } from '../src/engine/generator.js';
import { fromText } from '../src/game/serialize.js';

/**
 * A position built candidate-first.
 *
 * Elimination techniques read candidates, not clues, and hand-writing an
 * 81-clue grid that produces one exact X-Wing is both laborious and unreadable.
 * So these tests state the candidates directly: `filler` is what every
 * unmentioned cell holds, chosen to be inert for the technique under test
 * (usually "everything except the digit in question"), and `cells` sets the
 * pattern. The board stays empty, so every cell counts as unsolved.
 */
function position(cells, { without = [] } = {}) {
  const analysis = createAnalysis(new Uint8Array(CELLS));
  let filler = ALL_DIGITS;
  for (const digit of without) filler &= ~maskOf(digit);
  analysis.cands.fill(filler);
  for (const [cell, digits] of Object.entries(cells)) {
    analysis.cands[cell] = digits.reduce((mask, d) => mask | maskOf(d), 0);
  }
  return analysis;
}

/** Eliminations as a comparable, order-independent list of strings. */
const elims = (step) =>
  step.eliminations.map(({ cell, digit }) => `${cellName(cell)}!=${digit}`).sort();

describe('the ladder is ordered and self-consistent', () => {
  it('assigns every technique a tier and a cost', () => {
    for (const [name, meta] of Object.entries(TECHNIQUES)) {
      expect(meta.tier, name).toBeGreaterThanOrEqual(1);
      expect(meta.tier, name).toBeLessThanOrEqual(4);
      expect(meta.cost, name).toBeGreaterThan(0);
      expect(typeof meta.label, name).toBe('string');
    }
  });

  it('exposes exactly the techniques the catalogue describes', () => {
    expect(Object.keys(__techniques).sort()).toEqual(Object.keys(TECHNIQUES).sort());
  });

  it('costs harder tiers more than easier ones', () => {
    const byTier = {};
    for (const meta of Object.values(TECHNIQUES)) {
      byTier[meta.tier] = Math.max(byTier[meta.tier] ?? 0, meta.cost);
    }
    const tiers = Object.keys(byTier).map(Number).sort();
    for (let i = 1; i < tiers.length; i++) {
      expect(byTier[tiers[i]]).toBeGreaterThan(byTier[tiers[i - 1]]);
    }
  });
});

describe('tier 1: singles', () => {
  it('finds the last cell in a unit', () => {
    const board = new Uint8Array(CELLS);
    for (let d = 1; d <= 8; d++) board[d - 1] = d;
    const step = __techniques.fullHouse(createAnalysis(board));
    expect(step.technique).toBe('fullHouse');
    expect(step.placements).toEqual([{ cell: 8, digit: 9 }]);
    expect(step.explain).toContain('row 1');
  });

  it('finds a cell its peers have narrowed to one digit', () => {
    const board = new Uint8Array(CELLS);
    // Eight digits placed among r1c1's peers, spread so no unit is filled.
    board[1] = 1;
    board[2] = 2;
    board[10] = 3;
    board[11] = 4;
    board[9] = 5;
    board[18] = 6;
    board[27] = 7;
    board[36] = 8;
    const step = __techniques.nakedSingle(createAnalysis(board));
    expect(step.placements).toEqual([{ cell: 0, digit: 9 }]);
  });

  it('finds a digit with one home left in a unit', () => {
    const board = new Uint8Array(CELLS);
    // Nines placed so that in row 1, only r1c1 can still take one: boxes 2 and
    // 3 are covered, and columns 2 and 3 are covered.
    board[indexOf(1, 3)] = 9;
    board[indexOf(2, 6)] = 9;
    board[indexOf(3, 1)] = 9;
    board[indexOf(4, 2)] = 9;
    const analysis = createAnalysis(board);
    expect(analysis.cands[0]).toBe(ALL_DIGITS); // genuinely hidden, not naked
    const step = __techniques.hiddenSingle(analysis);
    expect(step.placements).toEqual([{ cell: 0, digit: 9 }]);
    expect(step.explain).toContain('only cell');
  });

  it('leaves a naked single to the simpler rule', () => {
    const board = new Uint8Array(CELLS);
    for (let d = 1; d <= 8; d++) board[d - 1] = d;
    // r1c9 is both a full house and a naked single; hiddenSingle declines it,
    // so the hint a player is shown is the easiest true description.
    expect(__techniques.hiddenSingle(createAnalysis(board))).toBeNull();
  });
});

describe('tier 2 and 3: subsets', () => {
  it('finds a naked pair and clears those digits from the unit', () => {
    const step = __techniques.nakedPair(
      position({ 0: [1, 2], 1: [1, 2], 2: [1, 3] }, { without: [1, 2] }),
    );
    expect(step.technique).toBe('nakedPair');
    expect(elims(step)).toEqual(['r1c3!=1']);
    expect(step.focus).toEqual([0, 1]);
  });

  it('finds a naked triple spread over three cells', () => {
    const step = __techniques.nakedTriple(
      position({ 0: [1, 2], 1: [2, 3], 2: [1, 3], 3: [1, 5] }, { without: [1, 2, 3] }),
    );
    expect(step.technique).toBe('nakedTriple');
    expect(elims(step)).toEqual(['r1c4!=1']);
  });

  it('finds a hidden pair and clears everything else from its cells', () => {
    const step = __techniques.hiddenPair(
      position({ 0: [4, 5, 7], 1: [4, 5, 8] }, { without: [4, 5] }),
    );
    expect(step.technique).toBe('hiddenPair');
    expect(elims(step)).toEqual(['r1c1!=7', 'r1c2!=8']);
  });

  it('finds a hidden triple', () => {
    const step = __techniques.hiddenTriple(
      position({ 0: [4, 5, 7], 1: [5, 6, 8], 2: [4, 6, 9] }, { without: [4, 5, 6] }),
    );
    expect(step.technique).toBe('hiddenTriple');
    expect(elims(step)).toEqual(['r1c1!=7', 'r1c2!=8', 'r1c3!=9']);
  });

  it('reports nothing when a subset rules nothing out', () => {
    // A textbook naked pair that has no one left to eliminate from is not a
    // move, and offering it as a hint would waste the player's press.
    expect(__techniques.nakedPair(position({ 0: [1, 2], 1: [1, 2] }, { without: [1, 2] }))).toBeNull();
  });
});

describe('tier 2: intersections', () => {
  it('points a digit out of a line from inside a box', () => {
    // In box 1, 5 can only go in r1c1 or r1c2, so it leaves the rest of row 1.
    const step = __techniques.pointing(position({ 0: [5, 7], 1: [5, 8], 5: [5, 9] }, { without: [5] }));
    expect(step.technique).toBe('pointing');
    expect(elims(step)).toEqual(['r1c6!=5']);
    expect(step.digit).toBe(5);
  });

  it('claims a digit for a box from a line', () => {
    // In row 1, 5 only fits inside box 1, so it leaves that box's other cells.
    const step = __techniques.claiming(
      position({ 0: [5, 7], 1: [5, 8], 9: [5, 9] }, { without: [5] }),
    );
    expect(step.technique).toBe('claiming');
    expect(elims(step)).toEqual(['r2c1!=5']);
  });
});

describe('tier 4: fish and wings', () => {
  it('finds an X-Wing across two rows', () => {
    const step = __techniques.xWing(
      position(
        {
          [indexOf(0, 1)]: [5, 7],
          [indexOf(0, 6)]: [5, 7],
          [indexOf(4, 1)]: [5, 8],
          [indexOf(4, 6)]: [5, 8],
          [indexOf(1, 1)]: [5, 9],
        },
        { without: [5] },
      ),
    );
    expect(step.technique).toBe('xWing');
    expect(elims(step)).toEqual(['r2c2!=5']);
    expect(step.focus.sort((a, b) => a - b)).toEqual([
      indexOf(0, 1),
      indexOf(0, 6),
      indexOf(4, 1),
      indexOf(4, 6),
    ]);
  });

  it('finds a Y-Wing and clears the shared digit', () => {
    // Pivot r1c1 is 1 or 2; the pincers are r1c2 (1 or 3) and r2c1 (2 or 3),
    // so a 3 lands in one of them and cannot sit where both can see.
    const step = __techniques.yWing(
      position({ 0: [1, 2], 1: [1, 3], 9: [2, 3], 10: [3, 7] }, { without: [3] }),
    );
    expect(step.technique).toBe('yWing');
    expect(elims(step)).toEqual(['r2c2!=3']);
    expect(step.focus).toEqual([0, 1, 9]);
  });

  it('rejects a pair of pincers holding the same two digits', () => {
    // Two identical bivalue cells are a naked pair, not a wing, and treating
    // them as one would "prove" an elimination that does not follow.
    expect(
      __techniques.yWing(position({ 0: [1, 2], 1: [1, 3], 9: [1, 3], 10: [3, 7] }, { without: [3] })),
    ).toBeNull();
  });
});

describe('gradePuzzle', () => {
  const newspaper = '530070000600195000098000060800060003400803001700020060060000280000419005000080079';

  it('solves a singles-only puzzle and reports tier 1', () => {
    const grade = gradePuzzle(
      fromText('530070000600195000098000060800060003400803001700020006060000280000419005000080079'),
    );
    expect(grade.solved).toBe(true);
    expect(grade.tier).toBe(1);
    expect(grade.score).toBeGreaterThan(0);
    expect(grade.steps.length).toBeGreaterThan(40);
  });

  it('stalls rather than guessing on a puzzle beyond the ladder', () => {
    // A published extreme puzzle needing chains and colouring. The generator
    // relies on this returning solved: false so such puzzles are never shipped.
    const grade = gradePuzzle(
      fromText('100007090030020008009600500005300900010080002600004000300000010041000007007000300'),
    );
    expect(grade.solved).toBe(false);
  });

  it('respects a tier cap', () => {
    const puzzle = generate({ difficulty: 'expert', seed: 'grade-cap' }).puzzle;
    expect(gradePuzzle(puzzle).solved).toBe(true);
    // The same puzzle needs tier 3 or 4, so a ladder stopped at tier 2 must
    // give up rather than quietly reach for a wing.
    expect(gradePuzzle(puzzle, { maxTier: 2 }).solved).toBe(false);
  });

  it('names the hardest technique it needed, not merely the last tier reached', () => {
    const grade = gradePuzzle(fromText(newspaper));
    expect(grade.hardest).not.toBeNull();
    expect(TECHNIQUES[grade.hardest].tier).toBe(grade.tier);
  });
});

describe('every step the ladder takes is sound', () => {
  // The property that matters most: a hint must never be wrong. A placement has
  // to match the unique solution, and an elimination must never remove the digit
  // that belongs in that cell. Checked across all four difficulties, on fixed
  // seeds so a failure is reproducible.
  const seeds = ['sound-1', 'sound-2', 'sound-3'];

  it.each(['easy', 'medium', 'hard', 'expert'])('%s', (difficulty) => {
    for (const seed of seeds) {
      const { puzzle } = generate({ difficulty, seed: `${difficulty}-${seed}` });
      const solution = solve(puzzle);
      const analysis = createAnalysis(puzzle);

      let steps = 0;
      for (;;) {
        const step = nextStep(analysis);
        if (!step) break;
        for (const { cell, digit } of step.placements) {
          expect(digit, `${difficulty}/${seed} placed ${digit} at ${cellName(cell)}`).toBe(
            solution[cell],
          );
        }
        for (const { cell, digit } of step.eliminations) {
          expect(digit, `${difficulty}/${seed} ruled out ${digit} at ${cellName(cell)}`).not.toBe(
            solution[cell],
          );
        }
        expect(step.explain.length).toBeGreaterThan(10);
        applyStep(analysis, step);
        expect(++steps).toBeLessThan(400);
      }
      expect([...analysis.board].join('')).toBe([...solution].join(''));
    }
  });
});

describe('the ladder', () => {
  // The ladder used to find each entry's tier through the function's own `name`,
  // which holds in source and is gone from a minified build: every lookup missed
  // and the module threw on load, taking the whole app with it. Naming the keys
  // explicitly is what fixes it, and this is what keeps the two lists in step.
  it('names every technique in the catalogue, in catalogue order', () => {
    expect(LADDER_IDS).toEqual(Object.keys(TECHNIQUES));
  });

  it('does not depend on function names, which a minifier rewrites', () => {
    for (const [id, fn] of Object.entries(__techniques)) {
      expect(TECHNIQUES[id]).toBeDefined();
      // Renaming the function must not change what the ladder can look up.
      Object.defineProperty(fn, 'name', { value: 'minified', configurable: true });
    }
    const analysis = createAnalysis(fromText('.'.repeat(CELLS)));
    expect(() => nextStep(analysis)).not.toThrow();
  });

  it('rises in tier, which is what lets nextStep stop at its cap', () => {
    const tiers = LADDER_IDS.map((id) => TECHNIQUES[id].tier);
    expect(tiers).toEqual([...tiers].sort((a, b) => a - b));
  });
});
