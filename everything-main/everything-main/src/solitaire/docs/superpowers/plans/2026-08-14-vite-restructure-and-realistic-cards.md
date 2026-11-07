# Solitaire Vite Restructure and Realistic Cards — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn a single 1307-line `index.html` Klondike solitaire into a Vite project with separated HTML/CSS/JS modules, add realistic desktop card faces while keeping small cards plain, and back stats plus game-resume with Puter.

**Architecture:** Pure game logic in `src/game/` with no DOM access and full Vitest coverage; DOM rendering in `src/ui/`; Puter and localStorage behind `src/services/stats.js`. Cards render in one of two modes chosen by card pixel width — a plain corner-index DOM below 76px, and a vendored public-domain `<playing-card>` SVG element at 76px and above.

**Tech Stack:** Vite, Vitest, plain JavaScript ES modules, no framework. CardMeister (Unlicense/public domain) for card art. puter.js for auth, KV storage.

**Spec:** `docs/superpowers/specs/2026-08-14-solitaire-vite-and-card-realism-design.md`

## Global Constraints

- **Plain JavaScript, ES modules.** No TypeScript, no framework, no CSS preprocessor.
- **Card aspect ratio is locked at 1:1.4** (`cardH = cardW * 1.4`). The vendored card SVG preserves aspect ratio and letterboxes if the box ratio differs. Do not change this ratio.
- **Rich mode threshold is 76px card width.** Constant `RICH_MODE_MIN_CARD_W = 76` in `src/ui/layout.js`.
- **`src/game/**` must never import from `src/ui/**` or `src/services/**`, and must never touch `document`, `window`, or `puter`.** This is what makes it testable.
- **`board.js` and `drag.js` must not import each other.** `main.js` owns `requestRender()` and passes it into both.
- **Any value derived per-card for visual variation must be a pure function of the card id, never `Math.random()`.** `render()` rebuilds the whole board on every move.
- **No Puter cloud call may run on page load unless `puter.auth.isSignedIn()` is already true.** Any cloud call auto-prompts a sign-in dialog; the game must never demand an account.
- **Every Puter call is wrapped in try/catch and falls back to localStorage silently.**
- **Tests cover `src/game/**` and the pure helpers in `src/ui/layout.js`, `src/ui/drag.js`, `src/ui/card-tilt.js`, and `src/services/stats.js` only.** No DOM or e2e tests.
- **`findHint`, `showHint`, the `.hint` CSS class and the `hintPulse` keyframes are deleted.** Do not port them.
- **Baseline reference:** the original single-file game is commit `d8b025b`, file `index.html`. "Port verbatim from baseline" below means copy that code unchanged apart from the import/export wrapper.

---

## File Structure

| File | Responsibility |
|---|---|
| `index.html` | Shell markup only: header, `#board`, `#win`, footer, module script tag |
| `package.json` | Scripts and dev dependencies |
| `vite.config.js` | Vite + Vitest config, `base: './'` |
| `src/main.js` | Bootstrap: owns `requestRender()`, wires buttons, keys, resize |
| `src/styles/base.css` | Reset, `:root` design tokens, typography |
| `src/styles/layout.css` | Header, main, board, rows, piles, slots, footer |
| `src/styles/card.css` | Card surface, both render modes, material realism |
| `src/styles/animations.css` | Flip, flight, win overlay, drop hover |
| `src/game/deck.js` | Suits, ranks, rank values, `newDeck` |
| `src/game/rules.js` | Placement validation, win detection |
| `src/game/state.js` | Game creation, undo history, move application, stock draw |
| `src/game/serialize.js` | Compact save encode/decode |
| `src/ui/layout.js` | Size computation, render-mode selection, CSS var application |
| `src/ui/card-tilt.js` | Deterministic per-card tilt |
| `src/ui/cardview.js` | Builds a card element in either render mode |
| `src/ui/board.js` | Full board render |
| `src/ui/drag.js` | Pointer drag/drop, drop-target picking |
| `src/ui/animate.js` | Flip, stock flight, win celebration |
| `src/services/stats.js` | localStorage stats/save, optional Puter mirror |
| `src/vendor/cardmeister.js` | Vendored public-domain 52-card SVG element |

---

## Task 1: Vite and Vitest scaffold with the deck module

**Files:**
- Create: `package.json`, `vite.config.js`, `src/main.js`, `src/game/deck.js`
- Test: `src/game/deck.test.js`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `SUITS: string[]` — `['♠','♥','♦','♣']`
  - `SUIT_COLOR: Record<string,'red'|'black'>`
  - `RANKS: string[]` — `['A','2',…,'10','J','Q','K']`
  - `RANK_VAL: Record<string,number>` — `A`=1 … `K`=13
  - `newDeck(random = Math.random): Card[]` where `Card = { suit, rank, color, faceUp, id }` and `id === suit + rank`

- [ ] **Step 1: Initialize the package and install tooling**

```bash
cd /Users/miikakuisma/Development/solitaire
npm init -y
npm install -D vite vitest
npm pkg set type=module
npm pkg set scripts.dev=vite
npm pkg set scripts.build="vite build"
npm pkg set scripts.preview="vite preview"
npm pkg set scripts.test="vitest run"
npm pkg set scripts.test:watch=vitest
npm pkg set private=true
npm pkg delete main
```

- [ ] **Step 2: Create `vite.config.js`**

`base: './'` matters — the build is served from a Puter subdomain root, and absolute asset paths break there.

```js
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: { outDir: 'dist' },
  test: {
    environment: 'node',
    include: ['src/**/*.test.js'],
  },
});
```

- [ ] **Step 3: Write the failing test**

Create `src/game/deck.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { SUITS, RANKS, RANK_VAL, SUIT_COLOR, newDeck } from './deck.js';

describe('newDeck', () => {
  it('produces 52 cards with unique ids', () => {
    const deck = newDeck();
    expect(deck).toHaveLength(52);
    expect(new Set(deck.map(c => c.id)).size).toBe(52);
  });

  it('produces 13 cards of each suit and 4 of each rank', () => {
    const deck = newDeck();
    for (const s of SUITS) {
      expect(deck.filter(c => c.suit === s)).toHaveLength(13);
    }
    for (const r of RANKS) {
      expect(deck.filter(c => c.rank === r)).toHaveLength(4);
    }
  });

  it('deals every card face down', () => {
    expect(newDeck().every(c => c.faceUp === false)).toBe(true);
  });

  it('assigns red to hearts and diamonds, black to spades and clubs', () => {
    const deck = newDeck();
    for (const c of deck) {
      const expected = (c.suit === '♥' || c.suit === '♦') ? 'red' : 'black';
      expect(c.color).toBe(expected);
    }
  });

  it('sets id to suit plus rank', () => {
    for (const c of newDeck()) expect(c.id).toBe(c.suit + c.rank);
  });

  it('shuffles using the injected random source', () => {
    // Always returning 0 makes Fisher-Yates swap every position with index 0,
    // which is deterministic — so two runs must match exactly.
    const a = newDeck(() => 0).map(c => c.id);
    const b = newDeck(() => 0).map(c => c.id);
    expect(a).toEqual(b);
  });

  it('actually permutes, and preserves the multiset', () => {
    // Do not use a random that returns ~1.0 here: floor(0.999999 * (i+1)) === i,
    // so Fisher-Yates swaps every index with itself and the "shuffle" is a no-op.
    const ids = newDeck(() => 0).map(c => c.id);
    const buildOrder = SUITS.flatMap(s => RANKS.map(r => s + r));
    expect(ids).not.toEqual(buildOrder);
    expect([...ids].sort()).toEqual([...buildOrder].sort());
  });
});

describe('RANK_VAL', () => {
  it('maps ace to 1 and king to 13', () => {
    expect(RANK_VAL['A']).toBe(1);
    expect(RANK_VAL['K']).toBe(13);
    expect(RANK_VAL['10']).toBe(10);
  });
});

describe('SUIT_COLOR', () => {
  it('covers all four suits', () => {
    expect(Object.keys(SUIT_COLOR).sort()).toEqual([...SUITS].sort());
  });
});
```

- [ ] **Step 4: Run the test and verify it fails**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "./deck.js"`.

- [ ] **Step 5: Write `src/game/deck.js`**

The `random` parameter is injected purely so the shuffle is testable; production callers use the default.

```js
export const SUITS = ['♠', '♥', '♦', '♣'];

export const SUIT_COLOR = { '♠': 'black', '♣': 'black', '♥': 'red', '♦': 'red' };

export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

export const RANK_VAL = Object.fromEntries(RANKS.map((r, i) => [r, i + 1]));

export function newDeck(random = Math.random) {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ suit, rank, color: SUIT_COLOR[suit], faceUp: false, id: suit + rank });
    }
  }
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}
```

- [ ] **Step 6: Run the test and verify it passes**

Run: `npm test`
Expected: PASS, 9 tests.

- [ ] **Step 7: Create a placeholder `src/main.js` so the dev server boots**

```js
// Bootstrap. Filled in at Task 10.
console.log('solitaire: booting');
```

- [ ] **Step 8: Verify the dev server and build both work**

Run: `npm run dev` — expect a URL on localhost, page loads without console errors. Stop it.
Run: `npm run build` — expect `dist/` written with no errors.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json vite.config.js src/
git commit -m "Add Vite and Vitest scaffold with the deck module"
```

---

## Task 2: Placement rules

**Files:**
- Create: `src/game/rules.js`
- Test: `src/game/rules.test.js`

**Interfaces:**
- Consumes: `RANK_VAL` from `src/game/deck.js`
- Produces:
  - `canPlaceOnTableau(card, targetPile): boolean`
  - `canPlaceOnFoundation(card, targetPile): boolean`
  - `isWon(game): boolean` — true when all four foundations hold 13 cards

- [ ] **Step 1: Write the failing test**

Create `src/game/rules.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { canPlaceOnTableau, canPlaceOnFoundation, isWon } from './rules.js';
import { SUIT_COLOR } from './deck.js';

const card = (suit, rank, faceUp = true) => ({
  suit, rank, color: SUIT_COLOR[suit], faceUp, id: suit + rank,
});

describe('canPlaceOnTableau', () => {
  it('allows only a King onto an empty column', () => {
    expect(canPlaceOnTableau(card('♠', 'K'), [])).toBe(true);
    expect(canPlaceOnTableau(card('♥', 'K'), [])).toBe(true);
    expect(canPlaceOnTableau(card('♠', 'Q'), [])).toBe(false);
    expect(canPlaceOnTableau(card('♠', 'A'), [])).toBe(false);
  });

  it('allows descending rank with alternating colour', () => {
    expect(canPlaceOnTableau(card('♥', 'Q'), [card('♠', 'K')])).toBe(true);
    expect(canPlaceOnTableau(card('♦', 'Q'), [card('♣', 'K')])).toBe(true);
  });

  it('rejects same colour', () => {
    expect(canPlaceOnTableau(card('♠', 'Q'), [card('♣', 'K')])).toBe(false);
    expect(canPlaceOnTableau(card('♥', 'Q'), [card('♦', 'K')])).toBe(false);
  });

  it('rejects a rank that is not exactly one below', () => {
    expect(canPlaceOnTableau(card('♥', 'J'), [card('♠', 'K')])).toBe(false);
    expect(canPlaceOnTableau(card('♥', 'K'), [card('♠', 'Q')])).toBe(false);
  });

  it('rejects a face-down top card', () => {
    expect(canPlaceOnTableau(card('♥', 'Q'), [card('♠', 'K', false)])).toBe(false);
  });

  it('only considers the top card of the target', () => {
    const pile = [card('♠', '5'), card('♦', '3'), card('♠', 'K')];
    expect(canPlaceOnTableau(card('♥', 'Q'), pile)).toBe(true);
  });
});

describe('canPlaceOnFoundation', () => {
  it('allows only an Ace onto an empty foundation', () => {
    expect(canPlaceOnFoundation(card('♠', 'A'), [])).toBe(true);
    expect(canPlaceOnFoundation(card('♠', '2'), [])).toBe(false);
    expect(canPlaceOnFoundation(card('♠', 'K'), [])).toBe(false);
  });

  it('allows ascending rank of the same suit', () => {
    expect(canPlaceOnFoundation(card('♠', '2'), [card('♠', 'A')])).toBe(true);
    expect(canPlaceOnFoundation(card('♥', 'K'), [card('♥', 'Q')])).toBe(true);
  });

  it('rejects a different suit', () => {
    expect(canPlaceOnFoundation(card('♥', '2'), [card('♠', 'A')])).toBe(false);
  });

  it('rejects a non-consecutive rank', () => {
    expect(canPlaceOnFoundation(card('♠', '3'), [card('♠', 'A')])).toBe(false);
    expect(canPlaceOnFoundation(card('♠', 'A'), [card('♠', '2')])).toBe(false);
  });
});

describe('isWon', () => {
  const full = () => Array.from({ length: 13 }, (_, i) => card('♠', String(i)));

  it('is true when all four foundations hold 13 cards', () => {
    expect(isWon({ foundations: [full(), full(), full(), full()] })).toBe(true);
  });

  it('is false when any foundation is short', () => {
    expect(isWon({ foundations: [full(), full(), full(), full().slice(1)] })).toBe(false);
    expect(isWon({ foundations: [[], [], [], []] })).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test`
Expected: FAIL — cannot resolve `./rules.js`.

- [ ] **Step 3: Write `src/game/rules.js`**

Logic ported verbatim from baseline `index.html:812-824` (`canPlaceOnTableau`, `canPlaceOnFoundation`) and `index.html:1279` (win condition).

