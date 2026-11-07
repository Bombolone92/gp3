// Crowd motion check for this style: every frame at 30 fps, every person's floor position.
//   node styles/isometric-picture-book/demo/tools/motion_check.mjs styles/isometric-picture-book/demo [--fps 30] [--gap .35]
// The film reports people through a hook: inside the code that draws a person, push
//   globalThis.__POS?.push({ i: <person id>, k: 'w' (standing) | 's' (seated), x, y, a: <alpha> })
// Reports: jumps (a person moves more than 0.2 m between two frames, i.e. faster than 6 m/s: reads as a teleport),
// stepping (move, freeze one frame, move: the motion is sampled coarser than the frame rate), and overlaps
// (two standing people whose feet are closer than --gap metres). Shot cuts (window.SHOTS starts) are skipped.
import { openDemo, closeServer } from '../../../../core/render/page.mjs';
const args = process.argv.slice(2), opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? +args[i + 1] : d; };
const FPS = opt('--fps', 30), GAP = opt('--gap', .35);
const { browser, page } = await openDemo(args[0], { w: 960, h: 540, q: 'nosub=1' });
const r = await page.evaluate(({ FPS, GAP }) => {
  const cuts = (window.SHOTS || []).map(s => s[0]), isCut = t => cuts.some(a => Math.abs(t - a) < 1.5 / FPS);
  let prev = null; const jumps = [], over = [], step = {};
  for (let f = 0; f <= window.DUR * FPS; f++) {
    const t = f / FPS; globalThis.__POS = []; window.render(t);
    const cur = new Map(); for (const d of globalThis.__POS) cur.set(d.i + d.k, d);
    if (prev && !isCut(t)) for (const [k, d] of cur) {
      const q = prev.get(k); if (!q) continue;
      const m = Math.hypot(d.x - q.x, d.y - q.y);
      if (m > .2 && d.a > .3) jumps.push(`${t.toFixed(2)}s person ${d.i}: ${m.toFixed(2)} m in one frame`);
      const s = step[k] ??= { last: [], n: 0, at: [] }; s.last.push(m); if (s.last.length > 3) s.last.shift();
      if (s.last.length === 3 && s.last[0] > .003 && s.last[1] < .0005 && s.last[2] > .003) { s.n++; s.at.push(t.toFixed(2)); }
    }
    const W = globalThis.__POS.filter(d => d.k === 'w' && d.a > .5);
    for (let a = 0; a < W.length; a++) for (let b = a + 1; b < W.length; b++) {
      const m = Math.hypot(W[a].x - W[b].x, W[a].y - W[b].y);
      if (m < GAP) over.push(`${t.toFixed(2)}s persons ${W[a].i}/${W[b].i}: ${m.toFixed(2)} m apart`);
    }
    prev = cur;
  }
  globalThis.__POS = undefined;
  const stepping = Object.entries(step).filter(([, s]) => s.n > 2).map(([k, s]) => `${k}: move-freeze-move ${s.n}x (${s.at.slice(0, 5).join(' ')})`);
  return { jumps, over, stepping };
}, { FPS, GAP });
for (const [name, list] of [['jumps', r.jumps], ['overlaps', r.over], ['stepping', r.stepping]]) { console.log(`${name}: ${list.length}`); list.slice(0, 20).forEach(l => console.log('  ' + l)); }
await browser.close(); closeServer();
process.exit(r.jumps.length + r.over.length + r.stepping.length ? 1 : 0);
