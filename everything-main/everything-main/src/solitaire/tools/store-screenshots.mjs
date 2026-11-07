/**
 * Renders the app-store screenshots to store/screenshots/:
 * 12 PNGs across 3 sizes (1920x1080, 1024x768, 1080x2280). Each folder has
 * four scenes, but the fourth one is NOT the same scene in every folder --
 * see "Scene set differs by folder" below before assuming you can add a
 * fifth size and get 4x it for free.
 *
 * Every scene is staged through the app's own persistence format: a
 * serialized game is written to localStorage['solitaire.save.v1'] (the
 * SAVE_KEY in src/services/stats.js) before the page loads, and main.js's
 * ordinary boot-time restore (restoreLocal()/adoptSave(), both synchronous)
 * puts it on screen. Nothing here reaches into the DOM to fake a card, and
 * every save is built with src/game/serialize.js's real serialize() -- the
 * exact function the browser itself calls on every move.
 *
 * The *positions* behind two of those saves are themselves produced by the
 * real engine, not hand-typed piles: FRESH_SAVE is src/game/state.js's
 * createGame() dealing a fixed-seed shuffle (see mulberry32 below), and
 * MID_GAME_SAVE is that same deal walked forward by a small greedy player
 * (tryFoundationFromWaste/tryFoundationFromTableau/tryRevealMove/
 * drawFromStock further down) that calls nothing but the actual
 * applyMove/canPlaceOnFoundation/canPlaceOnTableau/drawFromStock exported by
 * state.js and rules.js. Every move it makes is checked the same way the UI
 * checks a drag-and-drop, so an illegal position can't slip through.
 *
 * WIN_SAVE is the one exception, and it is hand-arranged: three foundations
 * complete (A-K) and the fourth at Q, with the missing King sitting alone in
 * the waste, tableau and stock both empty. Klondike ships no solver here to
 * replay a full game to that point the way the greedy player above reaches
 * a plausible mid-game, so the position itself is authored rather than
 * played -- but it still passes serialize.js's own round trip (52 distinct
 * cards, correct pile shapes), and the winning move and the entire cascade
 * are performed live in the real app: the tool clicks the waste card the
 * same way a player would, and src/ui/drag.js's autoMove() -> applyMove()
 * -> checkWin() -> src/ui/animate.js's startCelebration() run for real.
 *
 * Scene set differs by folder. All three folders used to share an identical
 * 4-scene set, with scene 4 (the phone-width board) forced narrow via an
 * injected #board max-width even in the two landscape folders. Reviewed
 * against the actual images: at 1920x1080/1024x768 that scene is a small
 * board adrift in a mostly-empty green field (content fills roughly a fifth
 * of the frame) -- an honest demonstration of simple mode, but a store
 * image that reads as broken or unfinished. The portrait folder is narrow
 * by construction (432 CSS px, well under the phone breakpoint) and so is
 * naturally full-bleed there; a landscape frame of that same deliberately
 * narrow layout is mostly empty felt no matter how it's staged. So: the
 * phone scene ('04-plain-cards-on-phones') now lives ONLY in 1080x2280.
 * The two landscape folders get a different fourth scene instead --
 * '04-you-won', the win overlay (the "You won" card with the move count and
 * Play again button) -- which is centred and fills the frame properly, and
 * pairs naturally with the cascade shot before it. See WIN_OVERLAY_SCENE
 * below for how it's staged. This is intentional, not an oversight: see
 * STORE_LISTING.md and store/description.md, which both call it out too.
 *
 * Two footguns specific to this app, both worth knowing before touching the
 * SIZES/SCENES below:
 *
 * - The cascade ends on the next pointerup anywhere on the page (see
 *   animate.js's onPointerEnd) and on a 'resize' event. Once the
 *   '03-win-cascade' scene's triggering click has landed, this script does
 *   not send another pointer event or touch the viewport size until after
 *   that scene's screenshot is taken. '04-you-won' deliberately breaks this
 *   rule in its OWN separate browser context, on purpose -- see
 *   WIN_OVERLAY_SCENE below.
 * - Rich card art (src/vendor/cardmeister.js, a <playing-card> custom
 *   element) only appears once boardEl.clientWidth clears
 *   RICH_MODE_MIN_CARD_W (76px of card width -- see src/ui/layout.js);
 *   below that the board renders the plain top-left rank-and-suit fallback
 *   instead. The '04-plain-cards-on-phones' scene (now 1080x2280 only, see
 *   above) needs that fallback for real, so rather than shrinking the
 *   Playwright viewport further (which is what that folder already does to
 *   land on its target pixel size), it constrains #board itself with an
 *   injected style tag and dispatches a synthetic 'resize' so the app's own
 *   resize handler re-renders at the new width -- verified below by reading
 *   boardEl.dataset.mode, not assumed.
 *
 * launchVelocity() (cascade-physics.js) draws from Math.random(), uncontrolled
 * by anything here, so the win-cascade scene's exact composition varies
 * between runs -- unlike the other scenes, which are fully deterministic.
 *
 * cascadeWait was originally tuned to ~700ms so the trail stayed sparse and
 * legible. Reviewed against the actual images, that was a mistake in the
 * other direction: at 700ms nothing has settled yet, so the bottom ~45% of
 * every '03-win-cascade.png' was bare felt -- and settled piles
 * accumulating at the floor are exactly what makes this recognisably the
 * Windows-Solitaire cascade rather than cards merely captured mid-air.
 *
 * The fix is NOT simply "wait longer", though -- a first pass at waiting
 * 8-10s (the ballpark that "last card launches at ~4.7s, worst-case settle
 * ~6.7s after that" suggests) rendered every folder as a solid, nearly
 * felt-free wall. The reason is the frame loop's own doc comment: the
 * canvas is NEVER cleared, and a card that has reached the floor keeps
 * being redrawn every single frame at its (slowly sliding, wall-bouncing)
 * resting position -- so screen time at the floor, not just cards arriving
 * there, is what fills the canvas. A few seconds of 52 cards each getting
 * repainted ~60 times/sec at nearly the same spot saturates the whole lower
 * half solid long before anything is actually "done settling" in a
 * physical sense. cascadeWait is tuned much shorter than that estimate
 * suggested -- 1.8s/1.5s/0.85s below -- landing while the earliest-launched
 * ranks (K/Q/J, sometimes 10) have reached the floor and formed a few
 * visibly distinct piles, but before their own continued on-floor redraws
 * have had enough frames to smear across the width. Candidates were
 * generated per size and picked by looking at the frames (see
 * task-4-report.md); the portrait folder needed a noticeably shorter wait
 * than either landscape folder, not just a scaled-down one -- its narrower
 * canvas concentrates the same 52 cards into less area, so it saturates
 * faster for a given elapsed time even though GRAVITY (cascade-physics.js,
 * a constant pixels/ms^2) makes fall/settle time itself governed by window
 * height, not width. If a folder's '03-win-cascade.png' ever comes out
 * unluckily composed (an unlucky launchVelocity() draw sending most cards
 * into one corner or one narrow lane), just rerun the script for that
 * folder -- see task-4-report.md.
 *
 * Also: an actual signed-in Puter session would let main.js's load-time
 * cloud-restore silently replace the staged local save with whatever is in
 * that account's KV store (this bit a previous task in this increment,
 * working against a real browser profile with a live session -- see
 * task-2-report.md). Each context here is a fresh, disposable Chromium
 * profile, and every one additionally routes js.puter.com to abort(), so
 * `puter` is never even defined and every codepath in
 * src/services/puter-sync.js short-circuits on puterAvailable() === false
 * with no network round trip at all.
 *
 * Playwright is only needed to regenerate the pictures, so it is not a
 * project dependency:
 *
 *   npm i --no-save playwright && npx playwright install chromium
 *   npm run dev                        # serves the app the shots are taken of
 *   node tools/store-screenshots.mjs [port] [filter]
 *
 * `filter`, if given, is matched against "<size-dir>/<scene-name>" for every
 * planned shot (plain String#includes, not a regex) and only matching shots
 * are (re)rendered -- e.g. `node tools/store-screenshots.mjs 5173 03-win-cascade`
 * regenerates just the three cascade shots, or `1920x1080` regenerates only
 * that folder. Useful because a byte-different PNG for an unrelated,
 * unchanged scene is noise in a diff -- default (no filter) still renders
 * every planned shot, so a plain `node tools/store-screenshots.mjs` remains
 * the correct way to regenerate the full set from scratch.
 */
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { RANKS, SUIT_COLOR, newDeck } from '../src/game/deck.js';
import { createGame, applyMove, drawFromStock } from '../src/game/state.js';
import { canPlaceOnFoundation, canPlaceOnTableau } from '../src/game/rules.js';
import { serialize } from '../src/game/serialize.js';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const port = process.argv[2] || '5173';
const filter = process.argv[3] || null;
const BASE = `http://localhost:${port}/`;
const OUT = new URL('../store/screenshots', import.meta.url).pathname;