```js
import { RANK_VAL } from './deck.js';

export function canPlaceOnTableau(card, target) {
  if (!target.length) return card.rank === 'K';
  const top = target[target.length - 1];
  if (!top.faceUp) return false;
  if (top.color === card.color) return false;
  return RANK_VAL[top.rank] === RANK_VAL[card.rank] + 1;
}

export function canPlaceOnFoundation(card, target) {
  if (!target.length) return card.rank === 'A';
  const top = target[target.length - 1];
  if (top.suit !== card.suit) return false;
  return RANK_VAL[card.rank] === RANK_VAL[top.rank] + 1;
}

export function isWon(game) {
  return game.foundations.every(f => f.length === 13);
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npm test`
Expected: PASS, all rules tests green.

- [ ] **Step 5: Commit**

```bash
git add src/game/rules.js src/game/rules.test.js
git commit -m "Add placement rules and win detection"
```

---

## Task 3: Game state, undo, and moves

**Files:**
- Create: `src/game/state.js`
- Test: `src/game/state.test.js`

**Interfaces:**
- Consumes: `newDeck` from `deck.js`; `canPlaceOnTableau`, `canPlaceOnFoundation` from `rules.js`
- Produces:
  - `HISTORY_LIMIT: number` — `200`
  - `createGame(deck?): Game` where `Game = { tableau: Card[][7], foundations: Card[][4], stock: Card[], waste: Card[], moves: number, history: Snapshot[] }`
  - `snapshot(game): void`
  - `undo(game): boolean` — false when history is empty
  - `getMovingCards(game, from): Card[]` where `from = { from: 'tableau'|'waste'|'foundation', fromIndex: number, cardIndex?: number }`
  - `applyMove(game, from, to, cards): { ok: boolean, flipped: string|null }` where `to = { kind: 'tableau'|'foundation', index: number }`; `flipped` is the id of a card newly turned face up
  - `drawFromStock(game): { ok: boolean, drawn: string|null, recycled: boolean }`

- [ ] **Step 1: Write the failing test**

Create `src/game/state.test.js`:

```js
import { describe, it, expect } from 'vitest';
import {
  createGame, snapshot, undo, getMovingCards, applyMove, drawFromStock, HISTORY_LIMIT,
} from './state.js';
import { newDeck, SUIT_COLOR } from './deck.js';

const card = (suit, rank, faceUp = true) => ({
  suit, rank, color: SUIT_COLOR[suit], faceUp, id: suit + rank,
});

// A game with hand-placed piles, so tests do not depend on the shuffle.
function rigged(overrides = {}) {
  return {
    tableau: [[], [], [], [], [], [], []],
    foundations: [[], [], [], []],
    stock: [],
    waste: [],
    moves: 0,
    history: [],
    ...overrides,
  };
}

describe('createGame', () => {
  it('deals 1..7 cards into the seven columns', () => {
    const g = createGame();
    g.tableau.forEach((col, i) => expect(col).toHaveLength(i + 1));
  });

  it('leaves exactly the last card of each column face up', () => {
    const g = createGame();
    g.tableau.forEach(col => {
      expect(col[col.length - 1].faceUp).toBe(true);
      expect(col.slice(0, -1).every(c => c.faceUp === false)).toBe(true);
    });
  });

  it('puts the remaining 24 cards in the stock and none in the waste', () => {
    const g = createGame();
    expect(g.stock).toHaveLength(24);
    expect(g.waste).toHaveLength(0);
  });

  it('uses all 52 cards exactly once', () => {
    const g = createGame();
    const ids = [...g.tableau.flat(), ...g.stock].map(c => c.id);
    expect(new Set(ids).size).toBe(52);
  });

  it('starts with no moves and no history', () => {
    const g = createGame();
    expect(g.moves).toBe(0);
    expect(g.history).toHaveLength(0);
  });

  it('accepts an injected deck', () => {
    const deck = newDeck(() => 0);
    const g = createGame(deck);
    expect([...g.tableau.flat(), ...g.stock]).toHaveLength(52);
  });
});

describe('undo', () => {
  it('returns false with empty history', () => {
    expect(undo(rigged())).toBe(false);
  });

  it('restores the exact prior state', () => {
    const g = rigged({ tableau: [[card('♠', 'K')], [], [], [], [], [], []], moves: 3 });
    snapshot(g);
    g.tableau[1].push(card('♥', 'Q'));
    g.moves = 4;
    expect(undo(g)).toBe(true);
    expect(g.tableau[1]).toHaveLength(0);
    expect(g.moves).toBe(3);
  });

  it('does not alias the live state after undo', () => {
    const g = rigged({ tableau: [[card('♠', 'K')], [], [], [], [], [], []] });
    snapshot(g);
    g.tableau[0].pop();
    undo(g);
    g.tableau[0].push(card('♥', 'Q'));
    // Mutating after undo must not corrupt any remaining snapshot.
    expect(g.tableau[0]).toHaveLength(2);
  });

  it('caps history at HISTORY_LIMIT', () => {
    const g = rigged();
    for (let i = 0; i < HISTORY_LIMIT + 25; i++) snapshot(g);
    expect(g.history).toHaveLength(HISTORY_LIMIT);
  });
});

describe('getMovingCards', () => {
  it('takes a tableau card and everything above it', () => {
    const g = rigged({
      tableau: [[card('♠', 'K'), card('♥', 'Q'), card('♠', 'J')], [], [], [], [], [], []],
    });
    expect(getMovingCards(g, { from: 'tableau', fromIndex: 0, cardIndex: 1 }).map(c => c.id))
      .toEqual(['♥Q', '♠J']);
  });

  it('takes only the top waste card', () => {
    const g = rigged({ waste: [card('♠', '2'), card('♥', '3')] });
    expect(getMovingCards(g, { from: 'waste' }).map(c => c.id)).toEqual(['♥3']);
  });

  it('takes only the top foundation card', () => {
    const g = rigged({ foundations: [[card('♠', 'A'), card('♠', '2')], [], [], []] });
    expect(getMovingCards(g, { from: 'foundation', fromIndex: 0 }).map(c => c.id)).toEqual(['♠2']);
  });
});

describe('applyMove', () => {
  it('rejects an invalid tableau placement and leaves state untouched', () => {
    const g = rigged({ tableau: [[card('♠', 'K')], [card('♠', 'Q')], [], [], [], [], []] });
    const result = applyMove(g, { from: 'tableau', fromIndex: 1, cardIndex: 0 },
      { kind: 'tableau', index: 0 }, [card('♠', 'Q')]);
    expect(result.ok).toBe(false);
    expect(g.tableau[1]).toHaveLength(1);
    expect(g.moves).toBe(0);
    expect(g.history).toHaveLength(0);
  });

  it('rejects a multi-card move to a foundation', () => {
    const g = rigged({ foundations: [[card('♠', 'A')], [], [], []] });
    const result = applyMove(g, { from: 'tableau', fromIndex: 0, cardIndex: 0 },
      { kind: 'foundation', index: 0 }, [card('♠', '2'), card('♠', '3')]);
    expect(result.ok).toBe(false);
  });

  it('rejects a move onto the pile it came from', () => {
    const g = rigged({ tableau: [[card('♠', 'K')], [], [], [], [], [], []] });
    const result = applyMove(g, { from: 'tableau', fromIndex: 0, cardIndex: 0 },
      { kind: 'tableau', index: 0 }, [card('♠', 'K')]);
    expect(result.ok).toBe(false);
  });

  it('moves a valid stack and increments moves', () => {
    const g = rigged({ tableau: [[card('♠', 'K')], [card('♥', 'Q')], [], [], [], [], []] });
    const result = applyMove(g, { from: 'tableau', fromIndex: 1, cardIndex: 0 },
      { kind: 'tableau', index: 0 }, [card('♥', 'Q')]);
    expect(result.ok).toBe(true);
    expect(g.tableau[0].map(c => c.id)).toEqual(['♠K', '♥Q']);
    expect(g.tableau[1]).toHaveLength(0);
    expect(g.moves).toBe(1);
    expect(g.history).toHaveLength(1);
  });

  it('flips the newly exposed card and reports its id', () => {
    const g = rigged({
      tableau: [[card('♠', 'K')], [card('♦', '7', false), card('♥', 'Q')], [], [], [], [], []],
    });
    const result = applyMove(g, { from: 'tableau', fromIndex: 1, cardIndex: 1 },
      { kind: 'tableau', index: 0 }, [card('♥', 'Q')]);
    expect(result.ok).toBe(true);
    expect(result.flipped).toBe('♦7');
    expect(g.tableau[1][0].faceUp).toBe(true);
  });

  it('reports no flip when the exposed card was already face up', () => {
    const g = rigged({
      tableau: [[card('♠', 'K')], [card('♠', 'K'), card('♥', 'Q')], [], [], [], [], []],
    });
    const result = applyMove(g, { from: 'tableau', fromIndex: 1, cardIndex: 1 },
      { kind: 'tableau', index: 0 }, [card('♥', 'Q')]);
    expect(result.flipped).toBe(null);
  });

  it('moves a waste card to a foundation', () => {
    const g = rigged({ waste: [card('♠', 'A')] });
    const result = applyMove(g, { from: 'waste' }, { kind: 'foundation', index: 0 }, [card('♠', 'A')]);
    expect(result.ok).toBe(true);
    expect(g.waste).toHaveLength(0);
    expect(g.foundations[0].map(c => c.id)).toEqual(['♠A']);
  });
});

describe('drawFromStock', () => {
  it('does nothing when stock and waste are both empty', () => {
    const g = rigged();
    expect(drawFromStock(g).ok).toBe(false);
    expect(g.moves).toBe(0);
  });

  it('moves one card face up to the waste', () => {
    const g = rigged({ stock: [card('♠', '2', false), card('♥', '3', false)] });
    const result = drawFromStock(g);
    expect(result.ok).toBe(true);
    expect(result.drawn).toBe('♥3');
    expect(result.recycled).toBe(false);
    expect(g.waste.map(c => c.id)).toEqual(['♥3']);
    expect(g.waste[0].faceUp).toBe(true);
    expect(g.stock).toHaveLength(1);
    expect(g.moves).toBe(1);
  });

  it('recycles the waste back into the stock face down and in reverse', () => {
    const g = rigged({ stock: [], waste: [card('♠', '2'), card('♥', '3'), card('♦', '4')] });
    const result = drawFromStock(g);
    expect(result.ok).toBe(true);
    expect(result.recycled).toBe(true);
    expect(result.drawn).toBe(null);
    expect(g.waste).toHaveLength(0);
    expect(g.stock.map(c => c.id)).toEqual(['♦4', '♥3', '♠2']);
    expect(g.stock.every(c => c.faceUp === false)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test`
Expected: FAIL — cannot resolve `./state.js`.

- [ ] **Step 3: Write `src/game/state.js`**

Deal loop ported from baseline `index.html:480-501`, snapshot/undo from `508-528`, move logic from `1035-1067`, stock draw from `789-809`. The behavioural change from the baseline is that `applyMove` returns the flipped card id instead of pushing to a module-level `pendingFlips` array, which is what keeps this module DOM-free.

```js
import { newDeck } from './deck.js';
import { canPlaceOnTableau, canPlaceOnFoundation } from './rules.js';

export const HISTORY_LIMIT = 200;

export function createGame(deck = newDeck()) {
  const cards = deck.slice();
  const tableau = [[], [], [], [], [], [], []];
  for (let i = 0; i < 7; i++) {
    for (let j = i; j < 7; j++) {
      const c = cards.pop();
      if (j === i) c.faceUp = true;
      tableau[j].push(c);
    }
  }
  return {
    tableau,
    foundations: [[], [], [], []],
    stock: cards,
    waste: [],
    moves: 0,
    history: [],
  };
}

export function snapshot(game) {
  game.history.push(JSON.parse(JSON.stringify({
    tableau: game.tableau,
    foundations: game.foundations,
    stock: game.stock,
    waste: game.waste,
    moves: game.moves,
  })));
  if (game.history.length > HISTORY_LIMIT) game.history.shift();
}

export function undo(game) {
  if (!game.history.length) return false;
  const prev = game.history.pop();
  game.tableau = prev.tableau;
  game.foundations = prev.foundations;
  game.stock = prev.stock;
  game.waste = prev.waste;
  game.moves = prev.moves;
  return true;
}

export function getMovingCards(game, from) {
  if (from.from === 'tableau') return game.tableau[from.fromIndex].slice(from.cardIndex);
  if (from.from === 'waste') return game.waste.slice(-1);
  if (from.from === 'foundation') return game.foundations[from.fromIndex].slice(-1);
  return [];
}

export function applyMove(game, from, to, cards) {
  if (to.kind === 'foundation') {
    if (cards.length !== 1) return { ok: false, flipped: null };
    if (!canPlaceOnFoundation(cards[0], game.foundations[to.index])) {
      return { ok: false, flipped: null };
    }
  } else if (to.kind === 'tableau') {
    if (!canPlaceOnTableau(cards[0], game.tableau[to.index])) {
      return { ok: false, flipped: null };
    }
  } else {
    return { ok: false, flipped: null };
  }

  if (from.from === to.kind && from.fromIndex === to.index) {
    return { ok: false, flipped: null };
  }

  snapshot(game);

  let flipped = null;
  if (from.from === 'tableau') {
    game.tableau[from.fromIndex].splice(from.cardIndex);
    const col = game.tableau[from.fromIndex];
    if (col.length && !col[col.length - 1].faceUp) {
      col[col.length - 1].faceUp = true;
      flipped = col[col.length - 1].id;
    }
  } else if (from.from === 'waste') {
    game.waste.pop();
  } else if (from.from === 'foundation') {
    game.foundations[from.fromIndex].pop();
  }

  if (to.kind === 'foundation') game.foundations[to.index].push(cards[0]);
  else game.tableau[to.index].push(...cards);

  game.moves++;
  return { ok: true, flipped };
}

export function drawFromStock(game) {
  if (!game.stock.length && !game.waste.length) {
    return { ok: false, drawn: null, recycled: false };
  }
  snapshot(game);
  let drawn = null;
  let recycled = false;
  if (!game.stock.length) {
    game.stock = game.waste.reverse().map(c => ({ ...c, faceUp: false }));
    game.waste = [];
    recycled = true;
  } else {
    const c = game.stock.pop();
    c.faceUp = true;
    game.waste.push(c);
    drawn = c.id;
  }
  game.moves++;
  return { ok: true, drawn, recycled };
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npm test`
Expected: PASS, all state tests green.

