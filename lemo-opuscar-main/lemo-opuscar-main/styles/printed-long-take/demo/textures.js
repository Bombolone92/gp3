// Canvas-drawn sprites and plates. Everything is ink, paper and one red; seeded, so every worker draws the same pixels.
import { mulberry } from '/core/lib.js';

export const INK = '#16171b', PAPER = '#ede5cd', RED = '#c4332b', YELLOW = '#dfa443';

// A short knife cut: blunt entry, tapered exit, a little wobble.
export function cut(g, x0, y0, x1, y1, w, R, col, taper = .85) {
  const n = 8, dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len, wob = (R() - .5) * len * .04;
  g.fillStyle = col; g.beginPath();
  for (let i = 0; i <= n; i++) {
    const s = i / n, ww = w * (1 - s * taper) * .5, b = Math.sin(s * Math.PI) * wob;
    g.lineTo(x0 + dx * s + nx * (ww + b), y0 + dy * s + ny * (ww + b));
  }
  for (let i = n; i >= 0; i--) {
    const s = i / n, ww = w * (1 - s * taper) * .5, b = Math.sin(s * Math.PI) * wob;
    g.lineTo(x0 + dx * s - nx * (ww - b), y0 + dy * s - ny * (ww - b));
  }
  g.fill();
}

// A tapered stroke along a polyline (w0 at the start, w1 at the end).
function ribbon(g, pts, w0, w1, col) {
  const L = [], Rr = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let dx = b[0] - a[0], dy = b[1] - a[1]; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
    const w = (w0 + (w1 - w0) * i / (pts.length - 1)) / 2;
    L.push([pts[i][0] - dy * w, pts[i][1] + dx * w]); Rr.push([pts[i][0] + dy * w, pts[i][1] - dx * w]);
  }
  g.fillStyle = col; g.beginPath();
  L.forEach((p, i) => i ? g.lineTo(...p) : g.moveTo(...p));
  for (let i = Rr.length - 1; i >= 0; i--) g.lineTo(...Rr[i]);
  g.closePath(); g.fill();
}
const bez = (p0, p1, p2, p3, n = 16) => {
  const o = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    o.push([u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
            u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]]);
  }
  return o;
};
const quadPts = (a, c, b, n = 14) => { const o = []; for (let i = 0; i <= n; i++) { const t = i / n, u = 1 - t; o.push([u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]); } return o; };

// ------------------------------------------------------------------ pines (windbreak belts)
// 8 variants, each 256×512. Bottom-centre of a tile is the trunk foot.
export function pineAtlas() {
  const TW = 256, TH = 512, N = 8;
  const c = document.createElement('canvas'); c.width = TW * N; c.height = TH;
  const g = c.getContext('2d');
  for (let v = 0; v < N; v++) {
    const R = mulberry(101 + v * 17), ox = v * TW + TW / 2;
    const top = 24 + R() * 30, foot = TH - 6;
    g.fillStyle = INK; g.fillRect(ox - 3, top + 40, 6, foot - top - 40);
    const tiers = 6 + Math.floor(R() * 4), lean = (R() - .5) * 12;
    for (let i = 0; i < tiers; i++) {
      const s = i / (tiers - 1);
      const yb = foot - 30 - (foot - 30 - top - 40) * s;
      const cx = ox + lean * s;
      const hwL = (1 - s * .9) * (62 + R() * 26) + 6, hwR = (1 - s * .9) * (62 + R() * 26) + 6;
      const yt = yb - (70 + 40 * (1 - s)) * (.8 + R() * .3);
      g.fillStyle = INK; g.beginPath(); g.moveTo(cx, yt);
      g.quadraticCurveTo(cx + hwR * .35, yt + (yb - yt) * .55, cx + hwR, yb + 6 + R() * 10);
      const nR = 3 + Math.floor(R() * 3);
      for (let k = 1; k <= nR; k++) { const u = 1 - k / (nR + 1); g.lineTo(cx + hwR * u + 4, yb - 10 - R() * 8); g.lineTo(cx + hwR * (u - .5 / (nR + 1)), yb + R() * 12); }
      g.lineTo(cx, yb - 16);
      const nL = 3 + Math.floor(R() * 3);
      for (let k = nL; k >= 1; k--) { const u = 1 - k / (nL + 1); g.lineTo(cx - hwL * (u + .5 / (nL + 1)), yb + R() * 12); g.lineTo(cx - hwL * u - 4, yb - 10 - R() * 8); }
      g.lineTo(cx - hwL, yb + 6 + R() * 10);
      g.quadraticCurveTo(cx - hwL * .35, yt + (yb - yt) * .55, cx, yt);
      g.fill();
      for (const side of [-1, 1]) {
        if (R() < .25) continue;
        const hw = side < 0 ? hwL : hwR, u = .35 + R() * .45;
        const x = cx + side * hw * u, y = yt + (yb - yt) * (.35 + .55 * u);
        cut(g, x - side * hw * .3, y - 10, x + side * hw * .15, y + 2, 6 + R() * 4, R, PAPER);
      }
    }
    cut(g, ox + lean, top - 10, ox + lean, top + 50, 7, R, INK);
  }
  return c;
}

