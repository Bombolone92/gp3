// Style kit for "Isometric Picture-book Explainer": palette, plane drawing, floor type, people, subtitles.
// engine.js is the iso-infographic engine.
import { Iso, mix, hex, css, rgb, C30, S30, TAU, clamp, lerp, seg, ss, eo, eio, hash } from './engine.js';
export { Iso, mix, hex, css, rgb, C30, S30, TAU, clamp, lerp, seg, ss, eo, eio, hash };
// three tones per solid: top lifted toward warm paper, the +x face dropped toward a warm umber (never toward grey or violet)
export function tri(c, lift = .22, drop = .2) { return [hex(mix(c, '#FFF8EA', lift)), hex(rgb(c)), hex(mix(c, '#5B4434', drop))]; }
export const W = 1920, H = 1080;
export const ei = t => { t = clamp(t); return t * t * t; };

// ---------- palette (apricot warm: one ink, one accent for the rule, one subject green, one marking ginger) ----------
export const C = {
  bg: '#F1E8D8', paper: '#FAF4E8', ink: '#2A2E29', soft: '#7A7468', ghost: '#D6CCBA',
  accent: '#D0573A', accentLt: '#EDBFA9', green: '#3D6B59', greenMid: '#6E9886', greenLt: '#A7C2B2', ginger: '#E2AE3A',
  hair: '#2A2624', skin: '#D9A882', dark: '#3A3E3B',
  apron: '#EAE2D3', apronJoint: '#DDD3C1', carpet: '#F2E5CE', carpetLane: '#EADAC0', carpetEdge: '#DCCAAC',
  body: '#F6F2EA', belly: '#E4DDD1', cabinFloor: '#E3D3B8', aisle: '#F5ECDC', wallIn: '#F7F1E6',
  glass: '#C3D8D1', metal: '#CEC7BA', screen: '#2F3532',
};
// people: four muted tops (the weave reads in these four colours)
export const TOPS = ['#B9824F', '#7F98AE', '#8C8199', '#D3C29E'];
export const LEGS = ['#3E4450', '#59534A', '#3A3D42', '#4B4F5A'];

export const font = (w, px, fam = 'NotoSerifSC') => `${w} ${px}px ${fam}`;
export function track(g, s, x, y, sp) { let cx = x; for (const ch of s) { g.fillText(ch, cx, y); cx += g.measureText(ch).width + sp; } return cx - x - sp; }
export function trackW(g, s, sp) { let w = 0; for (const ch of s) w += g.measureText(ch).width + sp; return w - sp; }

export const iso = new Iso(null, W, H);

// ---------- plane drawing ----------
// world plane: 'xy' floor (u = −y, v = +x), 'yz' wall facing +x (u = −y, v = −z), 'xz' wall facing +y (u = +x, v = −z)
export function onPlane(g, x, y, z, plane, fn) {
  const k = iso.cam.k, [sx, sy] = iso.P(x, y, z);
  const u = plane === 'xz' ? [C30, S30] : [C30, -S30], v = plane === 'xy' ? [C30, S30] : [0, 1];
  g.save(); g.setTransform(u[0] * k, u[1] * k, v[0] * k, v[1] * k, sx, sy); fn(g); g.restore();
}
export const quad = (pts, z) => pts.map(p => iso.P(p[0], p[1], z));
export function fillPoly(g, pts, col, a = 1) { g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.closePath(); g.fillStyle = typeof col === 'string' ? col : css(col); const a0 = g.globalAlpha; g.globalAlpha = a0 * a; g.fill(); g.globalAlpha = a0; }
export const rect = (x0, x1, y0, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
export function tracePath(g, pts, p) { // stroke a screen polyline up to fraction p
  let L = 0; const d = []; for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); d.push(l); L += l; }
  let rem = L * p; g.beginPath(); g.moveTo(...pts[0]);
  for (let i = 1; i < pts.length && rem > 0; i++) { const f = Math.min(1, rem / d[i - 1]); g.lineTo(lerp(pts[i - 1][0], pts[i][0], f), lerp(pts[i - 1][1], pts[i][1], f)); rem -= d[i - 1]; }
  g.stroke();
}
// a 3D facet in world metres, flat-toned by its normal (top / +y / +x), culled when it faces away
export function facet(g, pts, t3, o = {}) {
  const a = pts[0], b = pts[1], c = pts[2];
  let n = [(b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]), (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]), (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])];
  if (o.out && n[0] * o.out[0] + n[1] * o.out[1] + n[2] * o.out[2] < 0) n = n.map(v => -v);
  if (!o.both && n[0] + n[1] + n[2] <= 1e-9) return false;
  const L = Math.hypot(...n) || 1; n = n.map(v => v / L);
  let col = o.color;
  if (!col) { const T = typeof t3 === 'string' ? tri(t3) : t3; col = n[2] > .8 ? T[0] : n[2] > .42 ? hex(mix(T[0], n[0] > n[1] ? T[2] : T[1], .5)) : (n[0] > n[1] ? T[2] : T[1]); }
  fillPoly(g, pts.map(p => iso.P(p[0], p[1], p[2])), col, o.a ?? 1);
  return true;
}

