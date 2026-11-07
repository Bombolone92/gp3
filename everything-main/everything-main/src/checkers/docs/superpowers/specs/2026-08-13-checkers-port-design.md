# Checkers — port of chess.puter.com

Rebuild the single-file checkers game as a structural mirror of
`chess.puter.com`: same architecture, same visual design, same feature set,
same deploy shape. Only the game is different.

Target: **checkers.puter.com**.

## Ruleset

American checkers (English draughts), tournament rules:

- 8×8 board, 12 men a side, play on dark squares only.
- **Black moves first.**
- Men move and jump diagonally forward one square. Kings move and jump one
  square in all four diagonal directions.
- **Capturing is mandatory.** When several capturing sequences exist the player
  chooses freely among them — there is no longest-capture requirement.
- A jump sequence continues while the jumping piece can jump again. The whole
  sequence is one turn.
- Reaching the far row crowns a man **and ends the turn immediately**, even
  mid-sequence.
- A player with no legal move **loses**.

This is a deliberate change from the current game, which has forced capture
switched off.

### Terminal states

Chess's endings do not map one to one:

| chess | checkers |
| --- | --- |
| checkmate | — |
| stalemate | no legal moves is a **loss**, not a draw |
| threefold repetition | same — draw |
| fifty-move rule | **40-move rule**: 80 plies with no capture and no man move |
| insufficient material | dropped, no meaningful analog |
| timeout → draw when the winner cannot mate (FIDE 6.9) | dropped — **running out of time simply loses** |

Dropping the FIDE 6.9 analog removes `hasMatingMaterial()` from the engine and
collapses `describeTimeout()` to a single branch.

## Repository layout

```
checkers/
  index.html              app shell: topbar · board · sidebar · dialogs
  package.json            vite + vitest; no runtime framework
  vite.config.js
  customHttp.yml          CSP headers, inline-script hashes recomputed
  README.md
  public/
    favicon.ico, favicon-16x16.png, favicon-32x32.png,
    apple-touch-icon.png, icon-128/192/512.png,
    site.webmanifest, og-image.png, robots.txt, sitemap.xml
  src/
    main.js               controller
    style.css
    analytics.js          carried over unchanged
    engine/checkers.js    rules engine        (replaces engine/chess.js)
    engine/ai.js          negamax + alpha-beta + capture quiescence
    ui/boardView.js       DOM, pointer, keyboard
    game/clock.js         carried over unchanged
    game/persistence.js   saved game, move paths
    game/pdn.js           PDN export          (replaces game/pgn.js)
    net/online.js         Puter Peer session
  tests/
    rules.test.js  perft.test.js  notation.test.js  pdn.test.js
    ai.test.js     clock.test.js  persistence.test.js  online.test.js
  tools/
    og-image.html  render-og.mjs  store-screenshots.mjs
  store/description.md
  docs/superpowers/specs/
```

`clock.js` and `analytics.js` carry over verbatim. `boardView.js`, `online.js`,
`persistence.js` and `main.js` keep their structure and most of their code.
`checkers.js`, `ai.js` and `pdn.js` are new work.

`public/pieces/` does not exist — see *Pieces*.

## Engine — `src/engine/checkers.js`

### Board representation

Only 32 squares are playable, so the engine works on a 32-cell array using
PDN's own numbering rather than chess's 64-cell board with off-board maths.

Numbering: dark squares are those where `(row + col)` is odd with row 0 at the
top; numbers run left to right within a row, top to bottom. Black's back row is
1–4, White's is 29–32. Black men start on 1–12, White men on 21–32, squares
13–20 empty. Black advances toward higher numbers.

> **Verify before locking in.** Getting the numbering mirrored produces a board
> that is entirely self-consistent and silently wrong against every published
> game. Check square 1's position against a reference diagram, and assert the
> start position in `notation.test.js`.

Geometry is precomputed once at module load:

```js
STEPS[square][dir]        // → destination square, or 0 off-board
JUMPS[square][dir]        // → {over, land}, or null
```

with `dir` in `{0: up-left, 1: up-right, 2: down-left, 3: down-right}`. Men use
two directions, kings all four. No coordinate arithmetic at search time.

Cell values: `null`, or one of `'b' 'B' 'w' 'W'` (upper case is a king), matching
chess.js's convention that case encodes colour.

### The engine knows only complete turns

`moves()` returns whole sequences:

```js
{ color: 'b', path: [23, 14, 5], captured: [18, 9], crowned: false, pdn: '23x14x5' }
```

`move({ path })` applies one whole turn; `history()` holds one entry per turn;
`undo()` takes back one whole turn. This mirrors chess.js exactly, and it is
what makes review, PDN export, persistence, the clock, and the online protocol
correct without special cases.

