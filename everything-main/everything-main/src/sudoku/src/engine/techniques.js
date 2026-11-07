/**
 * Human solving techniques, in the order a person would reach for them.
 *
 * Two features share this one ladder, which is the point of writing it:
 *
 *   * Hints. `nextStep` returns the easiest move available in the position, so
 *     a hint can name the technique, point at the cells it read, and say why,
 *     rather than just leaking the answer from the solution grid.
 *   * Grading. `gradePuzzle` solves a puzzle with nothing but these techniques
 *     and reports the hardest one it needed. That is what "Medium" means here:
 *     not a count of givens, but which deductions the puzzle actually demands.
 *
 * The generator only ships puzzles this ladder can finish, so a hint is always
 * available and never has to say "now guess".
 *
 * Candidates here are the *basic* ones (a digit is a candidate for a cell when
 * no peer already holds it) plus whatever later steps have eliminated.
 * That is deliberately weaker than the solver's propagation: cascading naked
 * singles the way `candidatesFor` does would hide the very steps a player is
 * being asked to find.
 */

import {
  ALL_DIGITS,
  BOX_UNITS,
  CELLS,
  COL_UNITS,
  PEERS,
  ROW_UNITS,
  UNITS,
  boxOf,
  cellName,
  colOf,
  countBits,
  digitOf,
  digitsOf,
  maskOf,
  rowOf,
} from './grid.js';

/**
 * Technique catalogue: the ladder order, the tier a puzzle needing it lands
 * in, and a cost used to separate puzzles within a tier.
 *
 * `tier` is what the difficulty label reads off: a puzzle is as hard as the
 * hardest technique it forces you to use.
 */
export const TECHNIQUES = {
  fullHouse: { label: 'Last cell', tier: 1, cost: 1 },
  nakedSingle: { label: 'Naked single', tier: 1, cost: 2 },
  hiddenSingle: { label: 'Hidden single', tier: 1, cost: 3 },
  pointing: { label: 'Pointing pair', tier: 2, cost: 5 },
  claiming: { label: 'Box/line reduction', tier: 2, cost: 5 },
  nakedPair: { label: 'Naked pair', tier: 2, cost: 6 },
  hiddenPair: { label: 'Hidden pair', tier: 3, cost: 9 },
  nakedTriple: { label: 'Naked triple', tier: 3, cost: 10 },
  hiddenTriple: { label: 'Hidden triple', tier: 3, cost: 13 },
  xWing: { label: 'X-Wing', tier: 4, cost: 16 },
  yWing: { label: 'Y-Wing', tier: 4, cost: 18 },
};

/**
 * Ladder order: `nextStep` returns the first technique that fires.
 *
 * Must stay sorted by tier: `nextStep` stops at the first entry above its cap
 * rather than filtering the whole list on every call, and generation calls it
 * tens of thousands of times.
 *
 * Each entry names its own key in TECHNIQUES. Reading the key off the
 * function's `name` instead would work in source and break in a minified
 * build, where these functions are renamed and the lookup finds nothing.
 */
const LADDER = [
  ['fullHouse', fullHouse],
  ['nakedSingle', nakedSingle],
  ['hiddenSingle', hiddenSingle],
  ['pointing', pointing],
  ['claiming', claiming],
  ['nakedPair', nakedPair],
  ['hiddenPair', hiddenPair],
  ['nakedTriple', nakedTriple],
  ['hiddenTriple', hiddenTriple],
  ['xWing', xWing],
  ['yWing', yWing],
];

/** The ladder in order, so the catalogue and the ladder can be checked against
 *  each other rather than trusted to stay in step. */
export const LADDER_IDS = LADDER.map(([id]) => id);

if (LADDER.some(([id], i) => i > 0 && TECHNIQUES[id].tier < TECHNIQUES[LADDER[i - 1][0]].tier)) {
  throw new Error('LADDER must be ordered by tier.');
}

/* ------------------------------------------------------------------ */
/* Analysis state                                                      */
/* ------------------------------------------------------------------ */

/**
 * A working position: a board plus the candidates still standing.
 * @param {ArrayLike<number>} board
 */
