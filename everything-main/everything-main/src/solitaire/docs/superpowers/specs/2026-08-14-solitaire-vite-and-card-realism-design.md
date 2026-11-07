# Solitaire: Vite restructure, realistic cards, Puter sync

**Date:** 2026-08-14
**Status:** Approved design, ready for implementation planning

## Problem

The game is one 1307-line `index.html`: ~390 lines of CSS, ~870 lines of JS, and the markup, all in a single file. It works — full Klondike, pointer-based drag and drop, flip and flight animations, undo, a win celebration — but every change means editing one file that no longer fits comfortably in a single mental frame, and there is no build step, no module boundaries, and no tests.

Two goals:

1. Turn it into a Vite project with HTML, CSS, and JS in separate files.
2. Make cards look like real playing cards on desktop, while keeping them as plain and legible on small screens as they are today.

## Goals

- Vite project, plain JavaScript with ES modules, no framework.
- Game rules extracted into pure DOM-free modules with Vitest coverage.
- Desktop cards with correct pip layouts, real court-card art, and a card surface that reads as a physical object.
- Small cards unchanged from today: top-left rank and suit only.
- Stats and in-progress games sync to Puter automatically whenever already signed in, never blocking play.
- Winning triggers the classic Windows Solitaire cascade: cards bounce off the viewport edges leaving trails.
- Installable and playable offline as a PWA, with app-store listing material.

## Non-goals

- No framework, no TypeScript, no CSS preprocessor.
- No DOM or end-to-end tests. The rules layer is tested; rendering is verified by playing.
- No new game modes, no scoring system, no timer.
- No change to the drag-and-drop interaction model, which already works well on both mouse and touch.

## Decisions

### Language and tooling

Plain JS with ES modules. Vite for dev server and build. Vitest for the rules layer.

### Card art source

Rich cards render via **CardMeister** (`elements.cardmeister.min.js`), vendored into `src/vendor/cardmeister.js`.

- 27 KB minified, ~16 KB gzipped, all 52 cards plus a card back.
- **Unlicense — public domain.** No attribution required.
- Zero dependencies; it registers a `<playing-card>` custom element and builds every card as inline SVG. No external asset requests.
- Art lineage: Adrian Kennard's CC0 playing cards, optimised by Danny Engelman.

Rejected alternatives, with the reason each was rejected:

| Source | Why not |
|---|---|
| Byron Knoll / `notpeter/Vector-Playing-Cards` | Court cards total **7.7 MB** (`KC.svg` alone is 1.1 MB). They are bitmap traces with enormous node counts; SVGO cannot meaningfully fix that. |
| `RevK/SVG-playing-cards` (original CC0 source) | Repository is **97 MB**; each court card is ~4.5 MB of Inkscape working detail. |
| Hand-authored court figures | Twelve hand-drawn figures is disproportionate work and would not read as a real deck. |
| Monogram courts, no figures | Rejected during brainstorming — not what "realistic" means. |

### Verified integration constraints

These came from rendering the element in headless Chrome before committing to it:

1. **Aspect ratio is preserved, not stretched.** At 100×140 the SVG fills the box exactly; at 100×180 it letterboxes. The board must keep its current 1:1.4 card ratio (`cardH = cardW * 1.4`). This is already what `layoutSizes()` does, so it is a constraint to preserve, not a change to make.
2. **`borderline=0` does not suppress the element's own border.** Setting `bordercolor` to the card colour does hide it. The wrapper `.card` div draws the real edge.
3. **Courts are illegible below roughly 56px wide** and are mush at 44px. This is the evidence behind the render-mode threshold; it is a correctness requirement, not a preference.
4. **The card back works and is themeable.** `cid="back"` with `backcolor` produces a lattice back in the app's existing blue, replacing today's CSS-gradient back.

### Render modes

`ui/layout.js` computes card width and sets `data-mode` on `#board`:

- `data-mode="simple"` when `cardW < 76`
- `data-mode="rich"` when `cardW >= 76`

Threshold is card **pixel width**, not viewport width, so a narrow desktop window gets legible cards too. The 76px figure sits above the ~56px legibility floor measured in the probe, with margin.

**Simple mode** renders the current DOM unchanged: `.corner.tl` with rank and suit, no bottom corner, no centre suit, no pips.

**Rich mode** renders `<playing-card cid="...">` inside the same `.card` wrapper, with `bordercolor` set to the card colour.

Both modes share the same `.card` wrapper, so hit-testing, drag, fan offsets, and the flip and flight animations are identical in either mode and need no mode-specific handling.

### Material realism

Applied to the `.card` wrapper, in rich mode only, so simple mode costs nothing:

- **Edge:** `inset 0 1px 0` white highlight over a hairline dark outer stroke, for a cut-paper edge.
- **Grain:** one shared `feTurbulence` data-URI tiled at low opacity. A single shared background image, not per-card.
- **Gloss:** faint diagonal sheen at roughly 8% opacity.
- **Shadow:** two layers — a tight contact shadow and a wide ambient one.
- **Corner radius:** scales with card width instead of a fixed 8px, which is visibly too round on small cards today.
- **Stack rotation:** face-down cards get a sub-degree rotation so piles read as physical.

