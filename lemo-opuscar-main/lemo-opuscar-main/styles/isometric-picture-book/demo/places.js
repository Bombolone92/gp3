// Places: the apron (concrete, guide line, stop bar) and the gate inside the terminal (floor at z 2.3, cut away above).
import { C, W, H, iso, tri, mix, hex, css, TAU, clamp, lerp, seg, ss, eo, fillPoly, onPlane, rect, quad } from './kit.js';
import { BR } from './plane.js';

// ---------- apron ----------
export function apron(g, o = {}) {
  g.fillStyle = C.apron; g.fillRect(0, 0, W, H);
  g.save(); g.strokeStyle = C.apronJoint; g.lineWidth = 1; g.globalAlpha = .7; g.beginPath();   // concrete slab joints, 5 m
  for (let x = -60; x <= 60; x += 5) { const a = iso.P(x, -80, 0), b = iso.P(x, 80, 0); g.moveTo(...a); g.lineTo(...b); }
  for (let y = -80; y <= 80; y += 5) { const a = iso.P(-60, y, 0), b = iso.P(60, y, 0); g.moveTo(...a); g.lineTo(...b); }
  g.stroke(); g.restore();
  fillPoly(g, quad(rect(-.12, .12, -8.1, 60), .001), C.ginger);                   // lead-in line on the stand centreline
  if (o.stand !== false) fillPoly(g, quad(rect(-1.6, 1.6, -8.25, -7.95), .001), C.ginger);   // stop bar ahead of the nose
  // the neighbouring stand B11 (empty) and the service road: background detail, all in the marking colour, kept thin
  fillPoly(g, quad(rect(-24.12, -23.88, -8.1, 60), .001), C.ginger, .8);
  fillPoly(g, quad(rect(-25.6, -22.4, -8.25, -7.95), .001), C.ginger, .8);
  g.save(); g.strokeStyle = 'rgba(250,246,238,.95)'; g.lineWidth = 2; g.setLineDash([12, 10]);
  for (const x of [-20.2, -18.9]) { g.beginPath(); g.moveTo(...iso.P(x, -60, .001)); g.lineTo(...iso.P(x, 60, .001)); g.stroke(); }
  g.restore();
}
// a parked baggage tractor with three carts on the service road (background)
export function bagTrain(g, x, y) {
  iso.boxNow(x - .6, y - 1.6, .2, 1.2, 1.6, .7, tri(C.ginger, .25, .2));
  iso.boxNow(x - .5, y - 1.5, .9, 1.0, .7, .55, tri('#E9E2D4', .3, .18), { faceColor: { 2: '#A9BDB5', 1: '#B9CBC4' } });
  for (let k = 0; k < 3; k++) {
    const yy = y + .4 + k * 2.4;
    iso.boxNow(x - .7, yy, .35, 1.4, 2.0, .12, tri('#B9B2A5', .25, .2));
    iso.boxNow(x - .62, yy + .1, .47, 1.24, 1.8, .55, tri(['#7F98AE', '#B9824F', '#8C8199'][k], .25, .2));
  }
}

// ---------- gate ----------
export const GZ = 2.3, WALLX = 9.5;
// three painted lanes parallel to the glass, entrances at +y, all leading up to the door
export const LANES = [{ x0: WALLX + .45, x1: WALLX + 1.4, label: '9–12', en: 'ROWS 9–12' }, { x0: WALLX + 1.6, x1: WALLX + 2.55, label: '1–4', en: 'ROWS 1–4' }, { x0: WALLX + 2.75, x1: WALLX + 3.7, label: '5–8', en: 'ROWS 5–8' }];
export const LANE_Y = [-.35, 9.6];
export const laneX = i => (LANES[i].x0 + LANES[i].x1) / 2;
export const LANE1X = laneX(0);
export const CHAIR_X = [WALLX + 4.6, WALLX + 6.4, WALLX + 8.2], CHAIR_Y0 = .9, CHAIR_DY = .62;
export const chairPos = i => ({ x: CHAIR_X[Math.floor(i / 24)], y: CHAIR_Y0 + (i % 24) * CHAIR_DY });
export const DOOR_SIGN = { x: WALLX + .02, y: BR.y1 + .35, z: GZ + 2.55, w: 2.3, h: .6 };