// Matches src/services/stats.js's SAVE_KEY -- duplicated here rather than
// imported because that module reads `localStorage` at call time and is not
// meant to be pulled into a Node process.
const SAVE_KEY = 'solitaire.save.v1';

// Deterministic, dependency-free PRNG so the same seed always deals the same
// shuffle (state.js's newDeck() takes a `random` function; Math.random has
// no seed to fix). Public-domain mulberry32.
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- Greedy player for MID_GAME_SAVE. Each helper is a thin wrapper around
// the real state.js/rules.js functions -- it only ever calls applyMove()
// after the matching canPlaceOn*() check has already passed, exactly like
// drag.js's autoMove(), so every move it commits is one the UI would also
// allow. ----

function tryFoundationFromWaste(game) {
  if (!game.waste.length) return false;
  const card = game.waste[game.waste.length - 1];
  for (let i = 0; i < 4; i++) {
    if (canPlaceOnFoundation(card, game.foundations[i])) {
      const res = applyMove(game, { from: 'waste' }, { kind: 'foundation', index: i }, [card]);
      if (res.ok) return true;
    }
  }
  return false;
}

function tryFoundationFromTableau(game) {
  for (let i = 0; i < 7; i++) {
    const col = game.tableau[i];
    if (!col.length) continue;
    const top = col[col.length - 1];
    if (!top.faceUp) continue;
    for (let f = 0; f < 4; f++) {
      if (canPlaceOnFoundation(top, game.foundations[f])) {
        const res = applyMove(
          game,
          { from: 'tableau', fromIndex: i, cardIndex: col.length - 1 },
          { kind: 'foundation', index: f },
          [top],
        );
        if (res.ok) return true;
      }
    }
  }
  return false;
}

