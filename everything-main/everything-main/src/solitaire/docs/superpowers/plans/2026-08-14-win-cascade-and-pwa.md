# Win Cascade and PWA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current win celebration with the classic Windows Solitaire card cascade, and make the game an installable, offline-capable PWA with app-store listing material.

**Architecture:** The cascade runs on a `<canvas>` overlay that is never cleared, so each card stamps a trail — the effect that makes the original recognisable. Physics is extracted into a pure, tested module. PWA support follows the pattern already proven in `../checkers` (manifest, icon set, meta tags, store listing, Playwright-driven image tooling), extended with a runtime-caching service worker so the game is genuinely playable offline.

**Tech Stack:** Plain JavaScript ES modules, Vite, Vitest. Playwright and sharp for image generation, installed `--no-save` and never added to `package.json`.

**Spec:** `docs/superpowers/specs/2026-08-14-solitaire-vite-and-card-realism-design.md` (amended by this increment — see Task 0)

**Reference implementation:** `/Users/miikakuisma/Development/checkers` — same owner, same deployment target. Match its structure unless this plan says otherwise.

## Global Constraints

- **Plain JavaScript, ES modules.** No TypeScript, no framework, no CSS preprocessor.
- **No new runtime dependencies.** `package.json` gains nothing. Playwright and sharp are installed with `npm i --no-save` for image generation only.
- **`src/game/**` must never import from `src/ui/**` or `src/services/**`, and must never touch `document`, `window`, or `puter`.**
- **Any per-card visual variation must be deterministic where it is re-rendered.** The cascade is an exception: each card is launched once and animated to completion, so `Math.random()` is correct there — unlike `render()`, which rebuilds every card on every move.
- **`prefers-reduced-motion: reduce` must skip the cascade entirely** and show the win overlay immediately. A full-screen bouncing animation is exactly what that media query exists for.
- **The service worker must not break development.** Register only under `import.meta.env.PROD`.
- **Headless Chrome on macOS enforces a ~500px minimum layout viewport.** A `--window-size` below 500 yields a cropped screenshot of a 500px-wide layout that looks like board overflow but is not. Use ≥560px for any narrow capture.
- Existing behaviour must not regress: 121 tests must still pass, and `npm run build` must succeed.

---

## Task 0: Amend the spec

**Files:** Modify `docs/superpowers/specs/2026-08-14-solitaire-vite-and-card-realism-design.md`

The spec is the binding authority and currently describes the celebration this increment replaces, and says nothing about PWA support. Amend before implementing, so the spec leads the code rather than trailing it.

- [ ] **Step 1: Replace the win-celebration description**

Find the win celebration in the current spec (a fountain of cards flying outward from the foundations and fading). Replace with the cascade:

> Cards launch one at a time from the foundations, highest rank first, cycling the four piles. Each is thrown with a random horizontal velocity and an upward kick, falls under gravity, and bounces off the bottom **and both side edges** of the viewport, losing energy on every bounce until it comes to rest. The canvas is never cleared between frames, so each card stamps a trail; the accumulated trails are the effect. The cascade ends when every card has settled, when the player clicks, or on a safety timeout, after which the win overlay appears.
>
> Side bounces are a deliberate departure from the original, which let cards exit sideways. With damping, bouncing off all four edges produces the "trailing stacks" the owner asked for — cards pile up at the bottom instead of sailing off-screen.

- [ ] **Step 2: Add a PWA and distribution section**

Cover: installable via `site.webmanifest`; offline-capable via a runtime-caching service worker (cache-first with network fallback, navigation requests fall back to the cached shell); a full icon set; social preview and search metadata; and `STORE_LISTING.md` as the single source for listing copy. Note explicitly that offline capability is a deliberate extension beyond the `checkers` reference, which is manifest-only, because solitaire is entirely client-side and benefits from working on a plane.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/
git commit -m "Amend spec for the win cascade and PWA support"
```

---

## Task 1: Cascade physics (pure, tested)

**Files:**
- Create: `src/ui/cascade-physics.js`
- Test: `src/ui/cascade-physics.test.js`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `GRAVITY`, `BOUNCE_DAMPING`, `WALL_DAMPING`, `FLOOR_FRICTION`, `REST_SPEED` — tuning constants
  - `launchVelocity(random): { vx, vy }` — a random throw; `random` injected for testability
  - `stepCard(card, dt, bounds): void` — advances one card in place. `card` is `{ x, y, vx, vy, settled }`; `bounds` is `{ width, height, cardW, cardH }`
  - `isSettled(card, bounds): boolean`

This is the only part of the cascade that can be unit-tested, so it carries the correctness weight. Everything in Task 2 is drawing.

- [ ] **Step 1: Write the failing test**

Create `src/ui/cascade-physics.test.js` covering:

```js
import { describe, it, expect } from 'vitest';
import { stepCard, isSettled, launchVelocity, GRAVITY } from './cascade-physics.js';