**Stack rotation must be derived deterministically from the card id, never from `Math.random()`.** `render()` rebuilds the entire board on every move, so random per-render values would make the whole deck twitch on every click.

### Win cascade

Winning replaces the board with the classic Windows Solitaire cascade.

Cards launch one at a time from the foundations, highest rank first, cycling the four piles. Each is thrown with a random horizontal velocity and an upward kick, falls under gravity, and bounces off the bottom **and both side edges** of the viewport, losing energy on every bounce until it comes to rest on the floor.

**In practice the foundations do not stay visible while they drain.** `board.js` renders only each foundation's top card, and the moment a pile's first card launches, `animate.js` sets that pile's DOM slot to `opacity: 0` — the canvas card takes over the spot from there. So within roughly the first 270ms (three launch intervals) all four foundations read as empty boxes, and the remaining 48 cards launch from foundations that are already visually drained rather than draining on screen. This was a deliberate simplification, not a drift: making every launch re-render its foundation's new top card is real complexity (board.js would need to know about an in-flight cascade) for a detail the canvas itself covers within about a second — the trail overlay quickly obscures the foundation row entirely.

**The canvas is never cleared between frames.** Each card stamps itself at every position it occupies, and the accumulated trails are the effect — that omission is the entire reason the original is recognisable. Clearing the canvas would produce 52 cards bouncing around an empty screen, which is not the same thing at all.

Side bounces are a deliberate departure from the original, which let cards exit sideways off the screen. Combined with damping, bouncing off all four edges produces the trailing stacks the owner asked for: cards pile up along the bottom instead of sailing away.

The cascade ends when every card has settled, when the player clicks or taps, or on a 20-second safety timeout — after which the win overlay appears. A viewport resize also ends it, because resizing would either stretch the trails or force a clear.

**`prefers-reduced-motion: reduce` skips the cascade entirely** and shows the overlay immediately. A full-screen bouncing animation is precisely what that preference exists to suppress.

Physics lives in a pure, unit-tested module (`ui/cascade-physics.js`); the canvas layer only draws. `Math.random()` is correct here, unlike in `render()` — a cascade card is launched once and animated to completion, never re-created from state on each frame.

### Puter integration

Two features, both local-first. **The game never requires an account and never shows a sign-in dialog on load.**

Sync is automatic, not opt-in — there is no sign-in button, and `signIn()` was removed entirely. On load the app calls `puter.auth.isSignedIn()` once and only touches `puter.kv` if that already returns true. This load-time guarantee is unchanged from the original design and remains the thing that keeps the game silent for a signed-out visitor: Puter's documented behaviour is that *any* cloud call auto-prompts a sign-in dialog, so nothing beyond `isSignedIn()` may be called before that check passes.

The manual sign-in button was removed at the repository owner's request. The app is expected to run mostly as a Puter app, where — per Puter's own docs — a published app already has the user signed in; in that context a sign-in button had no one left to click it, and cloud sync should simply happen. Loaded as a plain website by a signed-out visitor, the behaviour is exactly what it was before: `isSignedIn()` returns false, no cloud call is made, and the game is local-only for that session, with nothing in the UI implying otherwise.

**Stats** — games played, games won, best (lowest) move count. Always written to `localStorage`. When signed in, mirrored to `puter.kv`. Merge rule: `max(played)`, `max(won)`, `min(bestMoves)` ignoring absent values.

**Resume game** — the in-progress board is saved so a game can be continued on another device.

- Saved on a 800 ms debounce after state changes, flushed immediately on `visibilitychange` to hidden. `beforeunload` writes `localStorage` only, since a KV write is not guaranteed to complete.
- Only committed state is saved, never mid-drag or mid-animation.
- On load: read the local save and, if signed in, the remote save; use whichever has the greater timestamp. If neither exists, deal a new game.
- The save is cleared on a win and on New Game.
- **Undo history is not persisted.** A resumed game starts with an empty history. Persisting up to 200 full board snapshots is disproportionate to the feature.

Save format is compact — each card is two characters, rank (`A23456789TJQK`) plus suit (`SHDC`), with a lowercase suit meaning face-down:

```json
{"v":1,"t":["As2h3S", "..."],"f":["","","",""],"s":"...","w":"...","m":42,"ts":1786...}
```

A full 52-card board is roughly 250 bytes, comfortably inside any plausible KV value limit. The docs do not publish the limit as a number, so `stats.js` reads `puter.kv.MAX_VALUE_SIZE` at runtime and skips the remote write if the payload would exceed it.

Any Puter failure — offline, declined sign-in, API error — falls back to local-only silently. A "Powered by Puter" footer link is included, as their docs request.

### PWA and distribution

