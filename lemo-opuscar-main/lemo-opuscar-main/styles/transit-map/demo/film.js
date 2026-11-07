// Transit Map engine: a printed octilinear network drawn by pen tips on a sheet of paper, under a perspective camera.
// Generic: it holds no network and no story. The network is net.js (window.NET); the film's direction is timeline.js
// (export DATA, optional export WARP). Every DATA hook below has a default, so a film defines only what it uses;
// the full list with signatures is in STYLE.md §10 and DEMO.md "Build notes".
// render(t) depends only on t: line growth, stations, trains, camera and counters are closed-form functions of t,
// precomputed at load where needed (station light-up times, label placement).
import { clamp, lerp, seg, ss, eio, eo, ei, back, monotone, track, mulberry, hash } from '/core/lib.js';
import * as TL from './timeline.js';

const DEFAULTS = {
  // required: DUR (story seconds), SHEET [x0, y0, x1, y1] (world units), PHASES, camera(t) -> {x, y, z, tilt, head, ap, focus?, far?, vig?, dim?}
  WARP: null,                                   // [[filmT, storyT], ...]; default: film time = story time
  LABEL_PREF: {}, nameAt: null, labelOnly: null, forceLabel: () => 0, hubLabelScale: z => clamp(Math.pow(.85 / z, .6), 1, 1.75),
  noRoundel: [], roundelPos: {}, roundelAlpha: () => 1, roundelScale: z => clamp(Math.pow(.9 / z, .55), 1, 1.8),
  drops: {}, dropRing: null,                    // ids of interchanges that fall onto the paper; dropRing(c, n, k2, helpers) overrides the landing
  veil: () => 0, stationDim: () => 1, highlight: () => {},
  waterLabels: null, riverLabels: () => {}, furniture: () => {}, annotations: () => {}, trains: () => {}, overlay: () => {},
  tunnelOnly: () => false, cues: [], init: () => {},
};
const DATA = { ...DEFAULTS, ...TL.DATA };
const WARP = TL.WARP || DATA.WARP || [[0, 0], [DATA.DUR, DATA.DUR]];
const { G, ST, LINES, WATER = [], LINKS = [], expand, pt: gpt } = window.NET;
const DUR = DATA.DUR;                     // story time (tau)
const DUR_T = WARP[WARP.length - 1][0]; window.DUR = DUR_T;   // film time
// film time t -> story time tau (piecewise linear: a slow 1995 beat, a longer verdict hold)
function tauOf(t) { for (let i = 1; i < WARP.length; i++) { const [ta, ua] = WARP[i - 1], [tb, ub] = WARP[i]; if (t <= tb) return ua + (ub - ua) * clamp((t - ta) / (tb - ta || 1)); } return WARP[WARP.length - 1][1]; }
function tOf(u) { for (let i = 1; i < WARP.length; i++) { const [ta, ua] = WARP[i - 1], [tb, ub] = WARP[i]; if (ub > ua && u >= ua && u < ub) return ta + (tb - ta) * (u - ua) / (ub - ua); } return u >= WARP[WARP.length - 1][1] ? WARP[WARP.length - 1][0] : u; }
// readable-text registry for window.TEXTS (readcheck): filled while a frame is drawn
let REG = [];
function regBox(id, text, X0, Y0, X1, Y1, a, minH) {
  if (a < .5 || !text) return;
  if (!(X0 >= 0 && Y0 >= 0 && X1 <= innerWidth && Y1 <= innerHeight)) return;   // counted from the moment it is fully in frame
  if (Y1 - Y0 < minH) return;                                                     // too small to be read
  REG.push({ id: String(id), text, x0: X0, y0: Y0, x1: X1, y1: Y1 });
}
function regW(id, text, x0, y0, x1, y1, a = 1, minH = 14) {   // a box on the sheet (world units)
  const b = window.__cam, SX = innerWidth / 1920; if (!b) return;
  const q = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(([x, y]) => toScreen(b, x, y)); if (q.some(p => !p)) return;
  const xs = q.map(p => p[0] * SX), ys = q.map(p => p[1] * SX);
  regBox(id, text, Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), a, minH);
}
function regS(id, text, x0, y0, x1, y1, a = 1) { const SX = innerWidth / 1920; regBox(id, text, x0 * SX, y0 * SX, x1 * SX, y1 * SX, a, 8); }
const RG = { regW, regS };
const DEG = Math.PI / 180, FOV = 32 * DEG, FOCAL = 540 / Math.tan(FOV / 2);
const INK = '#1b1c1e', PAPER = '#f2eee5', MUTED = '#77736b', RIVERC = '#bcd6ea', RIVERE = '#8fb5d6';
const F = (w, px) => `${w} ${px}px Inter, NotoSC`;
const LW = 15;