export function gateWindow(g, o = {}) { // glass wall at x = WALLX facing +x, the door opening at the bridge, a sign over the door
  // o.h: glass height above the floor. Full (4.6 m) in the gate shots; cut away to a parapet (1.1 m) when the camera looks past it
  const a = o.a ?? 1; if (a <= 0) return;
  const hh = o.h ?? 4.6, Z0 = GZ, Z1 = GZ + hh, y0 = -10, y1 = 26, d0 = BR.y0 - .15, d1 = BR.y1 + .15, DZ = Math.min(2.45, hh);
  g.save(); g.globalAlpha *= a;
  for (const [ya, yb] of [[y0, d0], [d1, y1]]) fillPoly(g, [iso.P(WALLX, ya, Z0), iso.P(WALLX, yb, Z0), iso.P(WALLX, yb, Z1), iso.P(WALLX, ya, Z1)], C.glass, .2);
  if (hh > 2.45) fillPoly(g, [iso.P(WALLX, d0, Z0 + 2.45), iso.P(WALLX, d1, Z0 + 2.45), iso.P(WALLX, d1, Z1), iso.P(WALLX, d0, Z1)], C.glass, .2);
  g.strokeStyle = '#B9B1A2'; g.lineWidth = 2.2; g.beginPath();
  for (let y = y0; y <= y1; y += 3.2) { if (y > d0 - .05 && y < d1 + .05) continue; g.moveTo(...iso.P(WALLX, y, Z0)); g.lineTo(...iso.P(WALLX, y, Z1)); }
  g.moveTo(...iso.P(WALLX, y0, Z0 + .35)); g.lineTo(...iso.P(WALLX, y1, Z0 + .35));
  g.stroke();
  g.lineWidth = 4; g.beginPath(); g.moveTo(...iso.P(WALLX, y0, Z1)); g.lineTo(...iso.P(WALLX, y1, Z1)); g.stroke();
  g.strokeStyle = C.dark; g.lineWidth = 3.5; g.beginPath();
  for (const [y, z] of hh > 2.45 ? [[d0, Z0], [d0, Z0 + 2.45], [d1, Z0 + 2.45], [d1, Z0]] : [[d0, Z0 + hh], [d0, Z0]]) g.lineTo(...iso.P(WALLX + .01, y, z));
  if (hh <= 2.45) { g.moveTo(...iso.P(WALLX + .01, d1, Z0 + hh)); g.lineTo(...iso.P(WALLX + .01, d1, Z0)); }
  g.stroke();
  // the gate sign hanging on the glass over the door (reads up-right, at 3/4 like everything on this wall)
  const S = DOOR_SIGN;
  if (o.sign !== false && hh >= S.z - GZ + .2) onPlane(g, S.x, S.y, S.z, 'yz', g2 => {
    g2.fillStyle = C.screen; g2.beginPath(); g2.roundRect(0, -S.h, S.w, S.h, .06); g2.fill();
    g2.fillStyle = '#E9C46A'; g2.font = '700 .42px Newsreader'; g2.textBaseline = 'alphabetic'; g2.fillText('B12', .14, -.15);
    g2.fillStyle = '#EFE8DA'; g2.font = '500 .26px NotoSerifSC'; g2.fillText('登机口', 1.18, -.22);
    g2.font = '500 .13px Newsreader'; g2.fillStyle = '#B9B2A4'; g2.fillText('GATE', 1.2, -.05);
  });
  g.restore();
}
export function gateFloor(g) {
  fillPoly(g, quad(rect(WALLX, 60, -10, 60), GZ), C.carpet);
  g.save(); g.strokeStyle = 'rgba(190,165,125,.16)'; g.lineWidth = 1; g.beginPath();   // carpet tiles, 2 m
  for (let x = WALLX + 2; x < 40; x += 2) { g.moveTo(...iso.P(x, -10, GZ)); g.lineTo(...iso.P(x, 60, GZ)); }
  for (let y = -10; y < 60; y += 2) { g.moveTo(...iso.P(WALLX, y, GZ)); g.lineTo(...iso.P(40, y, GZ)); }
  g.stroke(); g.restore();
  fillPoly(g, quad(rect(WALLX, WALLX + .45, -10, 60), GZ + .001), C.carpetEdge);
  // the terminal's end: its slab edge toward the camera side is hidden, so mark the end with a low parapet
  iso.boxNow(WALLX, -10.25, GZ, 40, .25, .5, tri('#E6DDCC', .3, .18));
}
// painted queue lanes: outline + chevrons pointing to the door; only the lit lane carries colour
export function lanes(g, o = {}) {
  const a = o.a ?? 1; if (a <= 0) return;
  g.save(); g.globalAlpha *= a;
  const [ya, yb] = LANE_Y;
  LANES.forEach((L, i) => {
    const on = o.lit === i, lit = on ? (o.litA ?? 1) : 0;
    const col = css(mix(hex(mix(C.green, C.carpet, on ? .3 : .55)), C.accent, lit));
    const pts = quad(rect(L.x0, L.x1, ya, yb), GZ + .002);
    fillPoly(g, pts, hex(mix(C.carpetLane, C.accentLt, lit * .35)), on ? 1 : .6);
    g.strokeStyle = col; g.lineWidth = on ? 2.4 : 1.6; g.lineJoin = 'round';
    g.beginPath(); pts.forEach((p, j) => j ? g.lineTo(...p) : g.moveTo(...p)); g.closePath(); g.stroke();
    const xc = (L.x0 + L.x1) / 2;
    g.lineWidth = on ? 2 : 1.4;
    for (let y = ya + 1.2; y < yb - .4; y += 1.5) { g.beginPath(); g.moveTo(...iso.P(xc - .26, y + .26, GZ + .003)); g.lineTo(...iso.P(xc, y, GZ + .003)); g.lineTo(...iso.P(xc + .26, y + .26, GZ + .003)); g.stroke(); }
  });
  g.restore();
}
// group sign on a post at a lane entrance; the plate faces +x (camera) and reads up-right
export const SIGN = i => ({ x: laneX(i), y: LANE_Y[1] + .55, z: GZ + 1.08 });
export function groupSign(g, i, lit, a = 1) {
  const L = LANES[i], { x, y: yc } = SIGN(i);
  iso.add(x + yc + GZ + .5, () => {
    const gg = iso.g; gg.save(); gg.globalAlpha *= a;
    iso.boxNow(x - .14, yc - .14, GZ, .28, .28, .04, tri('#B7B0A3'));
    iso.boxNow(x - .035, yc - .035, GZ, .07, .07, 1.1, tri(C.dark, .25, .2));
    iso.boxNow(x - .03, yc - .7, GZ + 1.08, .06, 1.4, .7, tri(lit > .5 ? C.accent : '#EFE9DD', .25, .2), { faceColor: { 2: css(mix('#FAF5EC', C.accent, lit)) } });
    onPlane(gg, x + .035, yc + .64, GZ + 1.75, 'yz', g2 => {
      g2.fillStyle = css(mix(C.ink, '#FFF8EE', lit)); g2.font = '600 .4px Newsreader'; g2.textBaseline = 'alphabetic';
      g2.fillText(L.label, .1, .38); const w = g2.measureText(L.label).width;
      g2.font = '700 .34px NotoSerifSC'; g2.fillText('排', .16 + w, .38);
      g2.font = '500 .15px Newsreader'; g2.fillStyle = css(mix(C.soft, '#FFF0E6', lit)); g2.fillText(L.en, .1, .58);
    });
    gg.restore();
  }, 1);
}
export const COUNTER_SCREEN = { x: WALLX + 1.46, y: -2.95, z: GZ + 1.0, w: 1.3, h: .42 };
export function counter(g) { // boarding podium by the door, its screen faces +x
  iso.box(WALLX + .7, -4.4, GZ, .75, 1.6, 1.05, tri('#ECE5D8', .3, .18), { cull: false, decal: I => {
    const S = COUNTER_SCREEN;
    onPlane(I.g, S.x, S.y, S.z, 'yz', g2 => {
      g2.fillStyle = C.screen; g2.fillRect(0, 0, S.w, S.h);
      g2.fillStyle = '#E9C46A'; g2.font = '600 .2px Newsreader'; g2.textBaseline = 'middle'; g2.fillText('B12  07:10', .1, .22);
    });
    I.poly([I.P(WALLX + 1.451, -4.4, GZ + .55), I.P(WALLX + 1.451, -2.8, GZ + .55), I.P(WALLX + 1.451, -2.8, GZ + .6), I.P(WALLX + 1.451, -4.4, GZ + .6)], C.green);
  } });
}
// a gate chair in the pale subject green: seat, back toward +x (people face the window, −x)
const CHAIR_T = tri(C.greenLt, .25, .18);
export function gateChair(x, y) {
  iso.box(x - .22, y - .24, GZ + .36, .44, .48, .08, CHAIR_T);
  iso.box(x + .2, y - .24, GZ + .4, .08, .48, .42, CHAIR_T, { faceColor: { 0: '#F1EADD' } });
}