// ------------------------------------------------------------------ frosted alders and willows
// 8 variants, 512×512 each, in one row. A dark crown of twigs with the hoarfrost carved out in paper.
export function frostTreeAtlas() {
  const T = 512, N = 8, SC = 2;   // drawn at 512 units, stored at 1024 px per tile, 4×2 tiles
  const c = document.createElement('canvas'); c.width = T * SC * 4; c.height = T * SC * 2;
  const cg = c.getContext('2d');
  for (let v = 0; v < N; v++) {
    // each tree is drawn large on its own sheet, then fitted into its tile with the foot on the bottom edge
    const tc = document.createElement('canvas'); tc.width = 1600 * SC; tc.height = 1200 * SC;
    const g = tc.getContext('2d'); g.scale(SC, SC);
    const R = mulberry(3100 + v * 53), ox = 800, foot = 1190;
    const willow = v >= 6, slim = v === 4 || v === 5;
    const segs = [];   // [x0,y0,x1,y1,w] for frost
    const tips = [];
    const grow = (x, y, ang, len, w, d) => {
      const bend = (R() - .5) * .5;
      const x1 = x + Math.cos(ang) * len, y1 = y + Math.sin(ang) * len;
      const mx = (x + x1) / 2 + Math.cos(ang + Math.PI / 2) * len * bend * .2, my = (y + y1) / 2 + Math.sin(ang + Math.PI / 2) * len * bend * .2;
      ribbon(g, quadPts([x, y], [mx, my], [x1, y1], 8), w, w * .62, INK);
      segs.push([x, y, mx, my, x1, y1, w]);
      if (d <= 0 || len < 9) { tips.push([x1, y1, ang]); return; }
      const kids = d > 3 ? 2 : 2 + (R() < .5 ? 1 : 0);
      for (let k = 0; k < kids; k++) {
        const spread = slim ? .32 : willow ? .5 : .5;
        let a = ang + (k - (kids - 1) / 2) * spread + (R() - .5) * .35;
        if (willow && d < 3) a = a * .5 + (Math.PI / 2) * .5 * (d < 2 ? 1 : .4);   // weeping tips droop
        grow(x1, y1, a, len * (.7 + R() * .14), w * .68, d - 1);
      }
    };
    const trunkH = slim ? 210 + R() * 40 : 120 + R() * 50;
    const lean = (R() - .5) * .18;
    // a second stem on some alders: they grow as clumps
    const stems = slim ? 1 : (R() < .55 ? 2 : 1);
    for (let s = 0; s < stems; s++) {
      const sx = ox + (s ? (R() - .5) * 40 : 0), a0 = -Math.PI / 2 + lean + (s ? (R() - .5) * .4 : 0);
      ribbon(g, [[sx, foot], [sx + Math.cos(a0) * trunkH * .5, foot + Math.sin(a0) * trunkH * .5], [sx + Math.cos(a0) * trunkH, foot + Math.sin(a0) * trunkH]], slim ? 12 : 20, slim ? 8 : 13, INK);
      const tx = sx + Math.cos(a0) * trunkH, ty = foot + Math.sin(a0) * trunkH;
      const nb = slim ? 3 : 4;
      for (let k = 0; k < nb; k++) {
        const a = a0 + (k - (nb - 1) / 2) * (slim ? .4 : .5) + (R() - .5) * .3;
        grow(tx, ty, a, (slim ? 70 : 92) * (.75 + R() * .4), slim ? 8 : 12, slim ? 4 : 5);
      }
    }
    // twig mass: many fine dark lines around the tips, merging into a crown
    g.strokeStyle = INK; g.lineCap = 'round';
    for (const [x, y, a] of tips) {
      for (let k = 0; k < 9; k++) {
        const aa = a + (R() - .5) * 1.6, l = 12 + R() * 26;
        g.lineWidth = 1.6 + R() * 1.6;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(aa) * l, y + Math.sin(aa) * l); g.stroke();
      }
      g.fillStyle = INK; g.beginPath(); g.arc(x, y, 3 + R() * 4, 0, Math.PI * 2); g.fill();
    }
    // hoarfrost: paper cuts along the upper side of every branch and stabs on the twig tips
    for (const [x0, y0, mx, my, x1, y1, w] of segs) {
      if (w < 2.2) continue;
      const pts = quadPts([x0, y0], [mx, my], [x1, y1], 6);
      let dx = x1 - x0, dy = y1 - y0; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
      let nx = -dy, ny = dx; if (ny > 0) { nx = -nx; ny = -ny; }   // the upper side
      const off = w * .18;
      for (let i = 0; i < pts.length - 1; i++) {
        if (R() < .25) continue;
        const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
        cut(g, ax + nx * off, ay + ny * off, bx + nx * off, by + ny * off, Math.max(1.4, w * .32), R, PAPER, .6);
      }
    }
    for (const [x, y, a] of tips) {
      for (let k = 0; k < 4; k++) {
        if (R() < .3) continue;
        const aa = a + (R() - .5) * 1.6, r = 2 + R() * 10;
        const px = x + Math.cos(aa) * r, py = y + Math.sin(aa) * r;
        cut(g, px, py, px + Math.cos(aa) * (5 + R() * 8), py + Math.sin(aa) * (5 + R() * 8), 2 + R() * 1.5, R, PAPER);
      }
    }
    // snow lying at the foot
    let x0 = ox, x1 = ox, y0 = foot;
    for (const [x, y] of tips) { x0 = Math.min(x0, x - 34); x1 = Math.max(x1, x + 34); y0 = Math.min(y0, y - 34); }
    const half = Math.max(ox - x0, x1 - ox), k = Math.min(1, (T - 8) / (foot - y0), (T / 2 - 4) / half);
    const dx = (v % 4) * T * SC, dy = Math.floor(v / 4) * T * SC;
    cg.drawImage(tc, (ox - (T / 2) / k) * SC, (foot - (T - 4) / k) * SC, T / k * SC, T / k * SC, dx, dy, T * SC, T * SC);
    cg.fillStyle = PAPER; cg.beginPath(); cg.ellipse(dx + T * SC / 2, dy + T * SC - 4, 52, 12, 0, Math.PI, 0); cg.fill();
  }
  return c;
}

