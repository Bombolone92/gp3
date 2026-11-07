// Board renderer: draws one board (a world module) through a world -> screen camera, PCB layers bottom-up:
// laminate, copper pour with clearances (rim + fill), traces, exposed metal, silkscreen, then light
// (water in silver, current in amber) on an additive layer with a two-radius bloom.
// Level of detail: textures crossfade between octaves; small features fade before they go sub-pixel.
import { drawText, layout } from './font.js';
import { sub, at, measure, offset } from './geo.js';
import { PAL, rgb } from './palette.js';

let W = 1920, H = 1080;
export function setSize(w, h) { W = w; H = h; }
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };

// ---------- camera ----------
export function camMatrix(cam) {
  const s = cam.z, co = Math.cos(cam.r || 0), si = Math.sin(cam.r || 0);
  const a = s * co, b = s * si, c = -s * si, d = s * co;
  return [a, b, c, d, W / 2 - (a * cam.x + c * cam.y), H / 2 - (b * cam.x + d * cam.y)];
}
export const toScreen = (M, p) => [M[0] * p[0] + M[2] * p[1] + M[4], M[1] * p[0] + M[3] * p[1] + M[5]];
export function camFor(p, s, z, r = 0) {
  const dx = (s[0] - W / 2) / z, dy = (s[1] - H / 2) / z, co = Math.cos(-r), si = Math.sin(-r);
  return { x: p[0] - (co * dx - si * dy), y: p[1] - (si * dx + co * dy), z, r };
}
function viewBox(cam, pad = 0) { const r = Math.hypot(W, H) / 2 / cam.z + pad; return [cam.x - r, cam.y - r, cam.x + r, cam.y + r]; }

// ---------- textures ----------
function makeWeave(P) {
  const T = 64, cv = new OffscreenCanvas(T, T), g = cv.getContext('2d');
  g.fillStyle = P.bg; g.fillRect(0, 0, T, T);
  const h = T / 2;
  for (let by = 0; by < 2; by++) for (let bx = 0; bx < 2; bx++) {
    const horiz = (bx + by) % 2 === 0, x0 = bx * h, y0 = by * h;
    for (let i = 0; i < 7; i++) {
      const o = 3 + i * 4.2; g.strokeStyle = i % 2 ? P.weaveA : P.weaveA2; g.lineWidth = 2.2; g.beginPath();
      if (horiz) { g.moveTo(x0 + 1, y0 + o); g.lineTo(x0 + h - 1, y0 + o); } else { g.moveTo(x0 + o, y0 + 1); g.lineTo(x0 + o, y0 + h - 1); }
      g.stroke();
    }
    g.strokeStyle = P.weaveB; g.lineWidth = 1.2; g.strokeRect(x0 + 0.5, y0 + 0.5, h - 1, h - 1);
  }
  return cv;
}
function makeSpeckle(n, seed, rmin, rmax, T = 256) {
  const cv = new OffscreenCanvas(T, T), g = cv.getContext('2d');
  let s = seed; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  g.fillStyle = '#000';
  for (let i = 0; i < n; i++) { const r = rmin + rnd() * (rmax - rmin); g.beginPath(); g.arc(rnd() * T, rnd() * T, r, 0, 6.2832); g.fill(); }
  return cv;
}
function makeMaskTex() {   // solder mask: very soft mottling, so big pours aren't flat
  const T = 256, cv = new OffscreenCanvas(T, T), g = cv.getContext('2d');
  let s = 7; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 1400; i++) { const r = 3 + rnd() * 10; g.fillStyle = `rgba(${rnd() < 0.5 ? '255,255,255' : '0,0,0'},${0.006 + rnd() * 0.009})`; g.beginPath(); g.arc(rnd() * T, rnd() * T, r, 0, 6.2832); g.fill(); }
  return cv;
}
function octaves(base, z, target) { const s = Math.log(target / (base * z)) / Math.log(4), k = Math.floor(s); return [[base * Math.pow(4, k), 1], [base * Math.pow(4, k + 1), s - k]]; }

