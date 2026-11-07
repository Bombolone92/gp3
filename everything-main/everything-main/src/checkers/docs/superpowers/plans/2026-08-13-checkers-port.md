# Checkers Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the single-file checkers game as a structural mirror of `chess.puter.com` — same architecture, visual design, and feature set, with American checkers in place of chess.

**Architecture:** Vanilla JS, no runtime framework, built with Vite. A pure rules engine over a 32-cell board (`src/engine/checkers.js`) that deals only in complete turns; a negamax AI over it; a DOM-only board view; a controller (`src/main.js`) that owns all app state including the hop-at-a-time jump chain; and four supporting modules for clock, persistence, PDN export, and Puter Peer online play.

**Tech Stack:** Vite 8, Vitest 4, `lucide` icons, `@fontsource/inter`, Puter Peer API (loaded lazily from the CDN, not an npm dependency).

**Reference implementation:** `../chess.puter.com` is the app being mirrored. Many tasks say "port from" a file there. That means: read that file, keep its structure, comments, and naming, and change only what the spec says changes. It does **not** mean rewrite from scratch.

**Spec:** `docs/superpowers/specs/2026-08-13-checkers-port-design.md`

## Global Constraints

- Target deploy: **checkers.puter.com**. Every canonical URL, `og:url`, PDN `Site` tag, manifest `start_url`, and sitemap entry uses it.
- Rules: American checkers (English draughts). **Capture is mandatory**; among several capturing sequences the player chooses freely. **Black moves first.** Crowning ends the turn immediately. **A player with no legal move loses.**
- Colours are `'b'` and `'w'` internally, displayed "Black" and "White". Upper case in a board cell means a king: `'b' 'B' 'w' 'W'`.
- Squares are PDN numbers **1–32**. `num = row*4 + (col>>1) + 1`, dark squares are those where `(row+col)` is odd, row 0 at the top. Black's back row is 1–4, White's is 29–32; Black starts on 1–12, White on 21–32.
- Directions are indexed `0: up-left (-1,-1)`, `1: up-right (-1,+1)`, `2: down-left (+1,-1)`, `3: down-right (+1,+1)`. Black men use dirs 2,3; White men use dirs 0,1; kings use all four.
- The engine deals **only in complete turns**. No engine method ever accepts or returns a partial jump sequence, except the read-only `preview()`.
- No `promotion` parameter anywhere — crowning is automatic.
- Storage keys: `checkers-game`, `checkers-settings`.
- Never commit a placeholder Plausible ID copied from the chess app. See Task 16.
- All user-facing text is written with `textContent`, never `innerHTML`. Opponent names and invite codes come off the wire.
- Every task ends with a passing `npm test` and a commit.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `package.json`, `vite.config.js` | build and test config |
| `index.html` | app shell — topbar, board, sidebar, dialogs |
| `src/style.css` | all styling |
| `src/main.js` | controller: app state, modes, interaction, chain lock, rendering orchestration |
| `src/analytics.js` | Plausible wrapper (ported verbatim) |
| `src/engine/geometry.js` | square numbering and the `STEPS`/`JUMPS` tables |
| `src/engine/checkers.js` | position, move generation, apply/undo, status |
| `src/engine/ai.js` | evaluation and search |
| `src/ui/boardView.js` | board DOM, pointer and keyboard input |
| `src/game/chain.js` | filtering a move list down to a jump sequence in progress |
| `src/game/clock.js` | time controls and the two countdowns (ported verbatim) |
| `src/game/persistence.js` | saved-game read/write/validate |
| `src/game/pdn.js` | PDN export |
| `src/net/online.js` | Puter Peer session |
| `tests/*.test.js` | one file per module under test |

Geometry is split out of `checkers.js` because it is pure data with no dependency on position state, it is the single most important thing to get right, and it deserves its own test file. `chain.js` is split out of `main.js` for the same reason: it is the one piece of genuinely new logic in the port, and in the controller it would be untestable without a DOM.

---

# Phase 1 — Engine

## Task 1: Project scaffold

**Files:**
- Create: `package.json`, `vite.config.js`, `tests/scaffold.test.js`
- Reference: `../chess.puter.com/package.json`, `../chess.puter.com/vite.config.js`

**Interfaces:**
- Consumes: nothing
- Produces: a working `npm test` and `npm run dev`

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "checkers-puter",
  "private": true,
  "version": "1.0.0",
  "type": "module",
  "description": "Play checkers against the computer or a friend — locally or online. No frameworks, just the web.",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "vite": "^8.2.0",
    "vitest": "^4.1.10"
  },
  "dependencies": {
    "@fontsource/inter": "^5.3.0",
    "lucide": "^1.28.0"
  }
}
```

- [ ] **Step 2: Write `vite.config.js`**

```js
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
  },
});
```

- [ ] **Step 3: Write a scaffold test**

```js
import { describe, it, expect } from 'vitest';

