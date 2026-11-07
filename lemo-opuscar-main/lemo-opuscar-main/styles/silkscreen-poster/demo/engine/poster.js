// poster.js · the full-bleed 16:9 travel print of "The Long Way Home": art to every edge, the city name printed into the sky,
// a ticket stub (DAY · FROM HOME · landmark) printed last on the right. Every piece is printed by a named pull;
// st.prog(name) → 0..1 says how far that pull has gone.
import { hex2rgb, ink, wipeRegion, wipeFront, inkFinish, paperSheet, rectPath, circlePath, unionPath, clamp, hash } from './silk.js';
import { AW, AH, BLEED } from './scenes.js';
export { AW, AH, BLEED };

export const FONT_D = 'BigShoulders', FONT_T = 'Outfit', FONT_C = 'NotoSC';
export const STUB = [1478, 236, 350, 556];        // x, y, w, h
const NOTCH_Y = 352;

// WCAG contrast: text inks are chosen against the ink underneath
const lum = (h) => { const c = hex2rgb(h).map(v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }); return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]; };
export const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
export function pickInk(bgs, cands, need = 3) { bgs = [].concat(bgs); for (const c of cands) if (c && bgs.every(b => contrast(c, b) >= need)) return c; return cands.filter(Boolean).sort((a, b) => Math.min(...bgs.map(x => contrast(b, x))) - Math.min(...bgs.map(x => contrast(a, x))))[0]; }

// a pull's printed region with the squeegee travelling at an angle (rotated about the print's centre)
const BOX = [-300, -300, AW + 600, AH + 600];
function rot(angle) { return new DOMMatrix().translate(AW / 2, AH / 2).rotate(angle * 180 / Math.PI).translate(-AW / 2, -AH / 2); }
export function tiltRegion(p, angle, seed, tail = 34) {
  if (p >= 1) return null;
  const out = new Path2D(); out.addPath(wipeRegion(BOX, 'down', p, seed, tail, 6), rot(angle)); return out;
}
export function tiltFront(p, angle, tail = 34) {
  const y = wipeFront(BOX, 'down', p, tail), m = rot(angle);
  const a = m.transformPoint(new DOMPoint(-300, y)), b = m.transformPoint(new DOMPoint(AW + 300, y));
  const d = m.transformPoint(new DOMPoint(0, 1)), o = m.transformPoint(new DOMPoint(0, 0));
  return { a: [a.x, a.y], b: [b.x, b.y], lead: [d.x - o.x, d.y - o.y] };
}
const R2 = (seed, amp) => [(hash(seed * 3.1 + 1) - .5) * 2 * amp, (hash(seed * 7.7 + 1.3) - .5) * 2 * amp];
function inverse(p) { const q = new Path2D(); q.rect(-1e4, -1e4, 2e4, 2e4); q.addPath(p); return q; }

// the stub panel: near ink, two half-round notches and a perforation row knocked out to paper
export function stubPath() {
  const [x, y, w, h] = STUB, p = rectPath(x, y, w, h);
  const knock = new Path2D();
  knock.arc(x, NOTCH_Y, 18, -Math.PI / 2, Math.PI / 2); knock.closePath();
  knock.moveTo(x + w, NOTCH_Y - 18); knock.arc(x + w, NOTCH_Y, 18, -Math.PI / 2, Math.PI / 2, true); knock.closePath();
  for (let xx = x + 34; xx < x + w - 26; xx += 22) { knock.moveTo(xx + 4.5, NOTCH_Y); knock.arc(xx, NOTCH_Y, 4.5, 0, Math.PI * 2); }
  return { path: p, knock };
}

