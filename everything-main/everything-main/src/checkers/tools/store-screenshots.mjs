/**
 * Renders the promotional app-store assets to store/screenshots/:
 * 4 scenes x 3 sizes (1920x1080, 1024x768, 1080x2280) = 12 PNGs.
 *
 * These are not raw screenshots. Each asset is a composition: a headline, a
 * supporting line, the brand lockup, and a window showing a real, contiguous
 * region of the running app, laid out on a brand-coloured canvas and rendered
 * at the exact size the store asks for.
 *
 * It runs in two passes:
 *
 *   1. The app is opened at a phone-width viewport (432 CSS px) at 3x, staged
 *      into the state the scene is about, then resized to the exact height its
 *      own content wants so no grid row stretches. Each crop is a clip taken
 *      between two measured element edges, padded into the gaps between cards,
 *      so no edge of a crop ever lands mid-text.
 *   2. Each crop is placed in a composition page sized to the target asset and
 *      screenshotted. The window is scaled up to the largest factor that still
 *      fits its box (roughly 1.2x to 2.1x), which is what keeps the app's own
 *      15px type readable once a store draws the asset at a third of its size.
 *
 * Light theme only — a store listing reads as one set of pictures, and
 * shipping half of them dark makes it read as two.
 *
 * Positions are staged through the app's own persistence format (a saved game
 * in localStorage restores on load), so every board, capture list, clock
 * reading and move list is produced by the real app. The one exception is the
 * online-invite scene, which puts the online card into its real hosting state
 * with a sample invite code (no live peer connection in headless).
 *
 * Playwright is only needed to regenerate the pictures, so it is not a project
 * dependency:
 *
 *   npm i --no-save playwright && npx playwright install chromium
 *   npm run dev                      # serves the app the shots are taken of
 *   node tools/store-screenshots.mjs [port]
 */
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, copyFileSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'store', 'screenshots');
const port = process.argv[2] || '5173';
const APP = `http://localhost:${port}/`;
// The compositions are served from a route handler rather than file:// so the
// fonts load under an ordinary origin instead of an opaque one.
const PROMO = 'http://promo.local/';

/**
 * A saved move is a whole turn's path — every square visited, PDN numbering
 * 1-32 — not a chess-style [from, to, promotion] tuple (see
 * src/game/persistence.js). Checkers has no "famous game" to transcribe the
 * way chess.puter.com's tool used Morphy's Opera Game, so these games are
 * self-play: both sides played by the real engine's Medium search
 * (src/engine/ai.js) against a fixed seed, then cut at the ply that stages
 * the feature the shot is about. Every position below is one the engine
 * itself produced and validated, not a hand-typed board.
 */

// Seed 4, cut at ply 17: a middlegame with three men off each side, White
// (the player) to move and nothing forced, so the man on 14 can be picked up
// to show its two quiet moves as hints.
const MIDDLEGAME = [
  [12, 16], [22, 18], [9, 13], [18, 14], [10, 17], [21, 14], [6, 10],
  [25, 21], [10, 17], [21, 14], [16, 19], [23, 16], [11, 20], [30, 25],
  [7, 11], [26, 23], [3, 7],
];

// Seed 13, cut at ply 19: an even middlegame, four men off each side and
// nothing forced, so the board behind the settings reads as a live game
// rather than a puzzle.
const EVEN_MIDDLEGAME = [
  [10, 15], [22, 18], [15, 22], [25, 18], [6, 10], [18, 14], [9, 18],
  [23, 14], [10, 17], [21, 14], [11, 15], [29, 25], [7, 10], [14, 7],
  [3, 10], [25, 21], [8, 11], [26, 23], [1, 6],
];

