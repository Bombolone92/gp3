/**
 * Grid geometry for a standard 9x9 Sudoku.
 *
 * Cells are addressed by a single index 0..80 in reading order, so a board is
 * a flat 81-length array everywhere in the app. Everything derived from that
 * index (row, column, box, the 27 units, the 20 peers of a cell) is computed
 * once at module load and then only read, because these tables are consulted
 * hundreds of thousands of times during generation.
 *
 * Candidates are 9-bit masks: bit (n - 1) is set when digit n is possible.
 * Bit twiddling on a small integer is what makes the solver fast enough to
 * grade a puzzle by re-solving it dozens of times.
 */

export const SIZE = 9;
export const CELLS = 81;
/** All nine digits set: 0b111111111. */
export const ALL_DIGITS = 0x1ff;

export const rowOf = (i) => (i / SIZE) | 0;
export const colOf = (i) => i % SIZE;
export const boxOf = (i) => 3 * ((rowOf(i) / 3) | 0) + ((colOf(i) / 3) | 0);
export const indexOf = (row, col) => row * SIZE + col;

/** The bitmask for a single digit 1..9. */
export const maskOf = (digit) => 1 << (digit - 1);
/** Whether `mask` contains `digit`. */
export const hasDigit = (mask, digit) => (mask & maskOf(digit)) !== 0;
/** How many digits a mask holds. */
export function countBits(mask) {
  let n = 0;
  while (mask) {
    mask &= mask - 1;
    n++;
  }
  return n;
}
/** The single digit in a one-bit mask, or 0. Cheaper than a loop for singles. */
export const digitOf = (mask) => (mask && (mask & (mask - 1)) === 0 ? 31 - Math.clz32(mask) + 1 : 0);
/** The digits in a mask, ascending. */
export function digitsOf(mask) {
  const out = [];
  for (let d = 1; d <= SIZE; d++) if (hasDigit(mask, d)) out.push(d);
  return out;
}

/** The nine cells of row r, in column order. */
export const ROW_UNITS = Array.from({ length: SIZE }, (_, r) =>
  Array.from({ length: SIZE }, (_, c) => indexOf(r, c)),
);

/** The nine cells of column c, in row order. */
export const COL_UNITS = Array.from({ length: SIZE }, (_, c) =>
  Array.from({ length: SIZE }, (_, r) => indexOf(r, c)),
);

/** The nine cells of box b, in reading order. */
export const BOX_UNITS = Array.from({ length: SIZE }, (_, b) => {
  const top = 3 * ((b / 3) | 0);
  const left = 3 * (b % 3);
  const cells = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) cells.push(indexOf(top + r, left + c));
  return cells;
});

/**
 * All 27 units, rows then columns then boxes. Each carries its kind and a
 * human label ("row 4", "box 7") so a hint can name where it looked without
 * every technique re-deriving the wording.
 */
export const UNITS = [
  ...ROW_UNITS.map((cells, i) => ({ kind: 'row', index: i, cells, label: `row ${i + 1}` })),
  ...COL_UNITS.map((cells, i) => ({ kind: 'col', index: i, cells, label: `column ${i + 1}` })),
  ...BOX_UNITS.map((cells, i) => ({ kind: 'box', index: i, cells, label: `box ${i + 1}` })),
];

/** The three units (row, column, box) a cell belongs to. */
export const UNITS_OF = Array.from({ length: CELLS }, (_, i) =>
  UNITS.filter((u) => u.cells.includes(i)),
);

/**
 * The 20 cells that share a row, column, or box with each cell: the cells a
 * placement rules a digit out of. Sorted, and never including the cell itself.
 */
export const PEERS = Array.from({ length: CELLS }, (_, i) => {
  const set = new Set();
  for (const unit of UNITS_OF[i]) for (const j of unit.cells) if (j !== i) set.add(j);
  return [...set].sort((a, b) => a - b);
});

/** Human cell name in the r1c1 notation used by solving literature. */
export const cellName = (i) => `r${rowOf(i) + 1}c${colOf(i) + 1}`;

/** A copy of `board` that is safe to mutate. */
export const cloneBoard = (board) => Uint8Array.from(board);

/**
 * Cells holding a digit that duplicates one of their peers. Used to mark
 * conflicts in the UI, so it reports every cell involved rather than just the
 * one entered last.
 */
export function findConflicts(board) {
  const bad = new Set();
  for (const unit of UNITS) {
    const seen = new Map();
    for (const i of unit.cells) {
      const v = board[i];
      if (!v) continue;
      if (seen.has(v)) {
        bad.add(i);
        bad.add(seen.get(v));
      } else {
        seen.set(v, i);
      }
    }
  }
  return bad;
}

/** Whether every cell is filled and no unit repeats a digit. */
export function isComplete(board) {
  for (let i = 0; i < CELLS; i++) if (!board[i]) return false;
  return findConflicts(board).size === 0;
}