// ------------------------------------------------------------------ red-crowned cranes
// 4×4 poses, 512×512 tiles, facing right. Standing tiles: the feet sit on the tile's bottom edge.
// Flight tiles: top view of the bird, body on the tile's centre line. HEAD lists the crown in tile units (0–100).
export const POSE = { SLEEP: 0, SLEEP2: 1, HALF: 2, ALERT: 3, CALL: 4, PECK: 5, WALK: 6, RUN: 7, FLY_UP: 8, FLY_MID: 9, FLY_DOWN: 10, LAND: 11, DANCE: 12, BOW: 13, ALERT2: 14, CALLW: 15 };
export const HEAD = [];
export function craneAtlas() {
  const T = 512, c = document.createElement('canvas'); c.width = T * 4; c.height = T * 4;
  const g = c.getContext('2d'); g.lineJoin = 'round'; g.lineCap = 'round';
  const U = T / 100;
  for (let p = 0; p < 16; p++) {
    const R = mulberry(7000 + p * 13);
    g.save(); g.translate((p % 4) * T, Math.floor(p / 4) * T); g.scale(U, U);
    g.beginPath(); g.rect(0, 0, 100, 100); g.clip();
    HEAD[p] = drawPose(g, p, R);
    g.restore();
  }
  return c;
}