export class Board {
  constructor(canvas, world, opts = {}) {
    this.cv = canvas; this.ctx = canvas.getContext('2d'); this.w = world; this.o = opts;
    const mk = () => { const c = new OffscreenCanvas(W, H); return [c, c.getContext('2d')]; };
    [this.cuA, this.gA] = mk(); [this.cuB, this.gB] = mk(); [this.silk, this.sctx] = mk(); [this.glow, this.gctx] = mk();
    this.weave = makeWeave(PAL); this.pin = makeSpeckle(260, 11, 0.6, 1.6); this.mtex = makeMaskTex();
    this.u = opts.unit || 1;          // a typical feature size (world units), used for LOD thresholds
    this.chans = [...(world.RIVER || []), ...(world.TAIL ? [world.TAIL] : [])].map(c => ({ ...c, m: measure(c.pts) }));
    this.pens = (world.PENS || []).map(c => ({ ...c, m: measure(c.pts) }));
    this.resFlow = (world.RES_FLOW || []).map(c => ({ ...c, m: measure(c.pts) }));
    for (const c of [...this.chans, ...this.pens, ...this.resFlow]) c.lines = [-0.34, -0.2, -0.07, 0.07, 0.2, 0.34].map(f => offset(c.pts, f * c.w));
    this.fence = world.fence ? world.fence() : [];
    this.stitch = world.stitch ? world.stitch() : [];
  }
  pattern(ctx, img, M, unit) { const pat = ctx.createPattern(img, 'repeat'), k = unit / img.width; pat.setTransform(new DOMMatrix([M[0] * k, M[1] * k, M[2] * k, M[3] * k, M[4], M[5]])); return pat; }
  boardPath(ctx, inset = 0) {
    const B = this.w.BOARD, i = inset, r = Math.max(0.5, B.r - i);
    if (!B.cut) { ctx.beginPath(); ctx.roundRect(B.x0 + i, B.y0 + i, B.x1 - B.x0 - 2 * i, B.y1 - B.y0 - 2 * i, r); return; }
    // board with its south-east corner cut off at 45° (B.cut units along each edge), every corner rounded
    const k = B.cut + i * Math.SQRT2 - 2 * i, x0 = B.x0 + i, y0 = B.y0 + i, x1 = B.x1 - i, y1 = B.y1 - i;
    const v = [[x0, y0], [x1, y0], [x1, y1 - k], [x1 - k, y1], [x0, y1]];
    ctx.beginPath(); ctx.moveTo((x0 + x1) / 2, y0);
    for (let n = 1; n <= v.length; n++) { const a = v[n % v.length], b = v[(n + 1) % v.length]; ctx.arcTo(a[0], a[1], b[0], b[1], r); }
    ctx.closePath();
  }