const bounds = { width: 1000, height: 800, cardW: 100, cardH: 140 };
const card = (over = {}) => ({ x: 500, y: 100, vx: 0, vy: 0, settled: false, ...over });

describe('stepCard', () => {
  it('accelerates downward under gravity', () => {
    const c = card();
    stepCard(c, 16, bounds);
    expect(c.vy).toBeCloseTo(GRAVITY * 16, 6);
    expect(c.y).toBeGreaterThan(100);
  });

  it('bounces off the floor, reversing and damping vertical velocity', () => {
    const c = card({ y: bounds.height - bounds.cardH - 1, vy: 1 });
    stepCard(c, 16, bounds);
    expect(c.y).toBeLessThanOrEqual(bounds.height - bounds.cardH);
    expect(c.vy).toBeLessThan(0);          // now moving up
    expect(Math.abs(c.vy)).toBeLessThan(1); // and slower than it arrived
  });

  it('bounces off the left wall', () => {
    const c = card({ x: 1, vx: -1 });
    stepCard(c, 16, bounds);
    expect(c.x).toBeGreaterThanOrEqual(0);
    expect(c.vx).toBeGreaterThan(0);
  });

  it('bounces off the right wall', () => {
    const c = card({ x: bounds.width - bounds.cardW - 1, vx: 1 });
    stepCard(c, 16, bounds);
    expect(c.x).toBeLessThanOrEqual(bounds.width - bounds.cardW);
    expect(c.vx).toBeLessThan(0);
  });

  it('never leaves the viewport, however hard it is thrown', () => {
    const c = card({ vx: 50, vy: -50 });
    for (let i = 0; i < 2000; i++) stepCard(c, 16, bounds);
    expect(c.x).toBeGreaterThanOrEqual(0);
    expect(c.x).toBeLessThanOrEqual(bounds.width - bounds.cardW);
    expect(c.y).toBeLessThanOrEqual(bounds.height - bounds.cardH);
  });

  it('comes to rest on the floor rather than bouncing forever', () => {
    const c = card({ vx: 2, vy: -2 });
    let steps = 0;
    while (!isSettled(c, bounds) && steps < 5000) { stepCard(c, 16, bounds); steps++; }
    expect(steps).toBeLessThan(5000);
    expect(isSettled(c, bounds)).toBe(true);
    expect(c.y).toBeCloseTo(bounds.height - bounds.cardH, 0);
  });

  it('does nothing to a settled card', () => {
    const c = card({ settled: true, x: 10, y: 20 });
    stepCard(c, 16, bounds);
    expect(c.x).toBe(10);
    expect(c.y).toBe(20);
  });

  it('is frame-rate independent over the same elapsed time', () => {
    const a = card({ vx: 0.3, vy: -0.4 });
    const b = card({ vx: 0.3, vy: -0.4 });
    for (let i = 0; i < 10; i++) stepCard(a, 32, bounds);
    for (let i = 0; i < 20; i++) stepCard(b, 16, bounds);
    expect(a.y).toBeCloseTo(b.y, 0);
  });
});