- [ ] **Step 5: Commit**

```bash
git add src/game/state.js src/game/state.test.js
git commit -m "Add game state, undo history, and move application"
```

---

## Task 4: Compact save serialization

**Files:**
- Create: `src/game/serialize.js`
- Test: `src/game/serialize.test.js`

**Interfaces:**
- Consumes: `SUIT_COLOR`, `RANKS` from `deck.js`
- Produces:
  - `SAVE_VERSION: number` — `1`
  - `serialize(game, now): Save` where `Save = { v, t: string[7], f: string[4], s: string, w: string, m: number, ts: number }`
  - `deserialize(save): Game | null` — returns `null` for anything malformed or from a different version. The returned game has an empty `history`.

Encoding: each card is two characters — rank (`A23456789TJQK`, `T` meaning 10) then suit (`SHDC`). A lowercase suit letter means face down. A full board is roughly 250 bytes.

- [ ] **Step 1: Write the failing test**

Create `src/game/serialize.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { serialize, deserialize, SAVE_VERSION } from './serialize.js';
import { createGame } from './state.js';
import { newDeck, SUIT_COLOR } from './deck.js';

const card = (suit, rank, faceUp = true) => ({
  suit, rank, color: SUIT_COLOR[suit], faceUp, id: suit + rank,
});

function stripHistory(game) {
  const { history, ...rest } = game;
  return rest;
}

describe('serialize / deserialize', () => {
  it('round-trips a freshly dealt game', () => {
    const game = createGame(newDeck(() => 0.5));
    const restored = deserialize(serialize(game, 1000));
    expect(stripHistory(restored)).toEqual(stripHistory(game));
  });

  it('round-trips an empty board', () => {
    const game = {
      tableau: [[], [], [], [], [], [], []],
      foundations: [[], [], [], []],
      stock: [], waste: [], moves: 0, history: [],
    };
    expect(stripHistory(deserialize(serialize(game, 1)))).toEqual(stripHistory(game));
  });

  it('round-trips a nearly-won board', () => {
    const game = {
      tableau: [[], [], [], [], [], [], []],
      foundations: [[card('♠', 'A')], [card('♥', 'A')], [], []],
      stock: [], waste: [card('♦', '10')], moves: 97, history: [],
    };
    const restored = deserialize(serialize(game, 5));
    expect(restored.waste[0].id).toBe('♦10');
    expect(restored.waste[0].rank).toBe('10');
    expect(restored.moves).toBe(97);
  });

  it('preserves face-up and face-down state', () => {
    const game = {
      tableau: [[card('♠', '4', false), card('♥', '9', true)], [], [], [], [], [], []],
      foundations: [[], [], [], []], stock: [], waste: [], moves: 0, history: [],
    };
    const restored = deserialize(serialize(game, 1));
    expect(restored.tableau[0][0].faceUp).toBe(false);
    expect(restored.tableau[0][1].faceUp).toBe(true);
  });

  it('restores the derived color and id fields', () => {
    const game = {
      tableau: [[card('♥', 'K')], [], [], [], [], [], []],
      foundations: [[], [], [], []], stock: [], waste: [], moves: 0, history: [],
    };
    const c = deserialize(serialize(game, 1)).tableau[0][0];
    expect(c.color).toBe('red');
    expect(c.id).toBe('♥K');
  });

  it('restores an empty history', () => {
    const game = createGame();
    expect(deserialize(serialize(game, 1)).history).toEqual([]);
  });

  it('stamps the version and timestamp', () => {
    const save = serialize(createGame(), 12345);
    expect(save.v).toBe(SAVE_VERSION);
    expect(save.ts).toBe(12345);
  });

  it('stays well under 2 KB for a full board', () => {
    const size = JSON.stringify(serialize(createGame(), 1)).length;
    expect(size).toBeLessThan(2048);
  });

  it('rejects null, a wrong version, and a missing body', () => {
    expect(deserialize(null)).toBe(null);
    expect(deserialize(undefined)).toBe(null);
    expect(deserialize({ v: 999, t: [], f: [], s: '', w: '', m: 0, ts: 0 })).toBe(null);
    expect(deserialize({ v: SAVE_VERSION })).toBe(null);
  });

  it('rejects malformed card data', () => {
    // Seven columns, so these reach decodePile rather than being rejected by
    // the shape check first.
    const withCol = first => ({
      v: SAVE_VERSION, t: [first, '', '', '', '', '', ''],
      f: ['', '', '', ''], s: '', w: '', m: 0, ts: 0,
    });
    expect(deserialize(withCol('ZZ'))).toBe(null);    // no such suit code
    expect(deserialize(withCol('♠K'))).toBe(null);    // suit where a rank belongs
    expect(deserialize(withCol('AS5'))).toBe(null);   // odd length
  });

  it('rejects a tableau that is not seven columns', () => {
    const save = serialize(createGame(), 1);
    save.t = save.t.slice(0, 5);
    expect(deserialize(save)).toBe(null);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test`
Expected: FAIL — cannot resolve `./serialize.js`.

- [ ] **Step 3: Write `src/game/serialize.js`**

```js
import { SUIT_COLOR, RANKS } from './deck.js';

export const SAVE_VERSION = 1;

const SUIT_CODE = { '♠': 'S', '♥': 'H', '♦': 'D', '♣': 'C' };
const CODE_SUIT = { S: '♠', H: '♥', D: '♦', C: '♣' };

// '10' is the only two-character rank; 'T' keeps every card exactly two chars.
const rankToCode = rank => (rank === '10' ? 'T' : rank);
const codeToRank = code => (code === 'T' ? '10' : code);

function encodePile(pile) {
  return pile.map(c => {
    const s = SUIT_CODE[c.suit];
    return rankToCode(c.rank) + (c.faceUp ? s : s.toLowerCase());
  }).join('');
}

function decodePile(str) {
  if (typeof str !== 'string' || str.length % 2 !== 0) throw new Error('bad pile');
  const out = [];
  for (let i = 0; i < str.length; i += 2) {
    const rankCode = str[i];
    const suitCode = str[i + 1];
    const rank = codeToRank(rankCode);
    const suit = CODE_SUIT[suitCode.toUpperCase()];
    if (!suit || !RANKS.includes(rank)) throw new Error('bad card');
    // An uppercase suit letter means face up.
    const faceUp = suitCode === suitCode.toUpperCase();
    out.push({ suit, rank, color: SUIT_COLOR[suit], faceUp, id: suit + rank });
  }
  return out;
}

export function serialize(game, now) {
  return {
    v: SAVE_VERSION,
    t: game.tableau.map(encodePile),
    f: game.foundations.map(encodePile),
    s: encodePile(game.stock),
    w: encodePile(game.waste),
    m: game.moves,
    ts: now,
  };
}

export function deserialize(save) {
  if (!save || save.v !== SAVE_VERSION) return null;
  if (!Array.isArray(save.t) || save.t.length !== 7) return null;
  if (!Array.isArray(save.f) || save.f.length !== 4) return null;
  try {
    return {
      tableau: save.t.map(decodePile),
      foundations: save.f.map(decodePile),
      stock: decodePile(save.s),
      waste: decodePile(save.w),
      moves: Number(save.m) || 0,
      history: [],
    };
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npm test`
Expected: PASS. Note the malformed-payload case `'♠K'` must fail because `♠` is not a valid rank code.

- [ ] **Step 5: Commit**

```bash
git add src/game/serialize.js src/game/serialize.test.js
git commit -m "Add compact save serialization"
```

---

## Task 5: HTML shell and CSS split

**Files:**
- Modify: `index.html` (replace entirely)
- Create: `src/styles/base.css`, `src/styles/layout.css`, `src/styles/card.css`, `src/styles/animations.css`

**Interfaces:**
- Consumes: nothing
- Produces: DOM contract used by every `ui/` module — `#board`, `#moves`, `#undo`, `#newgame`, `#win`, `#winStats`, `#winNew`, `#sync`

This task is a pure extraction. No behaviour changes, no new styles. Material realism arrives in Task 12.

- [ ] **Step 1: Replace `index.html` with the shell**

Changes from baseline: the inline `<style>` and `<script>` are gone, a `#sync` button and a Puter footer link are added, and the hidden moves counter is now visible.

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
<title>Solitaire</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/icon?family=Material+Symbols+Outlined" rel="stylesheet">
<script src="https://js.puter.com/v2/"></script>
</head>
<body>

<header>
  <div class="brand"><span class="dot"></span> Solitaire</div>
  <div class="stats">
    <span>Moves<b id="moves">0</b></span>
  </div>
  <div class="actions">
    <button class="btn" id="sync" title="Sync stats with Puter">
      <span class="material-symbols-outlined">cloud_off</span><span>Sync</span>
    </button>
    <button class="btn" id="undo" title="Undo">
      <span class="material-symbols-outlined">undo</span><span>Undo</span>
    </button>
    <button class="btn primary" id="newgame">
      <span class="material-symbols-outlined">refresh</span><span>New</span>
    </button>
  </div>
</header>

<main>
  <div id="board" data-mode="simple"></div>
</main>

<div id="win">
  <div class="win-card">
    <h2>You won</h2>
    <p id="winStats">Nicely done.</p>
    <button class="btn primary" id="winNew">
      <span class="material-symbols-outlined">refresh</span><span>Play again</span>
    </button>
  </div>
</div>

<footer class="credit">
  <a href="https://developer.puter.com" target="_blank" rel="noopener">Powered by Puter</a>
</footer>

<script type="module" src="/src/main.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create `src/styles/base.css`**

Port the `:root` block and the `*` / `html, body` rules verbatim from baseline `index.html:12-38`, then append the footer style below. Add these three new tokens inside `:root`, which later tasks depend on:

```css
  --card-radius: 8px;   /* overwritten per-frame by ui/layout.js */
  --card-tilt: 0deg;    /* overwritten per-card by ui/cardview.js */
  --back-color: #2c5e8f;
```

Append:

```css
footer.credit {
  position: fixed;
  bottom: 6px; right: 10px;
  font-size: 11px;
  z-index: 40;
}
footer.credit a {
  color: rgba(255, 255, 255, .35);
  text-decoration: none;
}
footer.credit a:hover { color: rgba(255, 255, 255, .7); }
```

- [ ] **Step 3: Create `src/styles/layout.css`**

Port verbatim from baseline: `header` through `button.btn .material-symbols-outlined` (`index.html:40-96`), `main` and `#board` (`98-110`), `.row` rules (`112-120`), `.slot` (`122-132`), `.pile` (`134-139`), `.stock-counter` (`342-349`), and the `@media (max-width: 700px)` block's header/main/stats/actions rules only (`384-388`).

**Do not port the card-face rules from inside the media query** (`index.html:392-396`). Those become mode-driven in `card.css` and would otherwise fight the new `data-mode` selectors.

- [ ] **Step 4: Create `src/styles/card.css`**

Port verbatim from baseline: `.card` (`141-155`), `.card.face-down` and its `::before` (`279-292`), `.card.face-up` (`293`), `.card .corner` rules (`294-307`), `.card .center-suit` (`308-316`), the colour rules (`317-319`), and `.card.draggable:hover`, `.card.selected`, `.card.dragging` (`321-333`).

**Do not port `.card.hint` or the `hintPulse` keyframes** (`334-340`) — the hint feature is deleted.

Then replace the fixed radius and add the mode rules:

```css
.card { border-radius: var(--card-radius); }

/* Simple mode: one corner index, nothing else. This is the small-screen
   card and it must stay exactly this plain. */
#board[data-mode="simple"] .card .corner.br,
#board[data-mode="simple"] .card .center-suit { display: none; }
#board[data-mode="simple"] .card .corner.tl { top: 4px; left: 5px; }
#board[data-mode="simple"] .card .corner .rank { font-size: 14px; }
#board[data-mode="simple"] .card .corner .suit { font-size: 12px; }
```

- [ ] **Step 5: Create `src/styles/animations.css`**

Port verbatim from baseline: the flip host rules and `cardFlipArc` / `cardFlipSpin` keyframes (`156-207`), the flying rules and `flyArc` / `flySpin` keyframes (`209-269`), the `.pile.drop-hover` rules (`270-278`), and the `#win` / `.win-card` / `winIn` block (`351-380`).

- [ ] **Step 6: Import the stylesheets from `src/main.js`**

Replace the placeholder body with:

```js
import './styles/base.css';
import './styles/layout.css';
import './styles/card.css';
import './styles/animations.css';

console.log('solitaire: styles loaded');
```

- [ ] **Step 7: Verify**

Run: `npm run dev`, open the page.
Expected: green felt background, header with Moves / Sync / Undo / New, an empty board area, and the "Powered by Puter" link bottom right. No cards yet. Console shows the log line and no errors.

- [ ] **Step 8: Commit**

```bash
git add index.html src/styles src/main.js
git commit -m "Split HTML shell and stylesheets out of the single file"
```

---

## Task 6: Layout sizing and render-mode selection

