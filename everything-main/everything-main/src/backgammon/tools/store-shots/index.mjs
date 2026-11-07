/**
 * Build the store screenshots.
 *
 *     node tools/store-shots/index.mjs        # or: npm run shots
 *
 * Two stages, both in headless Chrome and neither of them a mock-up:
 *
 *  1. **Plates.** The real app is served, seeded with a real game (see
 *     positions.mjs), driven with real clicks, and photographed at a desktop
 *     and a phone size. Nothing about the interface is redrawn for the
 *     picture; the only thing standing in for the world outside the app is the
 *     peer API, so that shooting the invite panel does not open a session on a
 *     live service.
 *  2. **Canvases.** Those plates are laid into a branded composition and
 *     rendered at each store size with the device metrics overridden, so every
 *     file comes out at exactly the dimensions it claims.
 *
 * Everything lands in store/screenshots/<size>/.
 */
import { createServer as createHttpServer } from 'node:http';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { launch, newPage, sleep } from './cdp.mjs';
import { positions } from './positions.mjs';
import { storageKeyFor } from '../../src/game/persistence.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const OUT = join(ROOT, 'store/screenshots');

// Fixed by default so the two servers are easy to find in a debugger, but
// overridable: a dev server of some other project on 5273 should not stop
// the screenshots being taken.
const APP_PORT = Number(process.env.SHOTS_APP_PORT) || 5273;
const WORK_PORT = Number(process.env.SHOTS_WORK_PORT) || 5274;

/* ------------------------------------------------------------------ */
/* Scenes                                                              */
/* ------------------------------------------------------------------ */

/**
 * Nothing mid-animation, no blinking caret, no focus ring, and no toast on its
 * way out: a still picture should not catch the interface between two states.
 */
const FREEZE = `
  (() => {
    let s = document.getElementById('capture-freeze');
    if (!s) {
      s = document.createElement('style');
      s.id = 'capture-freeze';
      document.head.appendChild(s);
    }
    s.textContent = \`*, *::before, *::after {
        animation-duration: 0.001s !important;
        animation-delay: 0s !important;
        animation-iteration-count: 1 !important;
        transition: none !important;
        caret-color: transparent !important;
      }
      *:focus, *:focus-visible { outline: none !important; }
      #toast { display: none !important; }\`;
  })()
`;

/**
 * A stand-in for the Puter peer API. `loadPuter` hands back `window.puter` if
 * it is already there, so defining it before the app boots keeps the whole
 * hosting path (and every pixel of the panel it renders) the app's own, while
 * the invite code becomes sample data like any other in a store screenshot.
 */
const PUTER_STUB = `
  window.puter = {
    auth: {
      isSignedIn: () => true,
      signIn: async () => ({}),
      getUser: async () => ({ username: 'nariman' }),
    },
    peer: {
      serve: async () => ({ inviteCode: 'HQ7M4K', addEventListener() {}, close() {} }),
    },
  };
`;

const settings = (over) => ({
  theme: 'light', // store assets are light theme only, whatever the OS says
  mode: 'computer',
  level: 'medium',
  color: 'w',
  time: 'unlimited',
  cube: false,
  movesOpen: false,
  ...over,
});