**Hop-at-a-time input is a controller concern, not an engine one.** `main.js`
holds a `pendingPath` beside `selected`/`targets` and filters the engine's move
list to sequences whose path starts with the hops taken so far. The engine
never sees a partial turn.

Because the engine's position does not advance until the sequence ends, the
board mid-chain shows something the engine is not in. One read-only helper
covers it:

```js
preview(path)   // → a 32-cell board with a partial sequence applied
```

`renderAll()` draws `preview(pendingPath)` when a chain is pending and
`board()` otherwise. Nothing else consumes it, and it mutates no state.

Consequences of a pending chain, all of which follow from the engine being one
turn behind the screen:

- **Undo is disabled** while a chain is pending. There is no half-turn to take
  back, and undoing the *previous* turn out from under a chain in progress
  would be incoherent. `canUndo()` gains the check.
- **Saving stores completed turns only.** A reload mid-chain resumes at the
  start of that turn, which is a legal position with the same obligation to
  jump. No save-format change, no partial state to validate.
- **Entering review clears the chain.** `goToPly()` already cancels drags and
  clears the selection; it clears `pendingPath` with them.

### Public API

Mirrors `Chess` so `main.js` changes as little as possible:

```js
class Checkers {
  constructor(fen)          load(fen)   reset()   fen()
  turn()                    // 'b' | 'w'
  board()                   // 32-cell array
  get(square)               // square is 1..32
  history()                 // complete turns, oldest first
  lastMove()
  moves({ square })         // legal turns; forced captures already filtered
  move({ path })            // → the applied turn, or null
  undo()
  status()                  // {over, turn, result, reason, mustCapture}
  isGameOver()  isDraw()  isThreefoldRepetition()  isFortyMoveRule()
}
```

Removed relative to `Chess`: `kingSquare`, `inCheck`, `isCheckmate`,
`isStalemate`, `isInsufficientMaterial`, `hasMatingMaterial`, and every
`promotion` parameter.

Added: `status().mustCapture` — whether the side to move is obliged to jump.
The UI uses it in place of the check indicator.

`status().reason` is one of `'no moves'`, `'threefold repetition'`,
`'40-move rule'`, or the manual reasons `main.js` already supplies.

### Draw counters

The 40-move counter increments per ply and resets on any capture or any man
move; a draw is declared at 80 plies. Repetition uses a position key of board
plus side to move, exactly as chess.js does.

## AI — `src/engine/ai.js`

Same design as the chess AI: negamax, alpha-beta, root randomness window,
async `chooseMove()` wrapper with a minimum think time.

Two things get simpler or better in checkers:

**Depth.** Branching factor is roughly 8 rather than 35, so the same budget
searches far deeper.

| level | depth | window |
| --- | --- | --- |
| easy | 2 | 120 |
| medium | 6 | 30 |
| hard | 10 | 0 |

These are starting points, to be tuned against a real wall-clock budget on the
slowest target device before shipping. The window mechanic is unchanged: pick
uniformly among root moves within `window` of the best, with the same
re-search of inexact upper bounds that `findBestMove` already does.

**Quiescence becomes exact.** Because capture is forced, a position is quiet
precisely when the side to move has no jump available. The search extends on
exactly that condition — no "filter moves to captures and promotions"
approximation is needed.