  // copper pour minus every clearance, `e` = extra clearance (the rim pass uses e > 0)
  copper(g, M, vb, z, e, color) {
    const Wd = this.w, clr = (Wd.CLR ?? 4) + e;
    g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'source-over'; g.clearRect(0, 0, W, H);
    g.setTransform(...M); g.fillStyle = color; this.boardPath(g, Wd.BOARD.inset + e); g.fill();
    g.globalCompositeOperation = 'destination-out'; g.fillStyle = '#000'; g.strokeStyle = '#000'; g.lineJoin = 'miter'; g.lineCap = 'butt'; g.miterLimit = 3;
    if (Wd.SEA) { poly(g, Wd.SEA); g.closePath(); g.lineWidth = 2 * e; g.fill(); if (e) g.stroke(); }
    for (const L of Wd.LAKES || []) { poly(g, L); g.closePath(); g.fill(); g.lineWidth = 2 * (clr * 0.6 + e); g.stroke(); }
    if (Wd.RESERVOIR) { poly(g, Wd.RESERVOIR); g.closePath(); g.fill(); g.lineWidth = 2 * (clr * 0.6 + e); g.stroke(); }
    for (const c of this.chans) { if (!inView(c, vb)) continue; g.lineWidth = c.w + 2 * (clr * 0.6 + e); poly(g, c.pts); g.stroke(); }
    for (const c of this.pens) { g.lineWidth = c.w + 2 * (clr * 0.45 + e); poly(g, c.pts); g.stroke(); }
    for (const c of Wd.STREETS || []) { g.lineWidth = c.w + 2 * (clr * 0.5 + e); poly(g, c.pts); g.stroke(); }
    for (const c of Wd.SLOTS || []) { g.lineCap = 'round'; g.lineWidth = c.w + 2 * (clr + e); poly(g, c.pts); g.stroke(); g.lineCap = 'butt'; }
    for (const h of Wd.HOLES_OVAL || []) { g.beginPath(); g.ellipse(h[0], h[1], 6 + clr + e, 13 + clr + e, 0, 0, 6.2832); g.fill(); }
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const t of Wd.TRACES) { if (t.layer === 'bottom' || !inView(t, vb)) continue; g.lineWidth = t.w + 2 * clr * (t.clrK ?? 1); poly(g, t.pts); g.stroke(); }
    for (const c of Wd.CLEARLINES || []) { g.lineWidth = c.w + 2 * e; g.lineJoin = 'miter'; poly(g, c.pts); g.stroke(); g.lineJoin = 'round'; }
    for (const p of Wd.PADS) padPath(g, p, clr * 0.8), g.fill();
    for (const k of Wd.KEEP || []) { keepPath(g, k, clr * 0.5 + e); g.fill(); }
    for (const v of Wd.VIAS || []) { circle(g, v[0], v[1], v[2] + clr * 0.6); g.fill(); }
    if (Wd.DAM) { const Dm = Wd.DAM; g.beginPath(); g.rect(Dm.x0 - clr, Dm.y0 - clr, Dm.x1 - Dm.x0 + 2 * clr, Dm.y1 - Dm.y0 + 2 * clr); g.fill(); }
    for (const h of Wd.HOLES || []) { circle(g, h[0], h[1], (Wd.HOLE_R || 30) * 1.45 + e); g.fill(); }
    for (const f of Wd.FIDS || []) { circle(g, f[0], f[1], (Wd.FID_R || 8) * 2.4 + e); g.fill(); }
    g.globalCompositeOperation = 'source-over';
  }

  // ---- main frame ----
  frame(cam, sc) {
    const { ctx } = this, P = PAL, M = camMatrix(cam), z = cam.z, vb = viewBox(cam, 60 / z), Wd = this.w, B = Wd.BOARD;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'none';
    const bw = (B.x1 - B.x0) * 0.04;
    const edgeVisible = vb[0] < B.x0 + bw || vb[2] > B.x1 - bw || vb[1] < B.y0 + bw || vb[3] > B.y1 - bw || (B.cut && vb[2] + vb[3] > B.x1 + B.y1 - B.cut - 2 * bw);
    if (edgeVisible) {
      this.desk(ctx, cam, M, z, sc);
      ctx.save(); ctx.setTransform(...M); this.boardPath(ctx); ctx.restore(); ctx.save(); ctx.clip();
    } else ctx.save();

    // laminate (two weave octaves) + bottom-layer traces seen through it
    const u = this.u, [o1, o2] = octaves(u * 0.75, z, 11.1);
    ctx.fillStyle = this.pattern(ctx, this.weave, M, o1[0]); ctx.fillRect(0, 0, W, H);
    if (o2[1] > 0.01) { ctx.globalAlpha = o2[1]; ctx.fillStyle = this.pattern(ctx, this.weave, M, o2[0]); ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
    ctx.setTransform(...M); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const t of Wd.TRACES) if (t.layer === 'bottom') { poly(ctx, t.pts); ctx.strokeStyle = P.under; ctx.lineWidth = t.w; ctx.stroke(); }
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // copper pour: rim pass, then fill pass inset by the rim width
    const rim = 1.6 / z;
    this.copper(this.gA, M, vb, z, 0, P.pour.rim);
    this.copper(this.gB, M, vb, z, rim, P.pour.fill);
    { const g = this.gB; g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'source-atop';      // mask mottling on the pour
      const [m1] = octaves(this.u * 9, z, 220); g.fillStyle = this.pattern(g, this.mtex, M, m1[0]); g.fillRect(0, 0, W, H); g.globalCompositeOperation = 'source-over'; }
    ctx.drawImage(this.cuA, 0, 0); ctx.drawImage(this.cuB, 0, 0);
    ctx.setTransform(...M);
    // via fences and stitching (on the pour)
    const fa = sstep(0.8, 2.2, (Wd.VIA_R || 2) * z);
    if (fa > 0.01) {
      ctx.globalAlpha = fa;
      const vr = (pts, r) => { for (const [x, y] of pts) { if (x < vb[0] || x > vb[2] || y < vb[1] || y > vb[3]) continue; circle(ctx, x, y, r); ctx.fillStyle = P.fence.ring; ctx.fill(); circle(ctx, x, y, r * 0.48); ctx.fillStyle = P.fence.hole; ctx.fill(); } };
      vr(this.stitch, Wd.VIA_R || 2); vr(this.fence, Wd.FENCE_R || Wd.VIA_R || 2);
      ctx.globalAlpha = 1;
    }
    // traces
    for (const t of Wd.TRACES) if (t.layer !== 'bottom' && inView(t, vb)) this.trace(ctx, t.pts, t.w, z);
    // exposed metal: the dam bar, pads, vias, holes
    if (Wd.DAM) this.damBar(ctx, z, sc);
    for (const p of Wd.PADS) this.pad(ctx, p, z, 0);
    for (const g of Wd.GENS || []) this.pad(ctx, g, z, sc.gens ? sc.gens[g.id] || 0 : 0);
    for (const v of Wd.VIAS || []) this.via(ctx, v, z);
    if (Wd.TPADS) this.tpads(ctx, z, vb, Wd.TPADS);
    for (const c of Wd.SLOTS || []) { poly(ctx, c.pts); ctx.lineCap = 'round'; ctx.lineWidth = c.w; ctx.strokeStyle = PAL.desk; ctx.stroke(); }
    for (const h of Wd.HOLES_OVAL || []) {
      ctx.beginPath(); ctx.ellipse(h[0], h[1], 6, 13, 0, 0, 6.2832); ctx.fillStyle = '#7A5A2A'; ctx.fill();
      const gr = ctx.createRadialGradient(h[0] - 1, h[1] - 3, 0.5, h[0], h[1], 12); gr.addColorStop(0, '#0B1A12'); gr.addColorStop(1, '#010302');
      ctx.beginPath(); ctx.ellipse(h[0], h[1], 4.8, 11.6, 0, 0, 6.2832); ctx.fillStyle = gr; ctx.fill();
    }
    for (const h of Wd.HOLES || []) this.hole(ctx, h, Wd.HOLE_R || 30, z);
    for (const f of Wd.FIDS || []) { circle(ctx, f[0], f[1], Wd.FID_R || 8); ctx.fillStyle = P.pad.fill; ctx.fill(); }

    // silkscreen
    this.silkLayer(M, z, sc, vb);
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.filter = 'blur(0.35px)'; ctx.drawImage(this.silk, 0, 0); ctx.filter = 'none';

    // light
    this.glowLayer(M, z, sc, vb);
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalCompositeOperation = 'lighter';
    ctx.filter = 'blur(24px)'; ctx.globalAlpha = 0.9; ctx.drawImage(this.glow, 0, 0);
    ctx.filter = 'blur(5px)'; ctx.globalAlpha = 0.85; ctx.drawImage(this.glow, 0, 0);
    ctx.filter = 'none'; ctx.globalAlpha = 1; ctx.drawImage(this.glow, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    if (Wd.DAM) { ctx.setTransform(...M); this.damBar(ctx, z, sc); ctx.setTransform(1, 0, 0, 1, 0, 0); }   // the penstocks run under the dam
    if (sc.after) sc.after(ctx, M, z);
    ctx.restore();

  }

  desk(ctx, cam, M, z, sc) {
    ctx.fillStyle = PAL.desk; ctx.fillRect(0, 0, W, H);
    const dg = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W * 0.7);
    dg.addColorStop(0, PAL.deskHi); dg.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = dg; ctx.fillRect(0, 0, W, H);
    ctx.save(); ctx.setTransform(...M); ctx.filter = `blur(${Math.max(4, 22)}px)`;
    ctx.translate(14 / z, 22 / z); this.boardPath(ctx); ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fill(); ctx.restore(); ctx.filter = 'none';
  }
  windowLight(ctx, M, z, L) {   // a parallelogram of noon light with a mullion shadow, in board space
    ctx.save(); ctx.setTransform(...M); ctx.globalCompositeOperation = 'soft-light';
    const q = L.quad; ctx.beginPath(); ctx.moveTo(...q[0]); for (const p of q.slice(1)) ctx.lineTo(...p); ctx.closePath();
    ctx.fillStyle = `rgba(255,236,196,${L.a})`; ctx.filter = `blur(${L.soft}px)`; ctx.fill(); ctx.restore();
  }

  trace(ctx, pts, w, z) {
    const P = PAL; poly(ctx, pts);
    if (w * z < 2.2) { ctx.strokeStyle = P.trace.rim; ctx.lineWidth = w; ctx.stroke(); return; }
    ctx.strokeStyle = P.trace.rim; ctx.lineWidth = w; ctx.stroke();
    ctx.strokeStyle = P.trace.fill; ctx.lineWidth = Math.max(w - 2.2 / z, w * 0.55); ctx.stroke();
  }
  pad(ctx, p, z, lit) {
    const P = PAL, st = P.pad;
    padPath(ctx, p, 0); ctx.fillStyle = st.fill; ctx.fill();
    ctx.lineWidth = Math.min(p.r ?? 1, 1.2 / z); ctx.strokeStyle = st.edge; ctx.stroke();
    ctx.save(); ctx.clip();
    const h = p.h ?? 2 * p.r, w_ = p.w ?? 2 * p.r;
    ctx.fillStyle = st.sheen; ctx.fillRect(p.x - w_ / 2, p.y - h / 2, w_, h * 0.34);
    if (lit > 0) { ctx.fillStyle = `rgba(255,236,170,${0.85 * lit})`; ctx.fillRect(p.x - w_, p.y - h, 2 * w_, 2 * h); }
    ctx.restore();
    if (p.hole) { circle(ctx, p.x, p.y, p.hole); ctx.fillStyle = st.hole; ctx.fill(); }
  }
  tpads(ctx, z, vb, list) {
    const P = PAL, small = 2.2 * z < 1.6;
    ctx.fillStyle = P.pad.fill;
    for (const p of list) {
      if (p.x < vb[0] || p.x > vb[2] || p.y < vb[1] || p.y > vb[3]) continue;
      if (small) { ctx.globalAlpha = 0.55; ctx.fillRect(p.x - p.w / 2, p.y - p.h / 2, p.w, p.h); ctx.globalAlpha = 1; continue; }
      if (p.r && p.w * z > 12) { ctx.beginPath(); ctx.roundRect(p.x - p.w / 2, p.y - p.h / 2, p.w, p.h, p.r); ctx.fill(); } else ctx.fillRect(p.x - p.w / 2, p.y - p.h / 2, p.w, p.h);
    }
    if (!small) { ctx.fillStyle = P.pad.sheen; for (const p of list) { if (p.x < vb[0] || p.x > vb[2] || p.y < vb[1] || p.y > vb[3]) continue; ctx.fillRect(p.x - p.w / 2, p.y - p.h / 2, p.w, p.h * 0.32); } }
  }
  via(ctx, v, z) { circle(ctx, v[0], v[1], v[2]); ctx.fillStyle = PAL.pad.fill; ctx.fill(); circle(ctx, v[0], v[1], v[3]); ctx.fillStyle = PAL.pad.hole; ctx.fill(); }
  hole(ctx, h, r, z) {
    circle(ctx, h[0], h[1], r * 1.25); ctx.fillStyle = PAL.pad.fill; ctx.fill();
    circle(ctx, h[0], h[1], r * 0.8); ctx.fillStyle = PAL.desk; ctx.fill();
  }
  damBar(ctx, z, sc) {
    const Dm = this.w.DAM, P = PAL;
    const g = ctx.createLinearGradient(0, Dm.y0, 0, Dm.y1);
    g.addColorStop(0, P.copper.hi); g.addColorStop(0.35, P.copper.mid); g.addColorStop(1, P.copper.lo);
    ctx.beginPath(); ctx.rect(Dm.x0, Dm.y0, Dm.x1 - Dm.x0, Dm.y1 - Dm.y0); ctx.fillStyle = g; ctx.fill();
    ctx.lineWidth = 1 / z; ctx.strokeStyle = P.copper.edge; ctx.stroke();
    // brushed streaks
    ctx.save(); ctx.clip(); ctx.globalAlpha = 0.18; ctx.strokeStyle = '#fff1dc'; ctx.lineWidth = 0.6 / z;
    for (let i = 0; i < 40; i++) { const y = Dm.y0 + (Dm.y1 - Dm.y0) * ((i * 0.618) % 1); ctx.beginPath(); ctx.moveTo(Dm.x0, y); ctx.lineTo(Dm.x1, y); ctx.stroke(); }
    ctx.restore();
  }

  silkLayer(M, z, sc, vb) {
    const g = this.sctx, Wd = this.w, P = PAL;
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, W, H); g.setTransform(...M);
    g.strokeStyle = P.silk; g.fillStyle = P.silk; g.lineCap = 'round'; g.lineJoin = 'round';
    const prog = id => id ? (sc.labels?.[id] ?? 0) : 1;
    for (const s of Wd.SILK || []) {
      const pr = prog(s.plot); if (pr <= 0) continue;
      if (s.w * z < 0.25) continue;
      g.globalAlpha = sstep(0.25, 0.7, s.w * z);
      g.lineWidth = s.w;
      if (s.circle) { g.beginPath(); g.arc(s.circle[0], s.circle[1], s.circle[2], 0, 6.2832 * pr); g.stroke(); continue; }
      if (s.tilde) { const [x, y] = s.tilde, k = s.s; g.beginPath(); g.moveTo(x, y + k * 0.25); g.lineTo(x + k * 0.25, y); g.lineTo(x + k * 0.5, y + k * 0.25); g.lineTo(x + k * 0.75, y + k * 0.5); g.lineTo(x + k, y + k * 0.25); g.stroke(); continue; }
      if (s.dash) g.setLineDash(s.dash);
      const pts = pr < 1 ? sub(measureCache(s), 0, measureCache(s).len * pr) : s.pts;
      if (pts.length > 1) { poly(g, pts); if (s.fill) { g.closePath(); g.fill(); } else g.stroke(); }
      if (s.dash) g.setLineDash([]);
    }
    g.globalAlpha = 1;
    // board furniture
    if (Wd.HOLES) for (const h of Wd.HOLES) { g.lineWidth = (Wd.HOLE_R || 30) * 0.12; g.beginPath(); g.arc(h[0], h[1], (Wd.HOLE_R || 30) * 1.55, 0, 6.2832); g.stroke(); }
    if (Wd.TITLE && (sc.labels?.titleBox ?? 0) > 0) this.titleBlock(g, Wd.TITLE, sc.labels.titleBox);
    // designators: fade when too small
    for (const d of this.o.noDesig ? [] : Wd.DESIG || []) { const a = sstep(5, 9, d.cap * z); if (a < 0.01) continue; g.globalAlpha = a; drawText(g, d.text, d.x, d.y, d.cap, { align: d.align, weight: 0.16 }); }
    g.globalAlpha = 1;
    // labels, plotted stroke by stroke
    for (const L of Wd.LABELS || []) {
      const pr = sc.labels?.[L.id] ?? 0; if (pr <= 0) continue;
      if (L.cap * z < 2) continue;
      g.strokeStyle = P.silk;
      drawText(g, L.text, L.x, L.y, L.cap, { align: L.align, sw: L.sw, progress: pr });
      if (L.tag) { g.lineWidth = L.tag.w; const fr = L.tag.frame, m = measureCache({ pts: fr }); const pts = sub(m, 0, m.len * Math.min(1, pr * 1.3)); if (pts.length > 1) { poly(g, pts); g.stroke(); } }
    }
    // print texture: pinholes
    g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'destination-out';
    const [p1, p2] = octaves(this.u * 3, z, 89);
    g.globalAlpha = 1 - p2[1]; g.fillStyle = this.pattern(g, this.pin, M, p1[0]); g.fillRect(0, 0, W, H);
    g.globalAlpha = p2[1]; g.fillStyle = this.pattern(g, this.pin, M, p2[0]); g.fillRect(0, 0, W, H);
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  }
  titleBlock(g, T, pr) { g.lineWidth = T.h * 0.03; g.strokeRect(T.x, T.y, T.w * pr, T.h); }

  glowLayer(M, z, sc, vb) {
    const g = this.gctx, P = PAL;
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, W, H); g.setTransform(...M);
    g.lineCap = 'round'; g.lineJoin = 'round'; g.globalCompositeOperation = 'lighter';
    const t = sc.t || 0;
    // ---- water (silver) ----
    if (sc.water) {
      const wa = sc.water;
      if (wa.res > 0 && this.w.RESERVOIR) { poly(g, this.w.RESERVOIR); g.closePath(); g.fillStyle = rgb(P.water.g, 0.07 * wa.res); g.fill(); }
      for (const c of this.chans) { const a = (c.id === 'tail' ? wa.tail : c.id === 'jinsha' ? wa.up : wa.river) ?? wa.river; if (a > 0 && inView(c, vb)) this.flow(g, c, z, t, a, 1); }
      if (wa.res > 0) for (const c of this.resFlow) this.flow(g, c, z, t, wa.res, 0.55);
      for (const c of this.pens) { const p = wa.pen?.[c.id] ?? 0; if (p > 0) this.penFlow(g, c, z, t, p, wa.penA ?? 1); }
    }
    // ---- current (amber) ----
    for (const a of sc.ac || []) this.acDashes(g, a, z, t);
    for (const d of sc.dc || []) this.dcStream(g, d, z, t);
    if (sc.lit && this.w.TPADS) {
      const c = P.cur.g; g.fillStyle = rgb(c, 0.55 * sc.lit);
      for (const p of this.w.TPADS) if (p.lit && (!sc.litOnly || sc.litOnly(p)) && p.x > vb[0] && p.x < vb[2] && p.y > vb[1] && p.y < vb[3]) g.fillRect(p.x - p.w * 0.42, p.y - p.h * 0.42, p.w * 0.84, p.h * 0.84);
    }
    for (const p of sc.glow || []) { poly(g, p.pts); g.strokeStyle = rgb(p.c || P.cur.g, p.a); g.lineWidth = p.w; g.stroke(); }
    for (const f of sc.flashes || []) {
      const R = Math.min(f.r, (f.maxPx || 150) / z), rg = g.createRadialGradient(f.p[0], f.p[1], 0, f.p[0], f.p[1], R);
      const c = f.c || P.cur; rg.addColorStop(0, rgb(c.h, f.a)); rg.addColorStop(1, rgb(c.g, 0)); g.fillStyle = rg; g.beginPath(); g.arc(f.p[0], f.p[1], R, 0, 6.2832); g.fill();
    }
    g.globalCompositeOperation = 'source-over';
  }
  // silver flow light: streamlines of moving dashes, each its own speed and rhythm
  flow(g, c, z, t, a, k) {
    const P = PAL, w = c.w;
    poly(g, c.pts); g.strokeStyle = rgb(P.water.g, (0.1 + 0.26 * (1 - clamp(w * z / 40))) * a); g.lineWidth = w * 0.9; g.stroke();
    const n = c.lines.length;
    for (let i = 0; i < n; i++) {
      const f = (i / (n - 1)) * 2 - 1, v = w * (5.2 - 2.6 * f * f) * k, dl = w * (0.9 + 0.7 * ((i * 0.37) % 1)), gp = w * (1.3 + 1.6 * ((i * 0.61) % 1));
      g.setLineDash([dl, gp]); g.lineDashOffset = -(t * v + i * w * 0.83);
      poly(g, c.lines[i]); g.strokeStyle = rgb(P.water.g, (0.5 - 0.2 * Math.abs(f)) * a); g.lineWidth = Math.max(w * 0.06, 0.9 / z); g.stroke();
      // ripples: short glints riding faster
      g.setLineDash([w * 0.18, w * (2.6 + 1.3 * ((i * 0.29) % 1))]); g.lineDashOffset = -(t * v * 1.35 + i * w * 1.7);
      g.strokeStyle = rgb(P.water.h, 0.42 * a); g.lineWidth = Math.max(w * 0.045, 0.8 / z); g.stroke();
    }
    g.setLineDash([]);
  }
  penFlow(g, c, z, t, p, a) {
    const P = PAL, m = c.m, w = c.w, s = m.len * Math.min(1, p);
    const pts = sub(m, 0, s); if (pts.length < 2) return;
    poly(g, pts); g.strokeStyle = rgb(P.water.g, 0.16 * a); g.lineWidth = w * 0.8; g.stroke();
    g.setLineDash([w * 2.6, w * 3.4]); g.lineDashOffset = -(t * w * 7 + c.k * w * 1.9);
    g.strokeStyle = rgb(P.water.h, 0.42 * a); g.lineWidth = w * 0.22; g.stroke(); g.setLineDash([]);
    if (p < 1.02) { const h = at(m, s), R = w * 1.6; const rg = g.createRadialGradient(h[0], h[1], 0, h[0], h[1], R); rg.addColorStop(0, `rgba(255,255,255,${0.95 * a})`); rg.addColorStop(1, rgb(P.water.g, 0)); g.fillStyle = rg; g.beginPath(); g.arc(h[0], h[1], R, 0, 6.2832); g.fill(); }
  }
  // AC: short dashes that rock back and forth along the trace (a slowed 50 Hz), over a faint energised line
  acDashes(g, a, z, t) {
    const P = PAL, tr = a.trace, m = tr.m, s0 = a.s0 ?? 0, s1 = Math.min(m.len, a.s1 ?? m.len); if (s1 <= s0) return;
    const pts = sub(m, s0, s1); if (pts.length < 2) return;
    if (a.fade) return this.lossDashes(g, a, z, t, pts, s0, s1);
    const lam = a.lam || tr.w * 4, A = lam * (a.amp ?? 0.32), ph = Math.sin(a.phase ?? (2 * Math.PI * (a.f ?? 2.2) * t + (a.ph || 0))) * A;
    poly(g, pts); g.strokeStyle = rgb(P.cur.e, 0.12 * a.a); g.lineWidth = tr.w * 0.45; g.stroke();
    g.lineCap = 'round'; g.setLineDash([lam * 0.36, lam * 0.64]); g.lineDashOffset = -(ph + (a.drift || 0) * t) + lam * 0.3;
    poly(g, pts); g.strokeStyle = rgb(P.cur.g, 0.85 * a.a); g.lineWidth = tr.w * 0.8; g.stroke();
    g.strokeStyle = `rgba(255,240,205,${0.45 * a.a})`; g.lineWidth = tr.w * 0.22; g.stroke();
    g.setLineDash([]); g.lineDashOffset = 0;
  }
  // AC sent too far: dashes moving forward, dimmer, thinner and fewer the further they get
  lossDashes(g, a, z, t, pts, s0, s1) {
    const P = PAL, tr = a.trace, m = tr.m, lam = a.lam || tr.w * 5, w = tr.w, off = ((t * (a.v || lam * 1.2)) % lam + lam) % lam;
    poly(g, pts); g.strokeStyle = rgb(P.cur.e, 0.1 * a.a); g.lineWidth = w * 0.45; g.stroke();
    g.lineCap = 'round';
    for (let s = s0 + off - lam, k = Math.floor((t * (a.v || lam * 1.2)) / lam); s < s1; s += lam, k--) {
      const d = s - (a.x0 ?? s0); if (d < 0) continue;
      const keep = Math.exp(-d / (a.fade * 1.4)), h = Math.abs(Math.sin(k * 12.9898) * 43758.5453) % 1;
      if (h > keep + 0.12) continue;
      const k2 = Math.exp(-d / a.fade) * a.a, L = lam * 0.38 * (0.45 + 0.55 * Math.exp(-d / a.fade));
      const q = sub(m, Math.max(s0, s), Math.min(s1, s + L)); if (q.length < 2) continue;
      poly(g, q); g.strokeStyle = rgb(P.cur.g, Math.min(1, 1.1 * k2)); g.lineWidth = w * (0.45 + 0.6 * Math.exp(-d / a.fade)); g.stroke();
      g.strokeStyle = `rgba(255,240,205,${0.6 * k2})`; g.lineWidth = w * 0.2; g.stroke();
    }
  }
  // DC: one direction, continuous: a lit stream behind a travelling head, with a slow afterglow and fast streaks
  dcStream(g, d, z, t) {
    const P = PAL, tr = d.trace, m = tr.m, head = Math.min(m.len, d.head ?? m.len), s0 = d.s0 ?? 0, w = tr.w, a = d.a ?? 1;
    if (head <= s0) return;
    const decay = d.decay ?? 1e9, N = 28;
    for (let i = 0; i < N; i++) {
      const sA = s0 + (head - s0) * i / N, sB = s0 + (head - s0) * (i + 1) / N, mid = (sA + sB) / 2;
      const k = Math.max(d.floor ?? 0.35, Math.exp(-(head - mid) / decay)) * a;
      const pts = sub(m, sA, sB + 0.01); if (pts.length < 2) continue;
      g.lineCap = 'butt'; poly(g, pts); g.strokeStyle = rgb(P.cur.g, 0.6 * k); g.lineWidth = Math.max(w * 0.9, (d.minPx || 3.6) / z); g.stroke();
      g.strokeStyle = `rgba(255,244,214,${0.38 * k})`; g.lineWidth = Math.max(w * 0.3, (d.minPx || 3.6) * 0.4 / z); g.stroke();
    }
    // streaks travelling with the current
    const pts = sub(m, s0, head);
    if (pts.length > 1) { g.setLineDash([w * 6, w * 9]); g.lineDashOffset = -(t * (d.v || w * 40)); poly(g, pts); g.strokeStyle = `rgba(255,252,240,${0.35 * a})`; g.lineWidth = w * 0.3; g.stroke(); g.setLineDash([]); }
    g.lineCap = 'round';
    if (d.headGlow !== false && head < m.len - 0.01) {
      const h = at(m, head), R = Math.min(w * 3.2, (d.maxPx || 70) / z);
      const rg = g.createRadialGradient(h[0], h[1], 0, h[0], h[1], R); rg.addColorStop(0, `rgba(255,255,255,${a})`); rg.addColorStop(0.4, rgb(P.cur.h, 0.85 * a)); rg.addColorStop(1, rgb(P.cur.g, 0));
      g.fillStyle = rg; g.beginPath(); g.arc(h[0], h[1], R, 0, 6.2832); g.fill();
    }
  }

  // every label visible at this camera, as screen boxes (for readcheck)
  texts(cam, sc, prefix = '') {
    const M = camMatrix(cam), out = [];
    for (const L of this.w.LABELS || []) {
      if ((sc.labels?.[L.id] ?? 0) <= 0) continue;
      const wd = layout(L.text).width * L.cap / 10;
      const x0 = L.align === 'center' ? L.x - wd / 2 : L.align === 'right' ? L.x - wd : L.x;
      const cs = [[x0, L.y - L.cap * 0.1], [x0 + wd, L.y - L.cap * 0.1], [x0, L.y + L.cap * 1.1], [x0 + wd, L.y + L.cap * 1.1]].map(p => toScreen(M, p));
      const xs = cs.map(p => p[0]), ys = cs.map(p => p[1]);
      if (Math.max(...ys) - Math.min(...ys) < 9) continue;     // too small to read: texture, not text
      out.push({ id: L.gid || prefix + L.id, text: L.text, x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) });
    }
    return out;
  }
}