The game ships as an installable, offline-capable progressive web app, following the structure already proven in the sibling `checkers` project: `site.webmanifest`, a full icon set, social preview and search metadata, and `STORE_LISTING.md` as the single source for listing copy so a submission form and a screenshot can never disagree about what the app is.

**Offline capability is a deliberate extension beyond that reference.** `checkers` is manifest-only. Solitaire is entirely client-side — no backend, no live data, nothing to be stale — so it can genuinely work on a plane, and a game you cannot play without a connection is a worse game.

The service worker uses **runtime caching rather than a precache manifest**. Vite hashes asset filenames on every build, so a hand-written precache list would go stale immediately, and generating one would mean adding a build plugin for a roughly 30-line problem. Instead: cache-first with network fallback for same-origin GETs, and navigation requests fall back to the cached shell so a cold offline launch still boots. A version constant invalidates the cache; stale caches are dropped on activate.

**Registration is production-only** (`import.meta.env.PROD`). A service worker on the dev server turns every subsequent change into a stale-cache mystery.

The icon is built from the app's own materials — the vendored deck's Ace of Spades on the felt green — rather than a new mark invented for the purpose. Image generation tooling (`playwright`, `sharp`, `png-to-ico`) is installed `--no-save` and never enters `package.json`; it is needed to regenerate pictures, not to build or run the game.

### Removals

- **`findHint()` and `showHint()` are deleted**, along with the `.hint` CSS and `hintPulse` keyframes. Fully implemented but never wired to any button or key.
- **The `js.puter.com` script tag moves from a dead `<head>` include to an actual dependency** of the stats and resume features.

## Architecture

```
solitaire/
├── index.html              # shell markup only — header, #board, #win
├── package.json
├── vite.config.js
└── src/
    ├── main.js             # bootstrap: buttons, keys, resize, owns requestRender()
    ├── styles/
    │   ├── base.css        # reset + :root design tokens
    │   ├── layout.css      # header, board, rows, piles, slots
    │   ├── card.css        # card surface + material realism
    │   └── animations.css  # flip, flight, win overlay, celebration
    ├── game/               # pure, no DOM, fully unit-tested
    │   ├── deck.js         # SUITS, RANKS, RANK_VAL, newDeck
    │   ├── rules.js        # canPlaceOnTableau, canPlaceOnFoundation, isWon
    │   ├── state.js        # newGame, snapshot/undo, applyMove
    │   └── serialize.js    # compact save encode/decode
    ├── ui/
    │   ├── layout.js       # layoutSizes(), card width → render mode
    │   ├── cardview.js     # cardEl(): simple vs rich face
    │   ├── board.js        # render()
    │   ├── drag.js         # pointer drag/drop, findDropTarget
    │   └── animate.js      # flip host, stock flight, win celebration
    ├── services/
    │   └── stats.js        # localStorage + optional Puter KV
    └── vendor/
        └── cardmeister.js  # vendored public-domain deck
```

### Module boundaries

`game/` is pure: it imports nothing from `ui/` or `services/`, touches no DOM, and every function is directly callable from a test.

`ui/` reads game state and renders. `services/stats.js` depends only on `game/serialize.js` and the global `puter`.

**Import cycle to avoid:** `board.js` must attach drag handlers from `drag.js`, and `drag.js` must trigger a re-render from `board.js`. Rather than importing each other, `main.js` owns a `requestRender()` function and passes it into both. This is the one structural trap in the split; everything else is a straight extraction.

### Data flow

```
pointer event → drag.js → rules.js (validate)
                        → state.js (apply + snapshot)
                        → requestRender() → board.js → cardview.js → DOM
                        → stats.js (debounced save)
```

## Testing

Vitest over `src/game/**` only:

- `deck.js` — 52 unique cards, correct suit and rank distribution, shuffle preserves the multiset.
- `rules.js` — tableau placement (alternating colour, descending rank, King onto empty), foundation placement (matching suit, ascending, Ace onto empty), rejection of face-down targets, win detection.
- `state.js` — move application, the flip-exposed-card side effect, undo restoring exact prior state, history cap.
- `serialize.js` — round-trip fidelity for a full board, an empty board, and a nearly-won board; rejection of a malformed or wrong-version payload.

Rendering, drag, and animations are verified by playing the game. No DOM or e2e tests.

## Risks

- **The vendored deck is unmaintained.** Mitigated by it being a single self-contained public-domain file with no dependencies — it cannot break from upstream, and it can be edited directly if needed.
- **Grain and gloss on many cards could cost frames on lower-end hardware.** Mitigated by rich mode being desktop-only, one shared background image rather than per-card, and no blend modes on animating elements.
- **The card art has its own aesthetic** — classic engraved courts against the app's flat modern chrome. Accepted deliberately: "real deck" was the stated goal.
- **Resume can restore a board that disagrees with a newer save elsewhere.** Resolved by last-write-wins on timestamp. There is no merge, and none is warranted for a single-player game.

## Open questions

None.