// Single-card tableau-to-tableau moves that expose a face-down card --
// i.e. the real "reveal" move a player makes for its own sake, not just to
// clear the way for a foundation play.
function tryRevealMove(game) {
  for (let i = 0; i < 7; i++) {
    const col = game.tableau[i];
    if (!col.length) continue;
    const topIdx = col.length - 1;
    const top = col[topIdx];
    if (!top.faceUp || topIdx === 0 || col[topIdx - 1].faceUp) continue;
    for (let j = 0; j < 7; j++) {
      if (j === i) continue;
      if (canPlaceOnTableau(top, game.tableau[j])) {
        const res = applyMove(
          game,
          { from: 'tableau', fromIndex: i, cardIndex: topIdx },
          { kind: 'tableau', index: j },
          [top],
        );
        if (res.ok) return true;
      }
    }
  }
  return false;
}

// Seed 5, 32 real steps (foundation-first, then reveal, then draw): lands on
// two foundations mid-build (4♠, 3♥) with the other two still empty, a
// three-card stock, sixteen cards already through the waste, and a tableau
// with real variety -- some columns still stacked deep in face-down cards,
// two freshly revealed. Chosen by inspecting several seeds/step-counts and
// picking the most legible mid-game moment; see task-4-report.md.
const MID_GAME_SEED = 5;
const MID_GAME_STEPS = 32;