// ---------------------------------------------------------------- geometry
function rounded(pts, r) { // dense polyline with circular fillets at corners (world units)
  const P = pts.filter((q, i) => { if (i === 0 || i === pts.length - 1) return true; const a = pts[i - 1], b = pts[i + 1];
    return Math.abs((q[0] - a[0]) * (b[1] - q[1]) - (q[1] - a[1]) * (b[0] - q[0])) > 1e-6; });
  const out = [P[0]];
  for (let i = 1; i < P.length - 1; i++) {
    const [ax, ay] = P[i - 1], [bx, by] = P[i], [cx, cy] = P[i + 1];
    let ux = ax - bx, uy = ay - by, vx = cx - bx, vy = cy - by;
    const lu = Math.hypot(ux, uy), lv = Math.hypot(vx, vy); ux /= lu; uy /= lu; vx /= lv; vy /= lv;
    const ang = Math.acos(clamp(ux * vx + uy * vy, -1, 1));
    const tlen = Math.min(r / Math.tan(ang / 2), lu * .45, lv * .45), rr = tlen * Math.tan(ang / 2);
    const p1 = [bx + ux * tlen, by + uy * tlen], p2 = [bx + vx * tlen, by + vy * tlen];
    const bis = [ux + vx, uy + vy], bl = Math.hypot(...bis), d = rr / Math.sin(ang / 2);
    const ox = bx + bis[0] / bl * d, oy = by + bis[1] / bl * d;
    let a1 = Math.atan2(p1[1] - oy, p1[0] - ox), a2 = Math.atan2(p2[1] - oy, p2[0] - ox);
    let da = a2 - a1; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
    out.push(p1); for (let k = 1; k < 12; k++) { const a = a1 + da * k / 12; out.push([ox + Math.cos(a) * rr, oy + Math.sin(a) * rr]); } out.push(p2);
  }
  out.push(P[P.length - 1]);
  const L = [0]; for (let i = 1; i < out.length; i++) L.push(L[i - 1] + Math.hypot(out[i][0] - out[i - 1][0], out[i][1] - out[i - 1][1]));
  return { p: out, L, total: L[L.length - 1] };
}
function project(path, x, y) {
  let best = 1e18, bl = 0; const { p, L } = path;
  for (let i = 1; i < p.length; i++) {
    const [ax, ay] = p[i - 1], [bx, by] = p[i], dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
    const f = clamp(((x - ax) * dx + (y - ay) * dy) / l2), qx = ax + dx * f, qy = ay + dy * f, d = (x - qx) ** 2 + (y - qy) ** 2;
    if (d < best) { best = d; bl = L[i - 1] + f * (L[i] - L[i - 1]); }
  }
  return bl;
}
function pointAt(path, len) {
  const { p, L } = path; if (len <= 0) return p[0]; if (len >= path.total) return p[p.length - 1];
  let lo = 0, hi = L.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (L[m] < len) lo = m; else hi = m; }
  const f = (len - L[lo]) / (L[hi] - L[lo] || 1); return [lerp(p[lo][0], p[hi][0], f), lerp(p[lo][1], p[hi][1], f)];
}
function dirAt(path, len) { const a = pointAt(path, len - 2), b = pointAt(path, len + 2); return Math.atan2(b[1] - a[1], b[0] - a[0]); }
function subPath(c, path, a, b) { // trace the part [a, b] of a path into the current context path
  if (b < a) [a, b] = [b, a]; if (b - a < .01) return false;
  const { p, L } = path; const s = pointAt(path, a); c.moveTo(s[0], s[1]);
  for (let i = 1; i < p.length; i++) { if (L[i] <= a) continue; if (L[i] >= b) break; c.lineTo(p[i][0], p[i][1]); }
  const e = pointAt(path, b); c.lineTo(e[0], e[1]); return true;
}
const W = v => v * G;

// river polyline (world) and distance to it
// water (NET.WATER): bands {line: [[x, y]...], outer, inner} (widths in G) and areas {area: [[x, y]...]} (sea, bay, harbour,
// lake: a closed octilinear outline). With tunnel: true, lines crossing it turn dashed with a casing.
const WAT = WATER.map(w => ({ ...w, pts: (w.line || w.area).map(q => [W(q[0]), W(q[1])]), outerW: W(w.outer ?? .81), innerW: W(w.inner ?? .75) }));
function inPoly(poly, x, y) { let ins = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) ins = !ins; } return ins; }
function inWater(x, y) { // inside a tunnel-making body of water, with the same 0.075 G margin past its edge
  for (const w of WAT) { if (!w.tunnel) continue;
    if (w.area) { if (inPoly(w.pts, x, y) || distPoly([...w.pts, w.pts[0]], x, y) < 7.5) return true; }
    else if (distPoly(w.pts, x, y) < w.outerW / 2 + 7.5) return true; }
  return false;
}
function distPoly(poly, x, y) { let best = 1e18; for (let i = 1; i < poly.length; i++) { const [ax, ay] = poly[i - 1], [bx, by] = poly[i], dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1; const f = clamp(((x - ax) * dx + (y - ay) * dy) / l2); best = Math.min(best, Math.hypot(x - ax - dx * f, y - ay - dy * f)); } return best; }

// ---------------------------------------------------------------- modes (line form carries the mode; colour carries identity)
// metro: solid 0.15 G · light (tram, light rail, maglev, people mover; old flag thin: true): solid 0.07 G
// bus: hollow 0.15 G, edges max(0.04 G, 2.5 px), paper core · ferry: 0.07 G thread on a 0.25 G paper lane, never dashed
const MODES = {
  metro: { lw: 15, fillet: 34, minor: true }, light: { lw: 7, fillet: 30 },
  bus: { lw: 15, fillet: 34, hollow: true, square: true, surface: true }, ferry: { lw: 7, fillet: 30, lane: 25, square: true, surface: true, pier: true },
};
const modeOf = L => MODES[L.mode || (L.thin ? 'light' : 'metro')];
const lum = hex => { const v = [1, 3, 5].map(i => { const c = parseInt(hex.slice(i, i + 2), 16) / 255; return c <= .04045 ? c / 12.92 : Math.pow((c + .055) / 1.055, 2.4); }); return .2126 * v[0] + .7152 * v[1] + .0722 * v[2]; };
const inkOn = L => L.ink ?? lum(L.color) > .4;           // ink text in the bullet on light colours

// ---------------------------------------------------------------- network build
const PATHS = {}; // key: lineId or lineId+'b'
const LINE = {};
for (const L of LINES) {
  LINE[L.id] = L;
  for (const key of ['route', 'branch']) {
    if (!L[key]) continue;
    const ex = expand(L[key]);
    const path = rounded(ex.pts.map(q => [W(q[0]), W(q[1])]), modeOf(L).fillet);
    path.line = L.id; path.color = L.color; path.key = L.id + (key === 'branch' ? 'b' : '');
    path.st = []; // stations on the path: {id, s, x, y}
    L[key].forEach(it => { if (it === '/') return; const id = NET.sid(it); if (!id) return; const q = gpt(it); path.st.push({ id, x: W(q[0]), y: W(q[1]), s: project(path, W(q[0]), W(q[1])) }); });
    // tunnel intervals: where the path is inside the river band
    path.tun = []; let inT = false, s0 = 0;
    for (let s = 0; s <= path.total; s += 4) { const q = pointAt(path, s); const now = !modeOf(L).surface && inWater(q[0], q[1]);
      if (now && !inT) { inT = true; s0 = s; } if (!now && inT) { inT = false; path.tun.push([s0, s]); } }
    if (inT) path.tun.push([s0, path.total]);
    // minor stops between named stations
    path.minor = [];
    const st = [...path.st].sort((a, b) => a.s - b.s);
    for (let i = 1; i < st.length; i++) {
      const gap = st[i].s - st[i - 1].s, n = Math.floor(gap / 78) - 0;
      for (let k = 1; k < n; k++) { const s = st[i - 1].s + gap * k / n; if (path.tun.some(([a, b]) => s > a - 20 && s < b + 20)) continue; path.minor.push(s); }
    }
    PATHS[path.key] = path;
  }
}
// station → the line points that meet there
const SNODE = {};
for (const path of Object.values(PATHS)) for (const q of path.st) {
  const n = SNODE[q.id] || (SNODE[q.id] = { id: q.id, pts: [], lines: new Set() });
  if (!n.pts.some(p => p.line === path.line)) n.pts.push({ line: path.line, x: q.x, y: q.y, path: path.key, s: q.s });
  n.lines.add(path.line);
}
for (const n of Object.values(SNODE)) {
  const s = ST[n.id]; n.zh = s[2]; n.en = s[3]; n.tier = s[4]; n.x = W(s[0]); n.y = W(s[1]);
  const xs = n.pts.map(p => p.x), ys = n.pts.map(p => p.y);
  n.box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  n.cx = (n.box[0] + n.box[2]) / 2; n.cy = (n.box[1] + n.box[3]) / 2;
}