// P = { scene, city, cityZh, day, km, landmark, built, seed }; st = { pal, T, prog(name), angle, reg, imprint, off(pull) }
export function drawPrint(ctx, P, st) {
  const pal = st.pal, prog = st.prog, reg = st.reg ?? 1, ang = st.angle ?? -.08;
  paperSheet(ctx, st.T, -BLEED, -BLEED, AW + 2 * BLEED, AH + 2 * BLEED, .6);
  P.scene.parts.forEach((pt, j) => {
    const p = prog(pt.pull); if (p <= 0) return;
    const off = st.off ? st.off(pt.pull) : [0, 0];
    ctx.save(); ctx.translate(off[0], off[1]);
    if (pt.cut) ctx.clip(inverse(pt.cut), 'evenodd');
    ink(ctx, pt, { color: pal[pt.ink], reg: R2(P.seed + j * 5, 2.2 * reg), clip: tiltRegion(p, ang, P.seed + j * 3), sheen: 1, trap: pt.lit ? 0 : 1, lw: 1.8 });
    ctx.restore();
  });
  // ---- the city, printed into the sky ----
  const hp = prog('header');
  if (hp > 0) {
    const clip = hp < 1 ? wipeRegion([80, 60, 900, 200], 'right', hp, 13, 40) : null;
    const col = pickInk([pal.sky2, pal.sky1], [pal.near, pal.mid], 3);
    ink(ctx, { paint: (c) => {
      c.font = `900 150px ${FONT_D}`; c.letterSpacing = '16px'; c.textAlign = 'left'; c.textBaseline = 'alphabetic'; c.fillText(P.city, 104, 214);
      const w = c.measureText(P.city).width;
      c.font = `600 54px ${FONT_C}`; c.letterSpacing = '6px'; c.fillText(P.cityZh, 104 + w + 18, 210);
    } }, { color: col, reg: R2(P.seed + 44, 1.4 * reg), clip });
  }
  // ---- the ticket stub, printed last ----
  const sp = prog('stub');
  if (sp > 0) {
    const s = stubPath();
    ink(ctx, s, { color: pal.near, reg: R2(P.seed + 51, 1.2 * reg), clip: sp < 1 ? wipeRegion([STUB[0] - 30, STUB[1] - 20, STUB[2] + 60, STUB[3] + 40], 'down', sp, 9, 40) : null, sheen: 1 });
  }
  const [X, Y, Wd] = STUB, lx = X + 34;
  const lab = pickInk(pal.near, [pal.sky1, pal.glow, pal.sky2], 4.5), val = pickInk(pal.near, [pal.sky1, pal.sun], 4.5), key = pickInk(pal.near, [pal.sun, pal.sky1], 3);
  const item = (name, fn, color, box) => { const p = prog(name); if (p <= 0) return; ink(ctx, { paint: fn }, { color, reg: R2(P.seed + name.length * 7, 1.2 * reg), clip: p < 1 ? wipeRegion(box, 'right', p, 31 + name.length, 24) : null }); };
  item('day', (c) => { c.font = `600 30px ${FONT_T}`; c.letterSpacing = '6px'; c.textAlign = 'left'; c.fillText('DAY', lx, Y + 76); c.font = `800 64px ${FONT_D}`; c.letterSpacing = '1px'; c.fillText(String(P.day), lx + 96, Y + 82); }, lab, [X, Y + 10, Wd, 100]);
  item('km', (c) => {
    c.font = `600 30px ${FONT_T}`; c.letterSpacing = '6px'; c.textAlign = 'left'; c.fillStyle = lab; c.fillText('FROM HOME', lx, Y + 186);
    c.fillStyle = key; c.font = `900 ${P.km.length > 5 ? 112 : 132}px ${FONT_D}`; c.letterSpacing = '2px'; c.fillText(P.km + ' KM', lx - 4, Y + 318);
    c.fillRect(lx, Y + 344, Wd - 68, 6);
  }, key, [X, Y + 140, Wd, 230]);
  item('landmark', (c) => {
    c.font = `600 25px ${FONT_T}`; c.letterSpacing = '4px'; c.textAlign = 'left'; c.fillStyle = lab; c.fillText(P.landmark, lx, Y + 414);
    c.fillStyle = val; c.font = `800 62px ${FONT_D}`; c.letterSpacing = '1px'; c.fillText('BUILT ' + P.built, lx, Y + 488);
  }, val, [X, Y + 380, Wd, 130]);
  // ---- optional printer's imprint, bottom right (page option ?sign=1; off in the film) ----
  const ip = st.imprint ? prog('sign') : 0;
  if (ip > 0) ink(ctx, { paint: (c) => { c.font = `600 26px ${FONT_T}`; c.letterSpacing = '4px'; c.textAlign = 'right'; c.textBaseline = 'alphabetic'; c.fillText('LemoLab × Claude Opus 5.5', AW - 52, AH - 30); } },
    { color: pickInk(pal.near, ['#F3EAD8', pal.sky1], 4.5), reg: R2(P.seed + 95, reg), clip: ip < 1 ? wipeRegion([AW - 520, AH - 70, 500, 60], 'right', ip, 41, 24) : null });
  if (st.finish !== false) inkFinish(ctx, st.T, -BLEED, -BLEED, AW + 2 * BLEED, AH + 2 * BLEED, .6, 1);
}

