// The aircraft (a 12-row, 3+3, one-aisle cabin), its lid that lifts like a picture-book flap, and the jet bridge.
// World metres. Fuselage axis along y: nose at −y (screen up-right), tail at +y. Doors on the +x side (toward camera).
import { C, iso, tri, mix, hex, css, TAU, clamp, lerp, seg, ss, eo, facet, fillPoly, onPlane, rect, quad, tracePath } from './kit.js';

export const PL = { ZC: 2.85, RX: 1.95, RZ: 2.0, FLOOR: 2.1, CUTN: 2.55, CUTF: 3.6, YF: -2.2, YA: 11.4, DOOR: [-1.65, -.55], BRIDGE_Z: 2.3 };
export const rowY = r => .75 + (r - 1) * .81;                          // seat-cushion centre of row r (1..12), pitch 32 in
export const SEATX = { A: -1.415, B: -.955, C: -.495, D: .495, E: .955, F: 1.415 };
export const AISLE = .265;                                             // half-width (aisle 53 cm)
export const DOORY = -1.1;

// ---------- hull sections ----------
const N = 32;
function ell(a, s = 1, dz = 0) { return [PL.RX * s * Math.cos(a), PL.ZC + dz + PL.RZ * s * Math.sin(a)]; }
function arc(a0, a1, s = 1, dz = 0, n = N) { const out = [], m = Math.max(2, Math.ceil(Math.abs(a1 - a0) / TAU * n)); for (let i = 0; i <= m; i++) out.push(ell(lerp(a0, a1, i / m), s, dz)); return out; }
const A_N = Math.asin((PL.CUTN - PL.ZC) / PL.RZ);                     // near cut angle (x > 0)
const A_F = Math.PI - Math.asin((PL.CUTF - PL.ZC) / PL.RZ);           // far cut angle (x < 0)
export const xAt = z => PL.RX * Math.sqrt(Math.max(0, 1 - ((z - PL.ZC) / PL.RZ) ** 2));

const BODY = tri(C.body, .35, .2);
// extrude a section polyline (x,z) along y from y0 to y1, outward normals away from the section centre
function extrude(g, sec, y0, y1, t3, o = {}) {
  for (let i = 0; i < sec.length - 1; i++) {
    const [xa, za] = sec[i], [xb, zb] = sec[i + 1];
    const mx = (xa + xb) / 2, mz = (za + zb) / 2, out = o.inside ? [-mx, 0, -(mz - PL.ZC)] : [mx, 0, mz - PL.ZC];
    facet(g, [[xa, y0, za], [xb, y0, zb], [xb, y1, zb], [xa, y1, za]], t3, { out, color: o.color });
  }
}
// loft between stations [{y, s, dz}] on full ellipses (convex), optional end caps
function loft(g, st, t3, o = {}) {
  for (let k = 0; k < st.length - 1; k++) {
    const A = st[k], B = st[k + 1];
    for (let i = 0; i < N; i++) {
      const a0 = i / N * TAU, a1 = (i + 1) / N * TAU;
      const p = ell(a0, A.s, A.dz), q = ell(a1, A.s, A.dz), r = ell(a1, B.s, B.dz), u = ell(a0, B.s, B.dz);
      const am = (a0 + a1) / 2;
      facet(g, [[p[0], A.y, p[1]], [q[0], A.y, q[1]], [r[0], B.y, r[1]], [u[0], B.y, u[1]]], t3, { out: [Math.cos(am), (B.y - A.y) > 0 ? (A.s - B.s) : (B.s - A.s), Math.sin(am)] });
    }
  }
}
const capPts = (y, s = 1, dz = 0) => { const o = []; for (let i = 0; i < N; i++) { const [x, z] = ell(i / N * TAU, s, dz); o.push([x, y, z]); } return o; };