// Seed 7, cut at ply 47: a five-a-side endgame with a White king crowned
// back on ply 42, deep enough to fill the move list. The shot steps back to
// White's 26x17 on ply 44, so the review controls are live and the board is
// showing a past position.
const ENDGAME = [
  [9, 13], [21, 17], [12, 16], [24, 20], [10, 14], [17, 10], [6, 15],
  [22, 18], [15, 22], [26, 17], [13, 22], [25, 18], [8, 12], [29, 25],
  [1, 6], [25, 21], [6, 9], [28, 24], [3, 8], [24, 19], [7, 10], [32, 28],
  [9, 13], [18, 14], [10, 17], [21, 14], [13, 17], [30, 26], [2, 6],
  [28, 24], [17, 21], [19, 15], [11, 18], [20, 11], [8, 15], [23, 19],
  [6, 9], [19, 10], [4, 8], [10, 7], [21, 25], [7, 2], [18, 22], [26, 17],
  [9, 18], [17, 14], [18, 22],
];

/**
 * The app is captured at 432 CSS px wide: the stacked layout an ordinary large
 * phone gets (an iPhone 16 Pro Max is 440), and the narrowest width that keeps
 * the difficulty, clock and colour pickers on one row — below 421 they stack
 * into a column. A narrow layout is also the one worth magnifying: it puts the
 * board and the cards in one column, so a crop of it stays legible at the size
 * an asset is actually looked at.
 */
const CAPTURE_WIDTH = 432;

/**
 * Crops are named by the two element edges they run between. `from: 'page'`
 * starts at the top of the app, above the header. The pads land the cut inside
 * the gap between two cards (12px) or between the board and the mode switch
 * (20px), never inside one.
 */
const SCENES = [
  {
    slug: '01-three-ways-to-play',
    headline: 'Three ways to play',
    subhead: 'Take on the computer, share one device, or invite a friend.',
    tone: 'sand',
    settings: { level: 'hard', color: 'w', time: '10+0', mode: 'computer' },
    save: {
      v: 1, mode: 'computer', myColor: 'w', time: '10+0',
      moves: MIDDLEGAME, clock: [478000, 402000], clockStack: [],
    },
    pickUp: 14,
    crops: {
      wide: { from: 'page', to: '.mode-switch', padBottom: 10 },
      tall: { from: 'page', to: '#card-bottom', padBottom: 6 },
    },
  },
  {
    slug: '02-levels-and-clocks',
    headline: 'Pick your level and your clock',
    subhead: 'Three levels of computer opponent, with or without a clock.',
    tone: 'espresso',
    settings: { level: 'medium', color: 'w', time: '3+2', mode: 'computer' },
    save: {
      v: 1, mode: 'computer', myColor: 'w', time: '3+2',
      moves: EVEN_MIDDLEGAME, clock: [104000, 127000], clockStack: [],
    },
    crops: {
      wide: { from: '.mode-switch', padTop: 10, to: '#controls', padBottom: 24 },
      tall: { from: 'page', to: '#controls', padBottom: 24 },
    },
  },
  {
    slug: '03-invite-a-friend',
    headline: 'Invite a friend, play anywhere',
    subhead: 'Share a short code and the game starts the moment they join.',
    tone: 'ink',
    settings: { color: 'w', time: '5+3', mode: 'online' },
    save: null,
    stageHosting: true,
    crops: {
      wide: { from: '.mode-switch', padTop: 10, to: '#online-card', padBottom: 24 },
      tall: { from: 'page', to: '#online-card', padBottom: 24 },
    },
  },
  {
    slug: '04-replay-every-move',
    headline: 'Replay every move',
    subhead: 'Step back through the whole game, then save it as PDN.',
    tone: 'sand-deep',
    settings: { level: 'hard', color: 'w', time: '15+10', mode: 'computer', movesOpen: true },
    save: {
      v: 1, mode: 'computer', myColor: 'w', time: '15+10',
      moves: ENDGAME, clock: [664000, 578000], clockStack: [],
    },
    reviewPly: 44,
    crops: {
      wide: { from: '#card-top', padTop: 10, to: '#moves-card', padBottom: 6 },
      tall: { from: 'page', to: '#moves-card', padBottom: 6 },
    },
  },
];

/**
 * Every number below is in final asset pixels. The two landscape sizes share
 * one layout (copy left, window right) and the portrait size stacks them, so
 * the set reads as one system at three sizes rather than three designs.
 *
 * `box` is the space the app window is fitted into: it is scaled up to fill
 * whichever of the two axes runs out first, so a short crop lands wide and a
 * tall one lands tall, and neither is ever cropped again by the frame.
 */