// boxes of the printed texts (art units), for window.TEXTS
export function textBoxes(P) {
  const [X, Y, Wd] = STUB;
  return [
    { id: 'header', pull: 'header', text: P.city + ' ' + P.cityZh, box: [104, 90, 980, 224] },
    { id: 'day', pull: 'day', text: 'DAY ' + P.day, box: [X + 30, Y + 30, X + 220, Y + 92] },
    { id: 'km', pull: 'km', text: 'FROM HOME ' + P.km + ' KM', box: [X + 26, Y + 156, X + Wd - 20, Y + 350] },
    { id: 'landmark', pull: 'landmark', text: P.landmark + ' BUILT ' + P.built, box: [X + 30, Y + 390, X + Wd - 20, Y + 496] },
  ];
}

// ======================================================================================================
// Generic pieces for the rest of the film: any scene (any width/height), loose layers, split fountain,
// a re-ink sweep between two prints, and the ticket stub drawn on its own (it stays put on screen).
// ======================================================================================================
// S = scene from scenes.js; st = { pal, T, prog(pull) (default 1), angle, reg, off(pull, depth), sep, header: {text, zh, p}, seed }
export function drawArt(ctx, S, st) {
  const W0 = S.w || AW, H0 = S.h || AH, pal = st.pal, reg = st.reg ?? 1, ang = st.angle ?? -.08, seed = st.seed || 1;
  const prog = st.prog || (() => 1), sep = st.sep || 0;
  paperSheet(ctx, st.T, -BLEED, -BLEED, W0 + 2 * BLEED, H0 + 2 * BLEED, .6);
  const box = [-300, -300, W0 + 600, H0 + 600];
  const region = (p, sd) => { if (p >= 1) return null; const m = new DOMMatrix().translate(W0 / 2, H0 / 2).rotate(ang * 180 / Math.PI).translate(-W0 / 2, -H0 / 2); const o = new Path2D(); o.addPath(wipeRegion(box, 'down', p, sd, 34, 6), m); return o; };
  S.parts.forEach((pt, j) => {
    const p = prog(pt.pull); if (p <= 0) return;
    const d = (S.depth && S.depth[pt.pull]) ?? .5;
    const off = st.off ? st.off(pt.pull, d) : [0, 0];
    ctx.save(); ctx.translate(off[0], off[1]);
    if (pt.cut) ctx.clip(inverse(pt.cut), 'evenodd');
    // loose layers: a sliver of bare paper and a paper-thickness shadow along the upper edge of each loose stencil
    if (sep > 0 && d >= .25 && p >= 1 && !pt.lit) {
      ctx.save(); ctx.translate(0, -9 * sep * d); ctx.globalAlpha = .26 * Math.min(1, sep * 1.5); ctx.fillStyle = '#140f14'; ctx.fill(pt.path); ctx.restore();
      ctx.save(); ctx.translate(1.5 * sep, -3.4 * sep); ctx.fillStyle = '#F3EAD8'; ctx.fill(pt.path); ctx.restore();
    }
    const clip = region(p, seed + j * 3), rg = R2(seed + j * 5, 2.2 * reg);
    if (pt.ink === 'fountain') {
      for (const s of S.fountain) { ctx.save(); ctx.beginPath(); ctx.rect(s.x0 - .5, -BLEED - 100, s.x1 - s.x0 + 1, H0 + 2 * BLEED + 200); ctx.clip(); ink(ctx, pt, { color: s.color, reg: rg, clip, sheen: 1, trap: 1, lw: 1.8 }); ctx.restore(); }
    } else ink(ctx, pt, { color: pal[pt.ink], reg: rg, clip, sheen: 1, trap: pt.lit ? 0 : 1, lw: 1.8 });
    ctx.restore();
  });
  const hd = st.header, hdr = S.header;
  if (hd && hdr && hd.p > 0) {
    const off = st.off ? st.off('sky', 0) : [0, 0];
    ctx.save(); ctx.translate(off[0], off[1]);
    const clip = hd.p < 1 ? wipeRegion([hdr.x - 20, hdr.y - hdr.size, 1700, hdr.size * 1.3], 'right', hd.p, 13, 40) : null;
    const col = pickInk([pal.sky2, pal.sky1], [pal.near, pal.mid, pal.sun, '#F3EAD8'], 3);
    ink(ctx, { paint: (c) => {
      c.font = `900 ${hdr.size}px ${FONT_D}`; c.letterSpacing = (hdr.size * .1) + 'px'; c.textAlign = 'left'; c.textBaseline = 'alphabetic'; c.fillText(hd.text, hdr.x, hdr.y);
      const w = c.measureText(hd.text).width;
      c.font = `600 ${Math.round(hdr.size * .36)}px ${FONT_C}`; c.letterSpacing = '6px'; c.fillText(hd.zh, hdr.x + w + 18, hdr.y - 4);
    } }, { color: col, reg: R2(seed + 44, 1.4 * reg), clip });
    ctx.restore();
  }
  if (st.finish !== false) inkFinish(ctx, st.T, -BLEED, -BLEED, W0 + 2 * BLEED, H0 + 2 * BLEED, .6, 1);
}
// header boxes in art units (two pieces, read separately)
export function headerBoxes(S, hd) {
  const h = S.header; if (!h) return [];
  const w = hd.text.length * h.size * .56;
  return [{ id: 'hdr-en', text: hd.text, box: [h.x, h.y - h.size * .8, h.x + w, h.y + 4] }, { id: 'hdr-zh', text: hd.zh, box: [h.x + w + 18, h.y - h.size * .5, h.x + w + 18 + hd.zh.length * h.size * .4, h.y] }];
}