// ---------------------------------------------------------------- growth phases
// a phase draws part of a path from station a toward station b between film times t0 and t1
const PH = DATA.PHASES.map(ph => {
  const path = PATHS[ph.path]; if (!path) throw new Error('no path ' + ph.path);
  const fa = path.st.find(q => q.id === ph.a), fb = ph.bLast ? path.st.filter(q => q.id === ph.b).pop() : path.st.find(q => q.id === ph.b);
  if (!fa || !fb) throw new Error('phase station missing ' + ph.path + ' ' + ph.a + ' ' + ph.b);
  const o = { ...ph, path, s0: fa.s, s1: fb.s };
  // progress function: custom keys (t, station) or eased between t0 and t1
  if (ph.keys) { const ks = ph.keys.map(([t, id]) => [t, Math.abs(path.st.find(q => q.id === id).s - o.s0) / Math.abs(o.s1 - o.s0)]); o.f = monotone(ks); o.t0 = ks[0][0]; o.t1 = ks[ks.length - 1][0]; }
  else o.f = t => { const u = seg(t, o.t0, o.t1); return ph.lin ? u : (u < .5 ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u)) * .35 + u * .65; };
  return o;
});
const phaseHead = (o, t) => t <= o.t0 ? o.s0 : t >= o.t1 ? o.s1 : lerp(o.s0, o.s1, clamp(o.f(t)));
function arrival(o, s) { // when the tip of phase o reaches arc length s
  const lo0 = Math.min(o.s0, o.s1) - 1, hi0 = Math.max(o.s0, o.s1) + 1; if (s < lo0 || s > hi0) return Infinity;
  let a = o.t0, b = o.t1; const want = Math.abs(s - o.s0);
  for (let k = 0; k < 40; k++) { const m = (a + b) / 2; if (Math.abs(phaseHead(o, m) - o.s0) >= want - .5) b = m; else a = m; }
  return b;
}
// light time of each (station, line) point, and of each station
for (const n of Object.values(SNODE)) {
  for (const p of n.pts) { p.tl = Infinity; for (const o of PH) if (o.path.key === p.path) p.tl = Math.min(p.tl, arrival(o, p.s)); }
  const ts = n.pts.map(p => p.tl).sort((a, b) => a - b);
  n.t1 = ts[0]; n.t2 = ts.length > 1 ? ts[1] : Infinity; // first line arrives, second line arrives (becomes an interchange)
}
for (const path of Object.values(PATHS)) path.minorT = path.minor.map(s => { let tl = Infinity; for (const o of PH) if (o.path === path) tl = Math.min(tl, arrival(o, s)); return tl; });
const lineStart = {}; for (const o of PH) { const k = o.path.line; if (!(k in lineStart) || o.t0 < lineStart[k].t0) lineStart[k] = o; }

// ---------------------------------------------------------------- paper texture (tileable)
function paperTexture() {
  const N = 1024, c = document.createElement('canvas'); c.width = c.height = N; const g = c.getContext('2d');
  const img = g.createImageData(N, N), d = img.data, R = mulberry(7);
  const lat = (p, seed) => { const a = new Float32Array(p * p); const r = mulberry(seed); for (let i = 0; i < a.length; i++) a[i] = r(); return a; };
  const L1 = lat(16, 3), L2 = lat(64, 5), L3 = lat(256, 9);
  const vn = (a, p, x, y) => { const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    const at = (i, j) => a[((j % p + p) % p) * p + ((i % p + p) % p)];
    return lerp(lerp(at(xi, yi), at(xi + 1, yi), ux), lerp(at(xi, yi + 1), at(xi + 1, yi + 1), ux), uy); };
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = (y * N + x) * 4, u = x / N, v = y / N;
    const cloud = .55 * vn(L1, 16, u * 16, v * 16) + .3 * vn(L2, 64, u * 64, v * 64) + .15 * vn(L3, 256, u * 256, v * 256);
    d[i] = cloud * 255; d[i + 1] = (R() * .6 + vn(L3, 256, u * 256, v * 256) * .4) * 255; d[i + 2] = 0; d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  // fibres into the blue channel
  const f = document.createElement('canvas'); f.width = f.height = N; const fg = f.getContext('2d'); fg.fillStyle = '#000'; fg.fillRect(0, 0, N, N);
  fg.strokeStyle = '#fff'; fg.lineCap = 'round';
  for (let k = 0; k < 2600; k++) { const x = R() * N, y = R() * N, a = R() * 6.283, l = 8 + R() * 34; fg.globalAlpha = .25 + R() * .6; fg.lineWidth = .6 + R() * 1.1;
    for (const ox of [-N, 0, N]) for (const oy of [-N, 0, N]) { fg.beginPath(); fg.moveTo(x + ox, y + oy); fg.quadraticCurveTo(x + ox + Math.cos(a + .8) * l * .5, y + oy + Math.sin(a + .8) * l * .5, x + ox + Math.cos(a) * l, y + oy + Math.sin(a) * l); fg.stroke(); } }
  const fd = fg.getImageData(0, 0, N, N).data; const id2 = g.getImageData(0, 0, N, N); for (let i = 0; i < fd.length; i += 4) id2.data[i + 2] = fd[i]; g.putImageData(id2, 0, 0);
  return c;
}