**Files:**
- Create: `src/ui/layout.js`, `src/ui/card-tilt.js`
- Test: `src/ui/layout.test.js`, `src/ui/card-tilt.test.js`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `RICH_MODE_MIN_CARD_W: number` — `76`
  - `computeSizes(boardWidth): { cardW, cardH, gap }`
  - `renderModeFor(cardW): 'rich' | 'simple'`
  - `cardRadiusFor(cardW): number`
  - `applySizes(rootEl, sizes): void` — writes `--card-w`, `--card-h`, `--gap`, `--card-radius`
  - `tiltFor(cardId): number` — degrees, deterministic, within ±0.6

- [ ] **Step 1: Write the failing tests**

Create `src/ui/layout.test.js`:

```js
import { describe, it, expect } from 'vitest';
import {
  computeSizes, renderModeFor, cardRadiusFor, RICH_MODE_MIN_CARD_W,
} from './layout.js';

describe('computeSizes', () => {
  it('fits seven cards plus six gaps into the board width', () => {
    const { cardW, gap } = computeSizes(980);
    expect(cardW * 7 + gap * 6).toBeCloseTo(980, 5);
  });

  it('keeps the locked 1:1.4 aspect ratio', () => {
    const { cardW, cardH } = computeSizes(980);
    expect(cardH).toBeCloseTo(cardW * 1.4, 5);
  });

  it('clamps the gap between 8 and 16', () => {
    expect(computeSizes(200).gap).toBe(8);
    expect(computeSizes(4000).gap).toBe(16);
    expect(computeSizes(700).gap).toBeCloseTo(700 * 0.018, 5);
  });

  it('never returns a negative card width for a tiny board', () => {
    expect(computeSizes(100).cardW).toBeGreaterThan(0);
  });
});

describe('renderModeFor', () => {
  it('is rich at and above the threshold', () => {
    expect(renderModeFor(RICH_MODE_MIN_CARD_W)).toBe('rich');
    expect(renderModeFor(RICH_MODE_MIN_CARD_W + 40)).toBe('rich');
  });

  it('is simple below the threshold', () => {
    expect(renderModeFor(RICH_MODE_MIN_CARD_W - 1)).toBe('simple');
    expect(renderModeFor(44)).toBe('simple');
  });

  it('stays simple at the width where court art was measured illegible', () => {
    // The probe showed courts as mush at 44px and barely readable at 56px.
    expect(renderModeFor(56)).toBe('simple');
  });
});

describe('cardRadiusFor', () => {
  it('scales with card width and stays inside 4..10', () => {
    expect(cardRadiusFor(40)).toBeGreaterThanOrEqual(4);
    expect(cardRadiusFor(1000)).toBeLessThanOrEqual(10);
    expect(cardRadiusFor(120)).toBeGreaterThan(cardRadiusFor(50));
  });
});
```

Create `src/ui/card-tilt.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { tiltFor } from './card-tilt.js';
import { newDeck } from '../game/deck.js';

describe('tiltFor', () => {
  it('is deterministic for the same id', () => {
    expect(tiltFor('♠K')).toBe(tiltFor('♠K'));
    expect(tiltFor('♦10')).toBe(tiltFor('♦10'));
  });

  it('stays within plus or minus 0.6 degrees', () => {
    for (const c of newDeck()) {
      expect(Math.abs(tiltFor(c.id))).toBeLessThanOrEqual(0.6);
    }
  });

  it('is never NaN, including for ids that hash negative', () => {
    for (const c of newDeck()) expect(Number.isNaN(tiltFor(c.id))).toBe(false);
  });

  it('gives different cards different tilts', () => {
    const values = new Set(newDeck().map(c => tiltFor(c.id)));
    expect(values.size).toBeGreaterThan(20);
  });

  it('returns 0 for an empty id', () => {
    expect(tiltFor('')).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npm test`
Expected: FAIL — cannot resolve `./layout.js` and `./card-tilt.js`.

- [ ] **Step 3: Write `src/ui/layout.js`**

Sizing ported from baseline `index.html:455-464`.

```js
export const RICH_MODE_MIN_CARD_W = 76;

export function computeSizes(boardWidth) {
  const gap = Math.max(8, Math.min(16, boardWidth * 0.018));
  const cardW = (boardWidth - gap * 6) / 7;
  return { cardW, cardH: cardW * 1.4, gap };
}

export function renderModeFor(cardW) {
  return cardW >= RICH_MODE_MIN_CARD_W ? 'rich' : 'simple';
}

export function cardRadiusFor(cardW) {
  return Math.max(4, Math.min(10, cardW * 0.075));
}

export function applySizes(rootEl, { cardW, cardH, gap }) {
  const s = rootEl.style;
  s.setProperty('--card-w', cardW + 'px');
  s.setProperty('--card-h', cardH + 'px');
  s.setProperty('--gap', gap + 'px');
  s.setProperty('--card-radius', cardRadiusFor(cardW) + 'px');
}
```

- [ ] **Step 4: Write `src/ui/card-tilt.js`**

The double modulo is deliberate: `h` is a signed 32-bit int, so a plain `h % 100` yields negative values for many ids and would tilt half the deck out of range.

```js
// Deterministic per-card tilt. Must never use Math.random(): render() rebuilds
// the whole board on every move, so a random value would make the entire deck
// twitch on every click.
export function tiltFor(cardId) {
  if (!cardId) return 0;
  let h = 0;
  for (let i = 0; i < cardId.length; i++) {
    h = (h * 31 + cardId.charCodeAt(i)) | 0;
  }
  const normalized = ((h % 100) + 100) % 100;  // 0..99, never negative
  return Number((((normalized / 99) - 0.5) * 1.2).toFixed(3));
}
```

- [ ] **Step 5: Run the tests and verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/ui/layout.js src/ui/layout.test.js src/ui/card-tilt.js src/ui/card-tilt.test.js
git commit -m "Add layout sizing, render-mode selection, and deterministic card tilt"
```

---

## Task 7: Card view

**Files:**
- Create: `src/ui/cardview.js`

**Interfaces:**
- Consumes: `tiltFor` from `./card-tilt.js`
- Produces:
  - `buildFrontFaceContent(card): string` — inner HTML for a face-up simple card
  - `cardEl(card, mode): HTMLElement` — a `.card` div; `mode` is `'rich'` or `'simple'`
  - `slotEl(iconName?): HTMLElement` — a `.slot` div

Rich mode is added in Task 11. For now `cardEl` ignores `mode` and always builds the simple face, so the game reaches parity before the art lands.

- [ ] **Step 1: Write `src/ui/cardview.js`**

Ported from baseline `index.html:574-636`, with the tilt and the `mode` parameter added.

```js
import { tiltFor } from './card-tilt.js';

export function buildFrontFaceContent(card) {
  return `
    <div class="corner tl"><div class="rank">${card.rank}</div><div class="suit">${card.suit}</div></div>
    <div class="corner br"><div class="rank">${card.rank}</div><div class="suit">${card.suit}</div></div>
    <div class="center-suit">${card.suit}</div>
  `;
}

function buildSimpleFace(el, card) {
  const tl = document.createElement('div');
  tl.className = 'corner tl';
  tl.innerHTML = `<div class="rank">${card.rank}</div><div class="suit">${card.suit}</div>`;
  const br = document.createElement('div');
  br.className = 'corner br';
  br.innerHTML = `<div class="rank">${card.rank}</div><div class="suit">${card.suit}</div>`;
  const center = document.createElement('div');
  center.className = 'center-suit';
  center.textContent = card.suit;
  el.append(tl, br, center);
}

export function cardEl(card, mode = 'simple') {
  const el = document.createElement('div');
  el.className = 'card ' + (card.faceUp ? 'face-up ' + card.color : 'face-down');
  el.dataset.id = card.id;
  el.style.setProperty('--card-tilt', tiltFor(card.id) + 'deg');
  if (card.faceUp) buildSimpleFace(el, card);
  return el;
}

export function slotEl(iconName) {
  const slot = document.createElement('div');
  slot.className = 'slot';
  if (iconName) {
    slot.innerHTML = `<span class="material-symbols-outlined">${iconName}</span>`;
  }
  return slot;
}
```

- [ ] **Step 2: Verify it imports cleanly**

Run: `npm test`
Expected: PASS — existing tests still green, nothing new broken.

- [ ] **Step 3: Commit**

```bash
git add src/ui/cardview.js
git commit -m "Add card view module"
```

---

## Task 8: Board rendering

**Files:**
- Create: `src/ui/board.js`

**Interfaces:**
- Consumes: `computeSizes`, `applySizes`, `renderModeFor` from `./layout.js`; `cardEl`, `slotEl` from `./cardview.js`
- Produces:
  - `render(ctx): void` where
    `ctx = { boardEl, game, hooks: { attachDrag(el, info), attachStockTap(pileEl), afterCard(el, card, pileEl) } }`

`board.js` must not import `drag.js` or `animate.js` — it reaches them only through `hooks`, which `main.js` supplies. This is the import cycle the spec calls out.

- [ ] **Step 1: Write `src/ui/board.js`**

Ported from baseline `index.html:638-768`, with globals replaced by `ctx` and the pending-flip / pending-flight calls replaced by the single `hooks.afterCard`.

```js
import { computeSizes, applySizes, renderModeFor } from './layout.js';
import { cardEl, slotEl } from './cardview.js';

function makePile(kind, index) {
  const p = document.createElement('div');
  p.className = 'pile';
  p.dataset.kind = kind;
  p.dataset.index = index;
  return p;
}

export function render(ctx) {
  const { boardEl, game, hooks } = ctx;

  const sizes = computeSizes(boardEl.clientWidth);
  applySizes(document.documentElement, sizes);
  const mode = renderModeFor(sizes.cardW);
  boardEl.dataset.mode = mode;

  boardEl.innerHTML = '';

  const top = document.createElement('div');
  top.className = 'row top';
  boardEl.appendChild(top);

  // Stock
  const stockPile = makePile('stock', 0);
  if (game.stock.length === 0) {
    stockPile.appendChild(slotEl(game.waste.length ? 'refresh' : 'block'));
  } else {
    game.stock.slice(-Math.min(3, game.stock.length)).forEach(c => {
      stockPile.appendChild(cardEl({ ...c, faceUp: false }, mode));
    });
  }
  hooks.attachStockTap(stockPile);
  if (game.stock.length) {
    const counter = document.createElement('div');
    counter.className = 'stock-counter';
    counter.textContent = game.stock.length;
    stockPile.appendChild(counter);
  }
  top.appendChild(stockPile);

  // Waste — last few fanned right so the pile reads as a stack
  const wastePile = makePile('waste', 0);
  if (!game.waste.length) {
    wastePile.appendChild(slotEl());
  } else {
    const fanX = Math.max(6, sizes.cardW * 0.10);
    const visible = game.waste.slice(-3);
    const startIdx = game.waste.length - visible.length;
    let topCardEl = null;
    let topCard = null;
    visible.forEach((c, i) => {
      const e = cardEl(c, mode);
      e.style.left = (i * fanX) + 'px';
      if (i === visible.length - 1) {
        hooks.attachDrag(e, { from: 'waste', fromIndex: startIdx + i });
        topCardEl = e;
        topCard = c;
      } else {
        e.style.pointerEvents = 'none';
      }
      wastePile.appendChild(e);
    });
    if (topCardEl) hooks.afterCard(topCardEl, topCard, wastePile);
  }
  top.appendChild(wastePile);

  top.appendChild(document.createElement('div')); // spacer

  // Foundations
  for (let i = 0; i < 4; i++) {
    const fp = makePile('foundation', i);
    const pile = game.foundations[i];
    if (!pile.length) {
      fp.appendChild(slotEl('star'));
    } else {
      const last = pile[pile.length - 1];
      const e = cardEl(last, mode);
      hooks.attachDrag(e, { from: 'foundation', fromIndex: i });
      fp.appendChild(e);
    }
    top.appendChild(fp);
  }

  // Tableau
  const tab = document.createElement('div');
  tab.className = 'row tableau';
  boardEl.appendChild(tab);

  const fanFaceDown = Math.max(10, sizes.cardH * 0.10);
  const fanFaceUp = Math.max(18, sizes.cardH * 0.22);

  for (let i = 0; i < 7; i++) {
    const pile = makePile('tableau', i);
    pile.classList.add('tableau');
    const col = game.tableau[i];
    if (!col.length) {
      pile.appendChild(slotEl());
    } else {
      let offset = 0;
      col.forEach((c, idx) => {
        const e = cardEl(c, mode);
        e.style.top = offset + 'px';
        pile.appendChild(e);
        if (c.faceUp) hooks.attachDrag(e, { from: 'tableau', fromIndex: i, cardIndex: idx });
        hooks.afterCard(e, c, pile);
        offset += c.faceUp ? fanFaceUp : fanFaceDown;
      });
      pile.style.height = (offset + sizes.cardH) + 'px';
    }
    tab.appendChild(pile);
  }
}

export { makePile };
```

- [ ] **Step 2: Verify nothing regressed**

Run: `npm test`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/ui/board.js
git commit -m "Add board rendering module"
```

---

## Task 9: Drag and drop

**Files:**
- Create: `src/ui/drag.js`
- Test: `src/ui/drag.test.js`

**Interfaces:**
- Consumes: `getMovingCards`, `applyMove` from `../game/state.js`; `canPlaceOnTableau`, `canPlaceOnFoundation` from `../game/rules.js`; `cardEl` from `./cardview.js`
- Produces:
  - `DRAG_THRESHOLD: number` — `6`
  - `DROP_TOLERANCE: number` — `50`
  - `pickDropTarget(point, ghostRect, piles): { kind, index } | null` — pure; `piles` is `[{ kind, index, rect: { left, right, top, bottom } }]`
  - `createDragController({ boardEl, getGame, requestRender, onMoveApplied }): { attachDrag, attachStockTap }`