// ---------- nose (closed), with the front bulkhead and its timer ----------
const NOSE = [{ y: PL.YF, s: 1, dz: 0 }, { y: -3.6, s: .985, dz: -.02 }, { y: -4.9, s: .9, dz: -.08 }, { y: -6.0, s: .72, dz: -.18 }, { y: -6.8, s: .46, dz: -.3 }, { y: -7.25, s: .16, dz: -.38 }];
export function nose(g, timer) {
  // bulkhead (faces +y, into the cabin): drawn first, the nose shell occludes nothing behind it
  facet(g, capPts(PL.YF), null, { color: C.wallIn, out: [0, 1, 0] });
  loft(g, [...NOSE].reverse(), BODY);
  // cockpit windows on the near cheek
  for (let i = 0; i < 3; i++) {
    const y0 = -5.2 - i * .34, y1 = y0 - .26, z0 = 3.72 - i * .05, z1 = z0 + .3;
    const xs = z => PL.RX * .8 * Math.sqrt(Math.max(0, 1 - ((z - PL.ZC + .14) / (PL.RZ * .8)) ** 2));
    fillPoly(g, [iso.P(xs(z0) + .02, y0, z0), iso.P(xs(z0) - .02, y1, z0), iso.P(xs(z1) - .05, y1, z1), iso.P(xs(z1) + .02, y0, z1)], '#3C4744');
  }
  if (timer) timerScreen(g, timer);
}
export function timerScreen(g, tm) { // small dark screen on the front bulkhead, read along +x
  const z = 3.08, y = PL.YF + .01;
  onPlane(g, -.62, y, z, 'xz', g2 => {
    g2.fillStyle = C.screen; g2.beginPath(); g2.roundRect(0, 0, 1.24, .5, .05); g2.fill();
    g2.fillStyle = tm.hot ? '#F08A6A' : '#E9C46A'; g2.font = '600 0.38px Newsreader'; g2.textAlign = 'center'; g2.textBaseline = 'middle';
    g2.fillText(tm.s, .62, .27);
  });
}

// ---------- the cabin: interior (floor, far wall, seats) and the lower hull ----------
export function cabinBack(g, o = {}) {
  const yA = PL.YF, yB = PL.YA;
  // far inner wall (faces +x), from the floor up to the far cut, with a row of windows
  const far = arc(A_F, Math.PI - Math.asin((PL.FLOOR - PL.ZC) / PL.RZ), 1);
  extrude(g, far, yA, yB, null, { inside: true, color: C.wallIn });
  for (let r = 1; r <= 12; r++) {
    const y = rowY(r) - .05, z0 = 3.0, z1 = 3.42, x0 = -xAt(z0) + .02, x1 = -xAt(z1) + .02;
    fillPoly(g, [iso.P(x0, y - .15, z0), iso.P(x0, y + .15, z0), iso.P(x1, y + .15, z1), iso.P(x1, y - .15, z1)], '#C9D6D1');
  }
  // floor and the aisle
  const xf = xAt(PL.FLOOR);
  fillPoly(g, quad(rect(-xf, xf, yA, yB), PL.FLOOR), C.cabinFloor);
  fillPoly(g, quad(rect(-AISLE, AISLE, yA + .4, yB - .3), PL.FLOOR + .001), C.aisle);
  // far rim (cut top), a narrow strip
  fillPoly(g, quad(rect(-PL.RX, -xAt(PL.CUTF) + .16, yA, yB), PL.CUTF), hex(mix(C.body, '#FFF7E6', .3)));
  if (o.decal) o.decal(g);
}
export function cabinFront(g, o = {}) { // near lower hull: exterior up to the low cut, with a gap at the door
  const yA = PL.YF, yB = PL.YA, [d0, d1] = PL.DOOR;
  extrude(g, arc(-Math.PI, A_N, 1), yA, yB, BODY);
  const zt = PL.CUTN;
  fillPoly(g, quad(rect(xAt(zt) - .2, xAt(zt), yA, yB), zt), hex(mix(C.body, '#FFF7E6', .45)));
  // belly line
  const zb = 1.05; fillPoly(g, [iso.P(xAt(zb), yA, zb), iso.P(xAt(zb), yB, zb), iso.P(xAt(zb - .12), yB, zb - .12), iso.P(xAt(zb - .12), yA, zb - .12)], C.belly);
  if (o.door) { const z0 = PL.FLOOR + .02; fillPoly(g, [iso.P(xAt(z0) + .01, d0, z0), iso.P(xAt(z0) + .01, d1, z0), iso.P(xAt(zt) + .01, d1, zt), iso.P(xAt(zt) + .01, d0, zt)], '#3C4441', .9); }
}
// the lid: everything above the cut, closed by its chord. It flips open on a hinge along the far cut edge,
// like a paper flap (its underside is paper-coloured), then glides away. L = {a, rot (rad), dx, dy, dz}
export const HINGE = [-xAt(PL.CUTF), PL.CUTF];
export function lidMap(L) {
  const c = Math.cos(L.rot || 0), s = Math.sin(L.rot || 0), [hx, hz] = HINGE;
  return (x, y, z) => [hx + (x - hx) * c - (z - hz) * s + (L.dx || 0), y + (L.dy || 0), hz + (x - hx) * s + (z - hz) * c + (L.dz || 0)];
}
export function lid(g, L) {
  if (L.a <= 0) return;
  const M = lidMap(L);
  const sec = arc(A_N, A_F, 1);                         // near cut → over the top → far cut; the chord closes it
  const R = sec.map(([x, z]) => M(x, 0, z));            // rotated section (y = 0)
  const cx = R.reduce((a, p) => a + p[0], 0) / R.length, cz = R.reduce((a, p) => a + p[2], 0) / R.length;
  const y0 = PL.YF + (L.dy || 0), y1 = PL.YA + (L.dy || 0);
  g.save(); g.globalAlpha *= L.a;
  const n = R.length;
  for (let i = 0; i < n; i++) {
    const A = R[i], B = R[(i + 1) % n], chord = i === n - 1;
    const out = [(A[0] + B[0]) / 2 - cx, 0, (A[2] + B[2]) / 2 - cz];
    facet(g, [[A[0], y0, A[2]], [B[0], y0, B[2]], [B[0], y1, B[2]], [A[0], y1, A[2]]], BODY, { out, color: chord ? C.wallIn : undefined });
  }
  facet(g, R.map(p => [p[0], y1, p[2]]), null, { out: [0, 1, 0], color: hex(mix(C.wallIn, C.belly, .35)) });
  // livery follows the flap
  const P = (x, y, z) => { const q = M(x, y, z); return iso.P(q[0], q[1], q[2]); };
  const nearFacing = Math.cos(L.rot || 0) > -.2;
  if (nearFacing) livery(g, 0, L.dy || 0, 0, PL.YF, PL.YA, true, (x, y, z) => P(x, y - (L.dy || 0), z));
  g.restore();
}
// windows + two green bands on the near side (on the lid when the cabin is cut); P maps world → screen
export function livery(g, dx, dy, dz, y0, y1, onLid, Pm) {
  const P = Pm ? ((x, y, z) => Pm(x, y + dy, z)) : ((x, y, z) => iso.P(x + dx, y + dy, z + dz));
  const band = (za, zb, col) => fillPoly(g, [P(xAt(za) + .005, y0, za), P(xAt(za) + .005, y1, za), P(xAt(zb) + .005, y1, zb), P(xAt(zb) + .005, y0, zb)], col);
  band(2.62, 2.74, C.greenLt); band(2.8, 2.95, C.green);
  for (let r = 1; r <= 12; r++) {
    const y = rowY(r) - .05, z0 = 3.08, z1 = 3.38;
    fillPoly(g, [P(xAt(z0) + .006, y - .14, z0), P(xAt(z0) + .006, y + .14, z0), P(xAt(z1) + .006, y + .14, z1), P(xAt(z1) + .006, y - .14, z1)], '#8FA79C');
  }
  const [d0, d1] = PL.DOOR; g.save(); g.strokeStyle = hex(mix(C.body, '#6F6A60', .35)); g.lineWidth = 1.4;
  g.beginPath(); for (const [y, z] of [[d0, 2.56], [d0, 4.05], [d1, 4.05], [d1, 2.56]]) { const p = P(xAt(z) + .006, y, z); g.lineTo(p[0], p[1]); } g.stroke(); g.restore();
}
// a closed cabin section (used when the lid is down and nothing inside is shown)
export function cabinClosed(g) {
  extrude(g, arc(-Math.PI / 2 - 1.2, Math.PI / 2 + .2, 1), PL.YF, PL.YA, BODY);
  const zb = 1.05; fillPoly(g, [iso.P(xAt(zb), PL.YF, zb), iso.P(xAt(zb), PL.YA, zb), iso.P(xAt(zb - .12), PL.YA, zb - .12), iso.P(xAt(zb - .12), PL.YF, zb - .12)], C.belly);
  livery(g, 0, 0, 0, PL.YF, PL.YA, false);
}