function scenes(games) {
  return [
    {
      n: '01',
      slug: 'play-the-computer',
      eyebrow: 'Player vs. computer',
      headline: 'Beat the computer at three levels',
      subhead: 'Easy, Medium, or a Hard search that reads every reply before it moves.',
      settings: { mode: 'computer', level: 'hard', time: '5+3' },
      game: games.midGame,
      async setup(page) {
        await page.waitFor(`document.querySelectorAll('#board .die').length === 2`);
      },
    },

    {
      n: '02',
      slug: 'the-doubling-cube',
      eyebrow: 'The doubling cube',
      headline: 'Play with the cube, or without',
      subhead: 'Off by default. Switch it on for gammons, backgammons, and a running score.',
      settings: { mode: 'local', cube: true },
      game: games.cube,
      // The take-or-drop card is shot on its own and composited back over the
      // board, because the app's real backdrop blurs everything behind it and
      // a whole asset built on a blurred screenshot reads as a bad photograph.
      card: 'cube-dialog',
      async setup(page, { form, dpr, dir, cardMeta, gapMeta }) {
        await page.waitFor(`!document.getElementById('double-btn').disabled`);
        await page.eval(`document.getElementById('double-btn').click()`);
        await page.waitFor(`document.getElementById('cube-dialog').open`);
        await sleep(500);
        const card = await page.eval(`(() => {
          const d = document.getElementById('cube-dialog');
          const r = d.getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height,
                   radius: parseFloat(getComputedStyle(d).borderTopLeftRadius) };
        })()`);
        await page.shot(join(dir, `card-cube-dialog-${form}.png`), {
          clip: { x: card.x, y: card.y, width: card.width, height: card.height, scale: dpr },
        });
        cardMeta[form] = card;

        // Take it and roll, so the plate shows a live cube at 2 on the board.
        await page.eval(`document.getElementById('cube-take').click()`);
        await page.waitFor(`!document.getElementById('cube-dialog').open`);
        await sleep(300);
        // A live roll, so it may be a double and show four dice.
        await page.eval(`document.getElementById('roll-btn').click()`);
        await page.waitFor(`document.querySelectorAll('#board .die').length >= 2`);
        await sleep(300);

        // Where the layout breathes. The compositor lands the floating card on
        // one of these seams so it never slices a control in half.
        gapMeta[form] = await page.eval(`(() => {
          const parts = [
            document.querySelector('.board-frame'),
            ...document.querySelectorAll('.sidebar > *'),
          ].filter((el) => el && el.getClientRects().length);
          const rects = parts.map((el) => el.getBoundingClientRect()).sort((a, b) => a.top - b.top);
          const gaps = [];
          for (let i = 1; i < rects.length; i++) {
            if (rects[i].top > rects[i - 1].bottom) gaps.push((rects[i].top + rects[i - 1].bottom) / 2);
          }
          return gaps;
        })()`);
      },
    },

    {
      n: '03',
      slug: 'play-a-friend-online',
      eyebrow: 'Private online games',
      headline: 'Invite a friend, play in seconds',
      subhead: 'Send a code or a link. Every roll is agreed between both browsers.',
      settings: { mode: 'online', time: '5+3' },
      game: null,
      boot: PUTER_STUB,
      async setup(page) {
        await page.waitFor(`!document.getElementById('online-card').classList.contains('hidden')`);
        await page.eval(`document.getElementById('host-btn').click()`);
        await page.waitFor(`document.getElementById('invite-code').textContent.trim().length > 3`);
        await sleep(400);
      },
    },

    {
      n: '04',
      slug: 'review-and-export',
      eyebrow: 'Review and export',
      headline: 'Replay any game, move by move',
      subhead: 'Step back through every turn, then copy or download the full transcript.',
      settings: { mode: 'local', movesOpen: true },
      game: games.late,
      async setup(page) {
        await page.waitFor(`document.querySelectorAll('#move-list .move-row').length >= 10`);
        await page.eval(`
          if (document.getElementById('moves-toggle').getAttribute('aria-expanded') !== 'true') {
            document.getElementById('moves-toggle').click();
          }
        `);
        await sleep(300);
        // Land on a late turn that reads as a real play, rather than whatever a
        // fixed number of steps back happens to hit: a turn with no legal play
        // shows as a dash, and a long one is elided.
        await page.eval(`(() => {
          const plies = [...document.querySelectorAll('#move-list button.ply')];
          const tail = plies.slice(-8);
          const good = tail.filter((b) =>
            !b.textContent.includes('\\u2014') &&
            !b.textContent.includes('\\u2026') &&
            b.scrollWidth <= b.clientWidth + 1);
          (good[Math.max(0, good.length - 3)] || tail[tail.length - 3])?.click();
        })()`);
        await page.waitFor(`document.querySelector('#move-list .ply.current')`);
        await sleep(300);
        // The list is a scroller: park it against the foot so the newest turn
        // sits flush with the edge rather than half cut.
        await page.eval(`(() => {
          const l = document.getElementById('move-list');
          l.scrollTop = l.scrollHeight;
        })()`);
        await sleep(300);
      },
    },
  ];
}