`onMoveApplied({ flipped })` fires after any successful move so `main.js` can queue a flip animation, bump stats, and check the win.

- [ ] **Step 1: Write the failing test for the pure picker**

Create `src/ui/drag.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { pickDropTarget, DROP_TOLERANCE } from './drag.js';

const rect = (left, top, w, h) => ({ left, top, right: left + w, bottom: top + h });

const PILES = [
  { kind: 'foundation', index: 0, rect: rect(0, 0, 100, 140) },
  { kind: 'foundation', index: 1, rect: rect(120, 0, 100, 140) },
  { kind: 'tableau', index: 0, rect: rect(0, 200, 100, 400) },
  { kind: 'tableau', index: 1, rect: rect(120, 200, 100, 400) },
];

describe('pickDropTarget', () => {
  it('returns the pile directly under the pointer', () => {
    expect(pickDropTarget({ x: 50, y: 70 }, null, PILES))
      .toEqual({ kind: 'foundation', index: 0 });
    expect(pickDropTarget({ x: 150, y: 300 }, null, PILES))
      .toEqual({ kind: 'tableau', index: 1 });
  });

  it('returns null when the pointer is far from everything and there is no ghost', () => {
    expect(pickDropTarget({ x: 900, y: 900 }, null, PILES)).toBe(null);
  });

  it('falls back to the pile with the largest ghost overlap', () => {
    const ghost = rect(105, 190, 100, 140); // straddles both tableau columns
    const target = pickDropTarget({ x: 900, y: 900 }, ghost, PILES);
    expect(target).toEqual({ kind: 'tableau', index: 1 });
  });

  it('falls back to the nearest pile within the tolerance', () => {
    // In the 20px gutter between the two foundations: 5px from foundation 0,
    // 15px from foundation 1, inside neither. Keep it in the gutter — anything
    // past x=120 lands inside foundation 1 and becomes a direct hit instead.
    expect(pickDropTarget({ x: 105, y: 70 }, null, PILES))
      .toEqual({ kind: 'foundation', index: 0 });
  });

  it('ignores every pile beyond the tolerance', () => {
    // 300px below the tableau columns — far outside DROP_TOLERANCE of anything.
    expect(pickDropTarget({ x: 105, y: 900 }, null, PILES)).toBe(null);
  });

  it('returns null for an empty pile list', () => {
    expect(pickDropTarget({ x: 10, y: 10 }, null, [])).toBe(null);
  });

  it('prefers the smaller pile when two directly contain the pointer', () => {
    const overlapping = [
      { kind: 'tableau', index: 0, rect: rect(0, 0, 400, 400) },
      { kind: 'foundation', index: 0, rect: rect(0, 0, 100, 140) },
    ];
    expect(pickDropTarget({ x: 50, y: 50 }, null, overlapping))
      .toEqual({ kind: 'foundation', index: 0 });
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test`
Expected: FAIL — cannot resolve `./drag.js`.

- [ ] **Step 3: Write `src/ui/drag.js`**

`pickDropTarget` is the baseline's `findDropTarget` (`index.html:986-1033`) with DOM queries lifted out so it can be tested. The controller is ported from `index.html:773-786` and `827-984`; `autoMove` from `1069-1097`.

```js
import { getMovingCards, applyMove } from '../game/state.js';
import { canPlaceOnTableau, canPlaceOnFoundation } from '../game/rules.js';
import { cardEl } from './cardview.js';

export const DRAG_THRESHOLD = 6;   // px before a press counts as a drag, not a click
export const DROP_TOLERANCE = 50;  // px of slack when the cursor misses every pile

// Pure. Three tiers, most specific first: direct cursor hit (smallest pile wins),
// then largest overlap with the dragged ghost, then nearest pile within tolerance.
export function pickDropTarget(point, ghostRect, piles) {
  const { x, y } = point;
  let direct = null;
  let directArea = Infinity;
  let overlapBest = null;
  let overlapBestArea = 0;
  let nearBest = null;
  let nearBestDist = Infinity;

  for (const { kind, index, rect } of piles) {
    if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
      const area = (rect.right - rect.left) * (rect.bottom - rect.top);
      if (area < directArea) { direct = { kind, index }; directArea = area; }
      continue;
    }
    if (ghostRect) {
      const ox = Math.max(0, Math.min(rect.right, ghostRect.right) - Math.max(rect.left, ghostRect.left));
      const oy = Math.max(0, Math.min(rect.bottom, ghostRect.bottom) - Math.max(rect.top, ghostRect.top));
      const area = ox * oy;
      if (area > overlapBestArea) { overlapBestArea = area; overlapBest = { kind, index }; }
      if (area > 0) continue;
    }
    const cx = Math.max(rect.left, Math.min(x, rect.right));
    const cy = Math.max(rect.top, Math.min(y, rect.bottom));
    const d = Math.hypot(x - cx, y - cy);
    if (d < DROP_TOLERANCE && d < nearBestDist) { nearBestDist = d; nearBest = { kind, index }; }
  }
  return direct || overlapBest || nearBest;
}

export function createDragController({ boardEl, getGame, requestRender, onMoveApplied }) {
  let dragging = null;

  function collectPiles() {
    return [...boardEl.querySelectorAll('.pile')]
      .filter(p => p.dataset.kind !== 'stock' && p.dataset.kind !== 'waste')
      .map(p => {
        const r = p.getBoundingClientRect();
        const rect = { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
        if (p.dataset.kind === 'tableau') rect.bottom = r.top + p.offsetHeight;
        return { kind: p.dataset.kind, index: parseInt(p.dataset.index, 10), rect };
      });
  }

  function findDropTarget(x, y) {
    const ghostRect = dragging && dragging.ghost && dragging.moved
      ? dragging.ghost.getBoundingClientRect() : null;
    return pickDropTarget({ x, y }, ghostRect, collectPiles());
  }

  function commit(from, to, cards) {
    const result = applyMove(getGame(), from, to, cards);
    if (result.ok) onMoveApplied(result);
    return result.ok;
  }

  function autoMove(info) {
    const game = getGame();
    const cards = getMovingCards(game, info);
    if (!cards.length) return false;
    if (cards.length === 1) {
      for (let i = 0; i < 4; i++) {
        if (canPlaceOnFoundation(cards[0], game.foundations[i])
          && commit(info, { kind: 'foundation', index: i }, cards)) return true;
      }
    }
    for (let i = 0; i < 7; i++) {
      if (info.from === 'tableau' && info.fromIndex === i) continue;
      if (canPlaceOnTableau(cards[0], game.tableau[i])
        && commit(info, { kind: 'tableau', index: i }, cards)) return true;
    }
    return false;
  }

  function updateDropHover(x, y) {
    boardEl.querySelectorAll('.pile.drop-hover').forEach(p => p.classList.remove('drop-hover'));
    if (!dragging) return;
    const drop = findDropTarget(x, y);
    if (!drop) return;
    const game = getGame();
    const cards = dragging.cards;
    const ok = (drop.kind === 'foundation' && cards.length === 1
        && canPlaceOnFoundation(cards[0], game.foundations[drop.index]))
      || (drop.kind === 'tableau' && canPlaceOnTableau(cards[0], game.tableau[drop.index]));
    if (!ok) return;
    const pile = boardEl.querySelector(
      `.pile[data-kind="${drop.kind}"][data-index="${drop.index}"]`);
    if (pile) pile.classList.add('drop-hover');
  }

  function beginDragVisual() {
    if (!dragging || dragging.moved) return;
    dragging.moved = true;
    dragging.ghost.style.visibility = '';
    const info = dragging.info;
    if (info.from === 'tableau') {
      const col = getGame().tableau[info.fromIndex];
      const pile = boardEl.querySelector(
        `.pile[data-kind="tableau"][data-index="${info.fromIndex}"]`);
      const cardEls = pile.querySelectorAll('.card');
      for (let i = info.cardIndex; i < col.length; i++) {
        if (cardEls[i]) cardEls[i].style.visibility = 'hidden';
      }
    } else if (dragging.startEl) {
      dragging.startEl.style.visibility = 'hidden';
    }
  }

  function onPointerMove(ev) {
    if (!dragging) return;
    if (!dragging.moved) {
      const dx = ev.clientX - dragging.startX;
      const dy = ev.clientY - dragging.startY;
      if ((dx * dx + dy * dy) < DRAG_THRESHOLD * DRAG_THRESHOLD) return;
      beginDragVisual();
    }
    dragging.ghost.style.left = (ev.clientX - dragging.offsetX) + 'px';
    dragging.ghost.style.top = (ev.clientY - dragging.offsetY) + 'px';
    updateDropHover(ev.clientX, ev.clientY);
  }

  function onPointerUp(ev) {
    boardEl.querySelectorAll('.pile.drop-hover').forEach(p => p.classList.remove('drop-hover'));
    document.removeEventListener('pointermove', onPointerMove);
    if (!dragging) return;

    const drop = findDropTarget(ev.clientX, ev.clientY);
    if (drop && dragging.moved) commit(dragging.info, drop, dragging.cards);
    else if (!dragging.moved) autoMove(dragging.info);

    dragging.ghost.remove();
    document.querySelectorAll('.card').forEach(c => { c.style.visibility = ''; });
    dragging = null;
    requestRender();
  }

  // A cancelled drag (window switch, browser gesture) must tear down and
  // re-render, or the hidden source cards stay invisible and undraggable.
  function onPointerCancel() {
    document.removeEventListener('pointermove', onPointerMove);
    if (!dragging) return;
    if (dragging.ghost) dragging.ghost.remove();
    dragging = null;
    requestRender();
  }

  function onPointerDown(ev, el, info) {
    if (ev.button !== 0) return;
    const game = getGame();
    const cards = getMovingCards(game, info);
    if (!cards.length || !cards[0].faceUp) return;

    const rect = el.getBoundingClientRect();
    const cardH = parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue('--card-h'));
    const fanFaceUp = Math.max(18, cardH * 0.22);
    const mode = boardEl.dataset.mode;

    const ghost = document.createElement('div');
    ghost.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.top}px;`
      + `width:${rect.width}px;pointer-events:none;z-index:1000;`;

    cards.forEach((c, idx) => {
      const ce = cardEl(c, mode);
      ce.style.position = 'absolute';
      ce.style.top = (idx * fanFaceUp) + 'px';
      ce.style.left = '0';
      ce.style.width = '100%';
      ce.style.height = cardH + 'px';
      ce.classList.add('dragging');
      ghost.appendChild(ce);
    });

    document.body.appendChild(ghost);
    // Hidden until the pointer crosses the threshold; until then a release is a click.
    ghost.style.visibility = 'hidden';

    dragging = {
      cards, info, ghost,
      offsetX: ev.clientX - rect.left,
      offsetY: ev.clientY - rect.top,
      startX: ev.clientX, startY: ev.clientY,
      moved: false, startEl: el,
    };

    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp, { once: true });
    document.addEventListener('pointercancel', onPointerCancel, { once: true });
    ev.preventDefault();
  }

  function attachDrag(el, info) {
    el.classList.add('draggable');
    el.addEventListener('pointerdown', ev => onPointerDown(ev, el, info));
    el.addEventListener('dblclick', () => { if (autoMove(info)) requestRender(); });
  }

  // Pointer-based rather than click: the board calls preventDefault() on
  // pointerdown, so mobile browsers defer the synthetic click on first tap.
  function attachStockTap(el) {
    let downX = null;
    let downY = null;
    el.addEventListener('pointerdown', e => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      downX = e.clientX; downY = e.clientY;
      e.preventDefault();
    });
    el.addEventListener('pointerup', e => {
      if (downX == null) return;
      const moved = Math.hypot(e.clientX - downX, e.clientY - downY);
      downX = null;
      if (moved < DRAG_THRESHOLD) el.dispatchEvent(
        new CustomEvent('stock-tap', { bubbles: true }));
    });
    el.addEventListener('pointercancel', () => { downX = null; });
  }

  return { attachDrag, attachStockTap };
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npm test`
Expected: PASS, 7 `pickDropTarget` tests green.

- [ ] **Step 5: Commit**

```bash
git add src/ui/drag.js src/ui/drag.test.js
git commit -m "Add drag and drop with a testable drop-target picker"
```

---

## Task 10: Animations, wiring, and parity checkpoint

**Files:**
- Create: `src/ui/animate.js`
- Modify: `src/main.js`

**Interfaces:**
- Consumes: `buildFrontFaceContent`, `cardEl` from `./cardview.js`; `SUITS`, `RANKS`, `SUIT_COLOR` from `../game/deck.js`; `computeSizes` from `./layout.js`
- Produces:
  - `createAnimator({ boardEl }): { afterCard, queueFlip, queueFlight, startCelebration, cancelCelebration }`
    - `queueFlip(cardId)` — next render animates that card's reveal
    - `queueFlight(cardId, sourceRect)` — next render flies that card from `sourceRect`
    - `afterCard(el, card, pileEl)` — called by `board.js` for every rendered card
    - `startCelebration(onDone)` / `cancelCelebration()`

This task ends with the game fully playable and at feature parity with the baseline, minus the deleted hint.

- [ ] **Step 1: Write `src/ui/animate.js`**

Ported from baseline: `applyPendingFlight` (`531-572`), `applyPendingFlip` (`583-617`), and the celebration (`1159-1270`). Module-level `pendingFlips` / `pendingFlight` become closure state.

Keep the manual `removeEventListener` in both handlers rather than `{ once: true }` — the inner `.flipper`'s animation end bubbles to the card and would consume a once-listener early, leaving the card stuck with `pointer-events: none` and undraggable.

```js
import { buildFrontFaceContent } from './cardview.js';
import { SUITS, RANKS, SUIT_COLOR } from '../game/deck.js';
import { computeSizes } from './layout.js';

