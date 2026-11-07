// Things that live in front of the board. There is no hand, no chalk stick and no eraser object:
// strokes grow by themselves; the only sign of "where the chalk is" is the growing front itself,
// a few loose grains and a faint glint. A Track is an invisible pen path used for timing and for
// the follow camera; a Wipe is the eraser's footprint moving across the board on its own.
import { clamp, lerp } from '/core/lib.js';
import { COLORS, rng } from './chalk.js';

const ss = t => { t = clamp(t); return t * t * (3 - 2 * t); };
const eo = t => 1 - Math.pow(1 - clamp(t), 3);
const css = (c, k = 1, a = 1) => `rgba(${Math.round(clamp(c[0] * k) * 255)},${Math.round(clamp(c[1] * k) * 255)},${Math.round(clamp(c[2] * k) * 255)},${a})`;

// ───────── an invisible pen: a sequence of strokes; front(t) = where the writing is now
export class Track {
  constructor(id) { this.id = id; this.jobs = []; }
  add(st) { this.jobs.push(st); this.jobs.sort((a, b) => a.t0 - b.t0); }
  front(t) {
    const J = this.jobs; if (!J.length) return null;
    if (t <= J[0].t0) return J[0].start.slice();
    for (let i = 0; i < J.length; i++) {
      const s = J[i];
      if (t <= s.t1) return s.at(s.prog(t) * s.len);
      const n = J[i + 1];
      if (n && t < n.t0) { const u = ss((t - s.t1) / (n.t0 - s.t1)); return [lerp(s.end[0], n.start[0], u), lerp(s.end[1], n.start[1], u)]; }
    }
    return J[J.length - 1].end.slice();
  }
}

// ───────── the eraser's footprint, moving on its own: [[t, x, y, ang], ...]
export class Wipe {
  // path: [[t, x, y], ...] — a smooth Catmull–Rom gesture through the keys; the footprint's long side stays across the motion
  constructor(path, o = {}) { this.path = path; this.w = o.w ?? 250; this.h = o.h ?? 100; this.t0 = path[0][0]; this.t1 = path[path.length - 1][0]; }
  pos(t) {
    const P = this.path, n = P.length; t = clamp(t, this.t0, this.t1);
    let i = 0; while (i < n - 2 && t > P[i + 1][0]) i++;
    const u = (t - P[i][0]) / (P[i + 1][0] - P[i][0]), p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(n - 1, i + 2)];
    const u2 = u * u, u3 = u2 * u, c = j => .5 * (2 * p1[j] + (-p0[j] + p2[j]) * u + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * u2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * u3);
    return [c(1), c(2)];
  }
  at(t) {
    const a = this.pos(t - .004), b = this.pos(t + .004), p = this.pos(t);
    return [p[0], p[1], Math.atan2(b[1] - a[1], b[0] - a[0]) + Math.PI / 2];
  }
}

