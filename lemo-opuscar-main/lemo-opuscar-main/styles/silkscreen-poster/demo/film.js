// film.js · "The Long Way Home" (silkscreen travel poster). One timeline for the whole 50 s film, full-bleed prints only:
// the camera always stays inside the picture (no table, no paper edge). 108 BPM waltz (3/4): beat 0.5556 s, bar 1.6667 s.
// The ticket stub sits at the same place on screen in every city; from shot 4 on it is drawn in screen space.
import { makeTextures, squeegee, wipeRegion, ink, rectPath, clamp, lerp, hash, inkFinish } from './engine/silk.js';
import { drawPrint, tiltFront, textBoxes, drawArt, headerBoxes, drawStub, stubBoxes, drawEndCard, STUB, AW, AH, FONT_T } from './engine/poster.js';
import { temple, istanbul, paris, boca, sea, BOCA_INKS } from './engine/scenes.js';

export const BPM = 108, B = 60 / BPM, BAR = 3 * B, DUR = 50;
const W = 1920, H = 1080;
const ss = t => { t = clamp(t); return t * t * (3 - 2 * t); };
const eio = t => { t = clamp(t); return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
const eo = t => 1 - Math.pow(1 - clamp(t), 3);
const seg = (t, a, b) => clamp((t - a) / (b - a));
const bt = (bar, beat = 0) => +(bar * BAR + beat * B).toFixed(4);

// ---------------- palettes (one per print; ≤ 6 inks + a lit-face ink) ----------------
export const PAPER = '#F3EAD8';
const PAL = {
  beijingDawn: { sky1: '#F5C978', sky2: '#E8866A', far: '#9A88AE', mid: '#22447C', near: '#1B1F34', sun: '#D8432B', glow: '#5D86C4' },
  istanbul: { sky1: '#F6DFB2', sky2: '#E9A27A', far: '#8DB9BE', mid: '#C9705A', near: '#1F2D3A', sun: '#F2C14E', glow: '#6E8BA3' },
  paris: { sky1: '#F4E6CC', sky2: '#A9C1DE', far: '#C3B3D2', mid: '#5B6E9C', near: '#252B42', sun: '#E4553F', glow: '#EDC77E' },
  boca: { sky1: '#F8E7B0', sky2: '#82C7D8', far: '#B9A9C6', mid: '#3B5B7A', near: '#232B3A', sun: '#E2543D', glow: '#F7E2A6' },
  sea: { sky1: '#2C3B69', sky2: '#1C2650', far: '#46598A', mid: '#203A63', near: '#111A2F', sun: '#F2D28A', glow: '#3F6395' },
  beijingDusk: { sky1: '#F2A766', sky2: '#A25A84', far: '#6E5C8E', mid: '#26386E', near: '#151A2C', sun: '#E4502F', glow: '#5578B4' },
  beijingNight: { sky1: '#2A3762', sky2: '#18204A', far: '#3A4778', mid: '#1F2D5C', near: '#0F1426', sun: '#F2BE4E', glow: '#3D5A97' },
};
// ---------------- prints ----------------
const PRINTS = {
  beijing: { scene: temple(3), city: 'BEIJING', cityZh: '北京', day: 1, km: '0', landmark: 'TEMPLE OF HEAVEN', built: '1420', seed: 5 },
};

// ---------------- timeline (whole-film clock) ----------------
const P1 = {
  sun: [-.9, 2.4], sky1: [bt(0, 2), .5], sky2: [bt(1, 0), .5], far: [bt(1, 1), .45], mid: [bt(1, 2), .45],
  near: [bt(2, 0), .45], acc: [bt(2, .5), .32], lit: [bt(2, 1), .32],
  stub: [bt(3, 1), .34], day: [bt(3, 1.5), .2], header: [bt(3, 2), .32], landmark: [bt(3, 2.5), .2], km: [bt(4, 0), .22],
  sign: [4.5 * BAR, .26],
};
const LIFT1 = bt(2, 2);                 // 4.44 s: the screen hinges up
const INK_OF = { sun: 'sun', sky1: 'sky1', sky2: 'sky2', far: 'far', mid: 'mid', near: 'near', acc: 'sun', lit: 'glow' };
// ---------------- the rest of the journey (whole-film clock) ----------------
const SC = { istanbul: istanbul(7), paris: paris(9), boca: boca(13), sea: sea(17), temple: temple(3) };
// Istanbul is printed on sixteenth notes (faster by subdividing the beat, same tempo); its stub lands early so it can be read
const IST = { cover: 10.3, sky: [10.28, .26], far: [10.42, .22], mid: [10.56, .22], near: [10.70, .22], acc: [10.84, .18], lit: [10.98, .18],
  header: [10.56, .3], panel: [10.70, .25], day: [10.84, .15], big: [10.98, .18], small: [11.12, .18] };
const PAR = { swap: [bt(8, 1.5), .5], crane: [14.4, 17.7], header: [14.45, .32], panel: [14.45, .25], day: [14.5, .15], big: [14.6, .18], small: [14.7, .18] };
const BA = { swap: [bt(10, 2), .6], near: [18.33, .26], header: [18.61, .32], acc: [18.75, .2], panel: [19.17, .3], day: [19.31, .18], big: [19.44, .2], small: [19.72, .2], truck: [17.9, 22.2] };
const PUSH = { t0: bt(13, .5), t1: 25.5, mesh: [24.4, .45], silence: [26.86, bt(16, 2)] };
const CLAMP = bt(16, 2);                                                   // 27.78 s
const SEA = { swap: [CLAMP + .17, .5], out: [28.2, 29.4], truck: [28.2, 33.33], lift: [28.55, .45], count: [28.6, 36.1] };
const HOME = { swap: [bt(20), .55], snap: bt(22), push: [36.9, 41.6], night: [bt(25, 1), .6], card1: [46.2, .4], card2: [46.6, .35] };
const TRAV0 = 20360, TRAV1 = 39630, FAR = 19270;

export const SHOTS = [
  { n: 1, t0: 0, t1: bt(2) }, { n: 2, t0: bt(2), t1: bt(3, 1) }, { n: 3, t0: bt(3, 1), t1: 10 },
  { n: 4, t0: 10, t1: PAR.swap[0] }, { n: 5, t0: PAR.swap[0], t1: BA.swap[0] }, { n: 6, t0: BA.swap[0], t1: PUSH.t0 },
  { n: 7, t0: PUSH.t0, t1: CLAMP }, { n: 8, t0: CLAMP, t1: HOME.swap[0] }, { n: 9, t0: HOME.swap[0], t1: HOME.snap },
  { n: 10, t0: HOME.snap, t1: HOME.night[0] }, { n: 11, t0: HOME.night[0], t1: DUR },
];

let ctx, T, CUES = [], SIGN = false, NOCAP = false;
export function setup(canvas, opts) {
  ctx = canvas.getContext('2d'); T = makeTextures(PAPER, 7); CUES = opts.cues || []; SIGN = !!opts.sign; NOCAP = !!opts.nocap;
  return { dur: DUR, ev: events() };
}
function events() {
  const ev = [], E = (t, type, o = {}) => ev.push({ t: +t.toFixed(3), type, ...o });
  for (const k of Object.keys(INK_OF)) { const [a, d] = P1[k]; E(Math.max(0, a), 'pull', { city: 'beijing', layer: k, dur: +(d - Math.max(0, -a)).toFixed(3), ink: INK_OF[k] }); }
  E(LIFT1, 'lift'); E(LIFT1 - .5, 'wake', { place: 'beijing' });
  E(P1.stub[0], 'stub', { dur: P1.stub[1] }); E(P1.header[0], 'header');
  E(P1.day[0], 'item', { k: 0 }); E(P1.landmark[0], 'item', { k: 1 }); E(P1.km[0], 'item', { k: 2, accent: 1 });
  if (SIGN) E(P1.sign[0], 'sign');
  E(P1.stub[0], 'push', { dur: 4.7 });
  // Istanbul
  E(10.0, 'wipe', { dur: .6 }); E(9.7, 'wake', { place: 'istanbul' });
  ['sky', 'far', 'mid', 'near', 'acc', 'lit'].forEach((k, j) => E(IST[k][0], 'pull', { city: 'istanbul', layer: k, n: j, dur: IST[k][1], quick: 1 }));
  const info = (o, city) => { E(o.header[0], 'header', { city }); E(o.panel[0], 'stub', { dur: o.panel[1], city }); E(o.day[0], 'item', { k: 0 }); E(o.big[0], 'item', { k: 2, accent: 1 }); E(o.small[0], 'item', { k: 1 }); };
  info(IST, 'istanbul');
  // Paris
  E(PAR.swap[0], 'sweep', { dur: PAR.swap[1], to: 'paris' }); E(PAR.swap[0] - .4, 'wake', { place: 'paris' }); E(PAR.crane[0], 'crane', { dur: PAR.crane[1] - PAR.crane[0] }); info(PAR, 'paris');
  // Buenos Aires
  E(BA.swap[0], 'sweep', { dur: BA.swap[1], to: 'boca', fountain: 1 }); E(BA.swap[0] - .4, 'wake', { place: 'boca' });
  E(BA.near[0], 'pull', { city: 'boca', layer: 'near', n: 4, dur: BA.near[1], quick: 1 }); E(BA.acc[0], 'pull', { city: 'boca', layer: 'acc', n: 5, dur: BA.acc[1], quick: 1 });
  E(BA.truck[0], 'truck', { dur: BA.truck[1] - BA.truck[0] }); info(BA, 'boca');
  // the far side: push into the number, silence, clamp
  E(PUSH.t0, 'bigpush', { dur: PUSH.t1 - PUSH.t0 }); E(PUSH.mesh[0], 'meshdown', { dur: PUSH.mesh[1] });
  E(25.0, 'drop'); E(PUSH.silence[0], 'silence', { dur: +(PUSH.silence[1] - PUSH.silence[0]).toFixed(3) }); E(CLAMP, 'clamp');
  // the way home
  E(SEA.swap[0], 'sweep', { dur: SEA.swap[1], to: 'sea' }); E(SEA.lift[0], 'lift'); E(SEA.out[0], 'pullout', { dur: SEA.out[1] - SEA.out[0] }); E(SEA.swap[0], 'wake', { place: 'sea' });
  E(SEA.out[0], 'truck', { dur: SEA.truck[1] - SEA.truck[0], long: 1 }); E(SEA.count[0], 'count', { dur: SEA.count[1] - SEA.count[0] });
  E(HOME.swap[0], 'sweep', { dur: HOME.swap[1], to: 'dusk' }); E(HOME.swap[0] - .5, 'wake', { place: 'home' });
  E(HOME.snap, 'snap'); E(HOME.push[0], 'push', { dur: HOME.push[1] - HOME.push[0] });
  E(HOME.night[0], 'sweep', { dur: HOME.night[1], to: 'night' }); E(HOME.night[0] - .3, 'wake', { place: 'night' });
  E(HOME.card1[0], 'endpull', { dur: HOME.card1[1] }); E(HOME.card2[0], 'endpull', { dur: HOME.card2[1], text: 1 });
  for (const c of CUES) E(c.vo, 'vo', { id: c.id });
  SHOTS.forEach(s => E(s.t0, 'shot', { n: s.n, t1: s.t1 }));
  ev.sort((a, b) => a.t - b.t);
  return ev;
}

// ---------------- camera: art units, z ≥ 1, the view never leaves the picture ----------------
const K1 = [
  [0, 0, [1240, 452, 3.2]],
  [0, bt(0, 2), [1236, 452, 3.34], 'lin'],
  [bt(0, 2), .55, [1180, 440, 2.25]],
  [bt(1, 0), .55, [1090, 470, 1.62]],
  [bt(1, 1), .5, [1010, 520, 1.3]],
  [bt(1, 2), .5, [975, 535, 1.12]],
  [bt(2, 0), .6, [960, 540, 1.0]],
  [P1.stub[0] - .3, 10 - P1.stub[0] + .3, [985, 532, 1.035], 'eio'],
];
function camAt(keys, t) {
  let s = keys[0][2].slice();
  for (const [t0, d, to, kind] of keys) {
    if (t < t0) break;
    const u = d <= 0 ? 1 : seg(t, t0, t0 + d), e = kind === 'lin' ? u : kind === 'eio' ? eio(u) : eo(u);
    s = [lerp(s[0], to[0], e), lerp(s[1], to[1], e), Math.exp(lerp(Math.log(s[2]), Math.log(to[2]), e))];
  }
  const z = Math.max(1, s[2]), hw = W / 2 / z, hh = H / 2 / z;      // keep the whole view inside the print
  return [clamp(s[0], hw, AW - hw), clamp(s[1], hh, AH - hh), z];
}
let CAM = [W / 2, H / 2, 1];
function cam(cx, cy, z) { CAM = [cx, cy, z]; ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.translate(W / 2, H / 2); ctx.scale(z, z); ctx.translate(-cx, -cy); }
const toScreen = (x, y) => [W / 2 + (x - CAM[0]) * CAM[2], H / 2 + (y - CAM[1]) * CAM[2]];

// ---------------- the screen over the print: mesh while printing; lifting = the frame's bottom bar sweeps up and away ----------------
function mesh(lift) {
  if (lift >= 1) return;
  const up = ss(lift) * (AH + 260);                     // the hinged screen rises: its lower edge travels up the print
  const y1 = AH + 40 - up;                              // lower edge of the mesh (art units)
  ctx.save();
  ctx.beginPath(); ctx.rect(-100, -100, AW + 200, y1 + 100); ctx.clip();
  ctx.fillStyle = 'rgba(236,214,128,.05)'; ctx.fillRect(-100, -100, AW + 200, AH + 200);
  ctx.strokeStyle = 'rgba(60,52,30,.12)'; ctx.lineWidth = .4; ctx.beginPath();
  for (let x = -60; x < AW + 60; x += 6) { ctx.moveTo(x, -60); ctx.lineTo(x, AH + 60); }
  for (let y = -60; y < AH + 60; y += 6) { ctx.moveTo(-60, y); ctx.lineTo(AW + 60, y); }
  ctx.stroke(); ctx.restore();
  if (lift > 0) {                                        // the frame's bottom bar: aluminium + blue tape, its shadow on the print
    ctx.save();
    ctx.globalAlpha = .22; ctx.fillStyle = '#000'; ctx.fillRect(-100, y1 + 34, AW + 200, 26 + 30 * lift);
    ctx.globalAlpha = 1; ctx.fillStyle = '#B7B2A6'; ctx.fillRect(-100, y1, AW + 200, 34);
    ctx.fillStyle = '#D6D1C4'; ctx.fillRect(-100, y1, AW + 200, 5); ctx.fillStyle = '#8E897E'; ctx.fillRect(-100, y1 + 28, AW + 200, 6);
    ctx.fillStyle = '#3C6E9E'; ctx.fillRect(-100, y1 - 10, AW + 200, 10);
    ctx.restore();
  }
}

// ---------------- Beijing (shots 1–3) ----------------
const prog1 = (t) => (k) => { const v = P1[k]; if (!v) return 0; return seg(t, v[0], v[0] + v[1]); };
const ANG = -.08;
function beijing(t) {
  const [cx, cy, z] = camAt(K1, t);
  cam(cx, cy, z);
  const pal = PAL.beijingDawn, P = PRINTS.beijing, prog = prog1(t);
  drawPrint(ctx, P, { pal, T, prog, angle: ANG, reg: 1, imprint: SIGN });
  // wet sheen behind the blade on the big pulls, dry within ~0.6 s
  for (const k of ['sky1', 'sky2', 'mid', 'near']) {
    const [a, d] = P1[k], u = seg(t, a, a + d), dry = seg(t, a + d, a + d + .6);
    if (u <= 0 || dry >= 1) continue;
    const f = tiltFront(u, ANG), mx = (f.a[0] + f.b[0]) / 2, my = (f.a[1] + f.b[1]) / 2;
    const g = ctx.createLinearGradient(mx - f.lead[0] * 260, my - f.lead[1] * 260, mx, my);
    g.addColorStop(0, 'rgba(255,250,235,0)'); g.addColorStop(.75, `rgba(255,250,235,${.06 * (1 - dry)})`); g.addColorStop(1, `rgba(255,250,235,${.18 * (1 - dry)})`);
    ctx.save(); ctx.fillStyle = g; ctx.translate(mx, my); ctx.rotate(ANG); ctx.fillRect(-1400, -260, 2800, 262); ctx.restore();
  }
  mesh(seg(t, LIFT1, LIFT1 + .45));
  for (const k of Object.keys(INK_OF)) {
    const [a, d] = P1[k], u = seg(t, a, a + d);
    if (u <= 0 || u >= 1) continue;
    const f = tiltFront(u, ANG), o = 16;
    squeegee(ctx, [f.a[0] + f.lead[0] * o, f.a[1] + f.lead[1] * o], [f.b[0] + f.lead[0] * o, f.b[1] + f.lead[1] * o], f.lead,
      { color: pal[INK_OF[k]], seed: a * 10 + 3, roll: (f.a[1] + f.b[1]) / 60, scale: 1.3, handle: .4, shadow: .18 });
  }
}

// ======================================================================================================
// Shots 4–11
// ======================================================================================================
let OZ = [W / 2, H / 2, 1];                                            // screen-space zoom wrapped around everything (the push into the stub)
function camS(cx, cy, z) { CAM = [cx, cy, z]; ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.translate(W / 2, H / 2); ctx.scale(OZ[2], OZ[2]); ctx.translate(-OZ[0], -OZ[1]); ctx.translate(W / 2, H / 2); ctx.scale(z, z); ctx.translate(-cx, -cy); }
function screenS() { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.translate(W / 2, H / 2); ctx.scale(OZ[2], OZ[2]); ctx.translate(-OZ[0], -OZ[1]); }
const sp = (t, v) => v ? seg(t, v[0], v[0] + v[1]) : 0;
const fmt = (n) => Math.round(n).toLocaleString('en-US');

// a re-ink sweep in screen space: everything behind the blade is the next print
const SW_BOX = [-500, -500, W + 1000, H + 1000];
function swRegion(p, ang, seed) { const m = new DOMMatrix().translate(W / 2, H / 2).rotate(ang * 180 / Math.PI).translate(-W / 2, -H / 2); const o = new Path2D(); o.addPath(wipeRegion(SW_BOX, 'down', p, seed, 50, 7), m); return o; }
function swFront(p, ang) {
  const y = -500 - 50 + p * (H + 1000 + 100), m = new DOMMatrix().translate(W / 2, H / 2).rotate(ang * 180 / Math.PI).translate(-W / 2, -H / 2);
  const a = m.transformPoint(new DOMPoint(-500, y)), b = m.transformPoint(new DOMPoint(W + 500, y)), d = m.transformPoint(new DOMPoint(0, 1)), o = m.transformPoint(new DOMPoint(0, 0));
  return { a: [a.x, a.y], b: [b.x, b.y], lead: [d.x - o.x, d.y - o.y] };
}
function sweep(p, ang, drawA, drawB, beads, seed = 3) {
  if (p <= 0) { drawA(); return; }
  if (p >= 1) { drawB(); return; }
  drawA();
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clip(swRegion(p, ang, seed)); drawB(); ctx.restore();
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
  const f = swFront(p, ang), o = 22, L = Math.hypot(f.b[0] - f.a[0], f.b[1] - f.a[1]);
  const bd = beads.length === 1 ? [{ t0: 0, t1: 1, color: beads[0] }] : beads.map((c, i) => ({ t0: i / beads.length + .004, t1: (i + 1) / beads.length, color: c }));
  squeegee(ctx, [f.a[0] + f.lead[0] * o, f.a[1] + f.lead[1] * o], [f.b[0] + f.lead[0] * o, f.b[1] + f.lead[1] * o], f.lead, { beads: bd, seed, roll: p * 40, scale: 1.6, handle: .35, shadow: .16 });
  ctx.restore();
}

// the screen frame bar crossing the frame (art or screen units): y1 = lower edge of the mesh
function meshAt(y1, w = W, h = H, bar = true) {
  ctx.save(); ctx.beginPath(); ctx.rect(-100, -100, w + 200, y1 + 100); ctx.clip();
  ctx.fillStyle = 'rgba(236,214,128,.05)'; ctx.fillRect(-100, -100, w + 200, h + 200);
  ctx.strokeStyle = 'rgba(60,52,30,.14)'; ctx.lineWidth = .4; ctx.beginPath();
  for (let x = -60; x < w + 60; x += 6) { ctx.moveTo(x, -60); ctx.lineTo(x, h + 60); }
  for (let y = -60; y < h + 60; y += 6) { ctx.moveTo(-60, y); ctx.lineTo(w + 60, y); }
  ctx.stroke(); ctx.restore();
  if (bar && y1 < h + 40) {
    ctx.save(); ctx.globalAlpha = .22; ctx.fillStyle = '#000'; ctx.fillRect(-100, y1 + 34, w + 200, 40);
    ctx.globalAlpha = 1; ctx.fillStyle = '#B7B2A6'; ctx.fillRect(-100, y1, w + 200, 34);
    ctx.fillStyle = '#D6D1C4'; ctx.fillRect(-100, y1, w + 200, 5); ctx.fillStyle = '#8E897E'; ctx.fillRect(-100, y1 + 28, w + 200, 6);
    ctx.fillStyle = '#3C6E9E'; ctx.fillRect(-100, y1 - 10, w + 200, 10); ctx.restore();
  }
}

// screen-space foreground silhouette (old cypresses) crossing right to left; it covers the frame for about one frame at t0
function treeWipe(t, t0, color) {
  const u = seg(t, t0 - .3, t0 + .3); if (u <= 0 || u >= 1) return;
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
  const w = W * 1.25, cx = lerp(W + w / 2 + 160, -w / 2 - 160, ss(u)), x = cx - w / 2;
  const p = new Path2D(); p.moveTo(x, -40);
  for (let y = -40; y <= H + 40; y += 60) { const b = 70 + 90 * hash(y * .37); p.quadraticCurveTo(x - b, y + 30, x - b * .4, y + 60); }
  p.lineTo(x + w, H + 40);
  for (let y = H + 40; y >= -40; y -= 60) { const b = 70 + 110 * hash(y * .61 + 3); p.quadraticCurveTo(x + w + b, y - 30, x + w + b * .3, y - 60); }
  p.closePath(); ctx.fillStyle = color; ctx.fill(p); ctx.restore();
}

// stub state for a city at time t
function stubCity(t, o, day, km, label, value) {
  return { panel: sp(t, o.panel), rows: { day: { p: sp(t, o.day), n: day }, big: { p: sp(t, o.big), label: 'FROM HOME', value: km }, small: { p: sp(t, o.small), label, value } } };
}
function stubReturn(t, day) {
  const u = ss(seg(t, SEA.count[0], SEA.count[1]));
  const home = Math.round(lerp(FAR, 0, u) / 10) * 10, trav = Math.round(lerp(TRAV0, TRAV1, u) / 10) * 10, live = u > 0 && u < 1;
  return { panel: 1, rows: { day: { p: 1, n: day }, big: { p: 1, label: 'FROM HOME', value: fmt(home), live }, small: { p: 1, label: 'TRAVELLED', value: fmt(trav) + ' KM', live } } };
}
function stubDraw(pal, s, seed) { screenS(); drawStub(ctx, { pal, T, panel: s.panel, rows: s.rows, seed }); }

// ---- one city print, with its own camera ----
function cityIst(t) {
  camS(lerp(960, 900, ss(seg(t, 10.3, 14.2))), lerp(540, 520, ss(seg(t, 10.3, 14.2))), lerp(1, 1.04, ss(seg(t, 10.3, 14.2))));
  const prog = (k) => sp(t, IST[k]);
  drawArt(ctx, SC.istanbul, { pal: PAL.istanbul, T, prog, angle: -.06, seed: 21, header: { text: 'ISTANBUL', zh: '伊斯坦布尔', p: sp(t, IST.header) } });
  for (const k of ['sky', 'far', 'mid', 'near', 'acc', 'lit']) {
    const u = sp(t, IST[k]); if (u <= 0 || u >= 1) continue;
    const f = tiltFrontS(u, -.06, SC.istanbul), o = 16, ink0 = { sky: 'sky2', far: 'far', mid: 'mid', near: 'near', acc: 'sun', lit: 'glow' }[k];
    squeegee(ctx, [f.a[0] + f.lead[0] * o, f.a[1] + f.lead[1] * o], [f.b[0] + f.lead[0] * o, f.b[1] + f.lead[1] * o], f.lead, { color: PAL.istanbul[ink0], seed: IST[k][0] * 10, roll: (f.a[1] + f.b[1]) / 60, scale: 1.3, handle: .4, shadow: .18 });
  }
  stubDraw(PAL.istanbul, stubCity(t, IST, 6, '7,060', 'HAGIA SOPHIA', 'BUILT 537'), 61);
}
function tiltFrontS(p, angle, S) {
  const W0 = S.w || AW, H0 = S.h || AH, box = [-300, -300, W0 + 600, H0 + 600], y = -300 - 34 + p * (H0 + 600 + 68);
  const m = new DOMMatrix().translate(W0 / 2, H0 / 2).rotate(angle * 180 / Math.PI).translate(-W0 / 2, -H0 / 2);
  const a = m.transformPoint(new DOMPoint(-300, y)), b = m.transformPoint(new DOMPoint(W0 + 300, y)), d = m.transformPoint(new DOMPoint(0, 1)), o = m.transformPoint(new DOMPoint(0, 0));
  return { a: [a.x, a.y], b: [b.x, b.y], lead: [d.x - o.x, d.y - o.y] };
}
function cityParis(t, stub = true) {
  const u = eio(seg(t, PAR.crane[0], PAR.crane[1])), cy = lerp(1080, 540, u);
  camS(960, cy, 1);
  const loose = lerp(.35, .9, seg(t, PAR.swap[0], BA.swap[0]));
  const off = (pull, d) => [Math.sin(d * 9 + 1) * 6 * loose, (1080 - cy) * (d - .4) * .32 + Math.cos(d * 7) * 5 * loose];
  drawArt(ctx, SC.paris, { pal: PAL.paris, T, angle: -.06, seed: 23, off, sep: loose, reg: 1 + loose, header: { text: 'PARIS', zh: '巴黎', p: sp(t, PAR.header) } });
  if (stub) stubDraw(PAL.paris, stubCity(t, PAR, 11, '8,220', 'EIFFEL TOWER', 'BUILT 1889'), 63);
}
function cityBoca(t, stub = true) {
  const u = ss(seg(t, BA.truck[0], BA.truck[1])), cx = lerp(960, 1640, u);
  camS(cx, 540, 1);
  const loose = lerp(.8, 1.6, seg(t, BA.swap[0], PUSH.t0 + 1));
  const off = (pull, d) => [(cx - 960) * (d - .5) * .22 + Math.sin(d * 11 + t * .7) * 7 * loose, Math.cos(d * 5 + t * .6) * 6 * loose];
  const prog = (k) => k === 'near' ? sp(t, BA.near) : k === 'acc' ? sp(t, BA.acc) : 1;
  drawArt(ctx, SC.boca, { pal: PAL.boca, T, prog, angle: -.05, seed: 25, off, sep: loose * .8, reg: 1 + loose, header: { text: 'BUENOS AIRES', zh: '布宜诺斯艾利斯', p: sp(t, BA.header) } });
  for (const k of ['near', 'acc']) {
    const v = sp(t, BA[k]); if (v <= 0 || v >= 1) continue;
    const f = tiltFrontS(v, -.05, SC.boca), o = 16;
    squeegee(ctx, [f.a[0] + f.lead[0] * o, f.a[1] + f.lead[1] * o], [f.b[0] + f.lead[0] * o, f.b[1] + f.lead[1] * o], f.lead, { color: PAL.boca[k === 'near' ? 'near' : 'sun'], seed: 7, roll: (f.a[1] + f.b[1]) / 60, scale: 1.3, handle: .4, shadow: .18 });
  }
  if (stub) stubDraw(PAL.boca, stubCity(t, BA, 19, '19,270', 'OBELISCO', 'BUILT 1936'), 65);
}
function citySea(t) {
  const cx = lerp(4300, 1100, ss(seg(t, SEA.truck[0], SEA.truck[1])));
  camS(cx, 540, 1);
  const off = (pull, d) => [Math.sin(d * 9 + t) * 5, Math.cos(d * 6 + t * .8) * 6 * d];
  drawArt(ctx, SC.sea, { pal: PAL.sea, T, angle: -.05, seed: 27, off, sep: .9, reg: 1.8 });
  stubDraw(PAL.sea, stubReturn(t, 24), 67);
}
function cityHome(t, pal, night) {
  const snapped = t >= HOME.snap, k = 1 - ss(seg(t, HOME.snap - .02, HOME.snap + .05));
  const loose = snapped ? k : 1;
  const off = (pull, d) => [Math.sin(d * 9 + t * .9 + 1) * 36 * d * loose, (Math.cos(d * 6 + t * .7) * 26 * d - 18 * d) * loose];
  const pu = eio(seg(t, HOME.push[0], HOME.push[1]));
  camS(960, 540, 1);
  drawArt(ctx, SC.temple, { pal, T, angle: -.08, seed: 29, off, sep: loose, reg: snapped ? 0.35 * (1 - k) + 1 * k : 1.6, header: { text: 'BEIJING', zh: '北京', p: 1 } });
  stubDraw(pal, stubReturn(t, 30), 69);
}

function shotsLater(t, s) {
  OZ = [W / 2, H / 2, 1];
  if (s.n === 4) {
    if (t < IST.cover) beijing(t); else cityIst(t);
    treeWipe(t, IST.cover, PAL.beijingDawn.near);
  } else if (s.n === 5) {
    const p = sp(t, PAR.swap);
    sweep(p, -.32, () => cityIst(t), () => cityParis(t), [PAL.paris.sky2, PAL.paris.sky1, PAL.paris.far, PAL.paris.near], 5);
  } else if (s.n === 6) {
    const p = sp(t, BA.swap);
    sweep(p, -.28, () => cityParis(t), () => cityBoca(t), BOCA_INKS, 9);
  } else if (s.n === 7) {
    const u = eio(seg(t, PUSH.t0, PUSH.t1)), u2 = seg(t, PUSH.t1, CLAMP);
    OZ = [lerp(W / 2, 1655, u), lerp(H / 2, 498, u), Math.exp(lerp(0, Math.log(5.2), u)) * (1 + .13 * u2)];
    cityBoca(t);
    screenS(); meshAt(lerp(-260, H + 60, ss(sp(t, PUSH.mesh))));
  } else if (s.n === 8) {
    const jolt = t < CLAMP + .12 ? Math.sin((t - CLAMP) * 90) * 3 * (1 - (t - CLAMP) / .12) : 0;
    const z0 = 5.2 * 1.13, u = eo(seg(t, SEA.out[0], SEA.out[1]));
    OZ = [lerp(1655, W / 2, u), lerp(498, H / 2, u) + jolt, Math.exp(lerp(Math.log(z0), 0, u))];
    const p = sp(t, SEA.swap);
    sweep(p, -.3, () => cityBoca(t), () => citySea(t), [PAL.sea.sky2, PAL.sea.sky1, PAL.sea.mid, PAL.sea.near], 11);
    const lift = sp(t, SEA.lift);
    if (lift < 1) { screenS(); meshAt(lerp(H + 60, -300, ss(lift))); }
  } else if (s.n === 9) {
    const p = sp(t, HOME.swap);
    sweep(p, -.3, () => citySea(t), () => cityHome(t, PAL.beijingDusk), [PAL.beijingDusk.sky1, PAL.beijingDusk.sky2, PAL.beijingDusk.mid, PAL.beijingDusk.near], 13);
  } else {
    const pu = eio(seg(t, HOME.push[0], HOME.push[1]));
    OZ = [lerp(W / 2, 1010, pu), lerp(H / 2, 520, pu), lerp(1, 1.035, pu)];
    const p = sp(t, HOME.night);
    sweep(p, -.3, () => cityHome(t, PAL.beijingDusk), () => cityHome(t, PAL.beijingNight), [PAL.beijingNight.sky1, PAL.beijingNight.sky2, PAL.beijingNight.sun, PAL.beijingNight.near], 15);
    const c1 = sp(t, HOME.card1), c2 = sp(t, HOME.card2);
    if (c1 > 0) {
      screenS(); drawEndCard(ctx, PAL.beijingNight, T, c1, c2);
      for (const [v, pal, k] of [[c1, PAL.beijingNight.near, 'down'], [c2, PAL.beijingNight.sun, 'right']]) {
        if (v <= 0 || v >= 1) continue;
        if (k === 'down') { const y = 236 - 20 - 40 + v * (600 + 40 + 80); squeegee(ctx, [1270, y + 12], [1890, y + 12], [0, 1], { color: pal, seed: 3, roll: y / 30, scale: 1.2, handle: .35, shadow: .16 }); }
        else { const x = 1300 - 50 + v * (560 + 100); squeegee(ctx, [x + 12, 200], [x + 12, 870], [1, 0], { color: pal, seed: 4, roll: x / 30, scale: 1.2, handle: .35, shadow: .16 }); }
      }
    }
  }
  OZ = [W / 2, H / 2, 1];
}

// ---------------- subtitles: a printed strip (near ink, paper-coloured type), pulled on with each line ----------------
const SUB_INK = '#1B1F34';
function subtitle(t) {
  if (NOCAP) return;
  const c = CUES.find(q => t >= q.t0 && t < q.t1); if (!c) return;
  const pIn = seg(t, c.t0, c.t0 + .12), pOut = seg(t, c.t1 - .1, c.t1);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.font = `600 40px NotoSC`; ctx.letterSpacing = '2px'; const wz = ctx.measureText(c.zh).width;
  ctx.font = `500 28px ${FONT_T}`; ctx.letterSpacing = '.6px'; const we = ctx.measureText(c.en).width;
  const w = Math.max(wz, we) + 76, h = 118, x = (W - w) / 2, y = H - 46 - h;
  ctx.save();
  if (pIn < 1) ctx.clip(wipeRegion([x, y, w, h], 'right', pIn, 7 + c.id.length, 26, 5));
  if (pOut > 0) { const r = new Path2D(); r.rect(x + w * pOut, y - 10, w, h + 20); ctx.clip(r); }
  ink(ctx, { path: rectPath(x, y, w, h) }, { color: SUB_INK, sheen: .6 });
  ink(ctx, { paint: (g) => {
    g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    g.font = `600 40px NotoSC`; g.letterSpacing = '2px'; g.fillText(c.zh, W / 2, y + 54);
    g.font = `500 28px ${FONT_T}`; g.letterSpacing = '.6px'; g.fillText(c.en, W / 2, y + 96);
  } }, { color: PAPER, reg: [1.2, -.8] });
  inkFinish(ctx, T, x, y, w, h, .7, .8);
  ctx.restore(); ctx.letterSpacing = '0px';
}

export function render(t) {
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = PAPER; ctx.fillRect(0, 0, W, H);
  const s = SHOTS.find(q => t >= q.t0 && t < q.t1) || SHOTS[SHOTS.length - 1];
  if (s.n <= 3) beijing(t); else shotsLater(t, s);
  subtitle(t);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

// every on-screen text at t (pixels), for readcheck; live counters are left out until they stop
export function texts(t) {
  const out = [], s = SHOTS.find(q => t >= q.t0 && t < q.t1) || SHOTS[SHOTS.length - 1];
  const push = (id, text, b) => { if (b[0] < 0 || b[1] < 0 || b[2] > W || b[3] > H) return; out.push({ id, text, x0: b[0], y0: b[1], x1: b[2], y1: b[3] }); };
  const z = (b) => { const f = (x, y) => [W / 2 + (x - OZ[0]) * OZ[2], H / 2 + (y - OZ[1]) * OZ[2]]; const [a, c] = f(b[0], b[1]), [d, e] = f(b[2], b[3]); return [a, c, d, e]; };
  const world = (b) => { const [x0, y0] = toScreen(b[0], b[1]), [x1, y1] = toScreen(b[2], b[3]); return z([x0, y0, x1, y1]); };
  if (s.n <= 3) {
    const [cx, cy, zz] = camAt(K1, t); CAM = [cx, cy, zz]; OZ = [W / 2, H / 2, 1];
    const prog = prog1(t);
    for (const b of textBoxes(PRINTS.beijing)) if (prog(b.pull) >= 1) push(b.id, b.text, world(b.box));
    return out;
  }
  // replay the camera of the current shot without drawing
  shotsLaterCam(t, s);
  const city = s.n === 4 ? (t >= IST.cover ? ['istanbul', IST, 'ISTANBUL', '伊斯坦布尔', stubCity(t, IST, 6, '7,060', 'HAGIA SOPHIA', 'BUILT 537')] : null)
    : s.n === 5 ? ['paris', PAR, 'PARIS', '巴黎', stubCity(t, PAR, 11, '8,220', 'EIFFEL TOWER', 'BUILT 1889')]
    : s.n === 6 || s.n === 7 ? ['boca', BA, 'BUENOS AIRES', '布宜诺斯艾利斯', stubCity(t, BA, 19, '19,270', 'OBELISCO', 'BUILT 1936')]
    : s.n === 8 ? ['sea', null, null, null, stubReturn(t, 24)] : ['temple', null, 'BEIJING', '北京', stubReturn(t, 30)];
  if (!city) return out;
  const [key, o, en, zh, st] = city;
  if (en && (!o || sp(t, o.header) >= 1) && !(s.n >= 10 && t >= HOME.card1[0])) for (const b of headerBoxes(SC[key], { text: en, zh })) push(b.id, b.text, world(b.box));
  if (!(t >= HOME.card1[0])) for (const b of stubBoxes(st.rows)) if (b.p >= 1 && !b.live) push(b.id, b.text, z(b.box));
  if (t >= HOME.card2[0] + HOME.card2[1]) for (const [id, text, y0, y1] of [['card-title', 'THE LONG WAY HOME', 260, 450], ['card-zh', '绕远路回家', 460, 510], ['card-style', 'SILKSCREEN TRAVEL POSTER', 580, 616], ['card-style-zh', '丝印旅行海报', 626, 662], ['card-sign', 'LemoLab × Claude Opus 5.5', 730, 762]]) push(id, text, z([1340, y0, 1830, y1]));
  return out;
}
// camera only (for texts): same maths as shotsLater, no drawing
function shotsLaterCam(t, s) {
  OZ = [W / 2, H / 2, 1];
  if (s.n === 4) { const u = ss(seg(t, 10.3, 14.2)); CAM = [lerp(960, 900, u), lerp(540, 520, u), lerp(1, 1.04, u)]; }
  else if (s.n === 5) { const u = eio(seg(t, PAR.crane[0], PAR.crane[1])); CAM = [960, lerp(1080, 540, u), 1]; }
  else if (s.n === 6 || s.n === 7) {
    CAM = [lerp(960, 1640, ss(seg(t, BA.truck[0], BA.truck[1]))), 540, 1];
    if (s.n === 7) { const u = eio(seg(t, PUSH.t0, PUSH.t1)), u2 = seg(t, PUSH.t1, CLAMP); OZ = [lerp(W / 2, 1655, u), lerp(H / 2, 498, u), Math.exp(lerp(0, Math.log(5.2), u)) * (1 + .13 * u2)]; }
  } else if (s.n === 8) { const u = eo(seg(t, SEA.out[0], SEA.out[1])); OZ = [lerp(1655, W / 2, u), lerp(498, H / 2, u), Math.exp(lerp(Math.log(5.2 * 1.13), 0, u))]; CAM = [lerp(4300, 1100, ss(seg(t, SEA.truck[0], SEA.truck[1]))), 540, 1]; }
  else { CAM = [960, 540, 1]; if (s.n >= 10) { const pu = eio(seg(t, HOME.push[0], HOME.push[1])); OZ = [lerp(W / 2, 1010, pu), lerp(H / 2, 520, pu), lerp(1, 1.035, pu)]; } }
}