function buildFlipper(card) {
  const flipper = document.createElement('div');
  flipper.className = 'flipper';
  const back = document.createElement('div');
  back.className = 'face back';
  const front = document.createElement('div');
  front.className = 'face front ' + card.color;
  front.innerHTML = buildFrontFaceContent(card);
  flipper.append(back, front);
  return flipper;
}

export function createAnimator({ boardEl }) {
  let pendingFlips = [];
  let pendingFlight = null;
  let celebration = null;

  function applyFlight(el, card) {
    if (!pendingFlight || pendingFlight.cardId !== card.id) return;
    const src = pendingFlight.sourceRect;
    pendingFlight = null;

    const destRect = el.getBoundingClientRect();
    const originalHTML = el.innerHTML;
    const originalClass = el.className;
    const originalStyle = el.getAttribute('style') || '';

    el.innerHTML = '';
    el.className = 'card flying';
    el.style.setProperty('--fly-dx', (src.left - destRect.left) + 'px');
    el.style.setProperty('--fly-dy', (src.top - destRect.top) + 'px');
    el.appendChild(buildFlipper(card));

    const onEnd = ev => {
      if (ev.target !== el) return;
      el.removeEventListener('animationend', onEnd);
      el.className = originalClass;
      el.setAttribute('style', originalStyle);
      el.innerHTML = originalHTML;
    };
    el.addEventListener('animationend', onEnd);
  }

  function applyFlip(el, card) {
    const i = pendingFlips.indexOf(card.id);
    if (i === -1) return;
    pendingFlips.splice(i, 1);

    const originalHTML = el.innerHTML;
    const originalClass = el.className;

    el.innerHTML = '';
    el.className = 'card flip-host';
    el.appendChild(buildFlipper(card));

    const onEnd = ev => {
      if (ev.target !== el) return;
      el.removeEventListener('animationend', onEnd);
      el.className = originalClass;
      el.innerHTML = originalHTML;
    };
    el.addEventListener('animationend', onEnd);
  }

  function afterCard(el, card, pileEl) {
    if (!card) return;
    if (pendingFlips.length) applyFlip(el, card);
    if (pendingFlight && pendingFlight.cardId === card.id) {
      // Defer until the pile is in the DOM, or getBoundingClientRect() on the
      // destination returns (0,0) and the card flies in from the viewport corner.
      requestAnimationFrame(() => applyFlight(el, card, pileEl));
    }
  }

  function cancelCelebration() {
    if (!celebration) return;
    if (celebration.launchTimer) clearInterval(celebration.launchTimer);
    if (celebration.overlayTimer) clearTimeout(celebration.overlayTimer);
    cancelAnimationFrame(celebration.rafId);
    for (const c of celebration.clones) c.remove();
    celebration = null;
  }

  function startCelebration(onDone) {
    if (celebration) return;

    const queues = SUITS.map(() => ({ rank: 0 }));
    const { cardW, cardH } = computeSizes(boardEl.clientWidth);
    const W = window.innerWidth;
    const H = window.innerHeight;
    const clones = [];
    let qi = 0;

    celebration = { rafId: 0, launchTimer: 0, overlayTimer: 0, clones, lastT: 0 };

    function launchOne() {
      let guard = 0;
      while (guard++ < SUITS.length && queues[qi].rank >= RANKS.length) {
        qi = (qi + 1) % SUITS.length;
      }
      if (guard > SUITS.length) return false;
      const s = qi;
      const r = queues[qi].rank;
      queues[qi].rank++;
      qi = (qi + 1) % SUITS.length;

      const slot = boardEl.querySelector(`.pile[data-kind="foundation"][data-index="${s}"]`);
      if (!slot) return false;
      const rect = slot.getBoundingClientRect();
      slot.style.opacity = '0';

      const suit = SUITS[s];
      const rank = RANKS[r];
      const c = { suit, rank, color: SUIT_COLOR[suit], faceUp: true, id: suit + rank };
      const clone = document.createElement('div');
      clone.className = 'card face-up ' + c.color;
      clone.style.cssText = 'position:fixed;z-index:60;pointer-events:none;'
        + `left:${rect.left}px;top:${rect.top}px;`
        + `width:${rect.width}px;height:${rect.height}px;margin:0;`;
      clone.innerHTML = buildFrontFaceContent(c);
      document.body.appendChild(clone);
      clones.push(clone);

      const angle = Math.random() * Math.PI * 2;
      const speed = Math.max(W, H) * (0.0008 + Math.random() * 0.0007);
      clone._x = rect.left;
      clone._y = rect.top;
      clone._vx = Math.cos(angle) * speed;
      clone._vy = Math.sin(angle) * speed;
      clone._rot = Math.random() * 360;
      clone._vr = (Math.random() * 2 - 1) * 0.45;
      clone._born = performance.now();
      clone._life = 1500 + Math.random() * 700;
      clone._alive = true;
      return true;
    }

    for (let i = 0; i < SUITS.length; i++) launchOne();
    celebration.launchTimer = setInterval(() => {
      if (!launchOne()) {
        clearInterval(celebration.launchTimer);
        celebration.launchTimer = 0;
      }
    }, 80);

    const MARGIN = 200;
    function frame(now) {
      if (!celebration) return;
      const dt = Math.min(34, celebration.lastT ? now - celebration.lastT : 16);
      celebration.lastT = now;
      let anyAlive = false;
      for (const c of clones) {
        if (!c._alive) continue;
        const age = now - c._born;
        c._x += c._vx * dt;
        c._y += c._vy * dt;
        c._rot += c._vr * dt;
        const fadeStart = c._life - 350;
        c.style.opacity = age > fadeStart ? Math.max(0, 1 - (age - fadeStart) / 350) : 1;
        c.style.transform = `translate3d(${c._x - c.offsetLeft}px,${c._y - c.offsetTop}px,0) `
          + `rotate(${c._rot}deg)`;
        const offScreen = c._x + cardW < -MARGIN || c._x > W + MARGIN
          || c._y + cardH < -MARGIN || c._y > H + MARGIN;
        if (offScreen || age > c._life) { c._alive = false; c.remove(); }
        else anyAlive = true;
      }
      if (anyAlive || celebration.launchTimer) {
        celebration.rafId = requestAnimationFrame(frame);
      } else {
        cancelCelebration();
        onDone();
      }
    }
    celebration.rafId = requestAnimationFrame(frame);

    // Safety: never leave the board hidden if something goes sideways.
    celebration.overlayTimer = setTimeout(() => {
      if (celebration) { cancelCelebration(); onDone(); }
    }, 14000);
  }

  return {
    afterCard,
    queueFlip: id => { if (id) pendingFlips.push(id); },
    queueFlight: (id, sourceRect) => { pendingFlight = { cardId: id, sourceRect }; },
    startCelebration,
    cancelCelebration,
  };
}
```

- [ ] **Step 2: Write `src/main.js`**

`main.js` owns `requestRender` and passes it to the controllers, which is what keeps `board.js` and `drag.js` from importing each other.

```js
import './styles/base.css';
import './styles/layout.css';
import './styles/card.css';
import './styles/animations.css';

import { createGame, undo, drawFromStock } from './game/state.js';
import { isWon } from './game/rules.js';
import { render } from './ui/board.js';
import { createDragController } from './ui/drag.js';
import { createAnimator } from './ui/animate.js';

const boardEl = document.getElementById('board');
const movesEl = document.getElementById('moves');
const winEl = document.getElementById('win');
const winStatsEl = document.getElementById('winStats');

let game = createGame();

const animator = createAnimator({ boardEl });

function updateStats() {
  movesEl.textContent = game.moves;
}

function requestRender() {
  render({
    boardEl,
    game,
    hooks: {
      attachDrag: (el, info) => drag.attachDrag(el, info),
      attachStockTap: el => drag.attachStockTap(el),
      afterCard: animator.afterCard,
    },
  });
  updateStats();
}

function checkWin() {
  if (isWon(game)) animator.startCelebration(showWin);
}

function showWin() {
  winStatsEl.textContent = `${game.moves} moves. Nicely done.`;
  winEl.classList.add('show');
}

const drag = createDragController({
  boardEl,
  getGame: () => game,
  requestRender,
  onMoveApplied: ({ flipped }) => {
    animator.queueFlip(flipped);
    checkWin();
  },
});

function onStockTap() {
  const stockPileEl = boardEl.querySelector('.pile[data-kind="stock"]');
  const srcRect = stockPileEl ? stockPileEl.getBoundingClientRect() : null;
  const result = drawFromStock(game);
  if (!result.ok) return;
  if (result.drawn && srcRect) animator.queueFlight(result.drawn, srcRect);
  requestRender();
}

function newGame() {
  animator.cancelCelebration();
  game = createGame();
  winEl.classList.remove('show');
  requestRender();
}

boardEl.addEventListener('stock-tap', onStockTap);
document.getElementById('newgame').onclick = newGame;
document.getElementById('winNew').onclick = newGame;
document.getElementById('undo').onclick = () => { if (undo(game)) requestRender(); };

window.addEventListener('resize', requestRender);
window.addEventListener('keydown', e => {
  if (e.key === 'z' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); if (undo(game)) requestRender(); }
  if (e.key === 'n') newGame();
});

requestRender();
```

- [ ] **Step 3: Verify parity by playing the game**

Run: `npm run dev` and check every one of these:

- Cards deal into seven columns, 1 through 7, last of each face up.
- Clicking the stock flies a card to the waste with the spin animation.
- Emptying the stock then clicking shows the recycle icon and refills it.
- Dragging a card to a valid pile works; the target highlights blue while hovering.
- Dragging to an invalid pile snaps back.
- Dragging a multi-card stack from mid-column moves the whole stack.
- Uncovering a face-down tableau card plays the flip animation.
- Single click on a card auto-moves it to a foundation when legal.
- Double click auto-moves.
- Undo button and Cmd/Ctrl+Z step back; `n` starts a new game.
- Moves counter increments.
- Resizing the window re-lays out without breaking.
- Console is clean.

Run: `npm test` — expected PASS.

- [ ] **Step 4: Commit**

```bash
git add src/ui/animate.js src/main.js
git commit -m "Add animations and bootstrap wiring, restoring full game parity"
```

---

## Task 11: Vendored card art and rich mode

**Files:**
- Create: `src/vendor/cardmeister.js`, `src/vendor/README.md`
- Modify: `src/ui/cardview.js`, `src/main.js`, `src/styles/card.css`

**Interfaces:**
- Consumes: the `<playing-card>` custom element registered by the vendored file
- Produces: `cardEl(card, 'rich')` returns a `.card` wrapping a `<playing-card>`

- [ ] **Step 1: Vendor the card art**

```bash
mkdir -p src/vendor
curl -sL -o src/vendor/cardmeister.js \
  https://raw.githubusercontent.com/cardmeister/cardmeister.github.io/master/elements.cardmeister.min.js
wc -c src/vendor/cardmeister.js   # expect roughly 27000
```

Prepend this provenance header to `src/vendor/cardmeister.js`. The Unlicense does not require attribution, but a vendored third-party file in an org repo should say where it came from.

```js
/*
 * CardMeister — 52 SVG playing cards as a <playing-card> custom element.
 * Source:  https://github.com/cardmeister/cardmeister.github.io
 * Author:  Danny Engelman
 * License: The Unlicense (public domain) — https://unlicense.org
 *
 * Card artwork derives from Adrian Kennard's CC0 playing cards
 * (https://www.me.uk/cards/), optimised by the CardMeister author.
 *
 * Vendored unmodified apart from this header. Do not reformat: the file is
 * hand-minified and a formatter will not improve it.
 */
```

- [ ] **Step 2: Write `src/vendor/README.md`**

```markdown
# Vendored dependencies

## cardmeister.js

52 SVG playing cards plus a card back, as a `<playing-card>` custom element.

- Upstream: https://github.com/cardmeister/cardmeister.github.io
- License: The Unlicense (public domain)
- Artwork lineage: Adrian Kennard's CC0 cards (https://www.me.uk/cards/),
  optimised by Danny Engelman.

Vendored rather than installed from npm because it is a single self-contained
file with no dependencies and no active release cadence.

### Integration constraints, measured

- The SVG **preserves aspect ratio**. In a box that is not the card's native
  ratio it letterboxes rather than stretching. Keep card boxes at 1:1.4.
- `borderline="0"` does **not** suppress its own border. Set `bordercolor` to
  the card colour instead.
- Court cards are illegible below roughly 56px wide. This is why the game
  falls back to a plain corner-index card under 76px.
```

- [ ] **Step 3: Add rich mode to `src/ui/cardview.js`**

Add the import at the top of the file:

```js
import '../vendor/cardmeister.js';
```

The vendored element uses `S H D C` suit letters and `10` for ten, so map from the game's Unicode suits:

```js
const CID_SUIT = { '♠': 'S', '♥': 'H', '♦': 'D', '♣': 'C' };

export function cidFor(card) {
  return card.rank + CID_SUIT[card.suit];
}

function buildRichFace(el, card) {
  const pc = document.createElement('playing-card');
  pc.setAttribute('cid', cidFor(card));
  // Its own border cannot be turned off with borderline=0; matching it to the
  // card colour hides it so our wrapper draws the only visible edge.
  pc.setAttribute('bordercolor', '#fdfdfd');
  el.appendChild(pc);
}