function buildMidGame() {
  const game = createGame(newDeck(mulberry32(MID_GAME_SEED)));
  for (let step = 0; step < MID_GAME_STEPS; step++) {
    if (tryFoundationFromWaste(game)) continue;
    if (tryFoundationFromTableau(game)) continue;
    if (tryRevealMove(game)) continue;
    const res = drawFromStock(game);
    if (!res.ok) throw new Error(`mid-game autoplay stalled at step ${step}`);
  }
  return game;
}

const FRESH_DEAL_SEED = 42;
const FRESH_SAVE = serialize(createGame(newDeck(mulberry32(FRESH_DEAL_SEED))), 1000);
const MID_GAME_SAVE = serialize(buildMidGame(), 2000);

// Hand-arranged one-click-from-winning position -- see the file header for
// why this scene, alone, isn't autoplayed. Three suits complete (A-K),
// clubs at Q, the missing K♣ alone in the waste. moves is illustrative
// (a real game reaching this point runs well over 100), not tallied.
function suitRun(suit, count) {
  return RANKS.slice(0, count).map(rank => ({
    suit, rank, color: SUIT_COLOR[suit], faceUp: true, id: suit + rank,
  }));
}
const WIN_SAVE = serialize({
  tableau: [[], [], [], [], [], [], []],
  foundations: [suitRun('♠', 13), suitRun('♥', 13), suitRun('♦', 13), suitRun('♣', 12)],
  stock: [],
  waste: [{ suit: '♣', rank: 'K', color: SUIT_COLOR['♣'], faceUp: true, id: '♣K' }],
  moves: 121,
}, 3000);

// #board's own CSS caps it at max-width:980px and centers it (layout.css);
// this override pulls that down well under the ~596px width where
// RICH_MODE_MIN_CARD_W=76 stops being cleared (see layout.js's
// computeSizes/renderModeFor), so the board renders the plain fallback for
// real wherever it's used, not just at the portrait folder's already-narrow
// viewport.
const NARROW_MAX_WIDTH = 420;

// Common to every folder, in the order every folder shows them.
const COMMON_SCENES = [
  { name: '01-fresh-deal', save: FRESH_SAVE },
  { name: '02-mid-game', save: MID_GAME_SAVE },
  { name: '03-win-cascade', save: WIN_SAVE, triggerWin: true },
];

// 1080x2280 only (see the file header's "Scene set differs by folder"):
// the phone-width board, honestly full-bleed only at this folder's own
// narrow viewport.
const PHONE_SCENE = { name: '04-plain-cards-on-phones', save: MID_GAME_SAVE, forceNarrow: true };

// 1920x1080 and 1024x768 only: the win overlay, staged by winning the same
// way '03-win-cascade' does and then ending that real cascade early on
// purpose. animate.js's startCelebration() ends the run (and fires
// showWin()) on the next 'resize' event exactly as readily as it does on
// settling naturally or on a stray pointerup -- see animate.js's onResize.
// Reaching the overlay by waiting out a natural run would mean ~11-20s per
// shot (the safety-timer worst case) with no benefit, since nothing about
// this scene needs the cascade itself on screen; dispatching a synthetic
// 'resize' (no actual viewport change -- same technique PHONE_SCENE already
// uses for its own re-render) reaches the exact same real showWin() state
// in well under a second, deterministically. This is safe specifically
// because this scene owns its own fresh browser context: the file header's
// "no further pointer event or viewport change" rule is about not cutting
// '03-win-cascade' short mid-shot in ITS context, not a blanket rule against
// ever ending a cascade early.
const WIN_OVERLAY_SCENE = { name: '04-you-won', save: WIN_SAVE, triggerWin: true, endEarly: true };