export function createAnalysis(board) {
  const b = Uint8Array.from(board);
  const cands = new Int16Array(CELLS);
  for (let i = 0; i < CELLS; i++) {
    if (b[i]) continue;
    let mask = ALL_DIGITS;
    for (const p of PEERS[i]) if (b[p]) mask &= ~maskOf(b[p]);
    cands[i] = mask;
  }
  return { board: b, cands };
}

/** Fold a step's placements and eliminations into the position. */
export function applyStep(analysis, step) {
  const { board, cands } = analysis;
  for (const { cell, digit } of step.placements ?? []) {
    board[cell] = digit;
    cands[cell] = 0;
    for (const p of PEERS[cell]) cands[p] &= ~maskOf(digit);
  }
  for (const { cell, digit } of step.eliminations ?? []) {
    cands[cell] &= ~maskOf(digit);
  }
  return analysis;
}

/**
 * The easiest technique that applies here, or null when the ladder is out.
 * @param {object} analysis
 * @param {number} [maxTier] Ignore techniques above this tier. Generation uses
 *   this to ask "is this puzzle still solvable with nothing harder than X?",
 *   which is how it lands on a requested difficulty rather than whatever the
 *   dig happens to produce.
 */
export function nextStep(analysis, maxTier = 4) {
  for (const [id, run] of LADDER) {
    if (TECHNIQUES[id].tier > maxTier) break; // LADDER is tier-ordered
    const step = run(analysis);
    if (step) return step;
  }
  return null;
}

/**
 * Solve `puzzle` with the ladder alone and report what it took.
 *
 * @param {ArrayLike<number>} puzzle
 * @param {{maxTier?: number}} [options] Cap the ladder, as `nextStep` does.
 * @returns {{solved: boolean, tier: number, score: number, steps: object[],
 *   counts: Record<string, number>, hardest: string|null}}
 *   `tier` is the hardest tier reached (0 when nothing was needed), `score`
 *   the summed cost, and `solved` false when the ladder stalled, which means
 *   the puzzle needs guessing or a technique this module does not know.
 */
export function gradePuzzle(puzzle, { maxTier = 4 } = {}) {
  const analysis = createAnalysis(puzzle);
  const steps = [];
  const counts = {};
  let tier = 0;
  let score = 0;
  let hardest = null;

  for (let guard = 0; guard < 400; guard++) {
    if (isFilled(analysis.board)) {
      return { solved: true, tier, score, steps, counts, hardest };
    }
    const step = nextStep(analysis, maxTier);
    if (!step) break;
    const meta = TECHNIQUES[step.technique];
    counts[step.technique] = (counts[step.technique] ?? 0) + 1;
    score += meta.cost;
    tier = Math.max(tier, meta.tier);
    // Cost, not tier, picks the name to report: two techniques can share a
    // tier, and "hidden single" is the more honest answer than the naked
    // single that happened to be needed first.
    if (!hardest || meta.cost > TECHNIQUES[hardest].cost) hardest = step.technique;
    steps.push(step);
    applyStep(analysis, step);
  }

  return { solved: isFilled(analysis.board), tier, score, steps, counts, hardest };
}

const isFilled = (board) => {
  for (let i = 0; i < CELLS; i++) if (!board[i]) return false;
  return true;
};

/* ------------------------------------------------------------------ */
/* Step helpers                                                        */
/* ------------------------------------------------------------------ */

function placement(technique, cell, digit, focus, explain) {
  return {
    technique,
    label: TECHNIQUES[technique].label,
    tier: TECHNIQUES[technique].tier,
    placements: [{ cell, digit }],
    eliminations: [],
    focus,
    target: cell,
    digit,
    explain,
  };
}

function elimination(technique, eliminations, focus, explain, digit = null) {
  return {
    technique,
    label: TECHNIQUES[technique].label,
    tier: TECHNIQUES[technique].tier,
    placements: [],
    eliminations,
    focus,
    target: eliminations[0]?.cell ?? null,
    digit,
    explain,
  };
}

/** Cells of a unit that are still empty. */
const emptyCells = (board, cells) => cells.filter((i) => !board[i]);

/** Empty cells of a unit that list `digit` as a candidate. */
const placesFor = (analysis, cells, digit) =>
  cells.filter((i) => !analysis.board[i] && analysis.cands[i] & maskOf(digit));

