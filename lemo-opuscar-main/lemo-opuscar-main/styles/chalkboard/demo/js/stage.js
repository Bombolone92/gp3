// The classroom's front wall, baked once. World units: the board's slate is x 0…6400, y 0…1700.
// A fixed back board spans the whole width; two front panels slide on their own tracks in front of it:
// FL starts over x 0…3200 and slides right over FR (x 3200…6400), uncovering the back board's left half.
// A freshly wiped board: one even deep ink green with its own fine grain and very slow mottling, nothing else.
import { clamp } from '/core/lib.js';
import { rng, n1 } from './chalk.js';

export const BW = 6400, BH = 1700, PW = 3200;            // board, panel width
export const WALL = [-1500, -1500, 9400, 4900];          // x0, y0, w, h
export const WALL_R = .5;                                 // px per unit for the wall bake
export const SLATE_R = 1;                                 // px per unit for the slates

export const css = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

// a smooth noise image whose alpha is the noise (fixed colour); scaled up it stays smooth
function noiseLayer(w, h, seed, rgb, aMax, pow = 1) {
  const o = new OffscreenCanvas(w, h), x = o.getContext('2d'), img = x.createImageData(w, h), R = rng(seed);
  const g = Array.from({ length: (w + 2) * (h + 2) }, R);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const v = (g[j * (w + 2) + i] + g[(j + 1) * (w + 2) + i + 1] + g[(j + 2) * (w + 2) + i + 2] + g[j * (w + 2) + i + 2]) / 4, q = 4 * (j * w + i);
    img.data[q] = rgb[0]; img.data[q + 1] = rgb[1]; img.data[q + 2] = rgb[2]; img.data[q + 3] = Math.round(Math.pow(clamp((v - .2) / .6), pow) * aMax * 255);
  }
  x.putImageData(img, 0, 0); return o;
}

// one slate (board units, origin at its top-left), with optional wooden edge strips on its sides
export function bakeSlate(w, h, seed, edges = false) {
  const R = SLATE_R, m = edges ? 34 : 0, cv = new OffscreenCanvas(Math.ceil((w + 2 * m) * R), Math.ceil(h * R)), c = cv.getContext('2d');
  c.scale(R, R); c.translate(m, 0); c.imageSmoothingQuality = 'high';
  c.fillStyle = '#0f1c15'; c.fillRect(0, 0, w, h);
  // very slow, very low mottling: the paint is even, not patchy
  c.drawImage(noiseLayer(Math.ceil(w / 260), Math.ceil(h / 260), seed, [22, 36, 29], .5), 0, 0, w, h);
  c.drawImage(noiseLayer(Math.ceil(w / 60), Math.ceil(h / 60), seed + 1, [10, 18, 14], .28), 0, 0, w, h);
  if (edges) {                                         // the panel's own wooden stiles
    for (const x0 of [-m, w]) wood(c, x0, 0, m, h, false, seed + (x0 < 0 ? 5 : 6));
    for (const x0 of [0, w - 26]) { const g = c.createLinearGradient(x0, 0, x0 + 26, 0); const L = x0 === 0; g.addColorStop(0, `rgba(0,0,0,${L ? .38 : 0})`); g.addColorStop(1, `rgba(0,0,0,${L ? 0 : .38})`); c.fillStyle = g; c.fillRect(x0, 0, 26, h); }
  }
  return { cv, m, w, h };
}

function wood(c, x, y, w, h, horiz, seed, base = '#6a4a2e') {
  const R = rng(seed); c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip();
  c.fillStyle = base; c.fillRect(x, y, w, h);
  for (let i = 0; i < 60; i++) {
    const t = R(), a = .04 + R() * .1, lw = .6 + R() * 2.2; c.strokeStyle = R() < .5 ? `rgba(40,22,10,${a})` : `rgba(160,118,74,${a})`; c.lineWidth = lw; c.beginPath();
    if (horiz) { const yy = y + t * h; c.moveTo(x, yy); for (let k = 1; k <= 24; k++) c.lineTo(x + w * k / 24, yy + (n1(k * .7 + i, seed) - .5) * 4); }
    else { const xx = x + t * w; c.moveTo(xx, y); for (let k = 1; k <= 24; k++) c.lineTo(xx + (n1(k * .7 + i, seed) - .5) * 4, y + h * k / 24); }
    c.stroke();
  }
  const g = horiz ? c.createLinearGradient(0, y, 0, y + h) : c.createLinearGradient(x, 0, x + w, 0);
  g.addColorStop(0, 'rgba(255,225,180,.16)'); g.addColorStop(.45, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.28)');
  c.fillStyle = g; c.fillRect(x, y, w, h); c.restore();
}