// cascadeWait is per-size, not a single constant, because the cascade's
// bounds are window.innerWidth/innerHeight (see animate.js) -- the same
// elapsed time covers visibly less screen area, and so looks denser, on the
// narrower portrait canvas than on the two landscape ones. Landing at 8-10s
// was the first thing tried and was rejected -- see the file header's
// cascadeWait paragraph for why that saturates the whole frame solid --
// hence the much shorter 1800/1500/850ms values below. Candidates were
// generated per size and picked by looking at the frames, same discipline
// as the original 700ms tuning (see task-4-report.md).
const SIZES = [
  {
    dir: '1920x1080', viewport: { width: 1920, height: 1080 }, dsf: 1, cascadeWait: 1800,
    scenes: [...COMMON_SCENES, WIN_OVERLAY_SCENE],
  },
  {
    dir: '1024x768', viewport: { width: 1024, height: 768 }, dsf: 1, cascadeWait: 1500,
    scenes: [...COMMON_SCENES, WIN_OVERLAY_SCENE],
  },
  {
    dir: '1080x2280', viewport: { width: 432, height: 912 }, dsf: 2.5, cascadeWait: 850,
    scenes: [...COMMON_SCENES, PHONE_SCENE],
  },
];

const browser = await chromium.launch();

for (const size of SIZES) {
  const dir = join(OUT, size.dir);
  mkdirSync(dir, { recursive: true });

  for (const scene of size.scenes) {
    if (filter && !`${size.dir}/${scene.name}`.includes(filter)) continue;

    const context = await browser.newContext({
      viewport: size.viewport,
      deviceScaleFactor: size.dsf,
    });

    // Keep js.puter.com from ever loading -- see the file header. Aborting
    // the request (rather than, say, stubbing a fake `puter` global) means
    // `typeof puter` genuinely stays 'undefined', which is exactly the
    // condition puter-sync.js's puterAvailable() checks.
    await context.route('https://js.puter.com/**', route => route.abort());

    await context.addInitScript(
      ([key, save]) => localStorage.setItem(key, JSON.stringify(save)),
      [SAVE_KEY, scene.save],
    );

    const page = await context.newPage();
    page.on('pageerror', e => {
      throw e;
    });
    const response = await page.goto(BASE);
    if (!response?.ok()) {
      throw new Error(`Dev server not reachable on port ${port} — run \`npm run dev\` first.`);
    }

    // board.js renders exactly 13 .pile elements (stock, waste, 4
    // foundations, 7 tableau columns) on every call, win or lose, staged or
    // fresh -- a state-independent signal that the first render has run.
    await page.waitForFunction(() => document.querySelectorAll('#board .pile').length === 13);
    // cardview.js's rich faces are built by a <playing-card> custom element
    // whose definition loads asynchronously (see cardview.js's
    // ensureCardmeister); anything created before that script registers the
    // element sits empty until the platform's automatic upgrade reaction
    // fires, so this must resolve before the images-complete check below
    // means anything. preloadCardmeister() is called unconditionally at
    // boot, so this resolves regardless of whether this scene's initial
    // render is rich or simple.
    await page.waitForFunction(() => !!customElements.get('playing-card'));
    await page.waitForFunction(
      () =>
        document.fonts.status === 'loaded' &&
        [...document.images].every(img => img.complete && img.naturalWidth > 0),
    );
    // Confirms the *staged* save actually landed (not a default new deal --
    // e.g. from a race with some other localStorage writer), since
    // main.js's boot-time restore is synchronous and this is already true
    // by the time the render signal above fires.
    await page.waitForFunction(
      moves => document.getElementById('moves').textContent === String(moves),
      scene.save.m,
    );

    if (scene.forceNarrow) {
      await page.addStyleTag({ content: `#board{max-width:${NARROW_MAX_WIDTH}px !important;}` });
      // #board's own width changed, but nothing re-renders until something
      // fires main.js's (rAF-throttled) 'resize' listener -- dispatch one
      // rather than actually resizing the viewport, which the win scene's
      // 'resize'-ends-the-cascade behaviour makes worth avoiding as a habit
      // even here, where no cascade is running.
      await page.evaluate(() => window.dispatchEvent(new Event('resize')));
      await page.waitForFunction(() => document.getElementById('board').dataset.mode === 'simple');
      // Checked for real, not assumed (see the file header): a face-up
      // card must show the plain top-left corner and no rich <playing-card>.
      const rendersSimple = await page.evaluate(() => {
        const card = document.querySelector('#board .card.face-up');
        return !!card && !card.querySelector('playing-card') && !!card.querySelector('.corner.tl');
      });
      if (!rendersSimple) throw new Error(`${scene.name}/${size.dir}: narrow layout did not render simple-mode cards`);
    }

    // Presentation only: no scrollbars, no focus rings from the clicks below.
    await page.addStyleTag({
      content: '::-webkit-scrollbar{display:none} *{scrollbar-width:none} :focus{outline:none}',
    });

    if (scene.triggerWin) {
      // The same gesture a player uses: a plain click (no movement between
      // down and up) on the sole waste card. drag.js's onPointerUp treats
      // that as a tap and runs autoMove(), which sends K♣ to the fourth
      // foundation, completes the deck, and fires checkWin() ->
      // startCelebration() for real.
      await page.click('.pile[data-kind="waste"] .card');
      await page.waitForSelector('canvas.cascade-canvas');

      if (scene.endEarly) {
        // '04-you-won': the target is the real showWin() overlay, not the
        // cascade itself -- see WIN_OVERLAY_SCENE above for why a synthetic
        // 'resize' is the right way to get there (and why it's safe in this
        // scene specifically). Everything from the canvas being appended to
        // the 'resize' listener being armed runs synchronously in
        // animate.js's startCelebration() with no intervening await, so the
        // canvas selector resolving above already proves the listener is
        // attached.
        await page.evaluate(() => window.dispatchEvent(new Event('resize')));
        await page.waitForSelector('#win.show');
        // #win.show .win-card's own winIn keyframe (animations.css) runs
        // .55s -- let it land at its resting transform/opacity instead of
        // catching it mid-motion.
        await page.waitForTimeout(650);
        // Park the pointer off the Play again button so it isn't caught
        // hovered -- the cascade's own pointerup listener is already torn
        // down by this point (state.end() ran removeListeners()), so this
        // plain mouse move cannot re-trigger anything cascade-related.
        await page.mouse.move(2, 2);
      } else {
        // '03-win-cascade': deliberately mid-flight, and deliberately not
        // too early. The canvas is never cleared (every frame stamps a new
        // position on top of the last -- see animate.js's own comment on
        // this), which makes this a trade between two failure modes rather
        // than "wait longer is always better": too short (the original
        // 700ms) leaves nothing settled and the bottom of the frame bare
        // felt; too long saturates the whole screen into a solid wall of
        // overlapping cards with no felt left anywhere (a never-cleared
        // canvas keeps repainting already-settled cards every frame too --
        // see the file header's cascadeWait paragraph for why that rules
        // out simply waiting for the whole run to finish). size.cascadeWait
        // (see SIZES above) targets the middle -- arcs still legible near
        // the top, real settled piles accumulated along the bottom. No further
        // pointer event or viewport change happens between the click above
        // and the screenshot below -- either one ends the cascade early
        // (see the file header).
        await page.waitForTimeout(size.cascadeWait);
      }
    } else {
      // Park the pointer off every control -- a click leaves it where it
      // landed, and a hovered pile would keep its hover styling.
      await page.mouse.move(2, 2);
      await page.waitForTimeout(300);
    }

    const path = join(dir, `${scene.name}.png`);
    await page.screenshot({ path });
    console.log(`wrote ${path}`);
    await context.close();
  }
}

await browser.close();