// ---------- floor type: phrases of segments [text, kind]; B big ink, A big accent, s small, n/na numerals (Latin serif) ----------
const SZ = { B: [700, 1.5, C.ink], A: [700, 1.5, C.accent], s: [500, .82, C.ink], n: [600, 1.5, C.ink, 'Newsreader'], na: [600, 1.5, C.accent, 'Newsreader'], ns: [500, .82, C.ink, 'Newsreader'], nsa: [600, .95, C.accent, 'Newsreader'], en: [500, .62, C.soft, 'Newsreader'], e: [600, 1.0, C.ink, 'Newsreader'] };
let _mg = null;
export function measure(w, s, fam) { if (!_mg) _mg = new OffscreenCanvas(8, 8).getContext('2d'); _mg.font = font(w, 100, fam); return _mg.measureText(s).width; }
// P = {id, x, y, z, t0, t1 (fade start), step, lineGap, dv, scale, lines, indent}
export function phraseLayout(P) {
  const out = []; let tc = P.t0; const sc = P.scale || 1;
  P.lines.forEach((line, li) => {
    let u = (li ? (P.indent ?? .55) : 0) * sc; const v = li * (P.dv || 1.85) * sc;
    for (const [s, k] of line) {
      const [w, size0, col, fam] = SZ[k], size = size0 * sc;
      const units = fam ? [s] : [...s];       // numbers/latin set as one run
      for (const ch of units) { if (ch === ' ') { u += .3 * sc; continue; } const cw = measure(w, ch, fam) * size / 100; out.push({ ch, u, v, w, size, col, cw, tc, fam, li }); u += cw + .05 * sc; tc += (P.step || .14) * (fam ? 2 : 1); }
    }
    tc += P.lineGap ?? .2;
  });
  return out;
}
export function floorType(g, t, P, L, alpha = 1) {
  const fade = (1 - ss(seg(t, P.t1, P.t1 + .3))) * alpha; if (fade <= 0) return;
  for (const c of L) {
    const a = eo(seg(t, c.tc, c.tc + .3)); if (a <= 0) continue;
    const dk = ss(seg(t, c.tc + .1, c.tc + .48)), sc = lerp(1.22, 1, eo(seg(t, c.tc, c.tc + .34)));
    onPlane(g, P.x + c.v, P.y - c.u, P.z ?? 0, 'xy', g2 => {
      g2.globalAlpha = a * fade; g2.font = font(c.w, 100, c.fam); g2.textBaseline = 'alphabetic';
      g2.fillStyle = css(mix(c.col === C.accent ? C.accentLt : C.ghost, c.col, dk));
      const s = c.size / 100, mw = measure(c.w, c.ch, c.fam);
      g2.translate(c.cw / 2, -c.size * .38); g2.scale(s * sc, s * sc); g2.translate(-mw / 2, c.size * .38 / s);
      g2.fillText(c.ch, 0, 0);
    });
  }
}
export function phraseBox(P, L, li) {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const c of L) if (li == null || c.li === li) for (const [du, dv] of [[0, 0], [c.cw, 0], [0, -c.size], [c.cw, -c.size]]) { const [sx, sy] = iso.P(P.x + c.v + dv, P.y - c.u - du, P.z ?? 0); x0 = Math.min(x0, sx); y0 = Math.min(y0, sy); x1 = Math.max(x1, sx); y1 = Math.max(y1, sy); }
  return { x0, y0, x1, y1 };
}
// world-space extent of a phrase on the floor: [xmin, xmax, ymin, ymax]
export function phraseWorld(P, L) {
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (const c of L) { x0 = Math.min(x0, P.x + c.v - c.size); x1 = Math.max(x1, P.x + c.v); y0 = Math.min(y0, P.y - c.u - c.cw); y1 = Math.max(y1, P.y - c.u); }
  return [x0, x1, y0, y1];
}