describe('launchVelocity', () => {
  it('is deterministic given a deterministic random source', () => {
    expect(launchVelocity(() => 0.5)).toEqual(launchVelocity(() => 0.5));
  });

  it('always throws upward', () => {
    for (const r of [0, 0.25, 0.5, 0.75, 0.999]) {
      expect(launchVelocity(() => r).vy).toBeLessThan(0);
    }
  });

  it('throws both left and right across the random range', () => {
    const signs = new Set([0, 0.1, 0.4, 0.6, 0.9, 0.99].map(r => Math.sign(launchVelocity(() => r).vx)));
    expect(signs.size).toBeGreaterThan(1);
  });
});
```

- [ ] **Step 2: Run and verify it fails**

Run: `npx vitest run src/ui/cascade-physics.test.js` — expect FAIL, module not found.

- [ ] **Step 3: Implement `src/ui/cascade-physics.js`**

Units are pixels and milliseconds throughout. `y` grows downward.

```js
// Pixels and milliseconds. y grows downward, so gravity is positive.
export const GRAVITY = 0.0022;        // px/ms^2
export const BOUNCE_DAMPING = 0.78;   // vertical energy kept per floor bounce
export const WALL_DAMPING = 0.72;     // horizontal energy kept per wall bounce
export const FLOOR_FRICTION = 0.985;  // horizontal drag applied on each floor contact
export const REST_SPEED = 0.04;       // px/ms below which a floored card is at rest

export function launchVelocity(random = Math.random) {
  const dir = random() < 0.5 ? -1 : 1;
  return {
    vx: dir * (0.22 + random() * 0.38),
    vy: -(0.18 + random() * 0.42),
  };
}

export function stepCard(card, dt, bounds) {
  if (card.settled) return;
  const maxX = bounds.width - bounds.cardW;
  const maxY = bounds.height - bounds.cardH;

  card.vy += GRAVITY * dt;
  card.x += card.vx * dt;
  card.y += card.vy * dt;

  if (card.x < 0) { card.x = 0; card.vx = -card.vx * WALL_DAMPING; }
  else if (card.x > maxX) { card.x = maxX; card.vx = -card.vx * WALL_DAMPING; }

  if (card.y > maxY) {
    card.y = maxY;
    card.vy = -card.vy * BOUNCE_DAMPING;
    card.vx *= FLOOR_FRICTION;
  }

  if (isSettled(card, bounds)) {
    card.settled = true;
    card.y = maxY;
    card.vx = 0;
    card.vy = 0;
  }
}