const outline = (g, w = .9) => { g.strokeStyle = INK; g.lineWidth = w; g.stroke(); };
function body(g, R, cx, cy, sx = 1, rot = 0, fluff = 0) {
  g.save(); g.translate(cx, cy); g.rotate(rot); g.scale(sx * 1.08, 1);
  g.beginPath();
  g.moveTo(15, -2);
  g.bezierCurveTo(10, -9 - fluff, -10, -9.5 - fluff, -19, -3.5);
  g.bezierCurveTo(-23, -.5, -24, 3.5, -21, 5.5);
  g.bezierCurveTo(-12, 10 + fluff * .5, 6, 10 + fluff * .5, 13, 5);
  g.bezierCurveTo(16, 3, 17, 0, 15, -2);
  g.fillStyle = PAPER; g.fill(); outline(g, .9 / sx);
  for (let i = 0; i < 5; i++) {
    const y = 4 + i * 1.2, x0 = -14 + i * 2.2 + R() * 2, x1 = 7 - i * 1.6 + R() * 2;
    cut(g, x0, y + R() * .5, x1, y + 1 + R() * .5, .5, R, INK, .9);
  }
  // black tertials draping over the tail, hanging below it
  g.beginPath();
  g.moveTo(-1, -7.5);
  g.bezierCurveTo(-9, -9, -18, -5, -24, 4);
  const tips = [[-25, 10], [-22.5, 7.5], [-21, 12], [-18.5, 8], [-16.5, 11.5], [-14, 7], [-11.5, 9.5], [-8, 5]];
  for (const [x, y] of tips) g.lineTo(x + R() * .6, y + R() * .6);
  g.bezierCurveTo(-5, 1, -1, -3, -1, -7.5);
  g.fillStyle = INK; g.fill();
  for (let i = 0; i < 4; i++) cut(g, -5 - i * 4, -4.5 + i * 1.6, -11 - i * 3.6, 6 + i * .8, .5, R, PAPER, .9);
  g.restore();
}
function neck(g, R, pts, w0 = 6.2, w1 = 3.2, nape = [.45, .95]) {
  const P = bez(pts[0], pts[1], pts[2], pts[3], 20);
  ribbon(g, P, w0, w1, INK);
  const a = Math.floor(P.length * nape[0]), b = Math.floor(P.length * nape[1]);
  const seg = [];
  for (let i = a; i <= b && i < P.length; i++) {
    const q = P[Math.min(P.length - 1, i + 1)], r = P[Math.max(0, i - 1)];
    let dx = q[0] - r[0], dy = q[1] - r[1]; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
    const w = (w0 + (w1 - w0) * i / (P.length - 1)) * .26;
    seg.push([P[i][0] + dy * w, P[i][1] - dx * w]);
  }
  if (seg.length > 1) ribbon(g, seg, .6, 1.5, PAPER);
  return P[P.length - 1];
}
function head(g, x, y, ang, billL = 9) {
  g.save(); g.translate(x, y); g.rotate(ang);
  g.beginPath(); g.ellipse(0, 0, 3.3, 2.5, 0, 0, Math.PI * 2); g.fillStyle = INK; g.fill();
  g.beginPath(); g.ellipse(-1.6, .9, 1.4, 1, .2, 0, Math.PI * 2); g.fillStyle = PAPER; g.fill();
  g.beginPath(); g.moveTo(2.3, -1.3); g.lineTo(2.5 + billL, .3); g.lineTo(2.3, 1.3); g.closePath();
  g.fillStyle = PAPER; g.fill(); outline(g, .5);
  g.restore();
  return [x + Math.sin(ang) * 1.5, y - Math.cos(ang) * 1.5];
}
function legs(g, list, w = 1.3) {
  for (const L of list) {
    ribbon(g, L, w, w * .85, INK);
    const f = L[L.length - 1];
    g.strokeStyle = INK; g.lineWidth = .8;
    g.beginPath(); g.moveTo(f[0] - 3.5, f[1] + .3); g.lineTo(f[0] + 4, f[1] + .3); g.stroke();
  }
}
// a crane's wing: long and broad, fingered primaries at the tip, black secondaries along the inner trailing edge.
// root → tip along `ang`; `side` picks which side the trailing edge lies on.
function wing(g, R, root, ang, len, c0, c1, side, bow = 0) {
  const ax = Math.cos(ang), ay = Math.sin(ang), nx = -ay * side, ny = ax * side;
  const N = 14, LE = [], TE = [];
  for (let i = 0; i <= N; i++) {
    const k = i / N, b = Math.sin(Math.PI * k) * len * .07 * bow;
    const x = root[0] + ax * len * k - nx * b, y = root[1] + ay * len * k - ny * b;
    LE.push([x, y]);
    const ch = lerp1(c0, c1, k) * (1 + .22 * Math.sin(Math.PI * k * .9));
    TE.push([x + nx * ch, y + ny * ch]);
  }
  // fingers first, under the wing: the separated primaries
  const tip = LE[N];
  for (let j = 0; j < 5; j++) {
    const f = (j + .5) / 5, bx = tip[0] + nx * c1 * f * .85 - ax * 2.5, by = tip[1] + ny * c1 * f * .85 - ay * 2.5;
    const a2 = ang + side * (f * .45 - .05), fl = len * (.13 - .04 * f) + 2.5;
    const P = [[bx, by], [bx + Math.cos(a2) * fl * .55, by + Math.sin(a2) * fl * .55], [bx + Math.cos(a2) * fl, by + Math.sin(a2) * fl]];
    ribbon(g, P, c1 / 5 * 1.5, .9, INK);
    ribbon(g, P.slice(0, 2).concat([[bx + Math.cos(a2) * fl * .9, by + Math.sin(a2) * fl * .9]]), c1 / 5 * 1.05, .3, PAPER);
  }
  g.beginPath(); LE.forEach((p, i) => i ? g.lineTo(...p) : g.moveTo(...p));
  for (let i = N; i >= 0; i--) g.lineTo(...TE[i]);
  g.closePath(); g.fillStyle = PAPER; g.fill(); outline(g, .8);
  // black secondaries along the inner trailing edge, ragged where the feathers end
  const M = Math.round(N * .58);
  g.beginPath();
  for (let i = 0; i <= M; i++) g.lineTo(...TE[i]);
  for (let i = M; i >= 0; i--) {
    const d = (.55 - .1 * (i / M)) * (i === M ? .4 : 1) + (i % 2 ? .05 : 0);
    g.lineTo(lerp1(TE[i][0], LE[i][0], d), lerp1(TE[i][1], LE[i][1], d));
  }
  g.closePath(); g.fillStyle = INK; g.fill();
  for (let i = 1; i < M; i++) { const d = .45 - .1 * (i / M); cut(g, lerp1(TE[i][0], LE[i][0], d * .8), lerp1(TE[i][1], LE[i][1], d * .8), TE[i][0], TE[i][1], .4, R, PAPER, .7); }
  // primaries: a few long ink cuts running out toward the tip
  for (let j = 0; j < 3; j++) {
    const d = .3 + j * .2, i0 = M + 1, i1 = N;
    cut(g, lerp1(LE[i0][0], TE[i0][0], d), lerp1(LE[i0][1], TE[i0][1], d), lerp1(LE[i1][0], TE[i1][0], d), lerp1(LE[i1][1], TE[i1][1], d), .45, R, INK, .9);
  }
}
const lerp1 = (a, b, t) => a + (b - a) * t;

