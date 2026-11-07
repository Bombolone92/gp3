// LIB=<library> node tools/camspeed.mjs [out.json] → camera speed (default out/camspeed.json): per-frame camera motion (view-direction turn rate + translation relative to subject distance)
import fs from 'fs';
const LIB = process.env.LIB || process.env.HOME + '/lemo-opuscar';
const { openDemo, closeServer } = await import(LIB + '/core/render/page.mjs');
const dir = decodeURIComponent(new URL('..', import.meta.url).pathname).replace(/\/$/, '');
const { browser, page } = await openDemo(dir);
const out = await page.evaluate(() => {
  const r = []; let prev = null;
  for (let f = 0; f <= Math.round(window.DUR * 30); f++) {
    const t = f / 30, d = window.DBG(t), c = d.cam, g = d.tg;
    const v = [g[0] - c[0], g[1] - c[1], g[2] - c[2]], L = Math.hypot(...v), u = v.map(x => x / L);
    if (prev) { const dot = Math.min(1, u[0] * prev.u[0] + u[1] * prev.u[1] + u[2] * prev.u[2]); const ang = Math.acos(dot) * 30;
      const tr = Math.hypot(c[0] - prev.c[0], c[1] - prev.c[1], c[2] - prev.c[2]) * 30 / L; r.push([+t.toFixed(3), +ang.toFixed(3), +tr.toFixed(3)]); }
    prev = { u, c };
  }
  return r;
});
fs.writeFileSync(process.argv[2] || dir + '/out/camspeed.json', JSON.stringify(out));
console.log('frames', out.length, 'max ang', Math.max(...out.map(x => x[1])).toFixed(2), 'max tr', Math.max(...out.map(x => x[2])).toFixed(2));
await browser.close(); closeServer();