// ---------- the second order: one line of seat-number squares snaking through the three lanes ----------
const SQ_Y0 = -.05, SQ_Y1 = 13.0, SQ_STEP = .95;
const SNAKE = [[laneX(0), SQ_Y0], [laneX(0), SQ_Y0 + 80]];   // one straight line in lane 1, running out of frame
const SNL = [0]; for (let i = 1; i < SNAKE.length; i++) SNL.push(SNL[i - 1] + Math.hypot(SNAKE[i][0] - SNAKE[i - 1][0], SNAKE[i][1] - SNAKE[i - 1][1]));
// k-th square: position and the direction the line faces there (toward the door)
export function sqPos(k) {
  const d = k * SQ_STEP;
  for (let i = 1; i < SNAKE.length; i++) if (d <= SNL[i] || i === SNAKE.length - 1) {
    const f = (d - SNL[i - 1]) / (SNL[i] - SNL[i - 1]), [ax, ay] = SNAKE[i - 1], [bx, by] = SNAKE[i];
    const L = Math.hypot(bx - ax, by - ay); return { x: lerp(ax, bx, f), y: lerp(ay, by, f), dx: (ax - bx) / L, dy: (ay - by) / L };
  }
}
export function squares(g, labels, a = 1) {
  if (a <= 0) return;
  g.save(); g.globalAlpha *= a;
  labels.forEach((lab, k) => {
    const q = sqPos(k), h = .2, z = GZ + .003;
    g.strokeStyle = hex(mix(C.green, C.carpet, .2)); g.lineWidth = 1.5;
    g.beginPath(); quad(rect(q.x - h, q.x + h, q.y - h, q.y + h), z).forEach((p, j) => j ? g.lineTo(...p) : g.moveTo(...p)); g.closePath(); g.stroke();
    // the label sits on the front half of the square (toward the door), clear of the feet
    // the seat number is painted beside its square, on the +x side, where no body covers it
    if (lab) onPlane(g, q.x + .78, q.y + .35, z, 'xy', g2 => {
      g2.fillStyle = C.ink; g2.font = '600 .4px Newsreader'; g2.textBaseline = 'alphabetic'; g2.fillText(lab, 0, 0);
    });
  });
  g.restore();
}
export const SQ_LABEL_BOX = k => { const q = sqPos(k); return [[q.x - .25, q.y - .25], [q.x + .25, q.y + .25]]; };