// ---------------------------------------------------------------- label placement (static, on the full network)
const meas = document.createElement('canvas').getContext('2d');
const LBL = {}; // id -> {dx, dy, align, zs, es}
function placeLabels() {
  const pts = []; for (const p of Object.values(PATHS)) for (let s = 0; s < p.total; s += 12) pts.push(pointAt(p, s));
  const grid = new Map(); const key = (x, y) => (Math.floor(x / 60)) + ',' + (Math.floor(y / 60));
  for (const q of pts) { const k = key(q[0], q[1]); (grid.get(k) || grid.set(k, []).get(k)).push(q); }
  const boxes = [];
  const nodes = Object.values(SNODE).filter(n => n.tier <= 3).sort((a, b) => a.tier - b.tier || b.lines.size - a.lines.size);
  for (const n of nodes) {
    const zs = n.tier === 1 ? 30 : n.tier === 2 ? 23 : 20, es = n.tier === 1 ? 17 : 14, K = n.tier === 1 ? 1.35 : 1;
    meas.font = F(n.tier === 1 ? 700 : 600, zs * K); const zw = meas.measureText(n.zh).width; meas.font = F(500, es * K); const ew = meas.measureText(n.en).width;
    const w = Math.max(zw, ew), h = (zs + es + 4) * K;
    const hw = (n.box[2] - n.box[0]) / 2 + 16, hh = (n.box[3] - n.box[1]) / 2 + 16;
    const cands = [['e', hw + 6, -h / 2, 0], ['w', -hw - 6 - w, -h / 2, 1], ['ne', hw - 2, -hh - h + 6, 2], ['se', hw - 2, hh - 6, 2], ['nw', -hw + 2 - w, -hh - h + 6, 3], ['sw', -hw + 2 - w, hh - 6, 3], ['n', -w / 2, -hh - h - 2, 2.5], ['s', -w / 2, hh + 2, 2.5]];
    const pref = DATA.LABEL_PREF[n.id];
    let best = null;
    for (const [nm, ox, oy, pen] of cands) {
      const x0 = n.cx + ox, y0 = n.cy + oy, x1 = x0 + w, y1 = y0 + h;
      let sc = pen * 4 + (pref ? (pref === nm ? -1000 : 0) : 0);
      for (let gx = Math.floor(x0 / 60); gx <= Math.floor(x1 / 60); gx++) for (let gy = Math.floor(y0 / 60); gy <= Math.floor(y1 / 60); gy++) {
        for (const q of grid.get(gx + ',' + gy) || []) if (q[0] > x0 - 9 && q[0] < x1 + 9 && q[1] > y0 - 9 && q[1] < y1 + 9) sc += 3; }
      for (const b of boxes) if (x0 < b[2] && x1 > b[0] && y0 < b[3] && y1 > b[1]) sc += 60;
      if (!best || sc < best.sc) best = { sc, nm, x0, y0, w, h };
    }
    boxes.push([best.x0 - 4, best.y0 - 4, best.x0 + best.w + 4, best.y0 + best.h + 4]);
    const right = best.nm === 'w' || best.nm === 'nw' || best.nm === 'sw';
    const centre = best.nm === 'n' || best.nm === 's';
    LBL[n.id] = { nm: best.nm, hw, hh, zs, es, align: right ? 'right' : centre ? 'center' : 'left' };
  }
}

// ---------------------------------------------------------------- camera
function basis(c) {
  const th = c.head * DEG, ti = c.tilt * DEG;
  const F = [Math.sin(th) * Math.sin(ti), -Math.cos(th) * Math.sin(ti), -Math.cos(ti)];
  const R = [Math.cos(th), Math.sin(th), 0];
  const U = [F[1] * R[2] - F[2] * R[1], F[2] * R[0] - F[0] * R[2], F[0] * R[1] - F[1] * R[0]];
  const D = FOCAL / c.z;
  const pos = [c.x - F[0] * D, c.y - F[1] * D, -F[2] * D];
  return { pos, F, R, Up: U, focal: FOCAL, D, c };
}
function toScreen(b, x, y, z = 0) {
  const v = [x - b.pos[0], y - b.pos[1], z - b.pos[2]];
  const zc = v[0] * b.F[0] + v[1] * b.F[1] + v[2] * b.F[2]; if (zc <= 1) return null;
  const xc = v[0] * b.R[0] + v[1] * b.R[1] + v[2] * b.R[2], yc = v[0] * b.Up[0] + v[1] * b.Up[1] + v[2] * b.Up[2];
  return [960 + FOCAL * xc / zc, 540 - FOCAL * yc / zc, zc];
}
function toPlane(b, sx, sy, maxT) {
  const px = sx - 960, py = 540 - sy;
  const d = [b.F[0] * FOCAL + b.R[0] * px + b.Up[0] * py, b.F[1] * FOCAL + b.R[1] * px + b.Up[1] * py, b.F[2] * FOCAL + b.R[2] * px + b.Up[2] * py];
  const l = Math.hypot(...d); d[0] /= l; d[1] /= l; d[2] /= l;
  let t = d[2] < -1e-4 ? -b.pos[2] / d[2] : maxT; t = Math.min(t, maxT);
  return [b.pos[0] + d[0] * t, b.pos[1] + d[1] * t, t];
}
const CAM = DATA.camera; // (t, helpers) -> {x, y, z, tilt, head, ap}