/** Join cell names for prose: "r1c2, r3c4 and r5c6". */
function listCells(cells) {
  const names = cells.map(cellName);
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

const listDigits = (digits) =>
  digits.length <= 1 ? String(digits[0] ?? '') : `${digits.slice(0, -1).join(', ')} and ${digits.at(-1)}`;

/** Every k-sized combination of `items`, as arrays. */
function combinations(items, k) {
  const out = [];
  const walk = (start, chosen) => {
    if (chosen.length === k) {
      out.push([...chosen]);
      return;
    }
    for (let i = start; i < items.length; i++) {
      chosen.push(items[i]);
      walk(i + 1, chosen);
      chosen.pop();
    }
  };
  walk(0, []);
  return out;
}

/* ------------------------------------------------------------------ */
/* Tier 1: singles                                                     */
/* ------------------------------------------------------------------ */

/** A unit with a single empty cell. Same answer as a naked single, but the
 *  easiest thing in Sudoku to see, so it is worth naming separately. */
function fullHouse({ board, cands }) {
  for (const unit of UNITS) {
    const empties = emptyCells(board, unit.cells);
    if (empties.length !== 1) continue;
    const cell = empties[0];
    const digit = digitOf(cands[cell]);
    if (!digit) continue;
    return placement(
      'fullHouse',
      cell,
      digit,
      unit.cells,
      `${unit.label} has one empty cell left, so ${cellName(cell)} must be ${digit}.`,
    );
  }
  return null;
}

/** A cell whose peers have ruled out eight of the nine digits. */
function nakedSingle({ board, cands }) {
  for (let i = 0; i < CELLS; i++) {
    if (board[i]) continue;
    const digit = digitOf(cands[i]);
    if (!digit) continue;
    return placement(
      'nakedSingle',
      i,
      digit,
      [i, ...PEERS[i].filter((p) => board[p])],
      `${digit} is the only digit left for ${cellName(i)}: its row, column and box account for the other eight.`,
    );
  }
  return null;
}

/** A digit with exactly one home left in some unit. */
function hiddenSingle(analysis) {
  const { board } = analysis;
  for (const unit of UNITS) {
    const filled = new Set(unit.cells.map((i) => board[i]).filter(Boolean));
    for (let d = 1; d <= 9; d++) {
      if (filled.has(d)) continue;
      const places = placesFor(analysis, unit.cells, d);
      if (places.length !== 1) continue;
      // A naked single reads more simply, so leave those to the rule above.
      if (countBits(analysis.cands[places[0]]) === 1) continue;
      return placement(
        'hiddenSingle',
        places[0],
        d,
        unit.cells,
        `In ${unit.label}, ${cellName(places[0])} is the only cell that can still take ${d}.`,
      );
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Tier 2-3: subsets and intersections                                 */
/* ------------------------------------------------------------------ */

/**
 * Naked subset: k cells in a unit share exactly k candidates between them, so
 * those k digits are used up there and can go nowhere else in the unit.
 */
function nakedSubset(analysis, k, technique) {
  const { board, cands } = analysis;
  for (const unit of UNITS) {
    const empties = emptyCells(board, unit.cells).filter((i) => countBits(cands[i]) <= k);
    if (empties.length <= k) continue;
    for (const group of combinations(empties, k)) {
      let union = 0;
      for (const i of group) union |= cands[i];
      if (countBits(union) !== k) continue;

      const eliminations = [];
      for (const i of unit.cells) {
        if (board[i] || group.includes(i)) continue;
        for (const d of digitsOf(cands[i] & union)) eliminations.push({ cell: i, digit: d });
      }
      if (!eliminations.length) continue;

      const digits = digitsOf(union);
      return elimination(
        technique,
        eliminations,
        group,
        `${listCells(group)} in ${unit.label} hold only ${listDigits(digits)} between them, ` +
          `so those ${k} digits fill those ${k} cells and can be removed from the rest of ${unit.label}.`,
      );
    }
  }
  return null;
}

function nakedPair(a) {
  return nakedSubset(a, 2, 'nakedPair');
}

function nakedTriple(a) {
  return nakedSubset(a, 3, 'nakedTriple');
}

/**
 * Hidden subset: k digits in a unit are confined to the same k cells, so those
 * cells cannot hold anything else, even though each still lists other digits.
 */
function hiddenSubset(analysis, k, technique) {
  const { board, cands } = analysis;
  for (const unit of UNITS) {
    const empties = emptyCells(board, unit.cells);
    if (empties.length <= k) continue;
    const open = [];
    for (let d = 1; d <= 9; d++) {
      const places = placesFor(analysis, unit.cells, d);
      if (places.length >= 2 && places.length <= k) open.push({ digit: d, places });
    }
    if (open.length < k) continue;

    for (const group of combinations(open, k)) {
      const cellSet = new Set();
      for (const { places } of group) for (const c of places) cellSet.add(c);
      if (cellSet.size !== k) continue;

      let keep = 0;
      for (const { digit } of group) keep |= maskOf(digit);
      const eliminations = [];
      for (const c of cellSet) {
        for (const d of digitsOf(cands[c] & ~keep)) eliminations.push({ cell: c, digit: d });
      }
      if (!eliminations.length) continue;

      const digits = group.map((g) => g.digit);
      return elimination(
        technique,
        eliminations,
        [...cellSet],
        `In ${unit.label}, ${listDigits(digits)} can only go in ${listCells([...cellSet].sort((x, y) => x - y))}. ` +
          `Those ${k} cells are taken by those ${k} digits, so nothing else fits in them.`,
      );
    }
  }
  return null;
}

function hiddenPair(a) {
  return hiddenSubset(a, 2, 'hiddenPair');
}

function hiddenTriple(a) {
  return hiddenSubset(a, 3, 'hiddenTriple');
}

/**
 * Pointing: a digit's only homes in a box all sit in one row or column, so it
 * must be in the box, and therefore nowhere else along that line.
 */
function pointing(analysis) {
  for (let b = 0; b < 9; b++) {
    const cells = BOX_UNITS[b];
    for (let d = 1; d <= 9; d++) {
      const places = placesFor(analysis, cells, d);
      if (places.length < 2) continue;

      for (const [axis, of, units, name] of [
        ['row', rowOf, ROW_UNITS, 'row'],
        ['col', colOf, COL_UNITS, 'column'],
      ]) {
        const line = of(places[0]);
        if (!places.every((c) => of(c) === line)) continue;
        const eliminations = units[line]
          .filter((c) => boxOf(c) !== b)
          .filter((c) => !analysis.board[c] && analysis.cands[c] & maskOf(d))
          .map((cell) => ({ cell, digit: d }));
        if (!eliminations.length) continue;
        void axis;
        return elimination(
          'pointing',
          eliminations,
          places,
          `In box ${b + 1}, ${d} can only go in ${listCells(places)}, all in ${name} ${line + 1}. ` +
            `So ${d} is somewhere in that box, and can be removed from the rest of ${name} ${line + 1}.`,
          d,
        );
      }
    }
  }
  return null;
}

/**
 * Claiming (box/line reduction): a digit's only homes in a row or column all
 * sit in one box, so it is in that intersection and nowhere else in the box.
 */
function claiming(analysis) {
  for (const [units, name] of [
    [ROW_UNITS, 'row'],
    [COL_UNITS, 'column'],
  ]) {
    for (let l = 0; l < 9; l++) {
      for (let d = 1; d <= 9; d++) {
        const places = placesFor(analysis, units[l], d);
        if (places.length < 2) continue;
        const box = boxOf(places[0]);
        if (!places.every((c) => boxOf(c) === box)) continue;

        const eliminations = BOX_UNITS[box]
          .filter((c) => !units[l].includes(c))
          .filter((c) => !analysis.board[c] && analysis.cands[c] & maskOf(d))
          .map((cell) => ({ cell, digit: d }));
        if (!eliminations.length) continue;

        return elimination(
          'claiming',
          eliminations,
          places,
          `In ${name} ${l + 1}, ${d} can only go in ${listCells(places)}, all inside box ${box + 1}. ` +
            `So that box's ${d} lies on this ${name}, and can be removed from the box's other cells.`,
          d,
        );
      }
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Tier 4: fish and wings                                              */
/* ------------------------------------------------------------------ */

/**
 * X-Wing: a digit has exactly two homes in each of two rows, and they line up
 * in the same two columns. The digit takes one column in one row and the other
 * in the other, either way, so it leaves both columns entirely. And likewise
 * with rows and columns swapped.
 */
function xWing(analysis) {
  for (const [lines, cross, crossOf, lineName, crossName] of [
    [ROW_UNITS, COL_UNITS, colOf, 'rows', 'column'],
    [COL_UNITS, ROW_UNITS, rowOf, 'columns', 'row'],
  ]) {
    for (let d = 1; d <= 9; d++) {
      const pairs = [];
      for (let l = 0; l < 9; l++) {
        const places = placesFor(analysis, lines[l], d);
        if (places.length === 2) pairs.push({ line: l, places });
      }
      for (const [a, b] of combinations(pairs, 2)) {
        const ca = a.places.map(crossOf);
        const cb = b.places.map(crossOf);
        if (ca[0] !== cb[0] || ca[1] !== cb[1]) continue;

        const corners = [...a.places, ...b.places];
        const eliminations = [];
        for (const c of ca) {
          for (const cell of cross[c]) {
            if (corners.includes(cell)) continue;
            if (!analysis.board[cell] && analysis.cands[cell] & maskOf(d)) {
              eliminations.push({ cell, digit: d });
            }
          }
        }
        if (!eliminations.length) continue;

        return elimination(
          'xWing',
          eliminations,
          corners,
          `${d} has just two homes in each of ${lineName} ${a.line + 1} and ${b.line + 1}, ` +
            `and they share ${crossName}s ${ca[0] + 1} and ${ca[1] + 1}. ` +
            `Whichever way round it goes, both ${crossName}s are used, so ${d} goes nowhere else in them.`,
          d,
        );
      }
    }
  }
  return null;
}

/**
 * Y-Wing: a pivot cell with candidates {a,b} sees one cell with {a,c} and
 * another with {b,c}. The pivot is a or b, which forces c into one pincer or
 * the other, so c is gone from every cell both pincers see.
 */
function yWing(analysis) {
  const { board, cands } = analysis;
  const bivalue = [];
  for (let i = 0; i < CELLS; i++) {
    if (!board[i] && countBits(cands[i]) === 2) bivalue.push(i);
  }

  for (const pivot of bivalue) {
    const [a, b] = digitsOf(cands[pivot]);
    const wings = bivalue.filter((i) => i !== pivot && PEERS[pivot].includes(i));
    for (const w1 of wings) {
      for (const w2 of wings) {
        if (w2 <= w1) continue;
        // One wing shares a with the pivot, the other b, and they share c.
        const d1 = digitsOf(cands[w1]);
        const d2 = digitsOf(cands[w2]);
        const pair = (digits, shared) => digits.includes(shared) && digits.length === 2;
        if (!((pair(d1, a) && pair(d2, b)) || (pair(d1, b) && pair(d2, a)))) continue;
        const c1 = d1.find((d) => d !== a && d !== b);
        const c2 = d2.find((d) => d !== a && d !== b);
        if (c1 === undefined || c1 !== c2) continue;
        // Rule out the degenerate case where both wings hold the same digits.
        if (cands[w1] === cands[w2]) continue;

        const seen = PEERS[w1].filter((i) => PEERS[w2].includes(i));
        const eliminations = seen
          .filter((i) => i !== pivot && !board[i] && cands[i] & maskOf(c1))
          .map((cell) => ({ cell, digit: c1 }));
        if (!eliminations.length) continue;

        return elimination(
          'yWing',
          eliminations,
          [pivot, w1, w2],
          `${cellName(pivot)} is ${a} or ${b}. Either way it forces ${c1} into ${cellName(w1)} or ` +
            `${cellName(w2)}, so ${c1} can be removed from every cell both of those see.`,
          c1,
        );
      }
    }
  }
  return null;
}

export const __techniques = {
  fullHouse,
  nakedSingle,
  hiddenSingle,
  nakedPair,
  nakedTriple,
  hiddenPair,
  hiddenTriple,
  pointing,
  claiming,
  xWing,
  yWing,
};