function buildRichBack(el) {
  const pc = document.createElement('playing-card');
  pc.setAttribute('cid', 'back');
  pc.setAttribute('backcolor', '#2c5e8f');
  el.appendChild(pc);
}
```

Replace the body of `cardEl` with:

```js
export function cardEl(card, mode = 'simple') {
  const el = document.createElement('div');
  el.className = 'card ' + (card.faceUp ? 'face-up ' + card.color : 'face-down');
  el.dataset.id = card.id;
  el.style.setProperty('--card-tilt', tiltFor(card.id) + 'deg');
  if (mode === 'rich') {
    if (card.faceUp) buildRichFace(el, card);
    else buildRichBack(el);
  } else if (card.faceUp) {
    buildSimpleFace(el, card);
  }
  return el;
}
```

- [ ] **Step 4: Add the rich-mode CSS to `src/styles/card.css`**

The `::before` suppression matters: the simple mode's CSS-gradient back would otherwise print over the vendored back art.

```css
#board[data-mode="rich"] .card playing-card {
  display: block;
  width: 100%;
  height: 100%;
}
#board[data-mode="rich"] .card.face-down::before { content: none; }
#board[data-mode="rich"] .card.face-down { background: none; }
```

- [ ] **Step 5: Verify both modes**

Run: `npm run dev`.

- At a wide window: courts show real figure art; 7♥ shows seven pips in the traditional layout; the stock shows a lattice back in blue.
- Narrow the window until cards drop under 76px: cards switch to the plain top-left index, exactly as before.
- Widen again: they switch back. No layout jump, no letterboxing (white bands above or below the art mean the 1:1.4 ratio has been broken somewhere).
- Drag a court card — the dragged ghost renders in the same mode as the board.

Run: `npm test` — expected PASS.

- [ ] **Step 6: Commit**

```bash
git add src/vendor src/ui/cardview.js src/styles/card.css
git commit -m "Add vendored public-domain card art and rich render mode"
```

---

## Task 12: Material realism

**Files:**
- Modify: `src/styles/card.css`

**Interfaces:**
- Consumes: `--card-tilt` set per card by `cardview.js`, `--card-radius` set per frame by `layout.js`
- Produces: no JS interface

All of this is scoped to `#board[data-mode="rich"]`, so simple mode is untouched and pays nothing.

- [ ] **Step 1: Append the realism block to `src/styles/card.css`**

```css
/* ---- Material realism (rich mode only) ---------------------------------- */

#board[data-mode="rich"] {
  /* One shared grain image for every card rather than a filter per element. */
  --paper-grain: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='120' height='120' filter='url(%23n)'/%3E%3C/svg%3E");
}

#board[data-mode="rich"] .card {
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, .9),      /* cut top edge */
    0 0 0 .5px rgba(0, 0, 0, .28),              /* hairline stock edge */
    0 1px 1px rgba(0, 0, 0, .22),               /* tight contact shadow */
    0 6px 16px rgba(0, 0, 0, .24);              /* wide ambient shadow */
  border: none;
}

/* Grain and gloss. ::after is free on rich cards — the simple-mode faces use
   child elements, and .face-down::before is suppressed in rich mode. */
#board[data-mode="rich"] .card::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  background-image:
    linear-gradient(125deg, rgba(255, 255, 255, .16) 0%, rgba(255, 255, 255, 0) 42%),
    var(--paper-grain);
  background-size: auto, 120px 120px;
  opacity: .5;
  mix-blend-mode: soft-light;
}

/* Sub-degree tilt so stacks read as physical paper rather than a printed grid.
   The value is a pure function of the card id — see ui/card-tilt.js. */
#board[data-mode="rich"] .card.face-down {
  transform: rotate(var(--card-tilt, 0deg));
}

#board[data-mode="rich"] .card.dragging {
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, .9),
    0 2px 4px rgba(0, 0, 0, .3),
    0 18px 40px rgba(0, 0, 0, .42);
  transform: scale(1.03) rotate(var(--card-tilt, 0deg));
}

#board[data-mode="rich"] .card.draggable:hover {
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, .9),
    0 0 0 .5px rgba(0, 0, 0, .28),
    0 2px 3px rgba(0, 0, 0, .24),
    0 12px 28px rgba(0, 0, 0, .3);
}

/* The grain must not ride along on animating cards — a blended overlay on a
   transforming element forces a repaint per frame. */
#board[data-mode="rich"] .card.flying::after,
#board[data-mode="rich"] .card.flip-host::after { content: none; }
```

- [ ] **Step 2: Verify visually**

Run: `npm run dev` at a wide window, then capture both modes headlessly for a side-by-side check:

```bash
npx vite build && npx vite preview --port 4173 &
sleep 3
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless --disable-gpu \
  --hide-scrollbars --screenshot=/tmp/rich.png --window-size=1280,900 \
  --virtual-time-budget=3000 http://localhost:4173/
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless --disable-gpu \
  --hide-scrollbars --screenshot=/tmp/simple.png --window-size=420,900 \
  --virtual-time-budget=3000 http://localhost:4173/
```

Check: face-down stacks show a slight tilt; cards have a visible top edge highlight and a soft ambient shadow; the grain is a texture, not visible noise; **the tilt does not change when you click** — click the stock five times and watch a face-down tableau card stay put. Movement there means a `Math.random()` crept in.

Check `/tmp/simple.png`: plain corner-index cards, no grain, no tilt, no gloss.

- [ ] **Step 3: Commit**

```bash
git add src/styles/card.css
git commit -m "Add material realism to rich-mode cards"
```

---

## Task 13: Local stats

**Files:**
- Create: `src/services/stats.js`
- Test: `src/services/stats.test.js`
- Modify: `src/main.js`

**Interfaces:**
- Consumes: `serialize`, `deserialize` from `../game/serialize.js`
- Produces:
  - `STATS_VERSION: number` — `1`
  - `emptyStats(): Stats` where `Stats = { v, played, won, bestMoves: number|null, ts }`
  - `mergeStats(a, b): Stats` — `max(played)`, `max(won)`, `min(bestMoves)` ignoring null
  - `recordGameStarted(stats, now): Stats`
  - `recordGameWon(stats, moves, now): Stats`
  - `loadLocalStats(): Stats`
  - `saveLocalStats(stats): void`
  - `loadLocalSave(): Save|null`
  - `saveLocalSave(save): void`
  - `clearLocalSave(): void`

- [ ] **Step 1: Write the failing test**

Create `src/services/stats.test.js`:

```js
import { describe, it, expect, beforeEach } from 'vitest';
import {
  emptyStats, mergeStats, recordGameStarted, recordGameWon,
  loadLocalStats, saveLocalStats, loadLocalSave, saveLocalSave, clearLocalSave,
  STATS_VERSION,
} from './stats.js';

// Minimal localStorage stand-in; vitest runs in the node environment.
beforeEach(() => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
  };
});

describe('mergeStats', () => {
  it('takes the higher played and won counts', () => {
    const a = { v: 1, played: 10, won: 3, bestMoves: 200, ts: 1 };
    const b = { v: 1, played: 4, won: 4, bestMoves: 180, ts: 2 };
    const m = mergeStats(a, b);
    expect(m.played).toBe(10);
    expect(m.won).toBe(4);
  });

  it('takes the lower best-move count', () => {
    const a = { v: 1, played: 1, won: 1, bestMoves: 200, ts: 1 };
    const b = { v: 1, played: 1, won: 1, bestMoves: 150, ts: 1 };
    expect(mergeStats(a, b).bestMoves).toBe(150);
  });

  it('ignores a null best-move count rather than treating it as zero', () => {
    const a = { v: 1, played: 1, won: 0, bestMoves: null, ts: 1 };
    const b = { v: 1, played: 1, won: 1, bestMoves: 180, ts: 1 };
    expect(mergeStats(a, b).bestMoves).toBe(180);
    expect(mergeStats(b, a).bestMoves).toBe(180);
  });

  it('is null when neither side has won a game', () => {
    expect(mergeStats(emptyStats(), emptyStats()).bestMoves).toBe(null);
  });

  it('tolerates null and undefined inputs', () => {
    expect(mergeStats(null, null)).toEqual(emptyStats());
    expect(mergeStats(undefined, { v: 1, played: 2, won: 0, bestMoves: null, ts: 9 }).played).toBe(2);
  });

  it('keeps the later timestamp', () => {
    const a = { v: 1, played: 0, won: 0, bestMoves: null, ts: 5 };
    const b = { v: 1, played: 0, won: 0, bestMoves: null, ts: 99 };
    expect(mergeStats(a, b).ts).toBe(99);
  });
});

describe('recordGameStarted / recordGameWon', () => {
  it('increments played without touching won', () => {
    const s = recordGameStarted(emptyStats(), 100);
    expect(s.played).toBe(1);
    expect(s.won).toBe(0);
    expect(s.ts).toBe(100);
  });

  it('increments won and sets the first best-move count', () => {
    const s = recordGameWon(recordGameStarted(emptyStats(), 1), 143, 200);
    expect(s.won).toBe(1);
    expect(s.bestMoves).toBe(143);
  });

  it('lowers best moves only on an improvement', () => {
    let s = recordGameWon(emptyStats(), 143, 1);
    s = recordGameWon(s, 190, 2);
    expect(s.bestMoves).toBe(143);
    s = recordGameWon(s, 120, 3);
    expect(s.bestMoves).toBe(120);
  });
});

describe('local persistence', () => {
  it('returns empty stats when nothing is stored', () => {
    expect(loadLocalStats()).toEqual(emptyStats());
  });

  it('round-trips stats', () => {
    const s = recordGameWon(recordGameStarted(emptyStats(), 1), 99, 2);
    saveLocalStats(s);
    expect(loadLocalStats()).toEqual(s);
  });

  it('returns empty stats for corrupt or wrong-version data', () => {
    localStorage.setItem('solitaire.stats.v1', 'not json');
    expect(loadLocalStats()).toEqual(emptyStats());
    localStorage.setItem('solitaire.stats.v1', JSON.stringify({ v: 99 }));
    expect(loadLocalStats()).toEqual(emptyStats());
  });

  it('round-trips and clears a save', () => {
    const save = { v: 1, t: ['', '', '', '', '', '', ''], f: ['', '', '', ''], s: '', w: '', m: 0, ts: 7 };
    expect(loadLocalSave()).toBe(null);
    saveLocalSave(save);
    expect(loadLocalSave()).toEqual(save);
    clearLocalSave();
    expect(loadLocalSave()).toBe(null);
  });

  it('returns null for a corrupt save', () => {
    localStorage.setItem('solitaire.save.v1', '{{{');
    expect(loadLocalSave()).toBe(null);
  });

  it('does not throw when localStorage is unavailable', () => {
    globalThis.localStorage = {
      getItem() { throw new Error('denied'); },
      setItem() { throw new Error('denied'); },
      removeItem() { throw new Error('denied'); },
    };
    expect(() => saveLocalStats(emptyStats())).not.toThrow();
    expect(loadLocalStats()).toEqual(emptyStats());
    expect(loadLocalSave()).toBe(null);
  });
});

describe('STATS_VERSION', () => {
  it('is 1', () => expect(STATS_VERSION).toBe(1));
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test`
Expected: FAIL — cannot resolve `./stats.js`.

- [ ] **Step 3: Write `src/services/stats.js`**

Every storage access is wrapped: Safari in private mode throws on `localStorage.setItem`, and a solitaire game must not die for that.

```js
export const STATS_VERSION = 1;

const STATS_KEY = 'solitaire.stats.v1';
const SAVE_KEY = 'solitaire.save.v1';

export function emptyStats() {
  return { v: STATS_VERSION, played: 0, won: 0, bestMoves: null, ts: 0 };
}

function minDefined(a, b) {
  const vals = [a, b].filter(v => typeof v === 'number' && Number.isFinite(v));
  return vals.length ? Math.min(...vals) : null;
}

export function mergeStats(a, b) {
  return {
    v: STATS_VERSION,
    played: Math.max(a?.played || 0, b?.played || 0),
    won: Math.max(a?.won || 0, b?.won || 0),
    bestMoves: minDefined(a?.bestMoves, b?.bestMoves),
    ts: Math.max(a?.ts || 0, b?.ts || 0),
  };
}

export function recordGameStarted(stats, now) {
  return { ...stats, v: STATS_VERSION, played: (stats.played || 0) + 1, ts: now };
}

export function recordGameWon(stats, moves, now) {
  return {
    ...stats,
    v: STATS_VERSION,
    won: (stats.won || 0) + 1,
    bestMoves: minDefined(stats.bestMoves, moves),
    ts: now,
  };
}

function readJSON(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private browsing or a full quota. Losing stats is not worth an exception.
  }
}

export function loadLocalStats() {
  const parsed = readJSON(STATS_KEY);
  if (!parsed || parsed.v !== STATS_VERSION) return emptyStats();
  return { ...emptyStats(), ...parsed };
}

export function saveLocalStats(stats) {
  writeJSON(STATS_KEY, stats);
}

export function loadLocalSave() {
  return readJSON(SAVE_KEY);
}

export function saveLocalSave(save) {
  writeJSON(SAVE_KEY, save);
}

export function clearLocalSave() {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    // Ignore.
  }
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Wire stats into `src/main.js`**

Add the import:

```js
import {
  loadLocalStats, saveLocalStats, recordGameStarted, recordGameWon,
} from './services/stats.js';
```

Add module state after `let game = createGame();`:

```js
let stats = loadLocalStats();
let countedThisGame = false;
```

Replace `showWin` and `newGame`, and record the game start on the first move:

```js
function showWin() {
  stats = recordGameWon(stats, game.moves, Date.now());
  saveLocalStats(stats);
  winStatsEl.textContent = `${game.moves} moves. Nicely done.`
    + (stats.bestMoves === game.moves ? ' New best.' : ` Best: ${stats.bestMoves}.`);
  winEl.classList.add('show');
}