function drawPose(g, p, R) {
  const P = POSE;
  const L2 = [[[45, 61], [46.5, 80], [45.5, 99]], [[50, 61], [52, 80], [51.5, 99]]];
  if (p === P.SLEEP || p === P.SLEEP2) {
    const tilt = p === P.SLEEP ? -.05 : .06;
    legs(g, [[[47, 62], [48, 80], [47.5, 99]]]);
    body(g, R, 46, 54, 1.0, tilt, 2.5);
    // the neck folded back over the shoulders, the head tucked into the back feathers
    g.beginPath(); g.moveTo(61, 53); g.bezierCurveTo(64, 46, 60, 41, 53, 41.5); g.bezierCurveTo(48, 42, 44, 44.5, 42, 47.5);
    g.bezierCurveTo(47, 46.5, 54, 47, 61, 53); g.fillStyle = INK; g.fill();
    cut(g, 58.5, 45, 48, 43.2, .9, R, PAPER, .9);
    return [53, 42];
  }
  if (p === P.HALF) {
    legs(g, L2);
    body(g, R, 44, 53, 1, -.04, 1);
    const hp = neck(g, R, [[56, 51], [63, 45], [67, 39], [70, 34]]);
    return head(g, hp[0] + 1, hp[1] - .5, .35);
  }
  if (p === P.ALERT || p === P.ALERT2) {
    const v = p === P.ALERT2;
    legs(g, L2);
    body(g, R, 44, 53, 1, -.08, 0);
    const hp = neck(g, R, v ? [[56, 50], [62, 38], [57, 28], [59, 17]] : [[56, 50], [63, 38], [60, 27], [62, 17]]);
    return head(g, hp[0] + 1, hp[1] - 1, v ? -.15 : .12);
  }
  if (p === P.CALL || p === P.CALLW) {
    legs(g, [[[44, 61], [45.5, 80], [44.5, 99]], [[49, 61], [51, 80], [50.5, 99]]]);
    if (p === P.CALLW) wing(g, R, [50, 47], -2.75, 24, 11, 8, -1, .5);
    body(g, R, 43, 54, 1, -.12, 0);
    const hp = neck(g, R, [[55, 50], [60, 36], [57, 24], [56, 15]]);
    return head(g, hp[0], hp[1] - 1, -1.25);
  }
  if (p === P.PECK) {
    legs(g, [[[43, 64], [42, 81], [41, 99]], [[48, 64], [50, 81], [51, 99]]]);
    body(g, R, 43, 56, 1, .2, 0);
    const hp = neck(g, R, [[55, 59], [66, 61], [71, 75], [72, 88]]);
    return head(g, hp[0] + 1, hp[1] + 1, 1.1, 8);
  }
  if (p === P.WALK) {
    legs(g, [[[47, 62], [54, 80], [58, 99]], [[43, 62], [40, 80], [36, 98]]]);
    body(g, R, 43, 53, 1, -.02, 0);
    const hp = neck(g, R, [[55, 51], [64, 43], [66, 31], [71, 25]]);
    return head(g, hp[0] + 1, hp[1], .25);
  }
  if (p === P.RUN) {
    wing(g, R, [48, 47], -2.05, 32, 13, 9, -1, .6);
    legs(g, [[[44, 62], [52, 78], [60, 88]], [[40, 62], [33, 76], [28, 90]]], 1.2);
    body(g, R, 45, 54, 1, .12, 0);
    const hp = neck(g, R, [[57, 54], [68, 49], [76, 45], [84, 42]], 5.6);
    const cr = head(g, hp[0] + 1, hp[1], .2);
    wing(g, R, [52, 48], -1.8, 38, 14, 10, -1, .6);
    return cr;
  }
  if (p === P.LAND) {
    wing(g, R, [48, 45], -2.35, 34, 13, 9, -1, 1);
    legs(g, [[[47, 60], [55, 74], [56, 92]], [[44, 60], [50, 76], [49, 94]]], 1.2);
    body(g, R, 45, 52, 1, -.25, 0);
    const hp = neck(g, R, [[56, 48], [64, 41], [70, 35], [77, 32]], 5.6);
    const cr = head(g, hp[0] + 1, hp[1], .3);
    wing(g, R, [52, 46], -2.0, 40, 14, 10, -1, 1);
    return cr;
  }
  if (p === P.DANCE) {
    wing(g, R, [47, 44], -2.45, 40, 14, 10, -1, .8);
    legs(g, [[[45, 58], [44, 74], [40, 90]], [[49, 58], [52, 74], [49, 91]]], 1.2);
    body(g, R, 45, 50, 1, -.18, 0);
    const hp = neck(g, R, [[56, 47], [62, 37], [62, 26], [66, 17]], 5.6);
    const cr = head(g, hp[0] + 1, hp[1] - 1, -.15);
    wing(g, R, [53, 44], -1.25, 40, 14, 10, -1, .8);
    return cr;
  }
  if (p === P.BOW) {
    legs(g, [[[44, 63], [45.5, 81], [44.5, 99]], [[49, 63], [51, 81], [50.5, 99]]]);
    body(g, R, 44, 56, 1, .3, 0);
    wing(g, R, [48, 50], 2.75, 28, 12, 9, -1, .5);
    const hp = neck(g, R, [[55, 60], [66, 62], [72, 70], [74, 80]]);
    return head(g, hp[0] + 1, hp[1] + 1, 1.0);
  }
  // flight, seen from above
  const len = p === P.FLY_MID ? 43 : p === P.FLY_UP ? 31 : 37;
  const sweep = p === P.FLY_MID ? .1 : p === P.FLY_UP ? .38 : -.06;
  const bow = p === P.FLY_DOWN ? 1.4 : p === P.FLY_UP ? -.6 : .5;
  legs(g, [[[40, 49.3], [30, 49], [21, 48.7]], [[40, 50.7], [30, 51], [21, 51.3]]], .9);
  for (const s of [-1, 1]) {
    const L = len * (s < 0 ? .93 : 1);
    wing(g, R, [57, 50 + s * 2.6], s < 0 ? -Math.PI / 2 - sweep : Math.PI / 2 + sweep, L, 17, 12, s, bow);
  }
  g.beginPath(); g.ellipse(51, 50, 13.5, 5, 0, 0, Math.PI * 2); g.fillStyle = PAPER; g.fill(); outline(g, .8);
  g.beginPath(); g.moveTo(39, 47.2); g.lineTo(33, 50); g.lineTo(39, 52.8); g.closePath(); g.fillStyle = PAPER; g.fill(); outline(g, .6);
  ribbon(g, [[62, 50], [71, 50], [80, 50]], 4, 2.8, INK);
  ribbon(g, [[71, 49.3], [79, 49.2]], .4, 1, PAPER);
  g.beginPath(); g.ellipse(82.5, 50, 2.9, 2.3, 0, 0, Math.PI * 2); g.fillStyle = INK; g.fill();
  g.beginPath(); g.moveTo(84.6, 49); g.lineTo(93, 50); g.lineTo(84.6, 51); g.closePath(); g.fillStyle = PAPER; g.fill(); outline(g, .4);
  return [82.3, 50];
}