// ---------- aft body, tail, wings, engines ----------
const AFT = [{ y: PL.YA, s: 1, dz: 0 }, { y: 14.2, s: 1, dz: 0 }, { y: 16.4, s: .86, dz: .2 }, { y: 18.4, s: .58, dz: .55 }, { y: 19.9, s: .27, dz: .85 }, { y: 20.5, s: .1, dz: .95 }];
export function aft(g) {
  aftEngine(g, -1);
  loft(g, AFT, BODY);
  const zb = 1.05; fillPoly(g, [iso.P(xAt(zb), PL.YA, zb), iso.P(xAt(zb), 14.2, zb), iso.P(xAt(zb - .12), 14.2, zb - .12), iso.P(xAt(zb - .12), PL.YA, zb - .12)], C.belly);
  livery(g, 0, 0, 0, PL.YA, 13.2, false);
  // T-tail: far tailplane, fin, near tailplane
  tailplane(g, -1);
  const fin = [[15.4, 4.5], [19.7, 4.0], [20.3, 8.8], [18.7, 8.8]], th = .12;
  const F = tri(C.green, .25, .2);
  for (let i = 0; i < 4; i++) { const [ya, za] = fin[i], [yb, zb2] = fin[(i + 1) % 4]; facet(g, [[th, ya, za], [th, yb, zb2], [-th, yb, zb2], [-th, ya, za]], F, { out: [0, zb2 - za, ya - yb] }); }
  facet(g, fin.map(([y, z]) => [th, y, z]), F, { out: [1, 0, 0] });
  fillPoly(g, [iso.P(th + .003, 16.75, 5.7), iso.P(th + .003, 19.85, 5.7), iso.P(th + .003, 19.95, 6.45), iso.P(th + .003, 17.3, 6.45)], C.greenLt);
  tailplane(g, 1);
  aftEngine(g, 1);
}
function tailplane(g, s) {
  const pts = [[s * .1, 18.6], [s * 4.3, 20.0], [s * 4.3, 20.6], [s * .1, 20.4]];
  iso.prismNow(s > 0 ? pts : pts.slice().reverse(), 8.75, .12, tri(C.body, .3, .22));
}
function aftEngine(g, s) { // rear-mounted engine on a short pylon
  const ex = s * 2.75, zc = 3.55;
  iso.boxNow(s > 0 ? 1.5 : -2.4, 14.4, zc - .12, .9, 1.4, .24, tri('#DCD6CB', .3, .2));
  iso.cylNow(ex, 13.4, zc, .64, .28, tri(C.green, .25, .2), { axis: 'y', n: 22 });
  iso.cylNow(ex, 13.6, zc, .62, 2.8, tri('#E7E1D6', .35, .22), { axis: 'y', n: 22 });
  iso.cylNow(ex, 16.35, zc, .36, .3, tri('#6B6E68', .2, .2), { axis: 'y', n: 16 });
}
export function stabilizers() {}
export function wing(g, side) {
  const s = side, pts = [[s * 1.6, 7.0], [s * 8.8, 10.3], [s * 8.8, 11.05], [s * 1.6, 11.0]];
  iso.prismNow(s > 0 ? pts : pts.slice().reverse(), 1.15, .24, tri('#E9E3D7', .35, .22));
  const tip = [[s * 8.62, 10.22], [s * 8.82, 10.3], [s * 8.82, 11.05], [s * 8.62, 11.05]];
  iso.prismNow(s > 0 ? tip : tip.slice().reverse(), 1.39, .9, tri(C.green, .25, .2));
}