**Evaluation**, in place of piece-square tables (checkers' 32 squares are far
more uniform than chess's 64):

- material — man 100, king 175
- advancement — men score for proximity to the crowning row
- back-rank guard — holding one's own back row is worth a small bonus
- centre vs edge — edge squares are worth slightly less, being unjumpable but
  also unable to jump
- mobility — number of legal turns

### Move generation tests

`perft.test.js` validates the generator against published English-draughts
perft counts from the start position.

> **Do not write these from memory.** Take them from a published source, cite
> it in the test file, and confirm depths 1–6 before relying on the deeper ones.

## Board and pieces

### Board

Identical to chess, verbatim: `--sq-light: #e9ecf4` / `--sq-dark: #7d90bb`
(light) and `#d3d8e5` / `#5f6f99` (dark), 12px radius, `--shadow-board`, the
`--hl-sel` / `--hl-last` yellow washes, the 30% hint dot and the 86%
capture-hint ring, and the focus-visible treatment.

`.square.check` and its red radial gradient are removed.

### Pieces

Four pieces, all CSS — no image files, no `public/pieces/`, no `pieceUrl()`:

- black man — black fill, white border
- white man — white fill, black border
- kings — as above, plus a centred Lucide `crown` glyph in the contrasting
  colour (white crown on black, black crown on white)

`boardView.render()` emits `<div class="piece" data-piece="bK">` rather than an
`<img>`. The drag ghost clones the div. Captured pieces in the player cards
render as the same discs at small size. `pieceLabel()` survives for ARIA text
("Black king").

### Square labels

Chess's a–h / 1–8 edge labels are replaced by the PDN square number, set faintly
in the corner of each dark square, so the board reads in the same language as
the move list and the export. `data-file` / `data-rank` become `data-num` on
dark squares only.

### Highlights

`check` has no analog and is gone. Two replacements:

- the piece locked mid-chain gets a pulsing accent ring
- because capture is forced, the set of movable pieces is itself informative
  when it shrinks — no extra affordance needed, the existing selectable state
  carries it

### Multi-jump interaction

Hop at a time, chain locked:

1. Press a piece → its legal landing squares light up, jumps as capture hints.
2. Press a landing square → that single hop animates and applies.
3. If the sequence continues, the piece is **locked**: it stays selected, gets
   the pulsing ring, only its remaining hops are lit, and no other piece can be
   picked up.
4. The sidebar note reads `Keep jumping — 1 of 2`.
5. The turn commits, the clock changes hands, and history gains one entry only
   when the sequence ends.

Drag-and-drop works per hop. Escape during a locked chain does **not** abandon
it — the chain is compulsory; Escape only clears a selection that has not yet
moved.

## Notation — `src/game/pdn.js`

PDN (Portable Draughts Notation), the direct counterpart of PGN.

- quiet move `11-15`
- jump `23x14`
- chain `23x14x5`
- crowning is implicit, no suffix

Tag roster: `Event`, `Site` (`checkers.puter.com`), `Date`, `Round`, `Black`,
`White`, `Result`, `GameType`, `TimeControl`, and `Termination` when not normal.
Note the ordering difference from PGN — in PDN **Black precedes White**, because
Black moves first.

`GameType` is the PDN code for English draughts on an 8×8 board.

> **Verify the GameType code against the PDN standard before shipping.**

Movetext wrapping at 80 columns, tag escaping, and `pdnFilename()` carry over
from `pgn.js` unchanged in substance.

## Clocks — `src/game/clock.js`

Carried over verbatim, including `TIME_CONTROLS`, the timestamp-based charging,
`baseline()`/`snapshot()`/`restore()`, and the flag-grace handling in `main.js`.

The clock changes hands **per turn**, so a five-hop chain is charged once and
receives one increment.

## Online play — `src/net/online.js`

Same Puter Peer session, lazily loaded SDK, same host/guest handshake, invite
codes, invite links, auto-join, resign, rematch, flag, and bye handling. Same
lifecycle guarantees (`_conn === conn` guards, host reverts to waiting on a
failed join, `onClose` fires exactly once).

`PROTOCOL_VERSION` resets to `1` — this is a new app with no deployed peers.

One message changes shape:

```
{t:'move', path:[23,14,5], clock}     was {t:'move', from, to, promotion, clock}
```

One message per **turn**, not per hop, so the position, the turn, and the clock
handover stay atomic across the wire. `cleanPath()` validates: an array of 2–13
integers in 1–32, no duplicates.

The `start` message keeps `{v, color, name, time}` unchanged.

## Persistence — `src/game/persistence.js`

Same localStorage move-list replay, same validation-then-replay discipline, same
"online and finished games are never saved" rule, same clock and clock-stack
handling.

Each saved move is a path array of integers rather than a `[from, to, promotion]`
tuple. `parseSavedGame()` validates integers in 1–32 and caps path length.

Storage key `checkers-game`; settings key `checkers-settings`.

## Carried over unchanged in behaviour

Three modes (Computer / Pass & Play / Online); light, dark and follow-system
themes with the pre-paint inline resolver; move review with the arrow keys,
Home/End, and click-to-jump; undo (a whole turn, plus the computer's reply);
resumable games; toasts; the game-over, confirm and rematch dialogs; the ARIA
grid, roving tabindex, and `role="status"` announcements; the five analytics
events; responsive layout; `noscript` note; JSON-LD; sitemap and robots.

## Removed entirely

The promotion dialog. Crowning is automatic, so `promo-dialog`, `askPromotion()`,
`finishPromotion()`, and the `promotion` field threading through moves, the wire
protocol, and the save format all disappear.

## Deferred — needs something I cannot supply

1. **Plausible site ID.** `analytics.js` and all five events carry over, but the
   `<script>` tag in `index.html` needs the checkers site's own ID. Ships as a
   clearly marked placeholder with a comment, not a copy of the chess ID.
2. **Icon and OG PNGs.** The checkers icon is authored as SVG and
   `tools/render-og.mjs` and `tools/store-screenshots.mjs` are wired up, but
   producing the PNGs needs Playwright installed on demand
   (`npm i --no-save playwright && npx playwright install chromium`). The README
   documents this; no broken image references are committed.

## Out of scope

International draughts, the longest-capture rule, an opening book, an engine
strength beyond the three levels, and any server-side component.