// ---------------------------------------------------------------- drawing helpers (world space)
function stopDot(c, x, y, color, r = 8.5, ring = 4.6) { c.beginPath(); c.arc(x, y, r, 0, 7); c.fillStyle = '#fff'; c.fill(); c.lineWidth = ring; c.strokeStyle = color; c.stroke(); }
function capsule(c, n, sc = 1, lw = 5.5) {
  const pad = 13, [x0, y0, x1, y1] = n.box, w = (x1 - x0) / 2 + pad, h = (y1 - y0) / 2 + pad;
  c.save(); c.translate(n.cx, n.cy); c.scale(sc, sc);
  c.beginPath(); c.roundRect(-w, -h, 2 * w, 2 * h, Math.min(w, h)); c.fillStyle = '#fff'; c.fill(); c.lineWidth = lw; c.strokeStyle = INK; c.stroke();
  c.restore();
}
function labelText(c, n, a, scaleK = 1) {
  const L = LBL[n.id]; if (!L || a <= .01) return;
  const k = scaleK, zs = L.zs * k, es = L.es * k, h = zs + es + 4 * k, { hw, hh } = L;
  // anchor from the station edge (fixed) and the label box (scaled)
  const P = { e: [hw + 6, -h / 2], w: [-hw - 6, -h / 2], ne: [hw - 2, -hh - h + 6], se: [hw - 2, hh - 6], nw: [-hw + 2, -hh - h + 6], sw: [-hw + 2, hh - 6], n: [0, -hh - h - 2], s: [0, hh + 2] }[L.nm];
  c.save(); c.globalAlpha *= a; c.textAlign = L.align; c.textBaseline = 'top';
  c.translate(n.cx, n.cy);
  const ox = P[0], oy = P[1];
  c.lineJoin = 'round'; c.strokeStyle = 'rgba(242,238,229,.92)';
  const nm = DATA.nameAt ? DATA.nameAt(n, c.__t) : [n.zh, n.en];
  c.font = F(n.tier === 1 ? 700 : 600, zs); const wz = c.measureText(nm[0]).width; c.lineWidth = 5 * k; c.strokeText(nm[0], ox, oy); c.fillStyle = INK; c.fillText(nm[0], ox, oy);
  c.font = F(500, es); const we = c.measureText(nm[1]).width; c.fillStyle = '#4a4740'; c.strokeText(nm[1], ox, oy + zs + 3 * k); c.fillText(nm[1], ox, oy + zs + 3 * k);
  c.restore();
  const w = Math.max(wz, we), lx = L.align === 'left' ? ox : L.align === 'right' ? ox - w : ox - w / 2;
  regW('st-' + n.id, nm[0] + ' ' + nm[1], n.cx + lx, n.cy + oy, n.cx + lx + w, n.cy + oy + zs + 3 * k + es, a, 26);
}
function roundel(c, x, y, line, sc, r = 25) {   // the line bullet: a disc for rail, a rounded square for bus and ferry
  const L = LINE[line]; c.save(); c.translate(x, y); c.scale(sc, sc);
  c.beginPath(); if (modeOf(L).square) c.roundRect(-24, -24, 48, 48, 12); else c.arc(0, 0, r, 0, 7); c.fillStyle = L.color; c.fill();
  const txt = L.bullet ?? L.id;
  c.fillStyle = inkOn(L) ? INK : '#fff';
  c.font = F(800, L.id.length > 1 || txt.length > 1 ? (txt.length > 2 || /[^\x00-\x7f]/.test(txt) ? 15 : 22) : 27); c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText(txt, 0, 1.5); c.restore();
}
function tipGlow(c, x, y, color, a) {
  const rgb = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16)).join(',');
  const g = c.createRadialGradient(x, y, 0, x, y, 80); g.addColorStop(0, `rgba(${rgb},${.45 * a})`); g.addColorStop(.4, `rgba(${rgb},${.14 * a})`); g.addColorStop(1, `rgba(${rgb},0)`);
  c.fillStyle = g; c.beginPath(); c.arc(x, y, 80, 0, 7); c.fill();
  c.save(); c.globalAlpha = a; c.beginPath(); c.arc(x, y, 11, 0, 7); c.fillStyle = '#fff'; c.shadowColor = `rgba(${rgb},1)`; c.shadowBlur = 22; c.fill(); c.shadowBlur = 0; c.lineWidth = 5; c.strokeStyle = color; c.stroke(); c.restore();
}
function train(c, path, s, color, a, scale = 1) {
  const q = pointAt(path, s), ang = dirAt(path, s);
  c.save(); c.globalAlpha *= a; c.translate(q[0], q[1]); c.rotate(ang); c.scale(scale, scale);
  c.beginPath(); c.roundRect(-20, -7, 40, 14, 7); c.fillStyle = '#fff'; c.fill(); c.lineWidth = 2.6; c.strokeStyle = INK; c.stroke();
  c.fillStyle = color; for (const wx of [-10, 0, 10]) c.fillRect(wx - 3.2, -2.8, 6.4, 5.6);
  c.restore();
}