describe('scaffold', () => {
  it('runs vitest', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 4: Install and run**

Run: `npm install && npm test`
Expected: 1 test passes.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json vite.config.js tests/scaffold.test.js
git commit -m "Add the Vite and Vitest scaffold"
```

---

## Task 2: Board geometry

The single most important task in the plan. A mirrored numbering produces a board that is entirely self-consistent and wrong against every published game, so the tests here assert against known-good facts from outside the code: the printed diagram, and the two most common opening moves in checkers.

**Files:**
- Create: `src/engine/geometry.js`, `tests/geometry.test.js`

**Interfaces:**
- Produces:
  - `squareToRowCol(num) → [row, col]` — `num` is 1–32
  - `rowColToSquare(row, col) → number` — 0 for a light square
  - `STEPS: number[][]` — 33 rows (index 0 unused) of 4; `STEPS[num][dir]` is the adjacent square, or 0
  - `JUMPS: (null | {over: number, land: number})[33][4]`
  - `DIRS_BLACK = [2, 3]`, `DIRS_WHITE = [0, 1]`, `DIRS_KING = [0, 1, 2, 3]`
  - `CROWN_ROW = { b: 7, w: 0 }`
  - `isCrowningSquare(num, color) → boolean`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest';
import {
  squareToRowCol, rowColToSquare, STEPS, JUMPS, isCrowningSquare,
} from '../src/engine/geometry.js';

describe('square numbering', () => {
  it('puts square 1 on the top row and 32 on the bottom', () => {
    expect(squareToRowCol(1)).toEqual([0, 1]);
    expect(squareToRowCol(4)).toEqual([0, 7]);
    expect(squareToRowCol(29)).toEqual([7, 0]);
    expect(squareToRowCol(32)).toEqual([7, 6]);
  });

  it('round-trips every square', () => {
    for (let n = 1; n <= 32; n++) {
      const [r, c] = squareToRowCol(n);
      expect(rowColToSquare(r, c)).toBe(n);
    }
  });

  it('reports light squares as 0', () => {
    expect(rowColToSquare(0, 0)).toBe(0);
    expect(rowColToSquare(7, 7)).toBe(0);
  });

  // Guards against a mirrored board: these are the two most-played opening
  // moves in checkers, and both must be single diagonal steps in the right
  // direction. 11-15 is Black's "Old Faithful"; 23-19 is a standard reply.
  it('makes the classic openings legal single steps', () => {
    expect(STEPS[11][2]).toBe(15);  // Black steps down-left
    expect(STEPS[23][1]).toBe(19);  // White steps up-right
  });

  it('gives edge squares no off-board neighbours', () => {
    expect(STEPS[1][0]).toBe(0);    // top row has nothing above it
    expect(STEPS[5][0]).toBe(0);    // left file has nothing up-left
    expect(STEPS[29][2]).toBe(0);   // bottom row has nothing below it
  });

  it('builds jumps as a step onto a landing square two away', () => {
    expect(JUMPS[11][2]).toEqual({ over: 15, land: 18 });
    expect(JUMPS[1][2]).toBe(null); // no landing square: 1 is on the edge file
  });

  it('knows the crowning rows', () => {
    expect(isCrowningSquare(29, 'b')).toBe(true);
    expect(isCrowningSquare(32, 'b')).toBe(true);
    expect(isCrowningSquare(1, 'b')).toBe(false);
    expect(isCrowningSquare(1, 'w')).toBe(true);
    expect(isCrowningSquare(29, 'w')).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/geometry.test.js`
Expected: FAIL — cannot resolve `../src/engine/geometry.js`.

- [ ] **Step 3: Implement the module**

```js
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
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/geometry.test.js`
Expected: all 7 pass. **If the opening-move test fails, stop and fix the numbering — do not adjust the test.**

- [ ] **Step 5: Print the board and eyeball it**

Run:
```bash
node -e "
const {rowColToSquare}=await import('./src/engine/geometry.js');
for(let r=0;r<8;r++){let s='';for(let c=0;c<8;c++){const n=rowColToSquare(r,c);s+=n?String(n).padStart(3):'  .';}console.log(s);}
" --input-type=module
```
Expected: `1 2 3 4` across the top row and `29 30 31 32` across the bottom, matching the diagram in the spec.

- [ ] **Step 6: Commit**

```bash
git add src/engine/geometry.js tests/geometry.test.js
git commit -m "Number the dark squares the way PDN does"
```

---

## Task 3: Position — load, reset, FEN

**Files:**
- Create: `src/engine/checkers.js`, `tests/position.test.js`

**Interfaces:**
- Consumes: everything from `geometry.js`
- Produces:
  - `class Checkers` with `constructor(fen = START_FEN)`, `load(fen)`, `reset()`, `fen()`, `turn()`, `board()`, `get(square)`
  - `export const START_FEN`
  - `export function colorOf(piece) → 'b' | 'w'`
  - `export function isKing(piece) → boolean`
  - Internal state: `this._board` is a 33-length array (index 0 unused) of `null | 'b' | 'B' | 'w' | 'W'`; `this._turn` is `'b' | 'w'`

PDN's FEN is `<turn>:W<squares>:B<squares>`, with `K` prefixing a king — e.g. `B:W21,22,23:BK5,6`.

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest';
import { Checkers, START_FEN, colorOf, isKing } from '../src/engine/checkers.js';

describe('position', () => {
  it('starts with Black to move and twelve men a side', () => {
    const game = new Checkers();
    expect(game.turn()).toBe('b');
    for (let n = 1; n <= 12; n++) expect(game.get(n)).toBe('b');
    for (let n = 13; n <= 20; n++) expect(game.get(n)).toBe(null);
    for (let n = 21; n <= 32; n++) expect(game.get(n)).toBe('w');
  });

  it('round-trips the start position through FEN', () => {
    expect(new Checkers().fen()).toBe(START_FEN);
    expect(new Checkers(START_FEN).fen()).toBe(START_FEN);
  });

  it('loads kings and an arbitrary position', () => {
    const game = new Checkers('W:WK32:B5,K6');
    expect(game.turn()).toBe('w');
    expect(game.get(32)).toBe('W');
    expect(game.get(5)).toBe('b');
    expect(game.get(6)).toBe('B');
    expect(game.get(1)).toBe(null);
    expect(game.fen()).toBe('W:WK32:B5,K6');
  });

  it('resets back to the start', () => {
    const game = new Checkers('W:WK32:B5');
    game.reset();
    expect(game.fen()).toBe(START_FEN);
  });

  it('rejects a malformed FEN', () => {
    expect(() => new Checkers('nonsense')).toThrow();
    expect(() => new Checkers('B:W99:B1')).toThrow();
  });

  it('reads colour and rank off a piece', () => {
    expect(colorOf('b')).toBe('b');
    expect(colorOf('W')).toBe('w');
    expect(isKing('B')).toBe(true);
    expect(isKing('b')).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/position.test.js`
Expected: FAIL — cannot resolve `../src/engine/checkers.js`.

- [ ] **Step 3: Implement position handling**

Create `src/engine/checkers.js` with the module docstring, the exports above, and:

```js
export const START_FEN =
  'B:W21,22,23,24,25,26,27,28,29,30,31,32:B1,2,3,4,5,6,7,8,9,10,11,12';

export const colorOf = (piece) => (piece === 'b' || piece === 'B' ? 'b' : 'w');
export const isKing = (piece) => piece === 'B' || piece === 'W';

export class Checkers {
  constructor(fen = START_FEN) {
    this.load(fen);
  }

  load(fen) {
    const parts = String(fen).split(':');
    if (parts.length !== 3) throw new Error(`Bad FEN: ${fen}`);
    const turn = parts[0].toUpperCase();
    if (turn !== 'B' && turn !== 'W') throw new Error(`Bad FEN side: ${parts[0]}`);
    const board = new Array(33).fill(null);
    for (const group of parts.slice(1)) {
      const color = group[0].toUpperCase();
      if (color !== 'B' && color !== 'W') throw new Error(`Bad FEN group: ${group}`);
      const body = group.slice(1);
      if (!body) continue;
      for (const entry of body.split(',')) {
        const king = entry[0].toUpperCase() === 'K';
        const num = Number(king ? entry.slice(1) : entry);
        if (!Number.isInteger(num) || num < 1 || num > 32) {
          throw new Error(`Bad FEN square: ${entry}`);
        }
        const letter = color === 'B' ? 'b' : 'w';
        board[num] = king ? letter.toUpperCase() : letter;
      }
    }
    this._board = board;
    this._turn = turn === 'B' ? 'b' : 'w';
    this._history = [];
    this._quietPlies = 0;      // Task 5: the 40-move counter
    this._positions = new Map(); // Task 5: repetition counts
    this._countPosition();
  }

  reset() {
    this.load(START_FEN);
  }

  fen() {
    const group = (color) => {
      const squares = [];
      for (let n = 1; n <= 32; n++) {
        const piece = this._board[n];
        if (piece && colorOf(piece) === color) {
          squares.push(isKing(piece) ? `K${n}` : String(n));
        }
      }
      return (color === 'w' ? 'W' : 'B') + squares.join(',');
    };
    return `${this._turn === 'b' ? 'B' : 'W'}:${group('w')}:${group('b')}`;
  }

  turn() { return this._turn; }
  board() { return this._board.slice(); }
  get(square) { return this._board[square] ?? null; }
}
```

`_countPosition()` is a stub returning nothing for now; Task 5 fills it in. Add it as an empty method with a comment saying so, so the constructor does not throw.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/position.test.js`
Expected: all 6 pass.

- [ ] **Step 5: Commit**

```bash
git add src/engine/checkers.js tests/position.test.js
git commit -m "Load and write positions in PDN's FEN"
```

---

## Task 4: Move generation

**Files:**
- Modify: `src/engine/checkers.js`
- Create: `tests/moves.test.js`

**Interfaces:**
- Produces:
  - `moves({ square = null } = {}) → Move[]`
  - `mustCapture() → boolean`
  - A `Move` is `{ color, path: number[], captured: number[], crowned: boolean, pdn: string }`. `path[0]` is the origin, the last element is the final square. A quiet move has `path.length === 2` and `captured.length === 0`.
  - `pdn` is `path.join('-')` for a quiet move and `path.join('x')` for a jump.

Generation rules, in order:
1. Collect every jump sequence for the side to move. A sequence continues while the moved piece can jump again from its landing square, **unless it was crowned**, which ends the turn.
2. If any jump exists, that is the complete move list — capture is mandatory.
3. Otherwise collect single steps.

A captured piece is removed for the duration of the recursion so it cannot be jumped twice in one sequence.

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest';
import { Checkers } from '../src/engine/checkers.js';

const pdns = (game, opts) => game.moves(opts).map((m) => m.pdn).sort();

describe('move generation', () => {
  it('offers seven opening moves for Black', () => {
    expect(pdns(new Checkers())).toEqual(
      ['10-14', '10-15', '11-15', '11-16', '12-16', '9-13', '9-14'].sort(),
    );
  });

  // move() arrives in Task 5, so the position after 11-15 is built by FEN.
  it('offers seven opening moves for White', () => {
    const after = 'W:W21,22,23,24,25,26,27,28,29,30,31,32:B1,2,3,4,5,6,7,8,9,10,12,15';
    expect(new Checkers(after).moves()).toHaveLength(7);
  });

  it('filters by origin square', () => {
    expect(pdns(new Checkers(), { square: 9 })).toEqual(['9-13', '9-14']);
    expect(pdns(new Checkers(), { square: 1 })).toEqual([]);
  });

  it('makes capture mandatory', () => {
    // Black man on 15, White man on 19: the only legal move is the jump.
    // Nothing sits beyond 24, so the sequence ends there.
    const game = new Checkers('B:W19,28:B15,11');
    expect(game.mustCapture()).toBe(true);
    expect(pdns(game)).toEqual(['15x24']);
  });

  it('lets the player choose among several captures', () => {
    // A Black man on 14 can take either way, and neither jump can continue.
    const game = new Checkers('B:W17,18:B14');
    expect(pdns(game)).toEqual(['14x21', '14x23'].sort());
  });

  it('chains a double jump into one move', () => {
    const game = new Checkers('B:W15,23:B11');
    const moves = game.moves();
    expect(moves).toHaveLength(1);
    expect(moves[0].path).toEqual([11, 18, 27]);
    expect(moves[0].captured).toEqual([15, 23]);
    expect(moves[0].pdn).toBe('11x18x27');
  });

  it('stops a chain at the crowning row', () => {
    // 24x31 crowns; a further jump from 31 is not offered.
    const game = new Checkers('B:W27,22:B24');
    const moves = game.moves();
    expect(moves).toHaveLength(1);
    expect(moves[0].path).toEqual([24, 31]);
    expect(moves[0].crowned).toBe(true);
  });

  it('never jumps the same piece twice in one sequence', () => {
    const game = new Checkers('B:WK18:BK15');
    // A king can circle, but 18 is gone after the first hop.
    for (const move of game.moves()) {
      expect(new Set(move.captured).size).toBe(move.captured.length);
    }
  });

  it('moves men forward only and kings every way', () => {
    expect(pdns(new Checkers('B:W32:B15'))).toEqual(['15-18', '15-19']);
    expect(pdns(new Checkers('B:W32:BK15'))).toEqual(
      ['15-10', '15-11', '15-18', '15-19'].sort(),
    );
  });

  // Boxed in, with every White man load-bearing: drop the one on 18 and 9x18
  // becomes legal, drop the one on 14 and the quiet 9-14 opens up.
  it('gives a trapped side no moves at all', () => {
    expect(new Checkers('B:W13,14,18:B9').moves()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/moves.test.js`
Expected: FAIL — `game.moves is not a function`.

- [ ] **Step 3: Implement generation**

Add to `Checkers`:

```js
  /** Directions a piece may travel, by its letter. */
  _dirsFor(piece) {
    if (isKing(piece)) return DIRS_KING;
    return colorOf(piece) === 'b' ? DIRS_BLACK : DIRS_WHITE;
  }

  /**
   * Every legal turn for the side to move. Capture is mandatory, so a jump
   * anywhere on the board suppresses every quiet move.
   */
  moves({ square = null } = {}) {
    const color = this._turn;
    const jumps = [];
    for (let from = 1; from <= 32; from++) {
      const piece = this._board[from];
      if (!piece || colorOf(piece) !== color) continue;
      this._collectJumps(from, piece, [from], [], jumps);
    }
    const all = jumps.length ? jumps : this._quietMoves(color);
    return square === null ? all : all.filter((m) => m.path[0] === square);
  }

  /**
   * Is the side to move obliged to jump? Asked at every node of the AI's
   * quiescence search, so it stops at the first jump it finds rather than
   * building every capture sequence on the board the way moves() would.
   */
  mustCapture() {
    const color = this._turn;
    for (let from = 1; from <= 32; from++) {
      const piece = this._board[from];
      if (!piece || colorOf(piece) !== color) continue;
      for (const dir of this._dirsFor(piece)) {
        const jump = JUMPS[from][dir];
        if (!jump) continue;
        const target = this._board[jump.over];
        if (target && colorOf(target) !== color && !this._board[jump.land]) return true;
      }
    }
    return false;
  }

  _quietMoves(color) {
    const out = [];
    for (let from = 1; from <= 32; from++) {
      const piece = this._board[from];
      if (!piece || colorOf(piece) !== color) continue;
      for (const dir of this._dirsFor(piece)) {
        const to = STEPS[from][dir];
        if (!to || this._board[to]) continue;
        out.push(this._buildMove(color, [from, to], [], !isKing(piece) && isCrowningSquare(to, color)));
      }
    }
    return out;
  }

  /**
   * Depth-first walk of a jump sequence. The jumped piece is lifted for the
   * duration of the recursion so it cannot be taken twice, and the moving
   * piece is lifted from its origin so it cannot block its own landing square.
   * Crowning ends the turn, so a man that reaches the far row stops here even
   * with another jump available.
   */
  _collectJumps(from, piece, path, captured, out) {
    const color = colorOf(piece);
    for (const dir of this._dirsFor(piece)) {
      const jump = JUMPS[from][dir];
      if (!jump) continue;
      const target = this._board[jump.over];
      if (!target || colorOf(target) === color) continue;
      if (this._board[jump.land]) continue;
      const crowns = !isKing(piece) && isCrowningSquare(jump.land, color);
      this._board[jump.over] = null;
      const origin = this._board[from];
      this._board[from] = null;
      const nextPath = [...path, jump.land];
      const nextCaptured = [...captured, jump.over];
      if (crowns) {
        out.push(this._buildMove(color, nextPath, nextCaptured, true));
      } else {
        const before = out.length;
        this._collectJumps(jump.land, piece, nextPath, nextCaptured, out);
        if (out.length === before) {
          out.push(this._buildMove(color, nextPath, nextCaptured, false));
        }
      }
      this._board[from] = origin;
      this._board[jump.over] = target;
    }
  }

  /** Build a Move record. Named apart from `move()`, which applies one. */
  _buildMove(color, path, captured, crowned) {
    return {
      color,
      path,
      captured,
      crowned,
      pdn: path.join(captured.length ? 'x' : '-'),
    };
  }
```

Import `STEPS`, `JUMPS`, `DIRS_BLACK`, `DIRS_WHITE`, `DIRS_KING`, `isCrowningSquare` from `./geometry.js`.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/moves.test.js`
Expected: all 10 pass.

- [ ] **Step 5: Commit**

```bash
git add src/engine/checkers.js tests/moves.test.js
git commit -m "Generate whole turns, with capture mandatory"
```

---

## Task 5: Apply, undo, status, draws

**Files:**
- Modify: `src/engine/checkers.js`
- Create: `tests/rules.test.js`

**Interfaces:**
- Produces:
  - `move({ path }) → Move | null` — applies a complete turn
  - `undo() → Move | null`
  - `history() → Move[]`, `lastMove() → Move | null`
  - `preview(path) → (null|string)[]` — read-only partial board for rendering
  - `status() → { over, turn, result, reason, mustCapture }`
  - `isGameOver()`, `isDraw()`, `isThreefoldRepetition()`, `isFortyMoveRule()`
  - `result` is `'1-0'` (White wins), `'0-1'` (Black wins), `'1/2-1/2'`, or `'*'`

**PDN result convention:** Black moves first, and the roster lists Black before White, but the `Result` token keeps PGN's meaning — the **first** number is White's score. So `'1-0'` is a White win.

`reason` is one of `'no moves'`, `'threefold repetition'`, `'40-move rule'`, or `null`.

The 40-move counter increments per turn and resets on any capture or any man move; a draw is declared at **80 plies**.

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest';
import { Checkers } from '../src/engine/checkers.js';

describe('applying turns', () => {
  it('moves a man and hands over the turn', () => {
    const game = new Checkers();
    const move = game.move({ path: [11, 15] });
    expect(move.pdn).toBe('11-15');
    expect(game.get(11)).toBe(null);
    expect(game.get(15)).toBe('b');
    expect(game.turn()).toBe('w');
    expect(game.history()).toHaveLength(1);
    expect(game.lastMove().pdn).toBe('11-15');
  });

  it('removes every piece a chain jumps', () => {
    const game = new Checkers('B:W15,23:B11');
    game.move({ path: [11, 18, 27] });
    expect(game.get(15)).toBe(null);
    expect(game.get(23)).toBe(null);
    expect(game.get(27)).toBe('b');
  });

  it('crowns a man that reaches the far row', () => {
    const game = new Checkers('B:W1:B25');
    game.move({ path: [25, 29] });
    expect(game.get(29)).toBe('B');
  });

  // 11-18 is shaped like a jump but there is nothing on 15 to capture, and
  // 11-7 is backwards for a man. (11-16 would NOT do here: it is legal.)
  it('refuses an illegal path', () => {
    const game = new Checkers();
    expect(game.move({ path: [11, 18] })).toBe(null);
    expect(game.move({ path: [11, 7] })).toBe(null);
    expect(game.turn()).toBe('b');
  });

  it('refuses a quiet move when a capture is available', () => {
    const game = new Checkers('B:W19,28:B15,11');
    expect(game.move({ path: [11, 16] })).toBe(null);
    expect(game.move({ path: [15, 24] })).not.toBe(null);
  });

  it('undoes a chain, restoring captures and crowning', () => {
    const game = new Checkers('B:W15,23:B11');
    const before = game.fen();
    game.move({ path: [11, 18, 27] });
    game.undo();
    expect(game.fen()).toBe(before);
    expect(game.history()).toHaveLength(0);
    expect(game.turn()).toBe('b');
  });

  it('undoes a crowning back to a man', () => {
    const game = new Checkers('B:W1:B25');
    game.move({ path: [25, 29] });
    game.undo();
    expect(game.get(25)).toBe('b');
  });

  it('previews a partial sequence without changing the position', () => {
    const game = new Checkers('B:W15,23:B11');
    const board = game.preview([11, 18]);
    expect(board[11]).toBe(null);
    expect(board[15]).toBe(null);
    expect(board[18]).toBe('b');
    expect(board[23]).toBe('w');   // not yet taken
    expect(game.get(11)).toBe('b'); // real position untouched
  });
});

describe('endings', () => {
  it('is a loss for the side with no move', () => {
    const game = new Checkers('B:W13,14,18:B9');
    const status = game.status();
    expect(status.over).toBe(true);
    expect(status.reason).toBe('no moves');
    expect(status.result).toBe('1-0'); // Black cannot move, so White wins
    expect(game.isGameOver()).toBe(true);
  });

  it('is a loss for a side with no pieces', () => {
    const game = new Checkers('W:W:B1,2');
    expect(game.status().result).toBe('0-1');
  });

  it('is not over at the start', () => {
    const status = new Checkers().status();
    expect(status.over).toBe(false);
    expect(status.result).toBe('*');
    expect(status.reason).toBe(null);
  });

  it('reports the forced-capture obligation', () => {
    expect(new Checkers().status().mustCapture).toBe(false);
    expect(new Checkers('B:W19,27:B15').status().mustCapture).toBe(true);
  });

  it('draws on threefold repetition', () => {
    // Two kings shuffling between the same squares.
    const game = new Checkers('B:WK32:BK1');
    const cycle = [[1, 5], [32, 28], [5, 1], [28, 32]];
    for (let i = 0; i < 2; i++) {
      for (const path of cycle) game.move({ path });
    }
    expect(game.isThreefoldRepetition()).toBe(true);
    expect(game.status().result).toBe('1/2-1/2');
    expect(game.status().reason).toBe('threefold repetition');
  });

  it('resets the 40-move counter on a man move', () => {
    const game = new Checkers();
    game.move({ path: [11, 15] });
    expect(game.isFortyMoveRule()).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/rules.test.js`
Expected: FAIL — `game.move is not a function`.

- [ ] **Step 3: Implement apply, undo, preview, and status**

Add to `Checkers`. `move()` looks the path up in the legal list rather than trusting it, which is what makes it safe to hand a path straight off the wire or out of a save file.

```js
  move({ path } = {}) {
    if (!Array.isArray(path) || path.length < 2) return null;
    const legal = this.moves().find(
      (m) => m.path.length === path.length && m.path.every((sq, i) => sq === path[i]),
    );
    if (!legal) return null;
    const from = legal.path[0];
    const to = legal.path[legal.path.length - 1];
    const piece = this._board[from];
    const undo = {
      move: legal,
      piece,
      taken: legal.captured.map((sq) => this._board[sq]),
      quietPlies: this._quietPlies,
    };
    this._board[from] = null;
    for (const sq of legal.captured) this._board[sq] = null;
    this._board[to] = legal.crowned ? piece.toUpperCase() : piece;
    // The 40-move rule counts turns in which nothing irreversible happened:
    // no capture, and no man moved (only kings shuffling).
    this._quietPlies =
      legal.captured.length || !isKing(piece) ? 0 : this._quietPlies + 1;
    this._turn = this._turn === 'b' ? 'w' : 'b';
    this._history.push(undo);
    this._countPosition();
    return legal;
  }

  undo() {
    const undo = this._history.pop();
    if (!undo) return null;
    this._discountPosition();
    const { move, piece, taken } = undo;
    const to = move.path[move.path.length - 1];
    this._board[to] = null;
    this._board[move.path[0]] = piece;
    move.captured.forEach((sq, i) => {
      this._board[sq] = taken[i];
    });
    this._quietPlies = undo.quietPlies;
    this._turn = move.color;
    return move;
  }

  history() {
    return this._history.map((entry) => entry.move);
  }

  lastMove() {
    const entry = this._history[this._history.length - 1];
    return entry ? entry.move : null;
  }

  /**
   * The board as it would look partway through a jump sequence. Read-only and
   * used for rendering alone: the engine's own position does not advance until
   * the whole turn is applied, so the controller needs this to draw a chain in
   * progress. An unrecognized path simply returns the current board.
   */
  preview(path) {
    const board = this._board.slice();
    if (!Array.isArray(path) || path.length < 2) return board;
    const piece = board[path[0]];
    if (!piece) return board;
    const color = colorOf(piece);
    board[path[0]] = null;
    let crowned = false;
    for (let i = 1; i < path.length; i++) {
      const from = path[i - 1];
      const to = path[i];
      for (const dir of DIRS_KING) {
        const jump = JUMPS[from][dir];
        if (jump && jump.land === to) board[jump.over] = null;
      }
      if (!isKing(piece) && isCrowningSquare(to, color)) crowned = true;
    }
    board[path[path.length - 1]] = crowned ? piece.toUpperCase() : piece;
    return board;
  }

  _positionKey() {
    return `${this._turn}${this._board.slice(1).map((p) => p || '-').join('')}`;
  }

  _countPosition() {
    const key = this._positionKey();
    this._positions.set(key, (this._positions.get(key) || 0) + 1);
  }

  _discountPosition() {
    const key = this._positionKey();
    const count = this._positions.get(key) || 0;
    if (count <= 1) this._positions.delete(key);
    else this._positions.set(key, count - 1);
  }

  isThreefoldRepetition() {
    return (this._positions.get(this._positionKey()) || 0) >= 3;
  }

  isFortyMoveRule() {
    return this._quietPlies >= 80;
  }

  isDraw() {
    return this.isThreefoldRepetition() || this.isFortyMoveRule();
  }

  isGameOver() {
    return this.isDraw() || this.moves().length === 0;
  }

  /**
   * How the game stands. A side with no legal move loses — checkers has no
   * stalemate, and a side with no pieces has no move either, so both losses
   * come out of the same test.
   */
  status() {
    const turn = this._turn;
    const mustCapture = this.mustCapture();
    if (this.isThreefoldRepetition()) {
      return { over: true, turn, result: '1/2-1/2', reason: 'threefold repetition', mustCapture };
    }
    if (this.isFortyMoveRule()) {
      return { over: true, turn, result: '1/2-1/2', reason: '40-move rule', mustCapture };
    }
    if (this.moves().length === 0) {
      // The side to move has lost; the first score in the token is White's.
      return {
        over: true,
        turn,
        result: turn === 'b' ? '1-0' : '0-1',
        reason: 'no moves',
        mustCapture: false,
      };
    }
    return { over: false, turn, result: '*', reason: null, mustCapture };
  }
```

Replace the `_countPosition()` stub from Task 3 with the real one above.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run`
Expected: everything from Tasks 1–5 passes.

- [ ] **Step 5: Commit**

```bash
git add src/engine/checkers.js tests/rules.test.js
git commit -m "Apply and take back whole turns, and call the endings"
```

---

## Task 6: Perft

**Files:**
- Modify: `src/engine/checkers.js` (export `perft`)
- Create: `tests/perft.test.js`

**Interfaces:**
- Produces: `export function perft(game, depth) → number`

Depths 1 and 2 are derivable by hand and are asserted as such. Deeper counts must come from a published source — **cite the source in a comment in the test file.** If a deeper count disagrees, the generator is the first suspect, but confirm the reference before changing code.

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest';
import { Checkers, perft } from '../src/engine/checkers.js';

describe('perft', () => {
  // Depth 1: only the four men on squares 9-12 can move, into the empty
  // squares 13-16. 9→13,14  10→14,15  11→15,16  12→16 = 7.
  // Depth 2: no piece is in contact yet, so White has the mirror-image 7
  // replies to each = 49. Both are hand-derivable and need no source.
  it('counts the opening moves', () => {
    expect(perft(new Checkers(), 1)).toBe(7);
    expect(perft(new Checkers(), 2)).toBe(49);
  });

  // SOURCE: <fill in the published English-draughts perft table used, with a
  // URL, when implementing>. Do not write these from memory.
  it('matches the published node counts', () => {
    expect(perft(new Checkers(), 3)).toBe(302);
    expect(perft(new Checkers(), 4)).toBe(1469);
    expect(perft(new Checkers(), 5)).toBe(7361);
    expect(perft(new Checkers(), 6)).toBe(36768);
  });

  it('leaves the position untouched', () => {
    const game = new Checkers();
    const fen = game.fen();
    perft(game, 4);
    expect(game.fen()).toBe(fen);
    expect(game.history()).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/perft.test.js`
Expected: FAIL — `perft is not a function`.

- [ ] **Step 3: Implement perft**

```js
/** Count the leaf nodes `depth` turns deep. Used to validate generation. */
export function perft(game, depth) {
  if (depth === 0) return 1;
  const moves = game.moves();
  if (depth === 1) return moves.length;
  let nodes = 0;
  for (const move of moves) {
    game.move({ path: move.path });
    nodes += perft(game, depth - 1);
    game.undo();
  }
  return nodes;
}
```

- [ ] **Step 4: Find the reference counts and run**

Look up a published English-draughts perft table, paste the URL into the `SOURCE:` comment, and confirm the depth 3–6 values match what is written in the test.

Run: `npx vitest run tests/perft.test.js`
Expected: all 3 pass. **If depths 1–2 pass but 3+ fail, the bug is almost certainly in chain generation or in the "capture is mandatory" filter — do not edit the expected numbers to match the code.**

- [ ] **Step 5: Commit**

```bash
git add src/engine/checkers.js tests/perft.test.js
git commit -m "Validate move generation against published perft counts"
```

---

# Phase 2 — AI

## Task 7: Computer opponent

**Files:**
- Create: `src/engine/ai.js`, `tests/ai.test.js`
- Reference: `../chess.puter.com/src/engine/ai.js`

**Interfaces:**
- Produces:
  - `export const LEVELS = { easy: {...}, medium: {...}, hard: {...} }` — each `{ depth, window, label }`
  - `export function evaluate(game) → number` — from **Black's** perspective (Black moves first, so Black is the "positive" side, matching how the chess AI treats White)
  - `export function findBestMove(game, level = 'medium', rng = Math.random) → Move | null`
  - `export function chooseMove(game, level, { minThinkMs = 450 } = {}) → Promise<Move|null>`
  - `findBestMove` returns the engine's own `Move` object, so the caller passes `move.path` straight to `game.move()`.

Search is negamax with alpha-beta and the same root randomness window as the chess AI, including the re-search of inexact upper bounds. Quiescence is exact: extend while `game.mustCapture()` is true.

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest';
import { Checkers } from '../src/engine/checkers.js';
import { LEVELS, evaluate, findBestMove } from '../src/engine/ai.js';

const level = (over) => ({ depth: 2, window: 0, ...over });

describe('evaluation', () => {
  it('is even at the start', () => {
    expect(evaluate(new Checkers())).toBe(0);
  });

  it('prefers having more material', () => {
    expect(evaluate(new Checkers('B:W21:B1,2'))).toBeGreaterThan(0);
    expect(evaluate(new Checkers('B:W21,22:B1'))).toBeLessThan(0);
  });

  it('values a king above a man', () => {
    const withKing = evaluate(new Checkers('B:W21:BK1'));
    const withMan = evaluate(new Checkers('B:W21:B1'));
    expect(withKing).toBeGreaterThan(withMan);
  });
});

describe('search', () => {
  it('returns null when there is nothing to play', () => {
    expect(findBestMove(new Checkers('B:W13,14,18:B9'), level())).toBe(null);
  });

  it('returns a legal move', () => {
    const game = new Checkers();
    const move = findBestMove(game, level());
    expect(game.moves().some((m) => m.pdn === move.pdn)).toBe(true);
  });

  it('takes a free piece', () => {
    // Black to move with one capture available and nothing to fear.
    const game = new Checkers('B:W19:B15,11,12');
    expect(findBestMove(game, level()).pdn).toBe('15x24');
  });

  it('avoids walking into a capture', () => {
    // 11-16 hangs the man to 20x11; 11-15 does not.
    const game = new Checkers('B:W20,32:B11,1');
    const move = findBestMove(game, level({ depth: 3 }));
    expect(move.pdn).not.toBe('11-16');
  });

  it('leaves the position untouched', () => {
    const game = new Checkers();
    const fen = game.fen();
    findBestMove(game, LEVELS.medium);
    expect(game.fen()).toBe(fen);
    expect(game.history()).toHaveLength(0);
  });

  it('is deterministic with a fixed rng', () => {
    const pick = () => findBestMove(new Checkers(), LEVELS.easy, () => 0).pdn;
    expect(pick()).toBe(pick());
  });

  it('defines three levels of increasing depth', () => {
    expect(LEVELS.easy.depth).toBeLessThan(LEVELS.medium.depth);
    expect(LEVELS.medium.depth).toBeLessThan(LEVELS.hard.depth);
    expect(LEVELS.easy.window).toBeGreaterThan(LEVELS.hard.window);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/ai.test.js`
Expected: FAIL — cannot resolve `../src/engine/ai.js`.

- [ ] **Step 3: Implement the AI**

```js
/**
 * Computer opponent: negamax with alpha-beta pruning over the checkers
 * engine's whole-turn move list.
 *
 * Two things are easier here than in chess. Checkers branches about eight
 * ways rather than thirty-five, so the same budget searches far deeper; and
 * quiescence is exact rather than heuristic, because capture is mandatory —
 * a position is quiet precisely when the side to move has no jump.
 *
 * Difficulty combines depth with a randomness window: the engine picks
 * uniformly among root moves scoring within `window` of the best, so lower
 * levels play plausible-but-imperfect checkers.
 */

import { colorOf, isKing } from './checkers.js';
import { squareToRowCol } from './geometry.js';

const WIN = 100000;
const INFINITY = 1000000;

export const MAN = 100;
export const KING = 175;

export const LEVELS = {
  easy: { depth: 2, window: 120, label: 'Easy' },
  medium: { depth: 6, window: 30, label: 'Medium' },
  hard: { depth: 8, window: 0, label: 'Hard' },
};

// Hard was tuned down from a starting guess of depth 10 against measured
// per-move worst cases: 3604ms at depth 10, 1232ms at depth 9, 499ms at
// depth 8. Easy runs ~1ms/move and Medium ~25-30ms/move.

/**
 * Static evaluation from Black's perspective.
 *
 * Material and shape only. A mobility term would have to call moves(), which
 * generates every jump chain on the board — at every leaf of a depth-10
 * search that costs more than it is worth, and the search already sees
 * mobility directly in the moves it enumerates.
 */
export function evaluate(game) {
  const board = game.board();
  let score = 0;
  for (let n = 1; n <= 32; n++) {
    const piece = board[n];
    if (!piece) continue;
    const black = colorOf(piece) === 'b';
    const [row, col] = squareToRowCol(n);
    let value = isKing(piece) ? KING : MAN;
    if (!isKing(piece)) {
      // Men are worth more the closer they are to crowning.
      value += (black ? row : 7 - row) * 4;
      // Holding your own back row denies the opponent a crowning square.
      if ((black && row === 0) || (!black && row === 7)) value += 6;
    }
    // An edge piece cannot be jumped, but cannot jump either.
    value += col === 0 || col === 7 ? -4 : 2;
    score += black ? value : -value;
  }
  return score;
}

/** Evaluation from the point of view of the side to move. */
function sideScore(game) {
  return game.turn() === 'b' ? evaluate(game) : -evaluate(game);
}

/** Captures first, longest chain first: the cheapest useful ordering. */
function orderMoves(moves) {
  return moves.slice().sort((a, b) => b.captured.length - a.captured.length);
}

/**
 * Search on while the side to move is obliged to jump. Forced capture makes
 * this exact: there is no "quiet" position in which a capture is pending, so
 * the horizon can never fall in the middle of an exchange.
 */
function quiescence(game, alpha, beta, ply) {
  if (!game.mustCapture()) return sideScore(game);
  const moves = game.moves();
  if (moves.length === 0) return -WIN + ply;
  let best = -INFINITY;
  for (const move of moves) {
    game.move({ path: move.path });
    const score = -quiescence(game, -beta, -alpha, ply + 1);
    game.undo();
    if (score > best) best = score;
    if (score > alpha) alpha = score;
    if (alpha >= beta) break;
  }
  return best;
}

function search(game, depth, alpha, beta, ply) {
  const moves = orderMoves(game.moves());
  // No move is a loss in checkers, not a draw — there is no stalemate.
  if (moves.length === 0) return -WIN + ply;
  if (game.isDraw()) return 0;
  if (depth === 0) return quiescence(game, alpha, beta, ply);
  let best = -INFINITY;
  for (const move of moves) {
    game.move({ path: move.path });
    const score = -search(game, depth - 1, -beta, -alpha, ply + 1);
    game.undo();
    if (score > best) best = score;
    if (score > alpha) alpha = score;
    if (alpha >= beta) break;
  }
  return best;
}

export function findBestMove(game, level = 'medium', rng = Math.random) {
  const cfg = typeof level === 'string' ? LEVELS[level] : level;
  if (!cfg) throw new Error(`Unknown difficulty level: ${level}`);

  const rootMoves = orderMoves(game.moves());
  if (rootMoves.length === 0) return null;

  const scored = [];
  let alpha = -INFINITY;
  for (const move of rootMoves) {
    game.move({ path: move.path });
    const score = -search(game, cfg.depth - 1, -INFINITY, -alpha + cfg.window, 1);
    game.undo();
    // A beta cutoff in the child search means `score` is only an upper bound.
    scored.push({ move, score, exact: score > alpha - cfg.window });
    if (score > alpha) alpha = score;
  }

  const best = Math.max(...scored.map((s) => s.score));
  // An upper bound can land exactly on the threshold while the true value is
  // far below it; re-search those with a full window so the random pick never
  // selects a move from outside the intended band.
  for (const s of scored) {
    if (!s.exact && s.score >= best - cfg.window) {
      game.move({ path: s.move.path });
      s.score = -search(game, cfg.depth - 1, -INFINITY, INFINITY, 1);
      game.undo();
    }
  }
  const candidates = scored.filter((s) => s.score >= best - cfg.window);
  return candidates[Math.floor(rng() * candidates.length)].move;
}

/**
 * Async wrapper: yields to the event loop so the UI can paint a "thinking"
 * state, and enforces a minimum think time so replies feel deliberate.
 */
export function chooseMove(game, level, { minThinkMs = 450 } = {}) {
  return new Promise((resolve) => {
    setTimeout(() => {
      const started = performance.now();
      const move = findBestMove(game, level);
      const elapsed = performance.now() - started;
      setTimeout(() => resolve(move), Math.max(0, minThinkMs - elapsed));
    }, 30);
  });
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/ai.test.js`
Expected: all 10 pass.

- [ ] **Step 5: Tune the depths against a real budget**

Run:
```bash
node -e "
const {Checkers}=await import('./src/engine/checkers.js');
const {findBestMove,LEVELS}=await import('./src/engine/ai.js');
for(const [name,cfg] of Object.entries(LEVELS)){
  const g=new Checkers(); const t=performance.now();
  for(let i=0;i<8&&!g.isGameOver();i++) g.move({path:findBestMove(g,cfg).path});
  console.log(name,cfg.depth,Math.round(performance.now()-t)+'ms for 8 plies');
}
" --input-type=module
```
Expected: `hard` stays under about 1500ms per move. If it does not, lower `LEVELS.hard.depth` until it does and note the measured figure in a comment beside `LEVELS`. Middlegame positions branch more than the opening, so leave headroom.

- [ ] **Step 6: Commit**

```bash
git add src/engine/ai.js tests/ai.test.js
git commit -m "Add the computer opponent"
```

---

# Phase 3 — Interface

## Task 8: App shell and stylesheet

**Files:**
- Create: `index.html`, `src/style.css`, `src/analytics.js`
- Reference: `../chess.puter.com/index.html`, `../chess.puter.com/src/style.css`, `../chess.puter.com/src/analytics.js`

**Interfaces:**
- Produces: every element id `main.js` reaches for in Task 10, and the CSS custom properties the board uses.

Port the chess shell and stylesheet. Keep the structure, the comments, and the class names. Changes:

**`index.html`**
- All copy: "chess" → "checkers", and the description becomes "Play checkers for free, right in your browser. Challenge the computer, pass & play with a friend on one device, or invite a friend to a private online game."
- Canonical, `og:url`, JSON-LD `url` → `https://checkers.puter.com/`
- Settings key in the pre-paint theme script → `checkers-settings`
- **Delete** the entire `#promo-dialog` block
- `#moves-empty` copy → `No moves yet — Black begins.`
- `aria-label` on the board → `Checkers board`
- Leave the Plausible `<script src>` as a comment placeholder (Task 16)

**`src/style.css`**
- Board section carries over **verbatim**: `--sq-light`, `--sq-dark`, the 12px radius, `--shadow-board`, `--hl-sel`/`--hl-last`, `.hint` (30% dot), `.capture-hint` (86% ring), `.square:focus-visible`
- **Delete** `.square.check` and its red radial gradient
- **Delete** `.square[data-rank]`/`[data-file]` rules; replace with a `[data-num]` label on dark squares only
- **Delete** the promotion-picker section
- Add the piece rules below

- [ ] **Step 1: Port `index.html`**

Copy `../chess.puter.com/index.html`, apply every change listed above.

- [ ] **Step 2: Port `src/analytics.js`**

Copy verbatim — it has no chess-specific content.

- [ ] **Step 3: Port `src/style.css` and add the piece rules**

```css
/* ------------------------------------------------------------------ */
/* Pieces                                                              */
/*                                                                     */
/* Four pieces, all drawn in CSS: there is no piece artwork to load,   */
/* and a circle scales to any board size without a raster step. The    */
/* crown is a Lucide glyph main.js drops in, tinted to the border      */
/* colour so a king reads as the same piece wearing a mark.            */
/* ------------------------------------------------------------------ */

.piece {
  position: absolute;
  inset: 9%;
  border-radius: 50%;
  cursor: pointer;
  display: grid;
  place-items: center;
  box-shadow: 0 2px 4px rgba(18, 24, 44, 0.35);
  -webkit-user-drag: none;
  user-select: none;
}

.piece[data-piece^='b'] {
  background: #14161c;
  border: max(2px, 4cqw) solid #f2f3f7;
}

.piece[data-piece^='w'] {
  background: #f2f3f7;
  border: max(2px, 4cqw) solid #14161c;
}

.piece .crown {
  width: 46%;
  height: 46%;
  pointer-events: none;
}

.piece[data-piece='bK'] .crown { color: #f2f3f7; }
.piece[data-piece='wK'] .crown { color: #14161c; }

/* The square is the containing block the border width is measured against. */
.square { container-type: inline-size; }

.piece.drag-origin {
  opacity: 0.4;
  cursor: grabbing;
}

.drag-ghost {
  position: fixed;
  inset: auto;
  margin: 0;
  pointer-events: none;
  z-index: 100;
  cursor: grabbing;
  box-shadow: 0 8px 14px rgba(10, 14, 8, 0.4);
}

/* A piece locked into a jump chain: the turn is not over and no other piece
   may be picked up, which is worth saying on the piece itself. */
.piece.chained::after {
  content: '';
  position: absolute;
  inset: -14%;
  border-radius: 50%;
  box-shadow: 0 0 0 3px var(--accent-strong);
  animation: chain-pulse 1.6s ease-in-out infinite;
}

@keyframes chain-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}

@media (prefers-reduced-motion: reduce) {
  .piece.chained::after { animation: none; }
}

/* PDN square numbers, on the playable squares only. */
.square[data-num]::before {
  content: attr(data-num);
  position: absolute;
  top: 3px;
  left: 5px;
  font-size: clamp(9px, 1.6vmin, 12px);
  font-weight: 600;
  color: var(--sq-light);
  opacity: 0.55;
  pointer-events: none;
}

/* Captured pieces on the player cards, at badge size. */
.caps .cap {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  display: inline-block;
}
.caps .cap[data-piece^='b'] { background: #14161c; border: 2px solid #f2f3f7; }
.caps .cap[data-piece^='w'] { background: #f2f3f7; border: 2px solid #14161c; }
```

- [ ] **Step 4: Check it renders**

Run: `npm run dev`, open the page.
Expected: the layout, topbar, sidebar cards, and an empty board frame all appear. The board is blank — `boardView` arrives in Task 9. No console errors other than the missing `src/main.js`.

- [ ] **Step 5: Commit**

```bash
git add index.html src/style.css src/analytics.js
git commit -m "Port the app shell and stylesheet"
```

---

## Task 9: Board view

**Files:**
- Create: `src/ui/boardView.js`, `tests/boardView.test.js`
- Reference: `../chess.puter.com/src/ui/boardView.js`

**Interfaces:**
- Consumes: `squareToRowCol`, `rowColToSquare` from `geometry.js`
- Produces:
  - `class BoardView(el, { onSquarePress, onDrop, onSquareActivate })`
  - `setOrientation(color)`, `render(state)`, `startDrag(square, event)`, `cancelDrag()`, `animatePath(path, done)`
  - `animateMove(from, to, done, { keepPiece = false } = {})` — with `keepPiece` it moves the piece element into the destination square rather than leaving that to the next render, so a following leg has something to slide
  - `export function pieceLabel(piece) → string`
  - `render` takes `{ board, selected, targets, lastMove, chained }` where `board` is a 33-cell array, `targets` is a `Map<number, boolean>` (square → is a capture), `lastMove` is `{from, to} | null`, and `chained` is the square of a piece locked mid-chain, or null.
  - Squares are **numbers** in every callback and every argument; `data-square` is parsed on read.
  - Board cells map to `data-piece` codes: `'b' → 'bM'`, `'B' → 'bK'`, `'w' → 'wM'`, `'W' → 'wK'`. The CSS in Task 8 selects on `^='b'` / `^='w'` for the disc and on the exact `bK` / `wK` for the crown tint.

Port the chess `BoardView` wholesale. It already handles the roving tabindex, the pointer-id-bound drag, the ghost, and keyboard navigation, and none of that changes. What changes:

- The grid is built over all 64 cells for the checkerboard, but only dark squares get `data-square`, a `tabIndex`, `role="gridcell"` and a `data-num` label. Light squares are inert: `aria-hidden="true"`, no handlers.
- Keyboard arrows move between **dark squares**, which are two columns apart on the same row and one column apart diagonally. Up/Down move a row and keep the nearest dark square; Left/Right move to the next dark square in the row.
- Pieces are `<div class="piece" data-piece="bK">` with an optional `<svg class="crown">` child, not `<img>`.
- `pieceUrl` does not exist.
- No `checkSquare`.
- `animatePath(path, done)` slides along a multi-hop path, one leg at a time — used for the computer's and the opponent's chains, which arrive whole.

- [ ] **Step 1: Write the failing test**

`boardView` touches the DOM, so this test file (and only this one) runs under `jsdom`. Add `// @vitest-environment jsdom` at the top and `npm i -D jsdom`.

```js
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { BoardView, pieceLabel } from '../src/ui/boardView.js';

const mount = () => {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const handlers = {
    onSquarePress: vi.fn(),
    onDrop: vi.fn(),
    onSquareActivate: vi.fn(),
  };
  return { view: new BoardView(el, handlers), el, handlers };
};

const emptyBoard = () => new Array(33).fill(null);

describe('board view', () => {
  it('builds 64 cells but only 32 playable squares', () => {
    const { el } = mount();
    expect(el.querySelectorAll('.square')).toHaveLength(64);
    expect(el.querySelectorAll('.square[data-square]')).toHaveLength(32);
  });

  it('numbers the playable squares 1 to 32', () => {
    const { el } = mount();
    const nums = [...el.querySelectorAll('.square[data-square]')]
      .map((s) => Number(s.dataset.num))
      .sort((a, b) => a - b);
    expect(nums).toEqual([...Array(32)].map((_, i) => i + 1));
  });

  it('puts square 1 top-left and 32 bottom-right for Black', () => {
    const { el, view } = mount();
    view.setOrientation('b');
    const playable = [...el.querySelectorAll('.square[data-square]')];
    expect(playable[0].dataset.square).toBe('1');
    expect(playable[31].dataset.square).toBe('32');
  });

  it('flips the board for White', () => {
    const { el, view } = mount();
    view.setOrientation('w');
    const playable = [...el.querySelectorAll('.square[data-square]')];
    expect(playable[0].dataset.square).toBe('32');
    expect(playable[31].dataset.square).toBe('1');
  });

  it('renders men and kings as discs', () => {
    const { el, view } = mount();
    const board = emptyBoard();
    board[1] = 'b';
    board[32] = 'W';
    view.render({ board, selected: null, targets: new Map(), lastMove: null, chained: null });
    const square1 = el.querySelector('[data-square="1"] .piece');
    expect(square1.dataset.piece).toBe('bM');
    expect(square1.querySelector('.crown')).toBe(null);
    expect(el.querySelector('[data-square="32"] .piece').dataset.piece).toBe('wK');
    expect(el.querySelector('[data-square="32"] .crown')).not.toBe(null);
  });

  it('marks hints, captures, selection, last move, and the chain', () => {
    const { el, view } = mount();
    const board = emptyBoard();
    board[11] = 'b';
    view.render({
      board,
      selected: 11,
      targets: new Map([[15, false], [18, true]]),
      lastMove: { from: 9, to: 11 },
      chained: 11,
    });
    expect(el.querySelector('[data-square="11"]').classList.contains('sel')).toBe(true);
    expect(el.querySelector('[data-square="15"]').classList.contains('hint')).toBe(true);
    expect(el.querySelector('[data-square="18"]').classList.contains('capture-hint')).toBe(true);
    expect(el.querySelector('[data-square="9"]').classList.contains('last')).toBe(true);
    expect(el.querySelector('[data-square="11"] .piece').classList.contains('chained')).toBe(true);
  });

  it('reports a press as a square number', () => {
    const { el, handlers } = mount();
    el.querySelector('[data-square="11"]').dispatchEvent(
      new MouseEvent('pointerdown', { bubbles: true, button: 0 }),
    );
    expect(handlers.onSquarePress).toHaveBeenCalledWith(11, expect.anything());
  });

  it('ignores presses on light squares', () => {
    const { el, handlers } = mount();
    el.querySelector('.square:not([data-square])').dispatchEvent(
      new MouseEvent('pointerdown', { bubbles: true, button: 0 }),
    );
    expect(handlers.onSquarePress).not.toHaveBeenCalled();
  });

  it('names pieces for assistive technology', () => {
    expect(pieceLabel('b')).toBe('Black man');
    expect(pieceLabel('W')).toBe('White king');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm i -D jsdom && npx vitest run tests/boardView.test.js`
Expected: FAIL — cannot resolve `../src/ui/boardView.js`.

- [ ] **Step 3: Implement `boardView.js`**

Start from `../chess.puter.com/src/ui/boardView.js` and apply the changes listed above. The two genuinely new pieces:

```js
/** Squares are numbers here, not strings — `data-square` is parsed on read. */
const pressed = (e) => {
  const el = e.target.closest('.square[data-square]');
  return el ? Number(el.dataset.square) : null;
};

/**
 * Slide a piece along a whole jump path, one leg at a time, then re-render.
 * Chains arriving from the computer or a peer come as a finished turn, so
 * this is what shows the player what happened rather than the piece simply
 * appearing at the far end.
 */
animatePath(path, done) {
  if (REDUCED_MOTION.matches || path.length < 2) {
    done();
    return;
  }
  let leg = 1;
  const next = () => {
    if (leg >= path.length) {
      done();
      return;
    }
    const from = path[leg - 1];
    const to = path[leg];
    leg += 1;
    this.animateMove(from, to, next, { keepPiece: true });
  };
  next();
}
```

`animateMove` gains a `keepPiece` option: when set it moves the piece element into the destination square instead of leaving the render to do it, so the next leg has something to slide.

Crowns are Lucide SVGs. Import `Crown` from `lucide` and build the glyph once, cloning it per king.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/boardView.test.js`
Expected: all 9 pass.

- [ ] **Step 5: Commit**

```bash
git add src/ui/boardView.js tests/boardView.test.js package.json package-lock.json
git commit -m "Draw the board and its pieces"
```

---

## Task 10: Controller — a playable game

The task that makes the app real. At the end of it you can play a full game against the computer and in pass & play.

**Files:**
- Create: `src/main.js`
- Reference: `../chess.puter.com/src/main.js`

**Interfaces:**
- Consumes: everything from Tasks 3–9
- Produces: a running app; later tasks extend this file

Port the chess controller. Keep its section structure, its comments, and its function names. In this task, wire up only: modes `computer` and `local`, settings, theme, selection, the chain lock, move animation, the move list, player cards, the result banner and dialog, undo, new game, toasts, and the screen-reader status region. Clock, persistence, review, PDN and online arrive in Tasks 12–15 — leave their call sites out entirely rather than stubbed.

**What changes from the chess controller:**

- `colorName(c)` → `'Black' | 'White'`; the first mover is `'b'`
- `bottomColor()` returns `'b'` in local mode
- `DISPLAY_VALUES` is replaced by a simple piece count — men and kings are listed separately on the player cards
- Every `promotion` reference, `askPromotion`, `finishPromotion`, and `promoDialog` is gone
- `checkSquare` is gone; `describeEnd` handles `'no moves'`, `'threefold repetition'`, `'40-move rule'`
- `positionAt(plies)` replays `history[i].path`

**The chain lock** is the new state. Add beside `selected`/`targets`, importing the two pure helpers from `src/game/chain.js` (built in Step 1):

```js
import { continuations, nextHops } from './game/chain.js';

// A jump sequence in progress. The engine only applies whole turns, so while
// this is non-empty the board is showing `game.preview(pendingPath)` and the
// engine's own position is still one turn behind the screen.
let pendingPath = [];

/** Squares the player may press right now, mapped to "is this a capture". */
function targetsFor(square) {
  if (pendingPath.length === 0) return nextHops(game.moves({ square }), 1);
  return nextHops(
    continuations(game.moves({ square: pendingPath[0] }), pendingPath),
    pendingPath.length,
  );
}

function clearSelection() {
  selected = null;
  targets = new Map();
  pendingToggleOff = false;
  pendingPath = [];
}
```

**Pressing a target square** either advances the chain or commits the turn:

```js
function attemptMove(from, to) {
  const path = pendingPath.length ? [...pendingPath, to] : [from, to];
  const candidates = continuations(game.moves({ square: path[0] }), path);
  if (candidates.length === 0) {
    clearSelection();
    renderAll();
    return;
  }
  // Exactly one legal turn ends here: commit it. Otherwise the sequence
  // continues and the piece stays locked.
  const complete = candidates.find((m) => m.path.length === path.length);
  const legFrom = path[path.length - 2];
  if (!complete) {
    pendingPath = path;
    selected = to;
    boardView.animateMove(legFrom, to, () => {
      renderAll();
      announceChain();
    }, { keepPiece: true });
    return;
  }
  const played = game.move({ path: complete.path });
  clearSelection();
  boardView.animateMove(legFrom, to, () => {
    renderAll();
    afterMove();
  }, { keepPiece: true });
}
```

> **Note the ambiguity this resolves.** A path can be both complete and extendable only when a further jump exists, and forced capture means it must then be taken — so `complete` and a longer candidate never coexist. Assert this in Step 2's test.

**`renderAll()`** draws the preview while a chain is pending:

```js
const shown = pendingPath.length ? game.preview(pendingPath) : game.board();
boardView.render({
  board: shown,
  selected,
  targets,
  lastMove: last ? { from: last.path[0], to: last.path[last.path.length - 1] } : null,
  chained: pendingPath.length ? pendingPath[pendingPath.length - 1] : null,
});
```

**`canUndo()`** gains the chain check:

```js
function canUndo() {
  if (pendingPath.length) return false; // no half-turn to take back
  if (mode === 'computer') return !thinking && game.history().some((m) => m.color === myColor);
  return game.history().length > 0;
}
```

**Escape** clears a selection but never abandons a chain — the sequence is compulsory:

```js
} else if (pendingPath.length) {
  showToast('You must finish the jump.');
} else if (selected) {
  boardView.cancelDrag();
  clearSelection();
  renderAll();
}
```

**The computer and, later, a peer** play whole turns, so they animate with `animatePath`.

- [ ] **Step 1: Write the chain helpers**

The chain filter is the one piece of genuinely new logic in the port, and it is pure — so it goes in its own module and gets pinned down by tests before the controller leans on it.

Create `src/game/chain.js`:

```js
/**
 * The turns that continue a jump sequence already partly played. Splitting
 * this out of the controller keeps the one piece of genuinely new logic in
 * the port testable without a DOM.
 */
export function continuations(moves, pendingPath) {
  if (pendingPath.length === 0) return moves;
  return moves.filter(
    (m) =>
      m.path.length >= pendingPath.length &&
      pendingPath.every((sq, i) => m.path[i] === sq),
  );
}

/** The next-hop squares of `moves`, mapped to whether that hop captures. */
export function nextHops(moves, step) {
  const map = new Map();
  for (const move of moves) {
    if (move.path.length > step) map.set(move.path[step], move.captured.length > 0);
  }
  return map;
}
```

- [ ] **Step 2: Write the failing test**

Create `tests/chain.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { Checkers } from '../src/engine/checkers.js';
import { continuations, nextHops } from '../src/game/chain.js';

describe('jump chains', () => {
  it('narrows to the sequences that match the hops taken', () => {
    const game = new Checkers('B:W15,23:B11');
    const all = game.moves({ square: 11 });
    expect(continuations(all, [11, 18])).toHaveLength(1);
    expect(continuations(all, [11, 19])).toHaveLength(0);
  });

  it('offers the next hop, not the far end', () => {
    const game = new Checkers('B:W15,23:B11');
    const hops = nextHops(continuations(game.moves({ square: 11 }), [11]), 1);
    expect([...hops.keys()]).toEqual([18]);
    expect(hops.get(18)).toBe(true);
  });

  // Forced capture guarantees this: if a sequence can continue, it must.
  it('never leaves a sequence both complete and extendable', () => {
    const game = new Checkers('B:W15,23:B11');
    for (const move of game.moves()) {
      for (let n = 2; n < move.path.length; n++) {
        const prefix = move.path.slice(0, n);
        const matches = continuations(game.moves({ square: prefix[0] }), prefix);
        const complete = matches.filter((m) => m.path.length === prefix.length);
        const longer = matches.filter((m) => m.path.length > prefix.length);
        expect(complete.length === 0 || longer.length === 0).toBe(true);
      }
    }
  });
});
```

- [ ] **Step 3: Run the tests**

Run: `npx vitest run tests/chain.test.js`
Expected: all 3 pass.

- [ ] **Step 4: Port the controller**

Write `src/main.js` following the notes above, importing `continuations` and `nextHops` from `./game/chain.js`. Leave out clock, persistence, review, PDN, and online entirely — those arrive in Tasks 11–14, and a stubbed call site is worse than an absent one.

- [ ] **Step 5: Play a real game**

Run: `npm run dev`. Check by hand:
1. Black's pieces are pickable, White's are not.
2. Pressing a piece lights its landing squares; jumps get the ring, quiet moves the dot.
3. When a capture exists anywhere, only capturing pieces can be picked up.
4. Set up a double jump and confirm the piece locks, pulses, and only its next hop lights.
5. Undo is disabled mid-chain and enabled after.
6. Reaching the far row crowns and ends the turn mid-chain.
7. The computer replies, and its chains animate hop by hop.
8. Play to a finish: the banner, dialog, and move list all read correctly.
9. Switch to Pass & Play and confirm the board flips and both sides are playable.

- [ ] **Step 6: Commit**

```bash
git add src/main.js src/game/chain.js tests/chain.test.js
git commit -m "Make the game playable against the computer and in pass & play"
```

---

# Phase 4 — The surround

## Task 11: Clocks

**Files:**
- Create: `src/game/clock.js`, `tests/clock.test.js`
- Modify: `src/main.js`, `index.html`
- Reference: `../chess.puter.com/src/game/clock.js`, `../chess.puter.com/tests/clock.test.js`

**Interfaces:**
- Produces: `Clock`, `TIME_CONTROLS`, `DEFAULT_TIME_ID`, `LOW_TIME_MS`, `formatClock`, `speakClock`, `isTimeId`, `timeControl`
- `Clock` keys its two sides `'b'` and `'w'`, unchanged from chess.

- [ ] **Step 1: Port `clock.js` and its test verbatim**

Both files copy across with no changes — the module names its sides `w` and `b` and knows nothing about the game.

- [ ] **Step 2: Run the ported tests**

Run: `npx vitest run tests/clock.test.js`
Expected: the whole ported suite passes untouched.

- [ ] **Step 3: Wire the clock into the controller**

Port from the chess `main.js`: `gameTimeId`, `resetClock`, `clockLive`, `syncClock`, `startClockTimer`, `stopClockTimer`, `onClockTick`, `announceLowTime`, `handleFlagFall`, `afterPlyApplied`, `applyRemoteClock`, `buildTimeOptions`, `renderClocks`, and the `FLAG_GRACE_MS` and `CLOCK_TICK_MS` constants.

`describeTimeout` collapses to one branch — there is no FIDE 6.9 analog:

```js
/** Running out of time loses. Checkers has no "but they could not have won". */
function describeTimeout(loser) {
  const winner = otherColor(loser);
  const base = { reason: 'timeout', termination: 'time forfeit' };
  const sub = `${cap(sideName(loser))} ran out of time.`;
  if (mode === 'local') {
    return { ...base, kind: 'win', result: resultFor(winner), title: `${colorName(winner)} wins`, sub };
  }
  return {
    ...base,
    kind: loser === myColor ? 'loss' : 'win',
    result: resultFor(winner),
    title: loser === myColor ? 'You lose' : 'You win',
    sub,
  };
}
```

`afterPlyApplied` is called once per **turn**, so a chain is charged once and incremented once. Call it from the `complete` branch of `attemptMove`, never from the chain-continuation branch.

- [ ] **Step 4: Check by hand**

Run: `npm run dev`. Pick a 1+0 clock and confirm: the clock does not start until the first move; a five-hop chain is charged once, not five times; the clock turns red under 20s and shows tenths; running out ends the game.

- [ ] **Step 5: Commit**

```bash
git add src/game/clock.js tests/clock.test.js src/main.js index.html
git commit -m "Put the game on a clock"
```

---

## Task 12: Saved games

**Files:**
- Create: `src/game/persistence.js`, `tests/persistence.test.js`
- Modify: `src/main.js`
- Reference: `../chess.puter.com/src/game/persistence.js`, `../chess.puter.com/tests/persistence.test.js`

**Interfaces:**
- Produces: `parseSavedGame(data)`, `loadGame()`, `saveGame({...})`, `clearGame()`
- A saved move is a `number[]` path, not a `[from, to, promotion]` tuple.

- [ ] **Step 1: Write the failing test**

Port the chess test file and replace its move-shape cases with:

```js
import { describe, it, expect } from 'vitest';
import { parseSavedGame } from '../src/game/persistence.js';

const valid = {
  v: 1,
  mode: 'computer',
  myColor: 'b',
  time: 'unlimited',
  moves: [[11, 15], [23, 19], [15, 24, 31]],
  clock: null,
  clockStack: [],
};

describe('parseSavedGame', () => {
  it('accepts a well-formed save', () => {
    const parsed = parseSavedGame(valid);
    expect(parsed.moves).toEqual([[11, 15], [23, 19], [15, 24, 31]]);
    expect(parsed.myColor).toBe('b');
  });

  it('rejects a save from another format version', () => {
    expect(parseSavedGame({ ...valid, v: 2 })).toBe(null);
  });

  it('rejects squares outside 1-32', () => {
    expect(parseSavedGame({ ...valid, moves: [[0, 15]] })).toBe(null);
    expect(parseSavedGame({ ...valid, moves: [[11, 33]] })).toBe(null);
    expect(parseSavedGame({ ...valid, moves: [[11, 15.5]] })).toBe(null);
  });

  it('rejects a path too short or absurdly long', () => {
    expect(parseSavedGame({ ...valid, moves: [[11]] })).toBe(null);
    expect(parseSavedGame({ ...valid, moves: [new Array(20).fill(11)] })).toBe(null);
  });

  it('rejects an online save', () => {
    expect(parseSavedGame({ ...valid, mode: 'online' })).toBe(null);
  });

  it('drops a clock stack that does not match the move count', () => {
    const parsed = parseSavedGame({ ...valid, clockStack: [[1000, 1000]] });
    expect(parsed.clockStack).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/persistence.test.js`
Expected: FAIL — cannot resolve the module.

- [ ] **Step 3: Port `persistence.js`**

Copy the chess module. Change `KEY` to `'checkers-game'`, drop `SQUARE`/`PROMOTIONS`, and replace the per-move validation with:

```js
/** A jump can chain at most nine times on an 8x8 board; ten is generous. */
const MAX_PATH = 12;

function parsePath(entry) {
  if (!Array.isArray(entry) || entry.length < 2 || entry.length > MAX_PATH) return null;
  for (const square of entry) {
    if (!Number.isInteger(square) || square < 1 || square > 32) return null;
  }
  return entry.slice();
}
```

`saveGame` stores `moves: moves.map((path) => path.slice())`.

- [ ] **Step 4: Run the tests, then wire it in**

Run: `npx vitest run tests/persistence.test.js` — all 6 pass.

Port `saveNow()` and `restoreGame()` from the chess controller, replaying `game.move({ path })`. Add the `pagehide`, `visibilitychange`, and `pageshow` listeners. **A pending chain is never saved** — `saveNow()` records `game.history()`, which holds complete turns only, so this needs no special case; add a comment saying so.

- [ ] **Step 5: Check by hand and commit**

Run: `npm run dev`. Play a few moves, reload — the game comes back with its clocks. Reload mid-chain — the position rewinds to the start of that turn and the jump is still compulsory.

```bash
git add src/game/persistence.js tests/persistence.test.js src/main.js
git commit -m "Let a game in progress survive a reload"
```

---

## Task 13: Review and PDN export

**Files:**
- Create: `src/game/pdn.js`, `tests/pdn.test.js`
- Modify: `src/main.js`
- Reference: `../chess.puter.com/src/game/pgn.js`, `../chess.puter.com/tests/pgn.test.js`

**Interfaces:**
- Produces: `buildPdn({ moves, result, black, white, date, control, termination, event, site })`, `pdnDate(date)`, `pdnFilename(date)`
- `moves` is an array of PDN strings (`'11-15'`, `'23x14x5'`).

**PDN differs from PGN in two ways that matter:** the tag roster lists **Black before White**, and it carries a `GameType` tag. The `Result` token keeps PGN's meaning, White's score first.

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest';
import { buildPdn, pdnDate, pdnFilename } from '../src/game/pdn.js';

const base = {
  moves: ['11-15', '23-19', '8-11'],
  result: '*',
  black: 'You',
  white: 'Computer (Medium)',
  date: new Date(2026, 7, 13, 14, 30),
};

describe('buildPdn', () => {
  it('lists Black before White', () => {
    const pdn = buildPdn(base);
    expect(pdn.indexOf('[Black ')).toBeLessThan(pdn.indexOf('[White '));
  });

  it('carries the roster and the game type', () => {
    const pdn = buildPdn(base);
    expect(pdn).toContain('[Site "checkers.puter.com"]');
    expect(pdn).toContain('[Date "2026.08.13"]');
    expect(pdn).toContain('[Black "You"]');
    expect(pdn).toContain('[White "Computer (Medium)"]');
    expect(pdn).toContain('[Result "*"]');
    expect(pdn).toContain('[GameType "21"]');
  });

  it('numbers move pairs and ends with the result', () => {
    expect(buildPdn(base)).toContain('1. 11-15 23-19 2. 8-11 *');
  });

  it('writes the time control in seconds plus increment', () => {
    const pdn = buildPdn({ ...base, control: { initial: 300000, increment: 3000 } });
    expect(pdn).toContain('[TimeControl "300+3"]');
    expect(buildPdn(base)).toContain('[TimeControl "-"]');
  });

  it('omits a normal termination and spells out any other', () => {
    expect(buildPdn(base)).not.toContain('[Termination');
    expect(buildPdn({ ...base, termination: 'time forfeit' })).toContain(
      '[Termination "time forfeit"]',
    );
  });

  it('escapes quotes and strips newlines from tag values', () => {
    const pdn = buildPdn({ ...base, black: 'a"b\nc' });
    expect(pdn).toContain('[Black "a\\"b c"]');
  });

  it('wraps movetext at 80 columns', () => {
    const moves = new Array(80).fill('11-15');
    for (const line of buildPdn({ ...base, moves }).split('\n')) {
      expect(line.length).toBeLessThanOrEqual(80);
    }
  });

  it('names a downloaded file', () => {
    expect(pdnDate(base.date)).toBe('2026.08.13');
    expect(pdnFilename(base.date)).toBe('checkers-20260813-1430.pdn');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/pdn.test.js`
Expected: FAIL — cannot resolve the module.

- [ ] **Step 3: Port `pgn.js` to `pdn.js`**

Copy it across. Change: `site` default to `'checkers.puter.com'`, the tag order to put `Black` before `White`, add `['GameType', GAME_TYPE]`, and change the filename prefix to `checkers-` with a `.pdn` extension.

```js
/**
 * PDN's code for the game being recorded. 8x8 English draughts — the ruleset
 * this app implements — has its own number, distinct from International
 * draughts on 10x10.
 *
 * VERIFY against the PDN standard before shipping; a wrong code makes every
 * exported game load under the wrong rules in other software.
 */
const GAME_TYPE = '21';
```

- [ ] **Step 4: Verify the GameType code**

Look up the PDN specification's GameType table, confirm the code for 8×8 English draughts, and replace the `VERIFY` note with a one-line citation. **If it is not 21, fix the constant and the test.**

Run: `npx vitest run tests/pdn.test.js` — all 8 pass.

- [ ] **Step 5: Wire up review and export**

Port from the chess controller: `reviewing`, `viewPlies`, `clampReview`, `positionAt`, `goToPly`, `announceReview`, `renderReviewBar`, `keepReviewFocus`, `scrollMoveIntoView`, `copyPdn`, `downloadPdn`, `currentPdn`, `pdnNames`, and the arrow-key and move-list click handlers.

Two changes: `positionAt` replays `history[i].path`, and `goToPly` clears `pendingPath` along with the selection and the drag.

`plyLabel` keeps its chess shape — `12.` and `12…` — since checkers numbers move pairs the same way.

- [ ] **Step 6: Check by hand and commit**

Run: `npm run dev`. Step back through a game with the arrow keys, click a move to jump to it, copy and download the PDN, and confirm a chain appears as `23x14x5`.

```bash
git add src/game/pdn.js tests/pdn.test.js src/main.js
git commit -m "Review a finished game and export it as PDN"
```

---

## Task 14: Online play

**Files:**
- Create: `src/net/online.js`, `tests/online.test.js`
- Modify: `src/main.js`, `index.html`
- Reference: `../chess.puter.com/src/net/online.js`, `../chess.puter.com/tests/online.test.js`

**Interfaces:**
- Produces: `class OnlineSession(handlers)`, `loadPuter()`
- `sendMove(move, clock)` takes the engine's `Move` and sends `{t:'move', path, clock}`
- `onMove({ path, clock })`

`PROTOCOL_VERSION` is `1` — a new app with no deployed peers.

- [ ] **Step 1: Port the module and its test**

Copy `online.js` across whole. It is almost entirely transport, and the lifecycle guarantees (`this._conn === conn` guards, host reverting to waiting on a failed join, `onClose` firing exactly once) are unchanged.

Change `PROTOCOL_VERSION` to `1`, replace `cleanClock`'s neighbours with a path validator, and update the two move methods:

```js
/**
 * A move path off the wire. One message carries a whole turn — chains
 * included — so the position, the turn, and the clock handover stay atomic.
 */
function cleanPath(value) {
  if (!Array.isArray(value) || value.length < 2 || value.length > 12) return null;
  const seen = new Set();
  for (const square of value) {
    if (!Number.isInteger(square) || square < 1 || square > 32) return null;
    if (seen.has(square)) return null;
    seen.add(square);
  }
  return value.slice();
}
```

```js
  /** `clock` is our own remaining ms after the turn, or null when untimed. */
  sendMove({ path }, clock = null) {
    this._send({ t: 'move', path, clock });
  }
```

and in `_onMessage`:

```js
      case 'move': {
        if (!this.connected) break;
        const path = cleanPath(msg.path);
        if (path) this.handlers.onMove({ path, clock: cleanClock(msg.clock) });
        break;
      }
```

- [ ] **Step 2: Update the ported test**

The chess `tests/online.test.js` fakes a peer and drives both ends. Port it and change its move assertions to paths:

```js
it('sends a whole turn as one message', () => {
  const sent = [];
  // ... harness setup as in the ported file ...
  session.sendMove({ path: [11, 18, 25] }, 42000);
  expect(JSON.parse(sent[0])).toEqual({ t: 'move', path: [11, 18, 25], clock: 42000 });
});

it('rejects a malformed path from a peer', () => {
  // ... deliver {t:'move', path:[11,11]} and {t:'move', path:[0,15]} ...
  expect(onMove).not.toHaveBeenCalled();
});
```

- [ ] **Step 3: Run the tests**

Run: `npx vitest run tests/online.test.js`
Expected: the ported suite passes.

- [ ] **Step 4: Wire online mode into the controller**

Port from the chess controller, unchanged in structure: `enterOnlineIdle`, `makeSession`, `createGame`, `joinGame`, `attemptAutoJoin`, `normalizeInviteCode`, `friendlyError`, `cancelOnlineSetup`, `handleSessionStart`, `startRematch`, `startOnlineGame`, `handleRemoteMove`, `handleRemoteFlag`, `desync`, `endGameManually`, `handleOpponentResign`, `requestResign`, `requestLeave`, `offerRematch`, `handleRematchOffer`, `handleRematchDecline`, `handleSessionClose`, `inviteLink`, `readInviteFromUrl`, `copyInviteCode`, `copyInviteLink`, plus `updateModeUi`'s online branches and the `hashchange` listener.

`handleRemoteMove` takes a path and animates it whole:

```js
function handleRemoteMove({ path, clock: remoteClock }) {
  if (mode !== 'online' || onlineUiState !== 'playing' || gameFinished()) return;
  if (game.turn() === myColor) {
    desync();
    return;
  }
  const played = game.move({ path });
  if (!played) {
    desync();
    return;
  }
  afterPlyApplied(played);
  applyRemoteClock(played.color, remoteClock);
  clearSelection();
  showPath(played.path, () => {
    renderAll();
    const status = game.status();
    if (status.over) showEnd(describeEnd(status));
  });
}
```

`showPath` is `showMove`'s sibling: it skips animation while reviewing, and otherwise calls `boardView.animatePath`.

Send the turn from the `complete` branch of `attemptMove`, after `afterPlyApplied`:

```js
if (mode === 'online') session?.sendMove(played, left);
```

- [ ] **Step 5: Test against yourself**

Run: `npm run dev`. Open two browser windows, create a game in one, join with the code in the other. Confirm: colours are assigned and the boards face opposite ways; a multi-jump arrives as one animated chain; the clock hands over once per turn; resign, rematch, and leave all work; closing one tab ends the game in the other.

- [ ] **Step 6: Commit**

```bash
git add src/net/online.js tests/online.test.js src/main.js index.html
git commit -m "Play a friend over a private peer connection"
```

---

# Phase 5 — Ship

## Task 15: Icons, images, and metadata

**Files:**
- Create: `public/site.webmanifest`, `public/robots.txt`, `public/sitemap.xml`, `tools/og-image.html`, `tools/render-og.mjs`, `tools/store-screenshots.mjs`, `src/icon.svg`
- Modify: `index.html`
- Reference: the matching files in `../chess.puter.com`

- [ ] **Step 1: Draw the icon**

Write `src/icon.svg`: a 512×512 rounded-square board tile in `--sq-dark` (`#7d90bb`) carrying one black disc with a white border, matching the in-app pieces.

- [ ] **Step 2: Generate the PNGs**

```bash
npm i --no-save sharp
node -e "
const sharp=require('sharp');
for (const size of [16,32,128,180,192,512])
  sharp('src/icon.svg').resize(size,size).png().toFile(
    'public/' + ({16:'favicon-16x16',32:'favicon-32x32',180:'apple-touch-icon'}[size] || 'icon-'+size) + '.png');
"
```
Then build `public/favicon.ico` from the 32px PNG.

- [ ] **Step 3: Port the manifest, robots, and sitemap**

`site.webmanifest`:
```json
{
  "name": "Checkers — Play Online",
  "short_name": "Checkers",
  "description": "Play checkers for free. Challenge the computer, pass & play with a friend on one device, or invite a friend to a private online game.",
  "start_url": ".",
  "display": "standalone",
  "theme_color": "#f4f5f9",
  "background_color": "#f4f5f9",
  "icons": [
    { "src": "icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

`robots.txt` and `sitemap.xml` port across with the domain swapped.

- [ ] **Step 4: Port the OG tooling and render the image**

Port `tools/og-image.html` and `tools/render-og.mjs`, staging a checkers position with a crowned king rather than a checkmate.

```bash
npm i --no-save playwright && npx playwright install chromium
npm run dev &
node tools/render-og.mjs
```
Expected: `public/og-image.png` at 1200×630.

- [ ] **Step 5: Port the store screenshot tool**

Port `tools/store-screenshots.mjs`. Its scenes are staged through the app's own save format, so update the staged games to checkers paths and rename the scenes (`checkmate` → `crowned`).

- [ ] **Step 6: Commit**

```bash
git add public src/icon.svg tools index.html
git commit -m "Add the icons, social image, and site metadata"
```

---

## Task 16: Deploy config and README

**Files:**
- Create: `customHttp.yml`, `README.md`
- Modify: `index.html`
- Reference: `../chess.puter.com/customHttp.yml`, `../chess.puter.com/README.md`

- [ ] **Step 1: Add the Plausible placeholder**

In `index.html`, in place of the chess analytics script:

```html
<!-- Privacy-friendly analytics by Plausible.
     Replace DATA-DOMAIN-SCRIPT-ID below with the script id Plausible issues
     for checkers.puter.com. Until then no events are sent: analytics.js
     absorbs every call, so the game is unaffected either way.
     Do NOT reuse the chess.puter.com id — it would report checkers traffic
     as chess traffic. -->
<script>
  window.plausible=window.plausible||function(){(plausible.q=plausible.q||[]).push(arguments)},plausible.init=plausible.init||function(i){plausible.o=i||{}};
  plausible.init()
</script>
```

- [ ] **Step 2: Port `customHttp.yml`**

Copy it across. The CSP is unchanged in substance — `js.puter.com` and `api.puter.com` for the SDK, `wss:` for peer signalling, inline styles allowed for the Puter consent dialog.

**Recompute the inline-script hashes** after building, since the theme script's text changed (`chess-settings` → `checkers-settings`) and the Plausible block changed:

```bash
npm run build
python3 -c "import re,hashlib,base64;[print('sha256-'+base64.b64encode(hashlib.sha256(s.encode()).digest()).decode()) for s in re.findall(r'<script>(.*?)</script>',open('dist/index.html').read(),re.S)]"
```
Paste the results into `script-src`.

- [ ] **Step 3: Write the README**

Port the chess README's shape. Describe the ruleset (forced capture, crowning ends the turn, no-move loses), the engine and its perft validation, the AI, the `game/` modules, the dev commands, and — under a **Regenerating images** heading — the Playwright and sharp steps from Task 15, since neither is a project dependency.

- [ ] **Step 4: Verify the build**

Run: `npm run build && npm run preview`
Expected: a clean build, and the production bundle plays a full game against the computer with no console errors.

- [ ] **Step 5: Full check**

Run: `npm test`
Expected: every suite passes — geometry, position, moves, rules, perft, ai, chain, boardView, clock, persistence, pdn, online.

- [ ] **Step 6: Commit**

```bash
git add customHttp.yml README.md index.html
git commit -m "Add the deploy configuration and the README"
```

---

## Deferred to you

Two things this plan cannot finish:

1. **The Plausible script id** for checkers.puter.com. Task 16 ships a commented placeholder; paste the real id in when you have it, then recompute the CSP hashes.
2. **DNS and hosting** for checkers.puter.com. `customHttp.yml` is AWS Amplify's format, matching how the chess app is deployed.