// ---------- people: billboards in metres, seen from behind; no faces, no hands ----------
// pose s: {phase, walking, bag (0 none, 1 rolling case), lift 0..1 (case raised overhead), sit}
export function drawPerson(g, p, s = {}) {
  const h = p.h, sw = s.walking ? Math.sin(s.phase) : 0, bob = s.walking ? Math.abs(Math.cos(s.phase)) * .012 * h : 0;
  const B = tri(p.top, .18, .26), Lg = p.legs, Ld = hex(mix(Lg, '#15171A', .25));
  g.save(); g.translate(0, -bob);
  if (s.bag && !s.lift) caseRoll(g, h, p);
  const leg = (hx, fx, col) => { g.beginPath(); g.moveTo(hx - .034 * h, -.49 * h); g.lineTo(hx + .034 * h, -.49 * h); g.lineTo(fx + .028 * h, -.02 * h); g.lineTo(fx - .028 * h, -.02 * h); g.closePath(); g.fillStyle = col; g.fill(); g.beginPath(); g.ellipse(fx - .008 * h, -.012 * h, .04 * h, .016 * h, 0, 0, TAU); g.fillStyle = '#232524'; g.fill(); };
  leg(.04 * h, .045 * h - sw * .1 * h, Ld); leg(-.04 * h, -.045 * h + sw * .1 * h, Lg);
  if (p.skirt) { const S = tri(p.skirt, .15, .25); g.beginPath(); g.moveTo(-.1 * h, -.62 * h); g.lineTo(.1 * h, -.62 * h); g.lineTo(.15 * h, -.38 * h); g.lineTo(-.15 * h, -.38 * h); g.closePath(); g.fillStyle = S[1]; g.fill(); }
  const lift = s.lift || 0;
  const arm = (sx, swing, col) => { g.save(); g.translate(sx, -.79 * h); g.rotate(swing); g.fillStyle = col; g.beginPath(); g.roundRect(-.026 * h, 0, .052 * h, .3 * h, .026 * h); g.fill(); g.restore(); };
  arm(.125 * h, lerp(-sw * .22 + .04, -2.9, lift), B[2]);
  g.beginPath(); g.moveTo(-.105 * h, -.5 * h); g.lineTo(-.12 * h, -.78 * h); g.quadraticCurveTo(-.12 * h, -.81 * h, -.09 * h, -.815 * h); g.lineTo(.09 * h, -.815 * h); g.quadraticCurveTo(.12 * h, -.81 * h, .12 * h, -.78 * h); g.lineTo(.105 * h, -.5 * h); g.closePath(); g.fillStyle = B[1]; g.fill();
  g.beginPath(); g.moveTo(.03 * h, -.5 * h); g.lineTo(.03 * h, -.815 * h); g.lineTo(.09 * h, -.815 * h); g.quadraticCurveTo(.12 * h, -.81 * h, .12 * h, -.78 * h); g.lineTo(.105 * h, -.5 * h); g.closePath(); g.fillStyle = B[2]; g.fill();
  arm(-.125 * h, lerp(sw * .22 - .04, 2.9, lift), B[1]);
  head(g, h, p);
  if (lift && s.caseUp !== false) { const y = lerp(-.62, -1.22, lift) * h; caseBox(g, 0, y, h, p); }
  g.restore();
}
function head(g, h, p) {
  g.fillStyle = hex(mix(C.skin, '#5A3A2A', .15)); g.fillRect(-.022 * h, -.85 * h, .044 * h, .05 * h);
  if (p.hairLong) { g.beginPath(); g.roundRect(-.07 * h, -.9 * h, .14 * h, .17 * h, .05 * h); g.fillStyle = C.hair; g.fill(); }
  g.beginPath(); g.arc(0, -.885 * h, .066 * h, 0, TAU); g.fillStyle = C.hair; g.fill();
  g.beginPath(); g.ellipse(-.058 * h, -.872 * h, .012 * h, .02 * h, 0, 0, TAU); g.fillStyle = C.skin; g.fill();
}
function caseRoll(g, h, p) { // small rolling case at the person's right, handle up
  const c = tri(p.bagc || '#5E6660', .2, .25);
  g.fillStyle = '#4A4E4B'; g.fillRect(.205 * h, -.62 * h, .012 * h, .3 * h);
  g.beginPath(); g.roundRect(.15 * h, -.34 * h, .14 * h, .32 * h, .02 * h); g.fillStyle = c[1]; g.fill();
  g.fillStyle = c[2]; g.fillRect(.25 * h, -.34 * h, .04 * h, .32 * h);
}
export function caseBox(g, x, y, h, p) { const c = tri(p.bagc || '#5E6660', .2, .25); g.beginPath(); g.roundRect(x - .16 * h, y - .1 * h, .32 * h, .2 * h, .02 * h); g.fillStyle = c[1]; g.fill(); g.fillStyle = c[0]; g.fillRect(x - .16 * h, y - .1 * h, .32 * h, .045 * h); }
// seated, seen from behind and above: shoulders and the back of the head (the seat back hides the rest)
export function drawSeated(g, p, s = {}) {
  const B = tri(p.top, .18, .26), sink = s.sink ?? 0;
  g.save(); g.translate(0, sink);
  g.beginPath(); g.moveTo(-.22, -.5); g.lineTo(-.23, -.93); g.quadraticCurveTo(-.22, -1.0, -.15, -1.01); g.lineTo(.15, -1.01); g.quadraticCurveTo(.22, -1.0, .23, -.93); g.lineTo(.22, -.5); g.closePath(); g.fillStyle = B[1]; g.fill();
  g.beginPath(); g.moveTo(.05, -.5); g.lineTo(.05, -1.01); g.lineTo(.15, -1.01); g.quadraticCurveTo(.22, -1.0, .23, -.93); g.lineTo(.22, -.5); g.closePath(); g.fillStyle = B[2]; g.fill();
  g.fillStyle = hex(mix(C.skin, '#5A3A2A', .15)); g.fillRect(-.04, -1.07, .08, .08);
  if (p.hairLong) { g.beginPath(); g.roundRect(-.12, -1.2, .24, .25, .08); g.fillStyle = C.hair; g.fill(); }
  g.beginPath(); g.arc(0, -1.15, .11, 0, TAU); g.fillStyle = C.hair; g.fill();
  g.restore();
}