// the ticket stub on its own. st = { pal, T, panel, rows: { day:{p, n}, big:{p, label, value}, small:{p, label, value} }, seed, reg }
export function drawStub(ctx, st) {
  const pal = st.pal, reg = st.reg ?? 1, seed = st.seed || 3, [X, Y, Wd] = STUB, lx = X + 34;
  if (st.panel > 0) ink(ctx, stubPath(), { color: pal.near, reg: R2(seed + 51, 1.2 * reg), clip: st.panel < 1 ? wipeRegion([X - 30, Y - 20, Wd + 60, STUB[3] + 40], 'down', st.panel, 9, 40) : null, sheen: 1 });
  const lab = pickInk(pal.near, [pal.sky1, pal.glow, pal.sky2, '#C3CADB'], 4.5), val = pickInk(pal.near, [pal.sky1, pal.sun, '#F3EAD8'], 4.5), key = pickInk(pal.near, [pal.sun, pal.sky1], 3);
  const R = st.rows || {};
  const item = (r, fn, color, box, k) => { if (!r || r.p <= 0) return; ink(ctx, { paint: fn }, { color, reg: R2(seed + k * 7, 1.2 * reg), clip: r.p < 1 ? wipeRegion(box, 'right', r.p, 31 + k, 24) : null }); };
  item(R.day, (c) => { c.font = `600 30px ${FONT_T}`; c.letterSpacing = '6px'; c.textAlign = 'left'; c.fillText('DAY', lx, Y + 76); c.font = `800 64px ${FONT_D}`; c.letterSpacing = '1px'; c.fillText(String(R.day.n), lx + 96, Y + 82); }, lab, [X, Y + 10, Wd, 100], 1);
  item(R.big, (c) => {
    c.font = `600 30px ${FONT_T}`; c.letterSpacing = '6px'; c.textAlign = 'left'; c.fillStyle = lab; c.fillText(R.big.label, lx, Y + 186);
    const v = R.big.value + ' KM'; c.fillStyle = key; let fs = 132; c.font = `900 ${fs}px ${FONT_D}`; c.letterSpacing = '2px';
    while (c.measureText(v).width > Wd - 60 && fs > 60) { fs -= 4; c.font = `900 ${fs}px ${FONT_D}`; }
    c.fillText(v, lx - 4, Y + 318); c.fillRect(lx, Y + 344, Wd - 68, 6);
  }, key, [X, Y + 140, Wd, 230], 2);
  item(R.small, (c) => {
    c.font = `600 25px ${FONT_T}`; c.letterSpacing = '4px'; c.textAlign = 'left'; c.fillStyle = lab; c.fillText(R.small.label, lx, Y + 414);
    c.fillStyle = val; c.font = `800 62px ${FONT_D}`; c.letterSpacing = '1px'; c.fillText(R.small.value, lx, Y + 488);
  }, val, [X, Y + 380, Wd, 130], 3);
  if (st.finish !== false && st.panel > 0) { ctx.save(); ctx.clip(stubPath().path); inkFinish(ctx, st.T, X - 30, Y - 20, Wd + 60, STUB[3] + 40, .6, 1); ctx.restore(); }
}
export function stubBoxes(rows) {
  const [X, Y, Wd] = STUB, out = [];
  if (rows.day) out.push({ id: 'day', text: 'DAY ' + rows.day.n, p: rows.day.p, box: [X + 30, Y + 30, X + 220, Y + 92] });
  if (rows.big) out.push({ id: 'big', text: rows.big.label + ' ' + rows.big.value + ' KM', p: rows.big.p, box: [X + 26, Y + 156, X + Wd - 20, Y + 350], live: rows.big.live });
  if (rows.small) out.push({ id: 'small', text: rows.small.label + ' ' + rows.small.value, p: rows.small.p, box: [X + 30, Y + 390, X + Wd - 20, Y + 496], live: rows.small.live });
  return out;
}