const SIZES = [
  {
    dir: '1920x1080', width: 1920, height: 1080, layout: 'split', crop: 'wide',
    pad: 110, gap: 60, textWidth: 770, box: { width: 870, height: 900 },
    type: { mark: 62, brand: 38, headline: 78, headlineLead: 1.06, sub: 33, subWidth: 660, radius: 26 },
  },
  {
    dir: '1024x768', width: 1024, height: 768, layout: 'split', crop: 'wide',
    pad: 56, gap: 32, textWidth: 364, box: { width: 516, height: 656 },
    type: { mark: 38, brand: 23, headline: 45, headlineLead: 1.06, sub: 20, subWidth: 352, radius: 18 },
  },
  {
    dir: '1080x2280', width: 1080, height: 2280, layout: 'stack', crop: 'tall',
    pad: 90, padTop: 150, padBottom: 130, gap: 96, box: { width: 900, height: 1430 },
    type: { mark: 70, brand: 44, headline: 86, headlineLead: 1.08, sub: 38, subWidth: 860, radius: 30 },
  },
];

const TONES = {
  sand: {
    bg: 'linear-gradient(148deg, #fbf7f0 0%, #f4ead8 46%, #e8d6b8 100%)',
    ink: '#2a2318', sub: '#6d6453', motif: 'rgba(42, 35, 24, 0.055)',
    glow: 'rgba(255, 255, 255, 0.85)', edge: 'rgba(42, 35, 24, 0.10)',
    shadow: '0 60px 100px -45px rgba(58, 44, 20, 0.55), 0 16px 36px -16px rgba(58, 44, 20, 0.22)',
  },
  'sand-deep': {
    bg: 'linear-gradient(148deg, #f6f0e4 0%, #ecdfc9 48%, #dbc8a6 100%)',
    ink: '#2a2318', sub: '#6d6453', motif: 'rgba(42, 35, 24, 0.06)',
    glow: 'rgba(255, 255, 255, 0.8)', edge: 'rgba(42, 35, 24, 0.10)',
    shadow: '0 60px 100px -45px rgba(58, 44, 20, 0.55), 0 16px 36px -16px rgba(58, 44, 20, 0.22)',
  },
  ink: {
    bg: 'linear-gradient(148deg, #16296b 0%, #0b1743 52%, #060e2a 100%)',
    ink: '#f9f4ea', sub: 'rgba(249, 244, 234, 0.74)', motif: 'rgba(255, 255, 255, 0.06)',
    glow: 'rgba(96, 128, 255, 0.30)', edge: 'rgba(255, 255, 255, 0.16)',
    shadow: '0 60px 110px -45px rgba(0, 0, 0, 0.75), 0 16px 40px -16px rgba(0, 0, 0, 0.45)',
  },
  espresso: {
    bg: 'linear-gradient(148deg, #4a3b29 0%, #2e2417 52%, #1a1409 100%)',
    ink: '#f9f4ea', sub: 'rgba(249, 244, 234, 0.72)', motif: 'rgba(255, 255, 255, 0.06)',
    glow: 'rgba(255, 214, 150, 0.20)', edge: 'rgba(255, 255, 255, 0.15)',
    shadow: '0 60px 110px -45px rgba(0, 0, 0, 0.7), 0 16px 40px -16px rgba(0, 0, 0, 0.4)',
  },
};

const FONT_WEIGHTS = [500, 600, 700, 800];

const work = mkdtempSync(join(tmpdir(), 'checkers-store-'));

for (const weight of FONT_WEIGHTS) {
  copyFileSync(
    join(ROOT, `node_modules/@fontsource/inter/files/inter-latin-${weight}-normal.woff2`),
    join(work, `inter-${weight}.woff2`),
  );
}
copyFileSync(join(ROOT, 'public/icon-512.png'), join(work, 'mark.png'));

const browser = await chromium.launch();