// ───────── chalk dust: deterministic particles (positions are closed-form in time)
export class Dust {
  constructor() { this.p = []; this.puffs = []; this.sprites = {}; }
  emit(t, x, y, n, o = {}) {
    const R = rng(Math.floor(t * 1000 + x * 3 + y * 7));
    for (let i = 0; i < n; i++) {
      const a = (o.dir ?? -Math.PI / 2) + (R() - .5) * (o.spread ?? 6.28), sp = (o.speed ?? 60) * (.3 + R());
      this.p.push({ t0: t + R() * (o.dt ?? 0), x: x + (R() - .5) * (o.jx ?? 6), y: y + (R() - .5) * (o.jy ?? 6), vx: Math.cos(a) * sp + (o.vx ?? 0), vy: Math.sin(a) * sp + (o.vy ?? 0),
        life: (o.life ?? 1.2) * (.5 + R()), size: (o.size ?? 1.4) * (.5 + R() * 1.1), a: (o.a ?? .7) * (.4 + R() * .6), col: o.color || 'white', seed: R() * 100, g: (o.g ?? 90) * (.6 + R() * .8) });
    }
  }
  puff(t, x, y, r, o = {}) { this.puffs.push({ t0: t, x, y, r, life: o.life ?? .6, a: o.a ?? .25, vx: o.vx ?? 0, vy: o.vy ?? -10, grow: o.grow ?? 1.8, col: o.color || 'white' }); }
  sprite(col) {
    if (this.sprites[col]) return this.sprites[col];
    const k = COLORS[col] || COLORS.white;
    const c = new OffscreenCanvas(32, 32), x = c.getContext('2d'), g = x.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, css(k, 1.05, 1)); g.addColorStop(.35, css(k, 1, .8)); g.addColorStop(1, css(k, 1, 0));
    x.fillStyle = g; x.fillRect(0, 0, 32, 32);
    const c2 = new OffscreenCanvas(128, 128), y = c2.getContext('2d');
    for (let i = 0; i < 14; i++) {
      const R = rng(i + 5), cx = 64 + (R() - .5) * 40, cy = 64 + (R() - .5) * 40, rr = 18 + R() * 26, gg = y.createRadialGradient(cx, cy, 0, cx, cy, rr);
      gg.addColorStop(0, css(k, 1, .22)); gg.addColorStop(1, css(k, 1, 0)); y.fillStyle = gg; y.fillRect(0, 0, 128, 128);
    }
    return (this.sprites[col] = { dot: c, puff: c2 });
  }
  draw(ctx, t, cam) {
    const s = cam.s;
    for (const q of this.puffs) {
      const u = (t - q.t0) / q.life; if (u < 0 || u > 1) continue;
      const r = q.r * (1 + q.grow * eo(u)) * s, [x, y] = cam.toScreen(q.x + q.vx * u * q.life, q.y + q.vy * u * q.life);
      ctx.globalAlpha = q.a * Math.sin(Math.PI * Math.min(1, u * 4) / 2) * (1 - u) * (1 - u);
      ctx.drawImage(this.sprite(q.col).puff, x - r, y - r, r * 2, r * 2);
    }
    for (const q of this.p) {
      const tau = t - q.t0; if (tau < 0 || tau > q.life) continue;
      const k = 5, e = (1 - Math.exp(-k * tau)) / k;     // drag-damped launch, then a slow fall with a little turbulence
      const x = q.x + q.vx * e + Math.sin(tau * 3 + q.seed) * 6 * tau, y = q.y + q.vy * e + q.g * (tau - e) / k * 2.2 + Math.cos(tau * 2.3 + q.seed) * 3 * tau;
      const [sx, sy] = cam.toScreen(x, y);
      if (sx < -20 || sy < -20 || sx > cam.W + 20 || sy > cam.H + 20) continue;
      const u = tau / q.life, sz = Math.max(1.1, q.size * s * 1.8);
      ctx.globalAlpha = q.a * Math.min(1, tau * 30) * (1 - u * u);
      ctx.drawImage(this.sprite(q.col).dot, sx - sz, sy - sz, sz * 2, sz * 2);
    }
    ctx.globalAlpha = 1;
  }
}

// the writing position: a few bright grains and a faint glint right at the growing front
export function drawFront(ctx, t, cam, x, y, color, w, k = 1) {
  const [sx, sy] = cam.toScreen(x, y), s = cam.s, col = COLORS[color] || COLORS.white;
  const R = rng(Math.floor(t * 240) * 7 + 3);
  const r = Math.max(5, w * s * 1.6);
  const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, r * 1.8);
  g.addColorStop(0, css(col, 1.25, .32 * k)); g.addColorStop(.35, css(col, 1.1, .12 * k)); g.addColorStop(1, css(col, 1, 0));
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx, sy, r * 1.8, 0, 6.29); ctx.fill();
  for (let i = 0; i < 9; i++) {
    const a = R() * 6.28, d = Math.pow(R(), .7) * r * 1.3, z = .8 + R() * 1.6;
    ctx.fillStyle = css(col, 1.3, (.45 + R() * .55) * k);
    ctx.fillRect(sx + Math.cos(a) * d - z / 2, sy + Math.sin(a) * d - z / 2, z, z);
  }
  ctx.fillStyle = `rgba(255,255,250,${.75 * k})`; ctx.fillRect(sx - 1, sy - 1, 2, 2);
}

// out-of-focus motes between the lens and the board (parallax depth layer)
export function drawMotes(ctx, t, cam, W, H) {
  const R = rng(77);
  for (let i = 0; i < 22; i++) {
    const depth = .45 + R() * .5, bx = R() * 3400 - 100, by = R() * 2000 - 100;
    const px = W / 2 + (bx - cam.cx) * cam.s / depth + Math.sin(t * .35 + i) * 18, py = H / 2 + (by - cam.cy) * cam.s / depth - t * (6 + i % 5 * 3) + Math.cos(t * .27 + i * 2) * 12;
    const x = ((px % (W + 300)) + W + 300) % (W + 300) - 150, y = ((py % (H + 300)) + H + 300) % (H + 300) - 150;
    const r = (14 + R() * 38) * (1.3 - depth), light = .5 + .5 * (1 - y / H);
    const g = ctx.createRadialGradient(x, y, r * .2, x, y, r);
    const a = (.03 + R() * .035) * light;
    g.addColorStop(0, `rgba(235,240,232,${a * .7})`); g.addColorStop(.75, `rgba(235,240,232,${a})`); g.addColorStop(1, 'rgba(235,240,232,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.29); ctx.fill();
  }
}