function surfaceLine(c, path, a, b, L, M, z) {
  // Paper inside a bus line or around a ferry is not painted: it is erased out of the ink layer (destination-out), so the
  // procedural paper of the WebGL pass shows through with its own tooth and light. Surface lines are drawn before every
  // solid line, so the erase only removes water and other surface lines under them, never a metro line or a label.
  c.save(); c.lineCap = 'round'; c.lineJoin = 'round';
  const px = 1 / Math.max(z, .01);                                        // one screen pixel at the aim point, in world units
  if (M.hollow) {
    // 0.15 G with 0.04 G edges; in wide shots it widens so each edge stays >= 2.5 px and the paper core >= 2.5 px
    const e = Math.max(4, 2.5 * px), w = Math.max(M.lw, 2 * e + 2.5 * px);
    if (lum(L.color) > .4) { c.strokeStyle = INK; c.lineWidth = w + 2 * Math.max(1.5, px); c.beginPath(); subPath(c, path, a, b); c.stroke(); }  // light colours: an ink rim, 0.015 G or 1 px
    c.strokeStyle = L.color; c.lineWidth = w; c.beginPath(); subPath(c, path, a, b); c.stroke();
    c.globalCompositeOperation = 'destination-out'; c.lineWidth = w - 2 * e; c.lineCap = 'butt'; c.beginPath(); subPath(c, path, a + 1, b - 1); c.stroke();
  } else if (M.lane) {
    c.globalCompositeOperation = 'destination-out'; c.lineWidth = Math.max(M.lane, 10 * px); c.beginPath(); subPath(c, path, a, b); c.stroke();   // the paper lane, >= 10 px
    c.globalCompositeOperation = 'source-over'; c.strokeStyle = L.color; c.lineWidth = M.lw; c.beginPath(); subPath(c, path, a, b); c.stroke();
  }
  c.restore();
}
function pier(c, x, y, color, sc = 1) { c.save(); c.translate(x, y); c.scale(sc, sc); c.beginPath(); c.roundRect(-8.5, -8.5, 17, 17, 4); c.fillStyle = '#fff'; c.fill(); c.lineWidth = 4; c.strokeStyle = color; c.stroke(); c.restore(); }
function drawLinks(c, t, view) {   // NET.LINKS: {a, b, out}: in-station (white bar, ink outline) or out-of-station (ink dots)
  for (const k of LINKS) {
    const A = SNODE[k.a], B = SNODE[k.b]; if (!A || !B) continue;
    const t0 = Math.max(A.t1, B.t1); if (t < t0) continue;
    const u = eo(seg(t, t0, t0 + .35)), x1 = lerp(A.cx, B.cx, u), y1 = lerp(A.cy, B.cy, u);
    c.save(); c.lineCap = 'round';
    if (k.out) { const len = Math.hypot(x1 - A.cx, y1 - A.cy), n = Math.floor(len / 8); c.fillStyle = INK;
      for (let i = 0; i <= n; i++) { const f = n ? i / n : 0; c.beginPath(); c.arc(lerp(A.cx, x1, f), lerp(A.cy, y1, f), 1.5, 0, 7); c.fill(); } }
    else { c.strokeStyle = INK; c.lineWidth = 6 + 2 * 5.5; c.beginPath(); c.moveTo(A.cx, A.cy); c.lineTo(x1, y1); c.stroke();
      c.strokeStyle = '#fff'; c.lineWidth = 6; c.stroke(); }
    c.restore();
  }
}
function dropRing(c, n, k2, { capsule, INK }) {   // default landing of a falling interchange: shock rings in ink and in each line's colour
  if (k2 < 0) return;
  if (k2 < .9) { const v = k2 / .9, cols = [...n.pts].sort((p, q) => p.tl - q.tl).map(p => LINE[p.line].color);
    c.save(); c.globalAlpha *= (1 - v) * .75; c.lineWidth = 7; c.strokeStyle = INK; c.beginPath(); c.arc(n.cx, n.cy, 30 + 230 * eo(v), 0, 7); c.stroke();
    cols.forEach((col, i) => { c.lineWidth = 5; c.strokeStyle = col; c.beginPath(); c.arc(n.cx, n.cy, 26 - 4 * i + (170 - 50 * i) * eo(clamp(v * (1.15 + .15 * i))), 0, 7); c.stroke(); });
    c.restore(); }
  capsule(c, n, 1 + .18 * Math.exp(-k2 * 14) * Math.cos(k2 * 40), 7);
}
function fallingCapsule(c, t) {   // every DATA.drops interchange falls for 0.42 s before it lands at t2; its shadow sharpens
  for (const id of Object.keys(DATA.drops)) {
    const n = SNODE[id]; if (!n) continue; const k = t - n.t2; if (!(k > -.42 && k < 0)) continue;
    const u = 1 + k / .42, h = 1 - ei(u);
    c.save();
    c.globalAlpha = .35 * u; c.fillStyle = '#000'; c.filter = `blur(${(14 * h).toFixed(1)}px)`;
    c.beginPath(); c.ellipse(n.cx + 60 * h, n.cy + 70 * h, 34 + 40 * h, 34 + 40 * h, 0, 0, 7); c.fill(); c.filter = 'none';
    c.globalAlpha = clamp(u * 2.5);
    const sc = 1 + 2.4 * h; c.translate(n.cx - 10 * h, n.cy - 30 * h); c.scale(sc, sc);
    const w = (n.box[2] - n.box[0]) / 2 + 15, hh = (n.box[3] - n.box[1]) / 2 + 15;
    c.beginPath(); c.roundRect(-Math.max(w, 28), -Math.max(hh, 28), 2 * Math.max(w, 28), 2 * Math.max(hh, 28), 28); c.fillStyle = '#fff'; c.fill(); c.lineWidth = 7; c.strokeStyle = INK; c.stroke();
    c.restore();
  }
}

// ---------------------------------------------------------------- the printed sheet: static furniture
const SHEET = DATA.SHEET;
function sheetFurniture(c, t, view) {
  DATA.furniture(c, t, view, { F, INK, MUTED, roundel, stopDot, W, ...RG });
}