// A game counts as played once the player actually moves, so opening the page
// and walking away does not pad the count.
function countGameOnce() {
  if (countedThisGame) return;
  countedThisGame = true;
  stats = recordGameStarted(stats, Date.now());
  saveLocalStats(stats);
}

function newGame() {
  animator.cancelCelebration();
  game = createGame();
  countedThisGame = false;
  winEl.classList.remove('show');
  requestRender();
}
```

Call `countGameOnce()` at the top of `onStockTap`, and inside the drag controller's `onMoveApplied`.

- [ ] **Step 6: Verify**

Run: `npm run dev`. Play and win (fastest route: use the browser console to stack the foundations, or simply verify the counters move). Reload and confirm stats persist. Check `localStorage` in devtools for `solitaire.stats.v1`.

- [ ] **Step 7: Commit**

```bash
git add src/services/stats.js src/services/stats.test.js src/main.js
git commit -m "Add local stats tracking"
```

---

## Task 14: Puter sign-in and stats sync

**Files:**
- Create: `src/services/puter-sync.js`
- Modify: `src/main.js`

**Interfaces:**
- Consumes: `mergeStats` from `./stats.js`
- Produces:
  - `puterAvailable(): boolean`
  - `isSignedIn(): Promise<boolean>` — never throws, never prompts
  - `signIn(): Promise<boolean>`
  - `pullStats(): Promise<Stats|null>`
  - `pushStats(stats): Promise<boolean>`
  - `pullSave(): Promise<Save|null>`
  - `pushSave(save): Promise<boolean>`
  - `clearSave(): Promise<void>`

The load-time rule from the spec lives here: **nothing in this module calls `puter.kv` unless `isSignedIn()` has already returned true.**

- [ ] **Step 1: Write `src/services/puter-sync.js`**

```js
const KV_STATS_KEY = 'stats';
const KV_SAVE_KEY = 'savedGame';

export function puterAvailable() {
  return typeof puter !== 'undefined' && !!puter?.auth && !!puter?.kv;
}

// Never throws and never triggers the sign-in dialog. Everything else in this
// module is gated behind this returning true.
export async function isSignedIn() {
  if (!puterAvailable()) return false;
  try {
    return !!(await puter.auth.isSignedIn());
  } catch {
    return false;
  }
}

// The only function permitted to prompt. Call it from a user gesture only.
export async function signIn() {
  if (!puterAvailable()) return false;
  try {
    await puter.auth.signIn();
    return !!(await puter.auth.isSignedIn());
  } catch {
    return false;
  }
}
```

> **Superseded — do not copy this `kvGet`/`kvSet` pair.** (Annotated
> 2026-08-14, final whole-branch review, after this exact code caused a
> silent-data-loss bug across three separate fix rounds.) `kvGet` below
> returns a bare `null` both when the key has never been written *and* when
> the read itself failed — the two are indistinguishable to every caller.
> Combined with Step 2 below, which pulls and then unconditionally pushes,
> a transient network failure reads as "this key is empty" and gets
> silently overwritten with a fresh local-only value, which can clobber a
> better value that was sitting in KV the whole time. The shipped, correct
> version is `src/services/puter-sync.js`: `kvGet`/`kvSet` return
> `{ ok, value }`, where `ok: false` means "the read failed or the user
> isn't signed in — treat this as unknown, not empty," and callers
> (`syncStats()` / `writeSave()` in `src/main.js`) refuse to merge or push
> unless the preceding pull actually had `ok: true`. See
> `src/services/puter-sync.test.js` for the pinned contract.

```js
async function kvGet(key) {
  if (!await isSignedIn()) return null;
  try {
    const raw = await puter.kv.get(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function kvSet(key, value) {
  if (!await isSignedIn()) return false;
  try {
    const payload = JSON.stringify(value);
    const limit = puter.kv.MAX_VALUE_SIZE;
    // The docs do not publish this as a number, so read it rather than assume.
    if (typeof limit === 'number' && payload.length > limit) return false;
    await puter.kv.set(key, payload);
    return true;
  } catch {
    return false;
  }
}

export const pullStats = () => kvGet(KV_STATS_KEY);
export const pushStats = stats => kvSet(KV_STATS_KEY, stats);
export const pullSave = () => kvGet(KV_SAVE_KEY);
export const pushSave = save => kvSet(KV_SAVE_KEY, save);

export async function clearSave() {
  if (!await isSignedIn()) return;
  try {
    await puter.kv.del(KV_SAVE_KEY);
  } catch {
    // Ignore.
  }
}
```

- [ ] **Step 2: Wire the sync button into `src/main.js`**

```js
import { mergeStats } from './services/stats.js';
import * as cloud from './services/puter-sync.js';

const syncBtn = document.getElementById('sync');
let signedIn = false;

function setSyncUI(state) {
  const icon = syncBtn.querySelector('.material-symbols-outlined');
  const label = syncBtn.querySelector('span:not(.material-symbols-outlined)');
  if (state === 'on') { icon.textContent = 'cloud_done'; label.textContent = 'Synced'; }
  else if (state === 'busy') { icon.textContent = 'cloud_sync'; label.textContent = 'Syncing'; }
  else { icon.textContent = 'cloud_off'; label.textContent = 'Sync'; }
  syncBtn.disabled = state === 'busy';
}

async function syncStats() {
  const remote = await cloud.pullStats();
  stats = mergeStats(stats, remote);
  saveLocalStats(stats);
  await cloud.pushStats(stats);
}

syncBtn.onclick = async () => {
  if (!cloud.puterAvailable()) return;
  setSyncUI('busy');
  signedIn = await cloud.isSignedIn() || await cloud.signIn();
  if (!signedIn) { setSyncUI('off'); return; }
  await syncStats();
  setSyncUI('on');
};

// Load-time path: only touch the cloud if already signed in, so opening the
// game never throws a login dialog at anyone.
(async () => {
  if (!cloud.puterAvailable()) { setSyncUI('off'); return; }
  signedIn = await cloud.isSignedIn();
  if (!signedIn) { setSyncUI('off'); return; }
  setSyncUI('busy');
  await syncStats();
  setSyncUI('on');
  requestRender();
})();
```

Also push stats after a win — add to the end of `showWin`:

```js
  if (signedIn) cloud.pushStats(stats);
```

- [ ] **Step 3: Verify**

Run: `npm run dev`.

- **Load the page signed out. No sign-in dialog may appear.** This is the single most important check in this task. The button reads "Sync" with a `cloud_off` icon.
- Click Sync — the Puter dialog opens. Sign in. Button becomes "Synced".
- Reload — it goes straight to "Synced" with no dialog.
- Win a game, reload in another browser, sign in, and confirm the counts merged.
- Block `js.puter.com` in devtools and reload: the game still plays, button stays "Sync", console has no unhandled rejections.

- [ ] **Step 4: Commit**

```bash
git add src/services/puter-sync.js src/main.js
git commit -m "Add Puter sign-in and stats sync"
```

---

## Task 15: Game resume

**Files:**
- Modify: `src/main.js`

**Interfaces:**
- Consumes: `serialize`, `deserialize` from `./game/serialize.js`; `loadLocalSave`, `saveLocalSave`, `clearLocalSave` from `./services/stats.js`; `pullSave`, `pushSave`, `clearSave` from `./services/puter-sync.js`
- Produces: no new exports

Rules from the spec: save on an 800 ms debounce, flush on `visibilitychange`, write local only on `beforeunload`, restore whichever of local/remote has the greater `ts`, clear on win and on New Game, and **do not persist undo history** — a resumed game starts with an empty history.

- [ ] **Step 1: Add the save scheduler to `src/main.js`**

```js
import { serialize, deserialize } from './game/serialize.js';
import { loadLocalSave, saveLocalSave, clearLocalSave } from './services/stats.js';

const SAVE_DEBOUNCE_MS = 800;
let saveTimer = null;

function writeSave({ remote }) {
  const save = serialize(game, Date.now());
  saveLocalSave(save);
  if (remote && signedIn) cloud.pushSave(save);
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => writeSave({ remote: true }), SAVE_DEBOUNCE_MS);
}

function flushSave() {
  clearTimeout(saveTimer);
  writeSave({ remote: true });
}

function dropSave() {
  clearTimeout(saveTimer);
  clearLocalSave();
  if (signedIn) cloud.clearSave();
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushSave();
});

// A KV write is not guaranteed to finish during unload, so only touch local here.
window.addEventListener('beforeunload', () => {
  clearTimeout(saveTimer);
  saveLocalSave(serialize(game, Date.now()));
});
```

- [ ] **Step 2: Call the scheduler on every committed change**

Add `scheduleSave()` to the end of `onStockTap`, to the drag controller's `onMoveApplied`, and to the undo handlers. Add `dropSave()` to `newGame` and to `showWin`.

The undo handlers become:

```js
function doUndo() {
  if (!undo(game)) return;
  requestRender();
  scheduleSave();
}

document.getElementById('undo').onclick = doUndo;
```

and the keydown handler calls `doUndo()`.

- [ ] **Step 3: Add restore on load**

Replace the bare `let game = createGame();` initialization path. `restoreGame()` runs before the first render:

```js
function adoptSave(save) {
  const restored = deserialize(save);
  if (!restored) return false;
  game = restored;
  countedThisGame = true; // an in-progress game was already counted as played
  return true;
}

function restoreLocal() {
  const local = loadLocalSave();
  return local ? { save: local, ts: local.ts || 0 } : null;
}

async function restoreFromCloud() {
  if (!signedIn) return null;
  const remote = await cloud.pullSave();
  return remote ? { save: remote, ts: remote.ts || 0 } : null;
}
```

In the load-time async block, after the stats sync, add:

```js
  const local = restoreLocal();
  const remote = await restoreFromCloud();
  const best = [local, remote].filter(Boolean).sort((a, b) => b.ts - a.ts)[0];
  if (best && adoptSave(best.save)) requestRender();
```

> **Superseded — do not copy this arbitration.** (Annotated 2026-08-14, final
> whole-branch review.) `restoreLocal()` is called again here, inside the
> load-time async block, after `isSignedIn`/`pullStats`/`pushStats`/`pullSave`
> have all already awaited — several round-trips' worth of time in which the
> player may have already made real moves (or pressed New) on top of the
> `localAtBoot` board this same plan restores synchronously below. Re-reading
> `localStorage` here picks up those moves and lets a merely-newer remote
> save silently overwrite them, with no guard at all. This was the shipped
> bug, caught and fixed across three review rounds. The shipped, correct
> version in `src/main.js` compares the remote timestamp only against the
> `bootSave` captured once, synchronously, before any `await` — never a
> fresh `restoreLocal()` call — and skips adoption entirely once
> `playerOwnsBoard` is true (set by any move, undo, stock draw, or New Game
> since load). The decision itself is pulled out into a small, pure, tested
> function, `shouldAdoptRemote()` in `src/services/save-arbitration.js` —
> see `src/services/save-arbitration.test.js` for the pinned contract.

and before that block runs, restore from local synchronously so a signed-out player still resumes:

```js
const localAtBoot = restoreLocal();
if (localAtBoot) adoptSave(localAtBoot.save);
```

- [ ] **Step 4: Verify**

Run: `npm run dev`.

- Make a few moves, reload — the same board comes back with the same move count.
- Undo is empty after a reload (expected, per the spec).
- Click New — reload — a fresh deal, not the old board.
- Win a game — reload — a fresh deal, not the won board.
- Signed in: play on one browser, sign in on a second, confirm the more recent board wins.
- Signed out: resume still works from localStorage alone.
- Check the payload size in devtools: `localStorage['solitaire.save.v1'].length` should be roughly 250 to 400.

Run: `npm test` — expected PASS.

- [ ] **Step 5: Final check — confirm the hint feature is gone**

```bash
grep -rn "findHint\|showHint\|hintPulse\|\.hint" src/ index.html
```

Expected: no matches.

- [ ] **Step 6: Commit**

```bash
git add src/main.js
git commit -m "Add game resume backed by localStorage and Puter KV"
```

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| Vite project, plain JS ES modules | 1 |
| HTML, CSS, JS in separate files | 5 |
| Rules extracted, DOM-free, Vitest | 1, 2, 3, 4 |
| Correct pip layouts and court art | 11 |
| Physical card surface | 12 |
| Small cards unchanged | 5 (CSS), 7 (view), 11 (mode switch) |
| 76px card-width threshold | 6 |
| 1:1.4 aspect ratio preserved | 6 (test), 11 (verify) |
| Card back from the deck | 11 |
| Deterministic tilt, never `Math.random()` | 6, 12 |
| No `board.js` ↔ `drag.js` cycle | 8, 9, 10 |
| Stats local-first, opt-in cloud | 13, 14 |
| No cloud call on load unless signed in | 14 |
| Puter failures fall back silently | 13, 14 |
| "Powered by Puter" footer | 5 |
| Resume game, last-write-wins | 15 |
| Undo history not persisted | 4, 15 |
| Compact save format | 4 |
| `MAX_VALUE_SIZE` guard | 14 |
| Hint deleted | 5, 15 (grep check) |
| puter.js becomes a real dependency | 14 |

No gaps.

**Placeholder scan:** No TBDs. Every code step carries the actual code; verbatim ports name the exact baseline line range in commit `d8b025b`.

**Type consistency:** `Card`, `Game`, `Save`, and `Stats` shapes are consistent across tasks. `applyMove` returns `{ ok, flipped }` in Task 3 and is consumed as `{ flipped }` in Tasks 9 and 10. `drawFromStock` returns `{ ok, drawn, recycled }` in Task 3 and is consumed as `result.drawn` in Task 10. `cardEl(card, mode)` gains rich behaviour in Task 11 without changing its signature from Task 7. `pickDropTarget` keeps one signature in Tasks 9. `mergeStats` is defined in Task 13 and consumed in Task 14.