/* ------------------------------------------------------------------ */
/* Pass 1: the app                                                     */
/* ------------------------------------------------------------------ */

for (const scene of SCENES) {
  const context = await browser.newContext({
    viewport: { width: CAPTURE_WIDTH, height: 700 },
    deviceScaleFactor: 3,
    colorScheme: 'light', // matches the in-app theme so nothing flashes
  });
  const settings = { level: 'medium', color: 'w', ...scene.settings, theme: 'light' };
  await context.addInitScript(
    ([settings, save]) => {
      localStorage.setItem('checkers-settings', JSON.stringify(settings));
      if (save) localStorage.setItem('checkers-game', JSON.stringify(save));
      else localStorage.removeItem('checkers-game');
    },
    [settings, scene.save],
  );

  const page = await context.newPage();
  page.on('pageerror', (e) => {
    throw e;
  });
  await page.goto(APP);

  // Fonts and the full 64-cell grid (32 dark, 32 light) must be in.
  // Pieces are drawn in CSS here — no piece images to wait on.
  await page.waitForFunction(
    () =>
      document.fonts.status === 'loaded' &&
      document.querySelectorAll('#board .square').length === 64 &&
      [...document.images].every(
        (img) => !img.src || (img.complete && img.naturalWidth > 0),
      ),
  );
  // The restored game has landed once the notation says so. Closed, the
  // Moves disclosure renders nothing below its own row (see setMovesOpen in
  // src/main.js), so the count on that row is what there is to wait for.
  if (scene.save) {
    await page.waitForFunction(
      (plies) => {
        const open =
          document.getElementById('moves-toggle').getAttribute('aria-expanded') === 'true';
        return open
          ? document.querySelectorAll('#move-list button').length >= plies
          : document.getElementById('move-count').textContent ===
              String(Math.ceil(plies / 2));
      },
      scene.save.moves.length,
    );
  }

  // Presentation only: no restore toast, no scrollbars, no focus rings.
  // Injected before the clicks below so nothing they focus is ringed.
  await page.addStyleTag({
    content:
      '::-webkit-scrollbar{display:none} *{scrollbar-width:none} :focus{outline:none} ' +
      '#toast{display:none!important}',
  });

  if (scene.stageHosting) {
    // The card's real hosting state (see updateModeUi in src/main.js: with a
    // game being arranged rather than played, the player cards, the moves and
    // the controls are all down), with a sample invite code.
    await page.evaluate(() => {
      document.getElementById('online-idle').classList.add('hidden');
      document.getElementById('online-hosting').classList.remove('hidden');
      document.getElementById('invite-code').textContent = 'HK7Q2F';
      for (const id of ['card-top', 'card-bottom', 'moves-card', 'controls']) {
        document.getElementById(id).classList.add('hidden');
      }
    });
  }

  // Pick a piece up the way a player does, so the hints on screen are the ones
  // the engine generated for it.
  if (scene.pickUp) {
    await page.click(`[data-square="${scene.pickUp}"]`);
    await page.waitForSelector(`[data-square="${scene.pickUp}"].sel`);
  }

  // Step back into the game: clicking a move in the list is how a player gets
  // there, and it opens the panel on the way.
  if (scene.reviewPly) {
    await page.click(`#move-list button[data-ply="${scene.reviewPly}"]`);
    await page.waitForFunction(
      () => document.getElementById('review-note').textContent.length > 0,
    );
  }

  await page.evaluate(() => {
    if (document.activeElement) document.activeElement.blur();
  });
  // Park the pointer off every control: a click leaves it where it landed, and
  // a move in the list or a mode button would keep its hover colour.
  await page.mouse.move(2, 2);

  // Grow the viewport to exactly the height the app's own content wants. Short
  // of that the column scrolls; past it the stacked grid stretches its rows and
  // opens gaps the app never shows a player.
  const natural = await page.evaluate(() => {
    const layout = document.querySelector('.layout');
    const header = document.querySelector('.topbar').getBoundingClientRect().height;
    return Math.ceil(header + layout.scrollHeight);
  });
  await page.setViewportSize({ width: CAPTURE_WIDTH, height: natural });

  // Let the icon buttons' 150ms background/color transitions finish before the
  // shutter, and the board settle after a click and the resize.
  await page.waitForTimeout(500);

  const edges = await page.evaluate(() => {
    const box = (sel) => {
      const el = document.querySelector(sel);
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom };
    };
    return {
      '.mode-switch': box('.mode-switch'),
      '#card-top': document.querySelector('#card-top').classList.contains('hidden')
        ? null
        : box('#card-top'),
      '#card-bottom': document.querySelector('#card-bottom').classList.contains('hidden')
        ? null
        : box('#card-bottom'),
      '#moves-card': document.querySelector('#moves-card').classList.contains('hidden')
        ? null
        : box('#moves-card'),
      '#controls': document.querySelector('#controls').classList.contains('hidden')
        ? null
        : box('#controls'),
      '#online-card': document.querySelector('#online-card').classList.contains('hidden')
        ? null
        : box('#online-card'),
    };
  });

  scene.shots = {};
  for (const [key, crop] of Object.entries(scene.crops)) {
    const top = crop.from === 'page' ? 0 : edges[crop.from].top - (crop.padTop ?? 0);
    const bottom = edges[crop.to].bottom + (crop.padBottom ?? 0);
    const height = Math.round(bottom - top);
    const file = `${scene.slug}-${key}.png`;
    await page.screenshot({
      path: join(work, file),
      clip: { x: 0, y: Math.round(top), width: CAPTURE_WIDTH, height },
    });
    scene.shots[key] = { file, width: CAPTURE_WIDTH, height };
  }

  await context.close();
}