/**
 * 1200x760 is the tightest desktop viewport that still fits the sidebar with
 * the move list open, so the app fills its plate instead of floating in margins
 * the compositor would only have to scale away again.
 */
const FORMS = {
  desktop: { width: 1200, height: 760, dpr: 2, mobile: false },
  phone: { width: 390, height: 844, dpr: 3, mobile: true },
};

const PLATE = {
  desktop: { css: 1200, w: 2400, h: 1520 },
  phone: { css: 390, w: 1170, h: 2532 },
};

/* ------------------------------------------------------------------ */
/* Canvases                                                            */
/* ------------------------------------------------------------------ */

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Place the floating dialog card on one of the plate's own layout seams, sized
 * so its foot clears the bottom of the device by `overhang`. Landing on a seam
 * is what stops it slicing a control in half; sizing it from the seam is what
 * stops a strip of half-covered sidebar showing underneath.
 */
function seamCard(dev, plateKey, meta, gaps, { overhang = 30, widthTarget = 0.95 } = {}) {
  const scale = dev.w / PLATE[plateKey].css;
  const foot = dev.y + dev.h + overhang;
  const want = dev.w * widthTarget;
  let best = null;
  for (const cssY of gaps[plateKey] || []) {
    const y = dev.y + cssY * scale;
    const w = ((foot - y) * meta.width) / meta.height;
    if (w <= 0) continue;
    const score = Math.abs(w - want);
    if (!best || score < best.score) best = { score, w: Math.round(w), y: Math.round(y) };
  }
  const w = best ? best.w : Math.round(want);
  return { w, x: Math.round(dev.x + (dev.w - w) / 2), y: best ? best.y : dev.y + dev.h - 400 };
}

const SIZES = {
  '1920x1080': {
    w: 1920,
    h: 1080,
    plate: 'desktop',
    type: { eyebrow: 21, head: 58, headLead: 1.09, sub: 25, gapA: 20, gapB: 22 },
    place(i) {
      const dev = { w: 1020, h: Math.round((1020 * PLATE.desktop.h) / PLATE.desktop.w) };
      dev.y = Math.round((1080 - dev.h) / 2);
      // Alternate the side the copy sits on, so four assets in a row do not
      // read as one picture printed four times.
      const copyLeft = i % 2 === 0;
      dev.x = copyLeft ? 800 : 90;
      return {
        dev,
        text: { w: 620, x: copyLeft ? 120 : 1210, y: 0, h: 1080 },
        // Off the board's outer corner, well clear of the copy.
        card: { w: 430, x: copyLeft ? 690 : 58, y: 600 },
        radius: 20,
      };
    },
  },

  '1024x768': {
    w: 1024,
    h: 768,
    plate: 'desktop',
    type: { eyebrow: 13, head: 34, headLead: 1.12, sub: 16.5, gapA: 11, gapB: 12 },
    place() {
      const dev = { w: 900, h: Math.round((900 * PLATE.desktop.h) / PLATE.desktop.w) };
      dev.x = Math.round((1024 - dev.w) / 2);
      dev.y = 168;
      return {
        dev,
        text: { w: 900, x: 62, y: 38, h: 112, centered: true },
        card: { w: 300, x: 30, y: 534 },
        radius: 14,
      };
    },
  },

  '1080x2280': {
    w: 1080,
    h: 2280,
    plate: 'phone',
    bezel: 12,
    type: { eyebrow: 23, head: 74, headLead: 1.08, sub: 30, gapA: 22, gapB: 24 },
    place(i, meta, gaps) {
      const dev = { w: 748, h: Math.round((748 * PLATE.phone.h) / PLATE.phone.w) };
      dev.x = Math.round((1080 - dev.w) / 2);
      dev.y = 566;
      return {
        dev,
        text: { w: 912, x: 84, y: 150, h: 360, centered: true },
        // At phone width the dialog is a sheet, so it sits inside the device.
        card: seamCard(dev, 'phone', meta, gaps),
        radius: 46,
      };
    },
  },
};

/** Film grain, so a wide flat fill has something to sit on. */
const GRAIN =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E" +
  "%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3'/%3E" +
  "%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E" +
  "%3Crect width='160' height='160' filter='url(%23n)'/%3E%3C/svg%3E";

