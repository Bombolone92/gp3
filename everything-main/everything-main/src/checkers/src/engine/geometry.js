/**
 * Board geometry for English draughts.
 *
 * Only the 32 dark squares are playable, so the engine numbers them 1–32 the
 * way PDN does rather than carrying a 64-cell board and checking parity. Dark
 * squares are those where (row + col) is odd with row 0 at the top, numbered
 * left to right within a row, top to bottom: Black's back row is 1–4 and
 * White's is 29–32. Black starts on 1–12 and advances toward higher numbers.
 *
 * Directions are indexed once, here, and everything downstream uses the index:
 *   0 up-left   1 up-right   2 down-left   3 down-right
 * "Up" is toward row 0, which is Black's back row and White's crowning row.
 */

const DELTAS = [
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
];

export const DIRS_BLACK = [2, 3];
export const DIRS_WHITE = [0, 1];
export const DIRS_KING = [0, 1, 2, 3];

/** The row a man of each colour is crowned on. */
export const CROWN_ROW = { b: 7, w: 0 };

/** @param {number} num 1–32 @returns {[number, number]} [row, col] */
export function squareToRowCol(num) {
  const row = (num - 1) >> 2;
  const idx = (num - 1) & 3;
  // Even rows carry their dark squares on odd files and vice versa.
  return [row, idx * 2 + (row % 2 === 0 ? 1 : 0)];
}

/** @returns {number} 1–32, or 0 for a light or off-board square. */
export function rowColToSquare(row, col) {
  if (row < 0 || row > 7 || col < 0 || col > 7) return 0;
  if ((row + col) % 2 === 0) return 0;
  return row * 4 + (col >> 1) + 1;
}

export function isCrowningSquare(num, color) {
  return squareToRowCol(num)[0] === CROWN_ROW[color];
}

/** STEPS[num][dir] → adjacent square, or 0 when off the board. */
export const STEPS = buildSteps();
/** JUMPS[num][dir] → {over, land}, or null when the jump runs off the board. */
export const JUMPS = buildJumps();

function buildSteps() {
  const table = [null];
  for (let num = 1; num <= 32; num++) {
    const [row, col] = squareToRowCol(num);
    table.push(DELTAS.map(([dr, dc]) => rowColToSquare(row + dr, col + dc)));
  }
  return table;
}

function buildJumps() {
  const table = [null];
  for (let num = 1; num <= 32; num++) {
    const [row, col] = squareToRowCol(num);
    table.push(
      DELTAS.map(([dr, dc], dir) => {
        const over = STEPS[num][dir];
        const land = rowColToSquare(row + dr * 2, col + dc * 2);
        return over && land ? { over, land } : null;
      }),
    );
  }
  return table;
}