// chalk stick lying in the tray (world units)
function chalkStick(c, x, y, len, r, col, ang = 0) {
  c.save(); c.translate(x, y); c.rotate(ang);
  c.save(); c.filter = 'blur(3px)'; c.fillStyle = 'rgba(0,0,0,.35)'; c.beginPath(); c.ellipse(4, r * .9, len / 2, r * .45, 0, 0, 6.29); c.fill(); c.restore();
  const g = c.createLinearGradient(0, -r, 0, r);
  g.addColorStop(0, css(col.map(v => Math.min(255, v + 20)))); g.addColorStop(.45, css(col)); g.addColorStop(1, css(col.map(v => v * .62)));
  c.fillStyle = g; c.beginPath(); c.roundRect(-len / 2, -r, len, 2 * r, r * .5); c.fill();
  c.fillStyle = css(col.map(v => v * .8)); c.beginPath(); c.ellipse(len / 2 - r * .25, 0, r * .3, r * .95, 0, 0, 6.29); c.fill();
  c.restore();
}

// the wall, frame, tray, clock (static). Returns {cv} covering WALL at WALL_R px per unit.
export function bakeWall() {
  const [X0, Y0, W, H] = WALL, R = WALL_R, cv = new OffscreenCanvas(Math.ceil(W * R), Math.ceil(H * R)), c = cv.getContext('2d');
  c.scale(R, R); c.translate(-X0, -Y0); c.imageSmoothingQuality = 'high';
  // upper wall: warm white paint; lower: the classroom's green dado
  c.fillStyle = '#bdb8a8'; c.fillRect(X0, Y0, W, H);
  c.drawImage(noiseLayer(90, 50, 31, [205, 200, 186], .5), X0, Y0, W, H);
  c.drawImage(noiseLayer(400, 220, 32, [150, 146, 134], .12), X0, Y0, W, H);
  const DY = 2380;
  c.fillStyle = '#56705f'; c.fillRect(X0, DY, W, Y0 + H - DY);
  c.drawImage(noiseLayer(90, 20, 33, [70, 90, 76], .45), X0, DY, W, Y0 + H - DY);
  c.fillStyle = 'rgba(30,40,34,.5)'; c.fillRect(X0, DY - 6, W, 10);
  c.fillStyle = 'rgba(255,255,240,.18)'; c.fillRect(X0, DY + 4, W, 3);
  // the board unit's shadow on the wall (light from the windows on the left, a little from above)
  c.save(); c.filter = 'blur(40px)'; c.fillStyle = 'rgba(30,26,20,.45)'; c.fillRect(-40, -40, BW + 150, BH + 230); c.restore();
  // frame: four rails
  const F = 70;
  c.fillStyle = '#0b130f'; c.fillRect(0, 0, BW, BH);
  wood(c, -F, -F, BW + 2 * F, F, true, 1); wood(c, -F, BH, BW + 2 * F, F, true, 2); wood(c, -F, 0, F, BH, false, 3); wood(c, BW, 0, F, BH, false, 4);
  c.strokeStyle = 'rgba(0,0,0,.55)'; c.lineWidth = 3; c.strokeRect(-1.5, -1.5, BW + 3, BH + 3);
  // chalk tray: a shelf under the bottom rail, its top face catching light
  const TY = BH + F;
  c.save(); c.filter = 'blur(12px)'; c.fillStyle = 'rgba(0,0,0,.45)'; c.fillRect(-F - 30, TY + 40, BW + 2 * F + 60, 46); c.restore();
  wood(c, -F - 30, TY, BW + 2 * F + 60, 34, true, 5, '#7a5838'); wood(c, -F - 30, TY + 34, BW + 2 * F + 60, 40, true, 6, '#5d4128');
  c.fillStyle = 'rgba(255,236,200,.16)'; c.fillRect(-F - 30, TY + 34, BW + 2 * F + 60, 3);
  { const r = rng(19); for (let i = 0; i < 260; i++) { const x = -F + r() * (BW + 2 * F), y = TY + 6 + r() * 24, s = .8 + r() * 2; c.fillStyle = `rgba(230,228,220,${.06 + r() * .14})`; c.fillRect(x, y, s * 2, s); } }
  chalkStick(c, 900, TY + 17, 92, 9, [236, 233, 222], -.04);
  chalkStick(c, 1010, TY + 19, 70, 9, [236, 233, 222], .03);
  chalkStick(c, 1105, TY + 18, 36, 9, [240, 150, 86], .1);           // the short orange stub
  chalkStick(c, 5600, TY + 18, 88, 9, [236, 233, 222], .02);
  // wall clock above the middle of the board: 7:58
  const cx = 3200, cy = -560, rr = 200;
  c.save(); c.filter = 'blur(14px)'; c.fillStyle = 'rgba(30,26,20,.4)'; c.beginPath(); c.arc(cx + 14, cy + 18, rr + 8, 0, 6.29); c.fill(); c.restore();
  c.fillStyle = '#2a2a28'; c.beginPath(); c.arc(cx, cy, rr + 16, 0, 6.29); c.fill();
  const fg = c.createRadialGradient(cx - 40, cy - 60, 10, cx, cy, rr); fg.addColorStop(0, '#f6f3ea'); fg.addColorStop(1, '#d9d4c6');
  c.fillStyle = fg; c.beginPath(); c.arc(cx, cy, rr, 0, 6.29); c.fill();
  c.strokeStyle = '#2b2b29'; c.lineCap = 'round';
  for (let i = 0; i < 60; i++) { const a = i / 60 * 6.2832, big = i % 5 === 0; c.lineWidth = big ? 9 : 3; c.beginPath(); c.moveTo(cx + Math.sin(a) * rr * (big ? .78 : .86), cy - Math.cos(a) * rr * (big ? .78 : .86)); c.lineTo(cx + Math.sin(a) * rr * .92, cy - Math.cos(a) * rr * .92); c.stroke(); }
  const hand = (a, l, w, col = '#222') => { c.strokeStyle = col; c.lineWidth = w; c.beginPath(); c.moveTo(cx - Math.sin(a) * l * .15, cy + Math.cos(a) * l * .15); c.lineTo(cx + Math.sin(a) * l, cy - Math.cos(a) * l); c.stroke(); };
  hand((7 + 58 / 60) / 12 * 6.2832, rr * .5, 14); hand(58 / 60 * 6.2832, rr * .78, 9);
  c.fillStyle = '#222'; c.beginPath(); c.arc(cx, cy, 12, 0, 6.29); c.fill();
  const gl = c.createLinearGradient(cx - rr, cy - rr, cx + rr, cy + rr); gl.addColorStop(0, 'rgba(255,255,255,.22)'); gl.addColorStop(.4, 'rgba(255,255,255,0)');
  c.fillStyle = gl; c.beginPath(); c.arc(cx, cy, rr, 0, 6.29); c.fill();
  return { cv };
}

// the painted tian-zi grid on the front panel: a permanent, dull ochre line under the chalk (panel-local units)
export function paintGrid(c, cx, cy, size, a = 1) {
  const h = size / 2;
  c.save(); c.globalAlpha = a;
  c.strokeStyle = 'rgba(196,176,112,.36)'; c.lineWidth = 5; c.strokeRect(cx - h, cy - h, size, size);
  c.setLineDash([size / 34, size / 46]); c.lineWidth = 3; c.strokeStyle = 'rgba(196,176,112,.24)';
  c.beginPath(); c.moveTo(cx - h, cy); c.lineTo(cx + h, cy); c.moveTo(cx, cy - h); c.lineTo(cx, cy + h); c.stroke();
  c.restore();
}