const mc = new WeakMap();
function measureCache(ld) { if (!mc.has(ld)) mc.set(ld, measure(ld.pts)); return mc.get(ld); }
function inView(t, vb) {
  if (!t.bb) { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const [x, y] of t.pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); } const p = (t.w || 0) + 20; t.bb = [x0 - p, y0 - p, x1 + p, y1 + p]; }
  const b = t.bb; return !(b[2] < vb[0] || b[0] > vb[2] || b[3] < vb[1] || b[1] > vb[3]);
}
function padPath(ctx, p, e) {
  ctx.beginPath();
  if (p.shape === 'round') ctx.arc(p.x, p.y, p.r + e, 0, 6.2832);
  else if (p.shape === 'square') ctx.rect(p.x - p.r - e, p.y - p.r - e, 2 * (p.r + e), 2 * (p.r + e));
  else ctx.roundRect(p.x - p.w / 2 - e, p.y - p.h / 2 - e, p.w + 2 * e, p.h + 2 * e, (p.r || 0) + e);
}
function keepPath(ctx, k, e) {
  ctx.beginPath();
  if (k.rect) { const [x0, y0, x1, y1] = k.rect; ctx.rect(x0 - e, y0 - e, x1 - x0 + 2 * e, y1 - y0 + 2 * e); }
  else if (k.circle) ctx.arc(k.circle[0], k.circle[1], k.circle[2] + e, 0, 6.2832);
  else if (k.poly) { const c = k.poly.reduce((s, p) => [s[0] + p[0] / k.poly.length, s[1] + p[1] / k.poly.length], [0, 0]); k.poly.forEach((p, i) => { const dx = p[0] - c[0], dy = p[1] - c[1], L = Math.hypot(dx, dy) || 1, q = [p[0] + dx / L * e * 1.41, p[1] + dy / L * e * 1.41]; i ? ctx.lineTo(...q) : ctx.moveTo(...q); }); ctx.closePath(); }
}
export function poly(ctx, pts) { ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]); }
export function circle(ctx, x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); }