export function isSettled(card, bounds) {
  if (card.settled) return true;
  const onFloor = card.y >= bounds.height - bounds.cardH - 0.5;
  return onFloor && Math.abs(card.vy) < REST_SPEED && Math.abs(card.vx) < REST_SPEED;
}
```

- [ ] **Step 4: Run and verify it passes**

Run: `npx vitest run src/ui/cascade-physics.test.js`, then `npm test`.

If the "comes to rest" or "frame-rate independent" tests fail, **tune the constants rather than loosening the assertions** — a cascade that never settles is a real defect, and frame-rate dependence means the animation runs at different speeds on different displays.

- [ ] **Step 5: Commit**

```bash
git add src/ui/cascade-physics.js src/ui/cascade-physics.test.js
git commit -m "Add pure cascade physics with bounce damping"
```

---

## Task 2: Canvas cascade

**Files:**
- Modify: `src/ui/animate.js`
- Modify: `src/styles/animations.css`

**Interfaces:**
- Consumes: `stepCard`, `isSettled`, `launchVelocity` from `./cascade-physics.js`; `SUITS`, `RANKS`, `SUIT_COLOR` from `../game/deck.js`
- Produces: `createAnimator({ boardEl })` keeps its existing shape — `{ afterCard, queueFlip, queueFlight, startCelebration, cancelCelebration }`. `main.js` must not need changes.

Replace the body of `startCelebration` / `cancelCelebration`. Everything else in `animate.js` stays.

- [ ] **Step 1: Build the card image atlas**

The vendored deck renders each card as an `<img>` whose `src` is a `data:image/svg+xml` URI, in light DOM with no shadow root. Harvest those once:

- For each of the 52 cards, create a detached `<playing-card cid="...">`, read its inner `<img>.src`, and load it into an `Image()`.
- They are data URIs, so there is no network — but decoding is still async. `await Promise.all(images.map(img => img.decode().catch(() => {})))` before the first frame.
- **Fallback:** if the custom element has not been defined (script blocked, or an old browser), draw a plain white rounded rectangle with the rank and suit in the card's colour. The cascade must never simply fail to appear.

- [ ] **Step 2: Create the canvas overlay**

```
position: fixed; inset: 0; z-index: 60; pointer-events: none;
```

Size the backing store to `innerWidth * devicePixelRatio` by `innerHeight * devicePixelRatio` and scale the 2D context by `devicePixelRatio`, so trails are crisp on retina displays. Put the rule in `animations.css` and create the element in JS.

- [ ] **Step 3: Launch and animate**

- Card size and the launch origin come from the real foundation piles: read `.pile[data-kind="foundation"][data-index="N"]`'s bounding rect, exactly as the current implementation does, and hide the pile as its cards leave.
- Launch one card every ~90ms, cycling the four foundations, taking the highest rank first (King down to Ace) so the piles visibly drain.
- Each frame: for every launched, unsettled card, `stepCard(...)`, then `drawImage` at its position. **Never clear the canvas** — that omission is the entire effect.
- Cap `dt` at ~34ms so a background tab does not teleport cards across the screen on return.

- [ ] **Step 4: Termination**

End the cascade and call the `onDone` callback when any of these happens:
- every card has been launched and `isSettled` is true for all of them
- the player clicks or taps anywhere (attach a one-shot listener on `window`; the canvas itself is `pointer-events: none`)
- a safety timeout of 20 seconds elapses
- the viewport is resized (resizing would either stretch the trails or force a clear; ending cleanly is better than either)

`cancelCelebration()` must remove the canvas, drop the listeners, cancel the animation frame and timers, and restore the foundation piles' visibility — the same teardown discipline the current implementation already has.

- [ ] **Step 5: Honour reduced motion**

```js
if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { onDone(); return; }
```

Check this at the top of `startCelebration`, before building anything.

- [ ] **Step 6: Verify in a browser**

Win a game (stage it through the save format in `localStorage` if that is faster than playing one out) and confirm: cards launch one at a time from the foundations; they bounce off the bottom and both sides; trails accumulate; cards come to rest in piles rather than bouncing forever; a click ends it early; the win overlay appears afterwards; New Game during the cascade cleans up with no leftover canvas. Then set the OS reduced-motion preference and confirm the overlay appears immediately with no canvas at all.

- [ ] **Step 7: Commit**

```bash
git add src/ui/animate.js src/styles/animations.css
git commit -m "Replace win celebration with the classic bouncing cascade"
```

---

## Task 3: PWA — manifest, icons, service worker, metadata

**Files:**
- Create: `public/site.webmanifest`, `public/sw.js`, `public/robots.txt`, `public/sitemap.xml`
- Create: `tools/icon.html`, `tools/render-icons.mjs`, `tools/og-image.html`, `tools/render-og.mjs`
- Create: `public/favicon.ico`, `favicon-16x16.png`, `favicon-32x32.png`, `apple-touch-icon.png`, `icon-128.png`, `icon-192.png`, `icon-512.png`, `og-image.png`
- Modify: `index.html`, `src/main.js`, `README.md`

- [ ] **Step 1: Design and render the icon**

Build the icon from the app's own materials rather than inventing a new mark: the vendored deck's Ace of Spades on the felt green, with the card's corner radius. `tools/icon.html` renders it at 512×512; `tools/render-icons.mjs` drives Playwright to screenshot it and `sharp` to emit each size. `png-to-ico` produces `favicon.ico`.

Install the tooling `--no-save` so `package.json` is untouched:

```sh
npm i --no-save playwright sharp png-to-ico && npx playwright install chromium
```

Sizes to emit: 16, 32, 48 (into the `.ico`), 128, 180 (`apple-touch-icon`), 192, 512.

- [ ] **Step 2: Write `public/site.webmanifest`**

Follow `../checkers/public/site.webmanifest`. `start_url: "."`, `display: "standalone"`, `theme_color` and `background_color` from the felt (`#124e3c`), 192 and 512 icons, plus a `description`.

- [ ] **Step 3: Write the service worker**

This is the deliberate extension beyond the checkers reference. Vite hashes asset filenames, so a hand-written precache list would go stale on every build. Use runtime caching instead — roughly 30 lines, no build integration, no dependency:

- `install`: `skipWaiting()`.
- `activate`: delete any cache whose name is not the current `CACHE` constant, then `clients.claim()`.
- `fetch`: ignore non-GET and cross-origin requests. For navigations, try the network and fall back to the cached shell so a cold offline launch still boots. For everything else, serve cache-first and populate the cache from successful responses.