// ---------------------------------------------------------------- map
function drawMap(c, t, view) {
  const z = view.z; c.__t = t;
  const lodMinor = ss(seg(z, .55, .85)), lod2 = ss(seg(z, .62, .9)), lod3 = ss(seg(z, 1.0, 1.3));
  const veil = DATA.veil(t); // 0..1: everything but the highlighted first section fades back
  // river and creek
  c.lineJoin = 'round'; c.lineCap = 'round';
  c.save();
  for (const w of WAT) { c.beginPath(); w.pts.forEach((q, i) => c[i ? 'lineTo' : 'moveTo'](q[0], q[1]));
    if (w.area) { c.closePath(); c.strokeStyle = RIVERE; c.lineWidth = W(.05); c.stroke(); c.fillStyle = RIVERC; c.fill(); }   // edge 0.025 G outside the fill
    else { c.strokeStyle = RIVERE; c.lineWidth = w.outerW; c.stroke(); c.strokeStyle = RIVERC; c.lineWidth = w.innerW; c.stroke(); } }
  c.restore();
  (DATA.waterLabels || DATA.riverLabels)(c, t, view, { F });
  sheetFurniture(c, t, view);
  // walking links (under everything else on the network)
  drawLinks(c, t, view);
  // lines: surface forms first (bus, ferry), because their paper parts are erased out of the ink layer; then solid lines
  const active = [];
  for (const pass of [0, 1]) for (const o of PH) {
    if (t <= o.t0) continue;
    const head = phaseHead(o, t), path = o.path, L = LINE[path.line], M = modeOf(L);
    if ((pass === 0) !== !!M.surface) continue;
    const a = Math.min(o.s0, head), b = Math.max(o.s0, head);
    if (b - a < .5) continue;
    const lw = M.lw;
    if (M.surface) { surfaceLine(c, path, a, b, L, M, view.z); if (t < o.t1 + .15) active.push({ o, head, fade: 1 - seg(t, o.t1, o.t1 + .15) }); continue; }
    c.save(); c.strokeStyle = path.color; c.lineWidth = lw; c.lineCap = 'round';
    // split by tunnel intervals: dashed inside the river
    let cur = a; const cuts = path.tun.filter(([x, y]) => y > a && x < b).sort((p, q) => p[0] - q[0]);
    for (const [x, y] of cuts) {
      if (x > cur) { c.beginPath(); subPath(c, path, cur, x); c.stroke(); }
      const ta = Math.max(x, a), tb = Math.min(y, b);
      c.save(); c.lineCap = 'butt'; c.setLineDash([16, 11]); c.lineDashOffset = -ta; c.globalAlpha = .9; c.beginPath(); subPath(c, path, ta, tb); c.stroke();
      c.setLineDash([]); c.globalAlpha = .55; c.lineWidth = 2; c.strokeStyle = INK; // tunnel casing
      for (const side of [-1, 1]) { c.beginPath(); const n = 24; for (let k = 0; k <= n; k++) { const s = lerp(ta, tb, k / n), q = pointAt(path, s), an = dirAt(path, s); const px = q[0] - Math.sin(an) * side * (lw / 2 + 5), py = q[1] + Math.cos(an) * side * (lw / 2 + 5); k ? c.lineTo(px, py) : c.moveTo(px, py); } c.stroke(); }
      c.restore(); cur = tb;
    }
    if (b > cur) { c.beginPath(); subPath(c, path, cur, b); c.stroke(); }
    c.restore();
    if (t < o.t1 + .15) active.push({ o, head, fade: 1 - seg(t, o.t1, o.t1 + .15) });
  }
  // first section highlight (end of film): glow along the 1993 segment
  DATA.highlight(c, t, { PATHS, pointAt, subPath });
  // veil: paper wash over the network except the highlight
  if (veil > 0) { c.save(); c.fillStyle = `rgba(242,238,229,${.62 * veil})`; c.fillRect(SHEET[0], SHEET[1], SHEET[2] - SHEET[0], SHEET[3] - SHEET[1]); c.restore(); DATA.highlight(c, t, { PATHS, pointAt, subPath }, true); }
  // trains
  DATA.trains(c, t, { PATHS, PH, phaseHead, train, pointAt });
  // minor stops
  if (lodMinor > 0) for (const path of Object.values(PATHS)) {
    if (!modeOf(LINE[path.line]).minor) continue;
    path.minor.forEach((s, i) => { const tl = path.minorT[i]; if (t < tl) return; const q = pointAt(path, s), k = t - tl;
      c.save(); c.globalAlpha = lodMinor * (1 - .6 * veil); stopDot(c, q[0], q[1], path.color, 6.5 * (.6 + .4 * back(seg(k, 0, .25), 3)), 3.6); c.restore(); });
  }
  // stations
  for (const n of Object.values(SNODE)) {
    if (t < n.t1) continue;
    const k1 = t - n.t1, multi = n.pts.length > 1, inter = t >= n.t2 && multi;
    const dim = DATA.stationDim(n, t, veil);
    c.save(); c.globalAlpha = dim;
    if (!inter) {
      if (n.tier <= 3 || lodMinor > 0) { const p = n.pts.reduce((a, b) => a.tl <= b.tl ? a : b); const col = LINE[p.line].color;
        const sc = .6 + .4 * back(seg(k1, 0, .28), 3);
        if (k1 < .6) { c.save(); c.globalAlpha *= (1 - k1 / .6) * .6; c.lineWidth = 3; c.strokeStyle = col; c.beginPath(); c.arc(p.x, p.y, 10 + 32 * eo(k1 / .6), 0, 7); c.stroke(); c.restore(); }
        c.globalAlpha *= n.tier <= 3 ? 1 : lodMinor; if (modeOf(LINE[p.line]).pier) pier(c, p.x, p.y, col, sc); else stopDot(c, p.x, p.y, col, 8.5 * sc, 4.6); }
    } else {
      const k2 = t - n.t2, drop = DATA.drops[n.id];
      if (drop) (DATA.dropRing || dropRing)(c, n, k2, { capsule, INK });
      else { const u = seg(k2, 0, .22), sc = lerp(2.0, 1, eo(u));
        if (k2 < .55) { c.save(); c.globalAlpha *= (1 - k2 / .55) * .5; c.lineWidth = 3.5; c.strokeStyle = INK; c.beginPath(); c.arc(n.cx, n.cy, 18 + 46 * eo(k2 / .55), 0, 7); c.stroke(); c.restore(); }
        c.globalAlpha *= clamp(u * 3); capsule(c, n, sc); }
    }
    c.restore();
  }
  // glowing tips
  for (const { o, head, fade } of active) { const q = pointAt(o.path, head); tipGlow(c, q[0], q[1], o.path.color, fade * (o.glow ?? 1)); }
  // roundels at the start of each line, with the opening year
  for (const [id, o] of Object.entries(lineStart)) {
    if (DATA.noRoundel.includes(id)) continue;
    const u = seg(t, o.t0 - .05, o.t0 + .3); if (u <= 0) continue;
    const p = pointAt(o.path, o.s0), an = dirAt(o.path, o.s0 + (o.s1 > o.s0 ? 3 : -3)) + (o.s1 > o.s0 ? Math.PI : 0);
    const rp = DATA.roundelPos[id]; const rx = rp ? W(rp[0]) : p[0] + Math.cos(an) * 44, ry = rp ? W(rp[1]) : p[1] + Math.sin(an) * 44;
    c.save(); c.globalAlpha = (1 - .6 * veil) * DATA.roundelAlpha(t, id, z);
    roundel(c, rx, ry, id, back(u, 2.2) * DATA.roundelScale(z));
    const yr = o.yearLabel; if (yr) { const ys = DATA.roundelScale(z); c.font = F(700, 17 * ys); c.fillStyle = INK; c.textAlign = 'center'; c.textBaseline = 'top'; c.globalAlpha *= seg(t, o.t0 + .1, o.t0 + .4); c.fillText(yr, rx, ry + 30 * ys); }
    c.restore();
  }
  // labels
  for (const n of Object.values(SNODE)) {
    if (n.tier > 3 || t < n.t1) continue;
    const only = DATA.labelOnly && DATA.labelOnly(t); if (only && !only.includes(n.id)) continue;
    const vis = n.tier === 1 ? 1 : n.tier === 2 ? lod2 : lod3;
    const forced = DATA.forceLabel(n, t);
    const a = Math.max(vis, forced) * seg(t, n.t1 + .02, n.t1 + .3) * DATA.stationDim(n, t, veil);
    if (a <= 0) continue;
    labelText(c, n, a, n.tier === 1 ? DATA.hubLabelScale(z) : 1);
  }
  DATA.annotations(c, t, view, { F, INK, MUTED, pointAt, PATHS, SNODE, W, stopDot, roundel, capsule, LINE, ...RG });
  fallingCapsule(c, t);
}