// ---------- subtitles: one cue per narration line, Chinese above, English below, on a pale bar in the lower safe area ----------
export const SUB = { cn: 34, en: 25, y: 1022, pad: 18 };   // y = baseline of the English line (≥ 54 px from the bottom edge)
export function subtitles(g, t, cues) {
  for (const s of cues) {
    if (t < s.t0 || t >= s.t1) continue;   // hard switch: one cue at a time, no cross-fade
    g.save();
    g.font = font(500, SUB.cn); const wc = g.measureText(s.cn).width; g.font = font(420, SUB.en, 'Newsreader'); const we = g.measureText(s.en).width;
    const w = Math.max(wc, we) + 2 * SUB.pad, top = SUB.y - SUB.en - SUB.cn - 22;
    g.fillStyle = 'rgba(250,245,236,.86)'; g.beginPath(); g.roundRect(W / 2 - w / 2, top, w, SUB.y + 14 - top, 6); g.fill();
    g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    g.fillStyle = C.ink; g.font = font(500, SUB.cn); g.fillText(s.cn, W / 2, SUB.y - SUB.en - 12);
    g.fillStyle = '#4A4A42'; g.font = font(420, SUB.en, 'Newsreader'); g.fillText(s.en, W / 2, SUB.y);
    g.restore();
  }
}
export function subtitleBox(g, s) { // screen box of a cue (for the margin check)
  g.save(); g.font = font(500, SUB.cn); const wc = g.measureText(s.cn).width; g.font = font(420, SUB.en, 'Newsreader'); const we = g.measureText(s.en).width; g.restore();
  const w = Math.max(wc, we) + 2 * SUB.pad; return { x0: W / 2 - w / 2, x1: W / 2 + w / 2, y0: SUB.y - SUB.en - SUB.cn - 22, y1: SUB.y + 14 };
}
// ---------- English subtitle bar (single line) ----------
export function subtitle(g, t, subs) {
  for (const s of subs) {
    const a = ss(seg(t, s.t0, s.t0 + .22)) * (1 - ss(seg(t, s.t1 - .18, s.t1))); if (a <= 0) continue;
    g.save(); g.globalAlpha = a; g.font = font(420, 32, 'Newsreader'); const w = g.measureText(s.text).width;
    g.fillStyle = 'rgba(247,241,230,.9)'; g.beginPath(); g.roundRect(W / 2 - w / 2 - 20, 1008 - 30, w + 40, 52, 4); g.fill();
    g.fillStyle = C.ink; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(s.text, W / 2, 1008 - 3); g.restore();
  }
}