function canvas(key, scene, index, cardMeta, gapMeta) {
  const s = SIZES[key];
  const { dev, text, card, radius } = s.place(index, cardMeta, gapMeta);
  const bezel = s.bezel || 0;
  const t = s.type;

  let cardHtml = '';
  if (scene.card) {
    const meta = cardMeta[s.plate];
    const h = Math.round((card.w * meta.height) / meta.width);
    // Matching the dialog's own radius is what trims the slivers of blurred
    // backdrop the clip caught in its corners.
    const r = Math.round((meta.radius * card.w) / meta.width);
    cardHtml = `
    <div class="card" style="left:${card.x}px; top:${card.y}px; width:${card.w}px; height:${h}px; border-radius:${r}px">
      <img src="card-${scene.card}-${s.plate}.png" width="${card.w}" height="${h}" alt="">
    </div>`;
  }

  const face = (weight) =>
    `@font-face{font-family:Inter;font-weight:${weight};font-style:normal;font-display:block;` +
    `src:url("fonts/inter-latin-${weight}-normal.woff2") format("woff2")}`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>${esc(scene.headline)}</title>
<style>
  ${[400, 600, 700, 800].map(face).join('\n  ')}

  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: ${s.w}px; height: ${s.h}px; overflow: hidden; }
  body {
    position: relative;
    font-family: Inter, sans-serif;
    -webkit-font-smoothing: antialiased;
    /* The felt from src/style.css, lit at the corners by the brass accent and
       the terracotta of the points. Nothing here is a colour the app is not
       already made of. */
    background:
      radial-gradient(56% 44% at 8% -6%, rgba(207, 152, 71, 0.26), transparent 62%),
      radial-gradient(50% 42% at 104% 106%, rgba(155, 62, 47, 0.22), transparent 66%),
      linear-gradient(158deg, #27553e 0%, #1d4331 46%, #14291f 100%);
  }
  /* Under the plates, never over them: grain across a screenshot costs it
     nothing but sharpness. */
  body::before {
    content: ""; position: absolute; inset: 0; z-index: 0;
    opacity: 0.42; mix-blend-mode: soft-light;
    background-image: url("${GRAIN}");
  }
  .text, .device, .card { z-index: 1; }

  .text { position: absolute; display: flex; flex-direction: column; justify-content: center; }
  .text.centered { text-align: center; align-items: center; }
  .eyebrow {
    font-size: ${t.eyebrow}px; font-weight: 700; letter-spacing: 0.17em;
    text-transform: uppercase; color: #e0ae63;
  }
  h1 {
    font-size: ${t.head}px; line-height: ${t.headLead}; font-weight: 800;
    letter-spacing: -0.022em; color: #f7f2e6; margin-top: ${t.gapA}px; text-wrap: balance;
  }
  p {
    font-size: ${t.sub}px; line-height: 1.46; color: rgba(240, 234, 219, 0.68);
    margin-top: ${t.gapB}px; max-width: ${Math.round(text.w * 0.92)}px; text-wrap: pretty;
  }

  .device {
    position: absolute; overflow: hidden; background: #101c15;
    box-shadow:
      0 2px 0 rgba(255, 255, 255, 0.10) inset,
      0 60px 120px -40px rgba(0, 0, 0, 0.62),
      0 24px 48px -24px rgba(0, 0, 0, 0.45);
  }
  .card {
    position: absolute; overflow: hidden;
    box-shadow: 0 40px 90px -28px rgba(0, 0, 0, 0.68), 0 12px 28px -12px rgba(0, 0, 0, 0.5);
  }
  img { display: block; }
</style></head>
<body>
  <div class="text${text.centered ? ' centered' : ''}"
       style="left:${text.x}px; top:${text.y}px; width:${text.w}px; height:${text.h}px">
    <span class="eyebrow">${esc(scene.eyebrow)}</span>
    <h1>${esc(scene.headline)}</h1>
    <p>${esc(scene.subhead)}</p>
  </div>

  <div class="device" style="left:${dev.x - bezel}px; top:${dev.y - bezel}px;
       width:${dev.w + bezel * 2}px; height:${dev.h + bezel * 2}px;
       border-radius:${radius + bezel}px; padding:${bezel}px">
    <img src="app-${scene.slug}-${s.plate}.png" width="${dev.w}" height="${dev.h}"
         alt="" style="border-radius:${radius}px">
  </div>
  ${cardHtml}
</body></html>`;
}

/* ------------------------------------------------------------------ */
/* Run                                                                 */
/* ------------------------------------------------------------------ */

/** Serve `root` over http, so the compositor can load plates and fonts. */
function serveDir(root, port) {
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.png': 'image/png',
    '.woff2': 'font/woff2',
  };
  const server = createHttpServer((req, res) => {
    const rel = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
    try {
      const body = readFileSync(join(root, rel));
      res.writeHead(200, { 'Content-Type': types[extname(rel)] || 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((done) => server.listen(port, () => done(server)));
}

const work = mkdtempSync(join(tmpdir(), 'bg-store-'));
mkdirSync(join(work, 'fonts'), { recursive: true });
for (const weight of [400, 600, 700, 800]) {
  cpSync(
    join(ROOT, `node_modules/@fontsource/inter/files/inter-latin-${weight}-normal.woff2`),
    join(work, `fonts/inter-latin-${weight}-normal.woff2`),
  );
}

const { createServer } = await import('vite');
const app = await createServer({ root: ROOT, server: { port: APP_PORT, strictPort: true }, logLevel: 'warn' });
await app.listen();
const files = await serveDir(work, WORK_PORT);
const browser = await launch();
const page = await newPage(browser.port);

const cardMeta = {};
const gapMeta = {};

try {
  console.log('positions…');
  const games = positions();
  const list = scenes(games);

  console.log('plates…');
  await page.viewport(FORMS.desktop);
  await page.goto(`http://localhost:${APP_PORT}/`, { waitMs: 300 });

  let seeded = null;
  for (const scene of list) {
    for (const [form, metrics] of Object.entries(FORMS)) {
      // Seeded before the app boots rather than written from the page that
      // came before: the app saves as it plays, so anything written while an
      // earlier game is still running is overwritten before the next
      // navigation even lands. Every mode's slot is cleared first, so the
      // game the previous form played on cannot be picked up instead of the
      // one this scene is about.
      const sceneSettings = settings(scene.settings);
      const slots = ['computer', 'local'].map(storageKeyFor);
      seeded = await page.onNewDocument(
        `try {
           localStorage.setItem('backgammon-settings', ${JSON.stringify(JSON.stringify(sceneSettings))});
           for (const key of ${JSON.stringify(slots)}) localStorage.removeItem(key);
           ${
             scene.game
               ? `localStorage.setItem(${JSON.stringify(storageKeyFor(sceneSettings.mode))}, ${JSON.stringify(JSON.stringify(scene.game))});`
               : ''
           }
         } catch (e) {}
         ${scene.boot || ''}`,
        seeded,
      );

      await page.viewport(metrics);
      await page.goto(`http://localhost:${APP_PORT}/`, { waitMs: 900 });
      await page.eval(FREEZE);
      await scene.setup(page, { form, dpr: metrics.dpr, dir: work, cardMeta, gapMeta });
      await page.eval(FREEZE);
      await sleep(250);
      await page.shot(join(work, `app-${scene.slug}-${form}.png`));
      console.log(`  ${scene.slug} / ${form}`);
    }
  }

  console.log('canvases…');
  for (const key of Object.keys(SIZES)) {
    mkdirSync(join(OUT, key), { recursive: true });
    for (const [i, scene] of list.entries()) {
      const file = `canvas-${key}-${scene.n}.html`;
      writeFileSync(join(work, file), canvas(key, scene, i, cardMeta, gapMeta));
      await page.viewport({ width: SIZES[key].w, height: SIZES[key].h, dpr: 1 });
      await page.goto(`http://localhost:${WORK_PORT}/${file}`, { waitMs: 600 });
      await page.eval('document.fonts.ready', { awaitPromise: true });
      await page.shot(join(OUT, key, `${scene.n}-${scene.slug}.png`));
      console.log(`  ${key}/${scene.n}-${scene.slug}.png`);
    }
  }
} finally {
  await page.close();
  await browser.close();
  files.close();
  await app.close();
  rmSync(work, { recursive: true, force: true });
}