// ---------------------------------------------------------------- frame
const glC = document.getElementById('gl'), ov = document.getElementById('ov'), oc = ov.getContext('2d');
const mapC = document.createElement('canvas'), mc = mapC.getContext('2d');
let plane = null;
function fit() { for (const k of [glC, ov]) { k.width = innerWidth; k.height = innerHeight; } }
fit();

function regionFor(b, view) {
  const maxT = b.D * (view.far || 5);
  const xs = [], ys = [];
  for (let i = 0; i <= 12; i++) for (const [sx, sy] of [[i * 160, 0], [i * 160, 1080], [0, i * 90], [1920, i * 90]]) { const q = toPlane(b, sx, sy, maxT); xs.push(q[0]); ys.push(q[1]); }
  let x0 = Math.min(...xs) - 30, x1 = Math.max(...xs) + 30, y0 = Math.min(...ys) - 30, y1 = Math.max(...ys) + 30;
  x0 = Math.max(x0, SHEET[0] - 40); y0 = Math.max(y0, SHEET[1] - 40); x1 = Math.min(x1, SHEET[2] + 40); y1 = Math.min(y1, SHEET[3] + 40);
  if (x1 <= x0) x1 = x0 + 10; if (y1 <= y0) y1 = y0 + 10;
  const near = toPlane(b, 960, 1080, maxT), zn = FOCAL / Math.max(1, near[2]);
  const want = 1.35 * Math.max(b.c.z, Math.min(zn, b.c.z * 2.2)) * (innerHeight / 1080);
  const s = Math.min(want, 4096 / (x1 - x0), 4096 / (y1 - y0));
  return { x0, y0, x1, y1, s };
}

function render(tFilm) {
  REG = [];
  const t = tauOf(tFilm);
  if (glC.width !== innerWidth) fit();
  const SX = innerWidth / 1920;
  const view = CAM(t);
  const b = basis(view);
  window.__cam = b;
  oc.setTransform(1, 0, 0, 1, 0, 0); oc.clearRect(0, 0, ov.width, ov.height);
  if (!DATA.tunnelOnly(t)) {
    const R = regionFor(b, view);
    const w = Math.max(2, Math.ceil((R.x1 - R.x0) * R.s)), h = Math.max(2, Math.ceil((R.y1 - R.y0) * R.s));
    // clear in pixel space: the previous frame's transform is still set, and clearing under it leaves old ink behind (ghosting, every other frame)
    if (mapC.width !== w || mapC.height !== h) { mapC.width = w; mapC.height = h; } else { mc.setTransform(1, 0, 0, 1, 0, 0); mc.clearRect(0, 0, w, h); }
    mc.setTransform(R.s, 0, 0, R.s, -R.x0 * R.s, -R.y0 * R.s);
    drawMap(mc, t, { ...view, region: R, b });
    plane.draw(b, [R.x0, R.y0, R.x0 + w / R.s, R.y0 + h / R.s], mapC, { sheet: SHEET, focusD: b.D * (view.focus || 1), aperture: view.ap || 0, vig: view.vig ?? .24, dim: view.dim || 0 });
  }
  oc.setTransform(SX, 0, 0, SX, 0, 0);
  DATA.overlay(oc, t, { b, toScreen, F, INK, view, ...RG });
}
window.render = render;
window.TEXTS = () => REG.slice();

// ---------------------------------------------------------------- events for the score
function events() {
  const ev = [];
  const pan = (t, x, y) => { const b = basis(CAM(t)), q = toScreen(b, x, y); if (!q) return { pan: 0, vis: 0 }; return { pan: +clamp((q[0] - 960) / 960, -1, 1).toFixed(2), vis: q[0] > -40 && q[0] < 1960 && q[1] > -40 && q[1] < 1120 ? 1 : 0 }; };
  for (const n of Object.values(SNODE)) {
    if (n.t1 < DUR) ev.push({ t: +n.t1.toFixed(3), type: 'stop', id: n.id, tier: n.tier, line: [...n.pts].sort((a, b) => a.tl - b.tl)[0].line, ...pan(n.t1, n.x, n.y) });
    if (n.t2 < DUR && n.pts.length > 1) ev.push({ t: +n.t2.toFixed(3), type: DATA.drops[n.id] ? 'drop' : 'x', id: n.id, ...pan(n.t2, n.cx, n.cy) });
  }
  for (const o of PH) ev.push({ t: +o.t0.toFixed(3), type: 'depart', line: o.path.line, year: o.year, t1: +o.t1.toFixed(3), ...pan(o.t0, ...pointAt(o.path, o.s0)) });
  for (const path of Object.values(PATHS)) path.minorT.forEach((tl, i) => { if (tl < DUR) ev.push({ t: +tl.toFixed(3), type: 'minor', line: path.line, ...pan(tl, ...pointAt(path, path.minor[i])) }); });
  for (const e of DATA.cues) ev.push(e);
  for (const e of ev) { e.tau = e.t; e.t = +tOf(e.t).toFixed(3); if (e.t1 != null) e.t1 = +tOf(e.t1).toFixed(3); }
  return ev.filter(e => e.t <= DUR_T).sort((a, b) => a.t - b.t);
}

// ---------------------------------------------------------------- boot
const fontList = ['400 20px Inter', '500 20px Inter', '600 20px Inter', '700 20px Inter', '800 20px Inter', '500 20px NotoSC', '600 20px NotoSC', '700 20px NotoSC', '800 20px NotoSC'];
Promise.all(fontList.map(f => document.fonts.load(f, f.includes('Noto') ? '地铁' : 'A1'))).then(() => document.fonts.ready).then(() => {
  plane = window.makePlane(glC, paperTexture());
  placeLabels();
  DATA.init({ PATHS, SNODE, PH, LINE, pointAt, project, W, F, meas, basis, toScreen });
  window.EV = events();
  render(0);
  window.READY = true;
});