// the end card: a wider ticket printed over the right side in two pulls
export const CARD = [1300, 236, 560, 600];
export function drawEndCard(ctx, pal, T, p1, p2) {
  const [X, Y, Wd, Hd] = CARD;
  if (p1 > 0) {
    const knock = new Path2D(); const ny = Y + 300;
    knock.arc(X, ny, 20, -Math.PI / 2, Math.PI / 2); knock.closePath();
    knock.moveTo(X + Wd, ny - 20); knock.arc(X + Wd, ny, 20, -Math.PI / 2, Math.PI / 2, true); knock.closePath();
    for (let xx = X + 40; xx < X + Wd - 30; xx += 24) { knock.moveTo(xx + 5, ny); knock.arc(xx, ny, 5, 0, Math.PI * 2); }
    ink(ctx, { path: rectPath(X, Y, Wd, Hd), knock }, { color: pal.near, reg: [1, -.6], clip: p1 < 1 ? wipeRegion([X - 30, Y - 20, Wd + 60, Hd + 40], 'down', p1, 5, 40) : null, sheen: 1 });
  }
  if (p2 > 0) {
    const hi = pickInk(pal.near, [pal.sky1, '#F3EAD8'], 4.5), key = pickInk(pal.near, [pal.sun, pal.sky1], 3), lo = pickInk(pal.near, [pal.glow, pal.sky1, '#AEB8CF'], 4.5);
    ink(ctx, { paint: (c) => {
      const lx = X + 44; c.textAlign = 'left'; c.textBaseline = 'alphabetic';
      c.fillStyle = key; c.font = `900 96px ${FONT_D}`; c.letterSpacing = '3px'; c.fillText('THE LONG', lx, Y + 116); c.fillText('WAY HOME', lx, Y + 206);
      c.fillStyle = hi; c.font = `600 44px ${FONT_C}`; c.letterSpacing = '8px'; c.fillText('绕远路回家', lx, Y + 268);
      c.fillStyle = lo; c.font = `600 26px ${FONT_T}`; c.letterSpacing = '5px'; c.fillText('SILKSCREEN TRAVEL POSTER', lx, Y + 372);
      c.font = `600 30px ${FONT_C}`; c.letterSpacing = '6px'; c.fillText('丝印旅行海报', lx, Y + 420);
      c.fillStyle = key; c.fillRect(lx, Y + 456, Wd - 88, 5);
      c.fillStyle = hi; c.font = `600 30px ${FONT_T}`; c.letterSpacing = '3px'; c.fillText('LemoLab × Claude Opus 5.5', lx, Y + 520);
    } }, { color: hi, reg: [1.2, .6], clip: p2 < 1 ? wipeRegion([X, Y, Wd, Hd], 'right', p2, 9, 50) : null });
  }
  if (p1 > 0) { ctx.save(); ctx.clip(rectPath(X, Y, Wd, Hd)); inkFinish(ctx, T, X - 30, Y - 20, Wd + 60, Hd + 40, .6, 1); ctx.restore(); }
}
