/**
 * Renders the app-store promotional assets to store/screenshots/:
 * 4 scenes x 3 canvas sizes (1920x1080, 1024x768, 1080x2280) = 12 PNGs.
 *
 * Two passes per asset. First the real app is driven into the scene and
 * screenshotted; then that picture is dropped into the promotional canvas in
 * tools/store-promo.html, which adds the background, the headline, and the
 * device frame. Nothing about the UI is re-drawn or mocked up: what sits
 * inside every frame is the running app.
 *
 * Scenes are staged through the app's own persistence format (a saved game in
 * localStorage restores on load), so every position, capture list, clock
 * reading, and move list is produced by the real app. The two exceptions are
 * the online-invite shot, which flips the online card into the exact DOM state
 * updateModeUi() gives it while hosting (there is no live peer in headless),
 * and the checkmate, which is played on the board because finished games are
 * deliberately never saved.
 *
 * Every asset uses the light theme, whatever the machine's setting: a store
 * page reads as one product when the screenshots agree.
 *
 * Playwright is only needed to regenerate the pictures, so it is not a project
 * dependency:
 *
 *   npm i --no-save playwright && npx playwright install chromium
 *   npm run dev                      # serves the app the shots are taken of
 *   node tools/store-promo.mjs [port]
 */
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const port = process.argv[2] || '5173';
const BASE = `http://localhost:${port}/`;
const OUT = new URL('../store/screenshots', import.meta.url).pathname;

// Opera Game (Morphy, 1858) through 12...Rd8 — White (the player) to move.
const OPERA_24 = [
  ['e2', 'e4', null], ['e7', 'e5', null],
  ['g1', 'f3', null], ['d7', 'd6', null],
  ['d2', 'd4', null], ['c8', 'g4', null],
  ['d4', 'e5', null], ['g4', 'f3', null],
  ['d1', 'f3', null], ['d6', 'e5', null],
  ['f1', 'c4', null], ['g8', 'f6', null],
  ['f3', 'b3', null], ['d8', 'e7', null],
  ['b1', 'c3', null], ['c7', 'c6', null],
  ['c1', 'g5', null], ['b7', 'b5', null],
  ['c3', 'b5', null], ['c6', 'b5', null],
  ['c4', 'b5', null], ['b8', 'd7', null],
  ['e1', 'c1', null], ['a8', 'd8', null],
];

// Same game through 16...Nxb8 — one ply before 17.Rd8#, which is played live.
const OPERA_32 = [
  ...OPERA_24,
  ['d1', 'd7', null], ['d8', 'd7', null],
  ['h1', 'd1', null], ['e7', 'e6', null],
  ['b5', 'd7', null], ['f6', 'd7', null],
  ['b3', 'b8', null], ['d7', 'b8', null],
];

// Najdorf English Attack through 12...b4 — opposite-side castling, pawn storms.
const NAJDORF_24 = [
  ['e2', 'e4', null], ['c7', 'c5', null],
  ['g1', 'f3', null], ['d7', 'd6', null],
  ['d2', 'd4', null], ['c5', 'd4', null],
  ['f3', 'd4', null], ['g8', 'f6', null],
  ['b1', 'c3', null], ['a7', 'a6', null],
  ['c1', 'e3', null], ['e7', 'e5', null],
  ['d4', 'b3', null], ['c8', 'e6', null],
  ['f2', 'f3', null], ['f8', 'e7', null],
  ['d1', 'd2', null], ['e8', 'g8', null],
  ['e1', 'c1', null], ['b8', 'd7', null],
  ['g2', 'g4', null], ['b7', 'b5', null],
  ['g4', 'g5', null], ['b5', 'b4', null],
];

/**
 * How the app is captured. `desktop` is the widest layout that still fills its
 * 1080px content column edge to edge, so the picture is all app and no margin;
 * `phone` is a 19.5:9 screen. Both are shot at 2x and land in the canvas at
 * their CSS size, which keeps the UI at 1:1 (or better) rather than shrinking
 * text a store page would then shrink again.
 */
const PROFILES = {
  desktop: { viewport: { width: 980, height: 735 }, deviceScaleFactor: 2 },
  phone: { viewport: { width: 360, height: 760 }, deviceScaleFactor: 2 },
};

const CANVASES = [
  { dir: '1920x1080', size: 'wide', width: 1920, height: 1080, profile: 'desktop' },
  { dir: '1024x768', size: 'tablet', width: 1024, height: 768, profile: 'phone' },
  { dir: '1080x2280', size: 'tall', width: 1080, height: 2280, profile: 'phone' },
];