// ---------- jet bridge: floor, a tall far wall, a low near wall (cut away), on a leg ----------
export const BR = { x0: 1.98, x1: 9.5, y0: -2.05, y1: -.15, z: PL.BRIDGE_Z };
const BRT = tri('#E3DDD1', .3, .18), BRG = tri(C.green, .25, .2);
// x0: where the bridge ends (1.98 = docked at the door; larger = retracted toward the terminal)
export function bridgeBack(g, x0 = BR.x0) {
  const { x1, y0, y1, z } = BR;
  iso.boxNow(7.25, -1.25, 0, .3, .3, z - .2, tri('#B3AC9F', .25, .2));
  iso.boxNow(7.05, -1.55, .12, .7, .9, .3, tri('#9C968A', .2, .2));
  iso.boxNow(x0, y0 - .1, z, x1 - x0, .1, 2.35, BRT);
  for (let x = x0 + .35; x < x1 - .3; x += .9) fillPoly(g, [iso.P(x, y0 + .001, z + .95), iso.P(x + .65, y0 + .001, z + .95), iso.P(x + .65, y0 + .001, z + 1.9), iso.P(x, y0 + .001, z + 1.9)], '#CADBD4');
  iso.boxNow(x0, y0, z - .22, x1 - x0, y1 - y0, .22, BRT, { faceColor: { 1: BRG[1] } });
  fillPoly(g, quad(rect(x0, x1, y0, y1), z + .002), '#E6DAC5');
}
export function bridgeFront(g, x0 = BR.x0) {
  const { x1, y0, y1, z } = BR;
  iso.boxNow(x0, y1, z, x1 - x0, .1, .85, BRT, { faceColor: { 1: BRG[1] } });
  iso.boxNow(x0 - .02, y0 - .12, z - .2, .22, y1 - y0 + .24, .2, tri('#C9C1B2', .25, .2));
}
// push-back tug: a low box with a small cab, nose toward the aircraft
export function tug(g, y) {
  iso.boxNow(-.75, y - 2.9, .25, 1.5, 2.3, .55, tri(C.ginger, .25, .2));
  iso.boxNow(-.6, y - 2.75, .8, 1.2, .9, .6, tri('#E9E2D4', .3, .18), { faceColor: { 2: '#9FB2AB', 1: '#B7C7C0' } });
  iso.boxNow(-.08, y - .6, .45, .16, .9, .1, tri(C.dark, .2, .2));
}