Bump the `CACHE` constant to invalidate. Register from `src/main.js`, guarded:

```js
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
```

`import.meta.env.PROD` keeps the dev server free of a stale-cache-shaped mystery. The `.catch(() => {})` matters — registration rejects on `file://` and in some private modes, and an unhandled rejection in the console is a bug report waiting to happen.

- [ ] **Step 4: Fill in `index.html`'s head**

Mirror `../checkers/index.html`: description, canonical, the full `og:*` and `twitter:*` sets, icon links, manifest link, light and dark `theme-color`, and a JSON-LD `WebApplication`/`VideoGame` block. Canonical host is `https://solitaire.puter.com/`. Keep the existing `js.puter.com` script tag and the "Powered by Puter" footer link.

- [ ] **Step 5: Render the social preview**

`tools/og-image.html` + `tools/render-og.mjs` → `public/og-image.png` at 1200×630, the ratio Facebook, LinkedIn, Slack, and X's large card all render. Show a recognisable board with a few face-up cards, not an empty table.

- [ ] **Step 6: Update the README**

Add a "Regenerating images" section in the style of `../checkers/README.md`, stating that `playwright`, `sharp`, and `png-to-ico` are deliberately not project dependencies. Document the service worker: what it caches, that it is production-only, and how to bust it.

- [ ] **Step 7: Verify**

`npm run build`, then serve `dist/` and check: the manifest parses and Chrome offers installation; the icons resolve; **load once online, then go offline and reload — the game must still boot and be playable**; the dev server registers no service worker; `npm test` still passes.

- [ ] **Step 8: Commit**

```bash
git add public/ tools/ index.html src/main.js README.md
git commit -m "Add PWA support: manifest, icons, offline service worker, metadata"
```

---

## Task 4: Store listing and screenshots

**Files:**
- Create: `STORE_LISTING.md`, `store/description.md`, `tools/store-screenshots.mjs`
- Create: `store/screenshots/{1920x1080,1024x768,1080x2280}/*.png`

- [ ] **Step 1: Write `STORE_LISTING.md`**

Match the section structure of `../checkers/STORE_LISTING.md`: name, tagline, short description, long description, key features, who it is for, highlights in this version, keywords, category, and a caption per screenshot. It is the single source — `store/description.md` is only a signpost to it, so a submission form and a screenshot can never disagree.

Content should be honest about what the game actually is: Klondike solitaire, draw-one, unlimited undo, real playing-card art on larger screens, plain readable cards on phones, plays offline, and syncs your record across devices when signed in to Puter.

- [ ] **Step 2: Write `tools/store-screenshots.mjs`**

Follow `../checkers/tools/store-screenshots.mjs`. Stage each scene **through the app's own save format** — write a serialized board into `localStorage['solitaire.save.v1']` and let the app restore it — so every position shown is one the real game produced. Document that in the file header, as checkers does.

Four scenes:
1. A fresh deal on a wide screen — the rich card art, the felt, the full tableau
2. Mid-game with two foundations building and a card mid-drag
3. The win cascade in flight, trails accumulating
4. The same game narrow, showing the plain readable cards on a phone

Three sizes each: 1920×1080, 1024×768, 1080×2280 (portrait).

- [ ] **Step 3: Generate and inspect**

Run the tool and **look at every image**. A store screenshot with a clipped card or an empty board is worse than none.

- [ ] **Step 4: Commit**

```bash
git add STORE_LISTING.md store/ tools/store-screenshots.mjs
git commit -m "Add app store listing copy and screenshots"
```

---

## Self-Review

**Spec coverage:** cascade behaviour (Task 0 Step 1, Tasks 1-2), PWA and distribution (Task 0 Step 2, Tasks 3-4), offline capability (Task 3 Step 3), reduced motion (Task 2 Step 5).

**Placeholder scan:** no TBDs. Constants, sizes, and the canonical host are all concrete.

**Type consistency:** `stepCard`/`isSettled` take the same `card` and `bounds` shapes in Task 1's tests and Task 2's consumer. `createAnimator`'s returned shape is unchanged, so `main.js` needs no edit for the cascade — only for the service worker registration.