const SCENES = [
  {
    file: '01-play-the-computer',
    headline: 'Three levels of challenge',
    sub: 'Easy to warm up on. Hard to keep you honest.',
    settings: { mode: 'computer', level: 'hard', color: 'w', time: '10+0' },
    save: {
      v: 1, mode: 'computer', myColor: 'w', time: '10+0',
      moves: OPERA_24, clock: [462000, 375300], clockStack: [],
    },
    // The board and the opponent's card, which is what this shot is about.
    phoneScroll: { top: 0 },
  },
  {
    file: '02-play-a-friend-online',
    headline: 'Invite a friend, play anywhere',
    sub: 'Share a code or a link and start a private game.',
    settings: { mode: 'online', color: 'w', time: '5+3' },
    save: null,
    async stage(page) {
      // Exactly the DOM updateModeUi() produces while hosting, with a sample
      // invite code in place of one from a live peer connection.
      await page.evaluate(() => {
        document.getElementById('online-idle').classList.add('hidden');
        document.getElementById('online-hosting').classList.remove('hidden');
        document.getElementById('invite-code').textContent = 'HK7Q2F';
        document.getElementById('controls').classList.add('hidden');
      });
    },
    phoneScroll: { top: 0 },
  },
  {
    file: '03-chess-clocks',
    headline: 'Bullet, blitz, and rapid clocks',
    sub: 'Fischer increments included, or play with no clock at all.',
    settings: { mode: 'local', color: 'w', time: '3+2' },
    save: {
      v: 1, mode: 'local', myColor: 'w', time: '3+2',
      moves: NAJDORF_24, clock: [16800, 92000], clockStack: [],
    },
    // Both clocks at once: the sidebar from the first player card down.
    phoneScroll: { alignTop: '#card-top', gap: 12 },
  },
  {
    file: '04-review-and-export',
    headline: 'Replay it, then export it',
    sub: 'Step back through every move and save the game as PGN.',
    settings: { mode: 'computer', level: 'hard', color: 'w', time: '15+10' },
    save: {
      v: 1, mode: 'computer', myColor: 'w', time: '15+10',
      moves: OPERA_32, clock: [686000, 483000], clockStack: [],
    },
    async stage(page) {
      // Finish the Opera Game on the board: 17.Rd8#.
      await page.click('[data-square="d1"]');
      await page.click('[data-square="d8"]');
      await page.waitForSelector('#gameover-dialog[open]');
      await page.click('#gameover-close'); // "Review board"
      await page.waitForFunction(
        () => !document.getElementById('gameover-dialog').open,
      );
      // Jump back to 12...Rd8, the position the game is remembered for.
      await page.click('#move-list button[data-ply="24"]');
      await page.waitForFunction(
        () => document.getElementById('review-note').textContent.startsWith('Reviewing'),
      );
      // The list scrolls the reviewed move just far enough to be visible,
      // which can leave a half row against its top edge. Nudge it onto a row
      // boundary so the picture reads as a list rather than a crop.
      await page.evaluate(() => {
        const list = document.getElementById('move-list');
        const top = list.getBoundingClientRect().top;
        const row = [...list.querySelectorAll('.move-row')].find(
          (r) => r.getBoundingClientRect().bottom > top + 0.5,
        );
        if (row) list.scrollTop += row.getBoundingClientRect().top - top;
      });
    },
    phoneScroll: { alignTop: '.mode-switch' },
  },
];