// ------------------------------------------------------------------ river steam
// 4 wisps, 1024×256 each, stacked: lens-shaped clusters of horizontal paper cuts.
export function mistAtlas() {
  const W = 1024, H = 256, c = document.createElement('canvas'); c.width = W; c.height = H * 4;
  const g = c.getContext('2d');
  for (let v = 0; v < 4; v++) {
    const R = mulberry(880 + v * 29), oy = v * H;
    for (let y = 30; y < H - 30; y += 8 + R() * 8) {
      const s = (y - 30) / (H - 60), env = Math.pow(Math.sin(s * Math.PI), .7);
      const half = W * .46 * env * (.7 + R() * .3), cx = W / 2 + (R() - .5) * 120;
      let x = cx - half;
      while (x < cx + half) {
        const len = 40 + R() * 260, gap = 10 + R() * 90;
        if (R() < .7) {
          const x1 = Math.min(cx + half, x + len), wv = Math.sin(x * .01 + v) * 3;
          cut(g, x, oy + y + wv, x1, oy + y + wv + (R() - .5) * 4, 4 + R() * 8 * env, R, PAPER, .9);
        }
        x += len + gap;
      }
    }
  }
  return c;
}

// ------------------------------------------------------------------ moon and sun
export function moonCanvas(S = 1024) {
  const c = document.createElement('canvas'); c.width = S; c.height = S;
  const g = c.getContext('2d'), R = mulberry(77), m = S / 2;
  g.strokeStyle = PAPER; g.lineCap = 'round';
  for (let i = 0; i < 4; i++) {
    const r = 210 + i * 70 + R() * 20, a0 = R() * 6, sw = Math.PI * (.7 + R() * .9);
    g.lineWidth = 4 - i * .6; g.beginPath();
    for (let s = 0; s <= 1; s += .01) { const a = a0 + sw * s, rr = r * (1 + Math.sin(s * 9 + i) * .012); g.lineTo(m + Math.cos(a) * rr, m + Math.sin(a) * rr * .96); }
    g.stroke();
  }
  g.fillStyle = PAPER; g.beginPath(); g.arc(m, m, 150, 0, Math.PI * 2); g.fill();
  g.strokeStyle = PAPER; g.lineWidth = 3; g.beginPath(); g.arc(m + 4, m - 2, 168, -1.2, 1.4); g.stroke();
  for (const [dx, dy, L] of [[-62, -48, 70], [-20, -20, 95], [-80, 8, 60], [-30, 38, 85], [-58, 66, 50]]) {
    const x = m + dx + (R() - .5) * 10, y = m + dy;
    cut(g, x, y, x + L, y + (R() - .5) * 4, 9, R, INK);
  }
  return c;
}
// The sun: a warm disc crossed by ink dashes, with carved rays fanning out above the horizon.
export function sunCanvas(S = 1024) {
  const c = document.createElement('canvas'); c.width = S; c.height = S;
  const g = c.getContext('2d'), R = mulberry(4401), m = S / 2;
  for (let i = 0; i < 56; i++) {
    const a = Math.PI + (i + .5) / 56 * Math.PI + (R() - .5) * .02;
    const r0 = 190 + R() * 30, r1 = 330 + R() * 170;
    cut(g, m + Math.cos(a) * r0, m + Math.sin(a) * r0, m + Math.cos(a) * r1, m + Math.sin(a) * r1, 5 + R() * 4, R, YELLOW);
  }
  g.strokeStyle = YELLOW; g.lineCap = 'round';
  for (let i = 0; i < 3; i++) { g.lineWidth = 4 - i; g.beginPath(); g.arc(m, m, 168 + i * 18, Math.PI * 1.02, Math.PI * 1.98); g.stroke(); }
  g.fillStyle = YELLOW; g.beginPath(); g.arc(m, m, 150, 0, Math.PI * 2); g.fill();
  for (let i = 0; i < 6; i++) { const y = m - 110 + i * 34, w = Math.sqrt(Math.max(0, 150 * 150 - (y - m) ** 2)); cut(g, m - w * .8, y, m + w * .55, y + 2, 6, R, INK); }
  return c;
}