/* ------------------------------------------------------------------ */
/* Pass 2: the assets                                                  */
/* ------------------------------------------------------------------ */

const fontFaces = FONT_WEIGHTS.map(
  (weight) => `@font-face{font-family:Inter;font-style:normal;font-weight:${weight};` +
    `src:url(inter-${weight}.woff2) format('woff2');font-display:block}`,
).join('');

const escape = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;');

function compose(size, scene) {
  const tone = TONES[scene.tone];
  const shot = scene.shots[size.crop];
  const t = size.type;
  // Fill whichever axis of the box runs out first. Both landscape sizes hand
  // the window a box wider than it is tall relative to the crop, so most scenes
  // are height-bound; the short ones fill the width instead.
  const scale = Math.min(size.box.width / shot.width, size.box.height / shot.height);
  const shotWidth = Math.round(shot.width * scale);
  const shotHeight = Math.round(shot.height * scale);

  const brand = `
      <div class="brand">
        <img class="mark" src="mark.png" alt="" width="${t.mark}" height="${t.mark}" />
        <span class="brand-name">Checkers</span>
      </div>`;
  const copy = `
      <h1>${escape(scene.headline)}</h1>
      <p>${escape(scene.subhead)}</p>`;
  const visual = `
      <div class="visual">
        <div class="window" style="width:${shotWidth}px;height:${shotHeight}px">
          <img src="${shot.file}" alt="" />
        </div>
      </div>`;

  const layout =
    size.layout === 'split'
      ? `<div class="split"><div class="copy">${brand}${copy}</div>${visual}</div>`
      : `<div class="stack"><div class="copy">${brand}${copy}</div>${visual}</div>`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><style>
${fontFaces}
*{box-sizing:border-box}
html,body{margin:0;padding:0;width:${size.width}px;height:${size.height}px;overflow:hidden}
body{
  font-family:Inter,sans-serif;
  background:${tone.bg};
  color:${tone.ink};
  -webkit-font-smoothing:antialiased;
}
/* A checkerboard, at the size the board's own squares would be, faded in from
   one corner: the motif the app is about, quiet enough to stay a texture. */
.motif{
  position:absolute;inset:0;
  background-image:repeating-conic-gradient(${tone.motif} 0% 25%, transparent 0% 50%);
  background-size:${Math.round(size.width / 12)}px ${Math.round(size.width / 12)}px;
  -webkit-mask-image:radial-gradient(115% 85% at 100% 0%, #000 0%, transparent 62%);
}
.glow{
  position:absolute;
  width:${Math.round(size.box.width * 1.9)}px;height:${Math.round(size.box.width * 1.9)}px;
  border-radius:50%;
  background:radial-gradient(closest-side, ${tone.glow}, transparent);
}
.split .glow{right:${-Math.round(size.box.width * 0.45)}px;top:50%;transform:translateY(-50%)}
.stack .glow{left:50%;bottom:${-Math.round(size.box.width * 0.5)}px;transform:translateX(-50%)}
.split{
  position:relative;display:flex;align-items:center;gap:${size.gap}px;
  width:100%;height:100%;padding:0 ${size.pad}px;
}
.stack{
  position:relative;display:flex;flex-direction:column;align-items:center;
  gap:${size.gap}px;width:100%;height:100%;
  padding:${size.padTop}px ${size.pad}px ${size.padBottom}px;text-align:center;
}
.copy{position:relative;flex:none}
.split .copy{width:${size.textWidth ?? 0}px}
.brand{display:flex;align-items:center;gap:${Math.round(t.mark * 0.28)}px;
  margin-bottom:${Math.round(t.headline * 0.6)}px}
.stack .brand{justify-content:center}
.mark{width:${t.mark}px;height:${t.mark}px;border-radius:${Math.round(t.mark * 0.26)}px;display:block}
.brand-name{font-size:${t.brand}px;font-weight:700;letter-spacing:-0.015em}
/* Balanced rather than ragged: a headline this size breaking one word onto a
   line of its own is the difference between a title and an accident. */
h1{
  margin:0;font-size:${t.headline}px;font-weight:800;
  line-height:${t.headlineLead};letter-spacing:-0.028em;text-wrap:balance;
}
p{
  margin:${Math.round(t.headline * 0.42)}px 0 0;
  max-width:${t.subWidth}px;font-size:${t.sub}px;font-weight:500;
  line-height:1.42;color:${tone.sub};text-wrap:pretty;
}
.stack p{margin-left:auto;margin-right:auto}
.visual{position:relative;flex:1;display:flex;align-items:center;justify-content:center;min-height:0}
.window{
  position:relative;overflow:hidden;
  border-radius:${t.radius}px;
  box-shadow:${tone.shadow}, 0 0 0 1px ${tone.edge};
  background:#f6efe3;
}
.window img{display:block;width:100%;height:100%}
</style></head>
<body><div class="motif"></div>${layout}</body></html>`;
}

const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 2,
  colorScheme: 'light',
});
const page = await context.newPage();
page.on('pageerror', (e) => {
  throw e;
});
await page.route(`${PROMO}**`, async (route) => {
  const name = decodeURIComponent(new URL(route.request().url()).pathname.slice(1));
  await route.fulfill({ path: join(work, name) });
});

for (const size of SIZES) {
  const dir = join(OUT, size.dir);
  mkdirSync(dir, { recursive: true });

  for (const scene of SCENES) {
    const name = `${scene.slug}-${size.dir}.html`;
    writeFileSync(join(work, name), compose(size, scene));
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.goto(`${PROMO}${name}`);
    await page.waitForFunction(
      () =>
        document.fonts.status === 'loaded' &&
        [...document.images].every((img) => img.complete && img.naturalWidth > 0),
    );

    const path = join(dir, `${scene.slug}.png`);
    // deviceScaleFactor 2 with a CSS-pixel screenshot: the page is rasterised
    // at twice the asset's size and resolved down to it, which is what keeps
    // 80px type and a 2x-magnified screenshot clean at the same time.
    await page.screenshot({ path, scale: 'css' });

    const png = readFileSync(path);
    const dims = `${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`;
    if (dims !== `${size.width}x${size.height}`) {
      throw new Error(`${path}: rendered ${dims}, wanted ${size.width}x${size.height}`);
    }
    console.log(`wrote ${path} (${dims})`);
  }
}

await context.close();
await browser.close();
rmSync(work, { recursive: true, force: true });