/** Drive the app into one scene at one profile and return a data: URI of it. */
async function captureApp(browser, scene, profileName) {
  const profile = PROFILES[profileName];
  const context = await browser.newContext({
    ...profile,
    colorScheme: 'light', // matches the in-app theme so nothing flashes
    reducedMotion: 'reduce',
  });
  const settings = { level: 'medium', color: 'w', ...scene.settings, theme: 'light' };
  await context.addInitScript(
    ([settings, save]) => {
      localStorage.setItem('chess-settings', JSON.stringify(settings));
      if (save) localStorage.setItem('chess-game', JSON.stringify(save));
      else localStorage.removeItem('chess-game');
    },
    [settings, scene.save],
  );

  const page = await context.newPage();
  page.on('pageerror', (e) => {
    throw e;
  });
  const response = await page.goto(BASE);
  if (!response?.ok()) {
    throw new Error(`Dev server not reachable on ${BASE} — run \`npm run dev\` first.`);
  }

  // Fonts, all piece images, and the board grid must be in.
  await page.waitForFunction(
    () =>
      document.fonts.status === 'loaded' &&
      document.querySelectorAll('#board .square').length === 64 &&
      [...document.images].every(
        (img) => !img.src || (img.complete && img.naturalWidth > 0),
      ),
  );
  if (scene.save) {
    await page.waitForFunction(
      (plies) => document.querySelectorAll('#move-list button').length >= plies,
      scene.save.moves.length,
    );
  }

  if (scene.stage) await scene.stage(page);

  // Presentation only: no restore toast, no scrollbars, no focus rings.
  await page.evaluate(() => {
    document.getElementById('toast').classList.remove('show');
    const style = document.createElement('style');
    style.textContent =
      '::-webkit-scrollbar{display:none} *{scrollbar-width:none} :focus{outline:none} ' +
      '#toast{display:none!important}';
    document.head.appendChild(style);
    if (document.activeElement) document.activeElement.blur();
  });

  // The stacked layout is taller than a phone screen and scrolls inside
  // .layout; park it where the scene reads best. Scenes anchor an element to
  // the top of the screen rather than pick a pixel offset, so the shot never
  // opens on a card sliced through the middle.
  if (profileName === 'phone') {
    await page.evaluate((scroll) => {
      const layout = document.querySelector('.layout');
      if (!scroll.alignTop) {
        layout.scrollTop = scroll.top;
        return;
      }
      const target = document.querySelector(scroll.alignTop);
      const flush =
        layout.scrollTop +
        target.getBoundingClientRect().top -
        layout.getBoundingClientRect().top;

      // Content runs past the bottom of a phone screen, which is ordinary, but
      // the edge should land in a gap rather than halfway down a line of type.
      // There is the gap above the anchor to play with: try every offset in
      // that range, nearest the middle first, and take the first that cuts
      // nothing. All of them are a clean top edge, so falling through only
      // costs the bottom.
      const LINES =
        '.btn, select, .field-label, .controls-hint, .move-row, .player-line, .card-title, .online-wait';
      const cuts = (edge) =>
        [...document.querySelectorAll(LINES)].some((el) => {
          const box = el.getBoundingClientRect();
          return box.top < edge - 1 && box.bottom > edge + 1;
        });

      const edge = layout.getBoundingClientRect().bottom;
      const gap = scroll.gap ?? 20;
      const middle = Math.round(gap / 2);
      const offsets = [...Array(gap + 1).keys()].sort(
        (a, b) => Math.abs(a - middle) - Math.abs(b - middle),
      );
      const clean = offsets.find((offset) => {
        layout.scrollTop = Math.round(flush - offset);
        return !cuts(edge);
      });
      if (clean === undefined) layout.scrollTop = Math.round(flush - middle);
    }, scene.phoneScroll);
  }

  // Let the icon buttons' 150ms background/color transitions (kicked by the
  // style recalc above) finish before the shutter.
  await page.waitForTimeout(400);

  const buffer = await page.screenshot();
  await context.close();
  return `data:image/png;base64,${buffer.toString('base64')}`;
}

const browser = await chromium.launch();

// One capture per profile per scene, reused by every canvas that wants it.
const shots = {};
for (const scene of SCENES) {
  shots[scene.file] = {};
  for (const profile of new Set(CANVASES.map((c) => c.profile))) {
    shots[scene.file][profile] = await captureApp(browser, scene, profile);
  }
}

for (const canvas of CANVASES) {
  const dir = join(OUT, canvas.dir);
  mkdirSync(dir, { recursive: true });

  const context = await browser.newContext({
    viewport: { width: canvas.width, height: canvas.height },
    deviceScaleFactor: 1, // one output pixel per CSS pixel: the size is exact
    colorScheme: 'light',
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => {
    throw e;
  });
  const response = await page.goto(`${BASE}tools/store-promo.html`);
  if (!response?.ok()) {
    throw new Error(`Dev server not reachable on ${BASE} — run \`npm run dev\` first.`);
  }
  await page.waitForFunction(() => document.fonts.status === 'loaded');

  for (const scene of SCENES) {
    await page.evaluate(
      (spec) => window.renderAsset(spec),
      {
        size: canvas.size,
        headline: scene.headline,
        sub: scene.sub,
        image: shots[scene.file][canvas.profile],
        frame: canvas.profile === 'desktop' ? 'window' : 'phone',
      },
    );
    await page.waitForFunction(
      () => [...document.querySelectorAll('#stage img')].every((i) => i.complete),
    );

    const path = join(dir, `${scene.file}.png`);
    await page.locator('.canvas').screenshot({ path });
    console.log(`wrote ${path}`);
  }
  await context.close();
}

await browser.close();
