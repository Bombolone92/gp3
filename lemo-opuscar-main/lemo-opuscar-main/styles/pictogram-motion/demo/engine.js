// Pictogram Motion engine (window.G): easing, rng, colour, the five-hue palette, the grid pattern with whole-row offsets,
// the motif library, the pictograms (umbrella, drop, cloud, sun, moon, bolt, footprint, lost items) and the mask-slide type.
(function () {
  const W = 1920, H = 1080;
  const G = (window.G = { W, H });

  // ───────── maths / easing ─────────
  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const inv = (a, b, x) => clamp((x - a) / (b - a));
  const E = {
    lin: (t) => clamp(t),
    io: (t) => 0.5 - 0.5 * Math.cos(Math.PI * clamp(t)),
    o3: (t) => 1 - Math.pow(1 - clamp(t), 3),
    i3: (t) => Math.pow(clamp(t), 3),
    io3: (t) => (t = clamp(t), t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    oExp: (t) => (t = clamp(t), t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
    iExp: (t) => (t = clamp(t), t <= 0 ? 0 : Math.pow(2, 10 * t - 10)),
    ioExp: (t) => (t = clamp(t), t <= 0 ? 0 : t >= 1 ? 1 : t < 0.5 ? Math.pow(2, 20 * t - 10) / 2 : (2 - Math.pow(2, -20 * t + 10)) / 2),
    oBack: (t, s = 1.7) => (t = clamp(t) - 1, t * t * ((s + 1) * t + s) + 1),
    o5: (t) => 1 - Math.pow(1 - clamp(t), 5),
  };
  const rng = (seed) => {
    let a = seed >>> 0;
    return () => {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  const hash = (n) => rng(n * 9301 + 49297)();
  Object.assign(G, { clamp, lerp, inv, E, rng, hash });

  // ───────── colour ─────────
  const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const toHex = (c) => '#' + c.map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('');
  const mix = (a, b, t) => { const A = hex(a), B = hex(b); return toHex(A.map((v, i) => lerp(v, B[i], t))); };
  const rgba = (h, a) => { const c = hex(h); return `rgba(${c[0]},${c[1]},${c[2]},${a})`; };
  G.mix = mix; G.rgba = rgba;

  // Five hues + one dark neutral, five tones each (t0 darkest → t4 lightest). Names are ours.
  const CREAM = '#fbf6ec', INK = '#111521';
  const PAL = {
    navy:   { name: 'Rain Navy',     t: ['#13254a', '#1a3263', '#24457d', '#3b5e95', '#5d7cad'], fg: CREAM },
    teal:   { name: 'Tram Teal',     t: ['#00544c', '#00685d', '#0b7f70', '#2e9686', '#5fae9f'], fg: CREAM },
    sky:    { name: 'Puddle Sky',    t: ['#4b95c4', '#61a5d0', '#7ab6da', '#97c7e3', '#b8daeb'], fg: '#0f2036' },
    coral:  { name: 'Brick Coral',   t: ['#a93726', '#c04731', '#d75d43', '#e2785c', '#ea957a'], fg: CREAM },
    yellow: { name: 'Signal Yellow', t: ['#d39400', '#e4a608', '#f2ba1d', '#f6c94a', '#f9d87e'], fg: '#231902' },
    ink:    { name: 'Storm Ink',     t: ['#0c1018', '#131924', '#1b2230', '#272f41', '#374055'], fg: CREAM, accent: '#f2ba1d' },
  };
  for (const k in PAL) { PAL[k].key = k; PAL[k].base = PAL[k].t[2]; PAL[k].far = mix(PAL[k].fg, PAL[k].t[2], 0.42); }
  G.PAL = PAL; G.CREAM = CREAM; G.INK = INK;
  G.UMB = PAL.yellow.t[2];       // the umbrella: the only warm colour in a cold world
  G.UMB2 = PAL.yellow.t[0];      // its darker gore

  // ───────── canvas helpers ─────────
  G.canvas = (w = W, h = H) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  G.disc = (ctx, x, y, r, col) => { if (r <= 0) return; ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); };
  G.seg = (ctx, a, b, w, col) => { ctx.strokeStyle = col; ctx.lineWidth = w; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); };
  G.ring = (ctx, x, y, r, w, col) => { if (r <= 0) return; ctx.strokeStyle = col; ctx.lineWidth = w; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke(); };
  G.poly = (ctx, pts, col) => { ctx.fillStyle = col; ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); ctx.fill(); };
  G.rrect = (ctx, x, y, w, h, r, col) => { ctx.fillStyle = col; ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fill(); };

  // ───────── pictograms (unit-sized, drawn under the current transform) ─────────
  // Raindrop: disc + pointed top. Origin = disc centre, r = disc radius.
  G.drop = (ctx, x, y, r, col) => {
    ctx.fillStyle = col; ctx.beginPath();
    ctx.moveTo(x, y - r * 2.5);
    ctx.quadraticCurveTo(x + r * 0.95, y - r * 0.9, x + r, y);
    ctx.arc(x, y, r, 0, Math.PI);
    ctx.quadraticCurveTo(x - r * 0.95, y - r * 0.9, x, y - r * 2.5);
    ctx.fill();
  };
  // Cloud: three discs on a flat base. (x, y) = base centre, s = half width.
  G.cloud = (ctx, x, y, s, col) => {
    ctx.fillStyle = col; ctx.beginPath();
    ctx.arc(x - s * 0.48, y - s * 0.32, s * 0.36, 0, Math.PI * 2);
    ctx.arc(x + s * 0.05, y - s * 0.52, s * 0.5, 0, Math.PI * 2);
    ctx.arc(x + s * 0.55, y - s * 0.28, s * 0.32, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath(); ctx.roundRect(x - s * 0.84, y - s * 0.4, s * 1.7, s * 0.4, s * 0.2); ctx.fill();
  };
  // Sun: disc + 12 rounded rays.
  G.sunIcon = (ctx, x, y, r, col, spin = 0) => {
    G.disc(ctx, x, y, r, col);
    for (let i = 0; i < 12; i++) {
      const a = spin + (i / 12) * Math.PI * 2;
      G.seg(ctx, [x + Math.cos(a) * r * 1.35, y + Math.sin(a) * r * 1.35], [x + Math.cos(a) * r * 1.72, y + Math.sin(a) * r * 1.72], r * 0.2, col);
    }
  };
  // Footprint (one shoe sole). (x, y) = centre, s = length/2, ang = heading (radians, 0 = up).
  // Crescent moon (clip + even-odd, so it needs no background colour).
  G.moon = (ctx, x, y, r, col) => {
    ctx.save(); ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.clip();
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.arc(x + r * 0.5, y - r * 0.3, r * 0.86, 0, Math.PI * 2);
    ctx.fillStyle = col; ctx.fill('evenodd'); ctx.restore();
  };
  // Lightning bolt. (x, y) = top, s = height.
  G.bolt = (ctx, x, y, s, col) => G.poly(ctx, [[x + s * 0.12, y], [x - s * 0.22, y + s * 0.56], [x + 0.02 * s, y + s * 0.56], [x - s * 0.14, y + s],
    [x + s * 0.3, y + s * 0.38], [x + s * 0.06, y + s * 0.38], [x + s * 0.3, y]], col);
  // Small lost things for the shelf: glove, key, hat, scarf. (x, y) = centre, s = cell size.
  G.item = (ctx, kind, x, y, s, col) => {
    if (kind === 0) { // glove
      G.rrect(ctx, x - s * 0.17, y - s * 0.05, s * 0.34, s * 0.34, s * 0.08, col);
      for (let i = 0; i < 4; i++) G.seg(ctx, [x - s * 0.12 + i * s * 0.08, y - s * 0.05], [x - s * 0.12 + i * s * 0.08, y - s * 0.26 + Math.abs(i - 1.5) * s * 0.03], s * 0.07, col);
      G.seg(ctx, [x - s * 0.17, y + s * 0.08], [x - s * 0.3, y - s * 0.04], s * 0.08, col);
    } else if (kind === 1) { // key
      G.ring(ctx, x - s * 0.18, y, s * 0.12, s * 0.06, col);
      G.seg(ctx, [x - s * 0.06, y], [x + s * 0.3, y], s * 0.07, col);
      G.seg(ctx, [x + s * 0.2, y], [x + s * 0.2, y + s * 0.1], s * 0.06, col); G.seg(ctx, [x + s * 0.29, y], [x + s * 0.29, y + s * 0.12], s * 0.06, col);
    } else if (kind === 2) { // hat
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y + s * 0.08, s * 0.22, Math.PI, 0); ctx.fill();
      G.seg(ctx, [x - s * 0.32, y + s * 0.1], [x + s * 0.32, y + s * 0.1], s * 0.07, col);
    } else { // scarf
      G.seg(ctx, [x - s * 0.26, y - s * 0.12], [x + s * 0.26, y - s * 0.12], s * 0.11, col);
      G.seg(ctx, [x + s * 0.14, y - s * 0.12], [x + s * 0.2, y + s * 0.26], s * 0.1, col);
      G.seg(ctx, [x + s * 0.02, y - s * 0.12], [x + s * 0.0, y + s * 0.22], s * 0.1, col);
    }
  };
  G.foot = (ctx, x, y, s, ang, col, mirror = 1) => {
    // bare footprint: sole + heel pad + five toe dots (the universal footprint sign)
    ctx.save(); ctx.translate(x, y); ctx.rotate(ang); ctx.scale(mirror, 1); ctx.fillStyle = col;
    ctx.beginPath(); ctx.ellipse(s * 0.04, -s * 0.12, s * 0.34, s * 0.46, 0.12, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(0, s * 0.5, s * 0.26, s * 0.3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.rect(-s * 0.24, s * 0.1, s * 0.46, s * 0.4); ctx.fill();
    const toes = [[-0.26, -0.7, 0.13], [-0.06, -0.8, 0.11], [0.12, -0.78, 0.095], [0.27, -0.7, 0.085], [0.38, -0.56, 0.075]];
    for (const [tx, ty, tr] of toes) { ctx.beginPath(); ctx.arc(tx * s, ty * s, tr * s, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
  };
  // Umbrella. Local frame: R = 1, origin = canopy rim centre, tip pointing up (-y).
  // o = 1 open, 0 closed (furled). col = canopy, col2 = centre gore, sh = shaft/handle colour.
  G.umbrella = (ctx, x, y, R, o, rot, col, col2, sh) => {
    o = clamp(o, 0, 1.15);
    const w = lerp(0.15, 1, o), h = lerp(1.12, 0.62, Math.min(o, 1)), ry = lerp(0.52, 0, Math.min(o, 1));
    const sc = 0.03 + 0.11 * Math.min(o, 1); // scallop depth
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot || 0); ctx.scale(R, R);
    // shaft + handle (behind the canopy)
    const shaftEnd = lerp(0.98, 0.95, o);
    G.seg(ctx, [0, -h + ry - 0.16], [0, shaftEnd], 0.058, sh);
    ctx.strokeStyle = sh; ctx.lineWidth = 0.062; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(-0.13, shaftEnd, 0.13, 0, Math.PI, false); ctx.stroke();
    // canopy path
    const path = () => {
      ctx.beginPath();
      const N = 28;
      for (let i = 0; i <= N; i++) {
        const th = Math.PI + (i / N) * Math.PI; // π → 2π (top half)
        const px = w * Math.cos(th), py = ry + h * Math.sin(th);
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      // scalloped hem, right → left, four bays
      for (let k = 0; k < 4; k++) {
        const xa = w * (1 - k * 0.5), xb = w * (1 - (k + 1) * 0.5);
        ctx.quadraticCurveTo((xa + xb) / 2, ry - sc * 2, xb, ry);
      }
      ctx.closePath();
    };
    path(); ctx.fillStyle = col; ctx.fill();
    // centre gore
    ctx.save(); path(); ctx.clip();
    ctx.beginPath(); ctx.ellipse(0, ry, w * 0.36, h, 0, Math.PI, 0); ctx.closePath(); ctx.fillStyle = col2; ctx.fill();
    ctx.restore();
    // ferrule
    G.seg(ctx, [0, ry - h - 0.02], [0, ry - h - 0.14], 0.05, sh);
    ctx.restore();
  };

  // ───────── grid pattern ─────────
  const CELL = 180; G.CELL = CELL;
  function motif(ctx, kind, x, y, s, c, r) {
    const [a, b, cc] = c;
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, s, s); ctx.clip();
    ctx.fillStyle = a; ctx.fillRect(x, y, s, s);
    const rot = Math.floor(r() * 4);
    const upright = kind >= 14; // pictogram motifs keep their orientation
    ctx.translate(x + s / 2, y + s / 2); if (!upright) ctx.rotate(rot * Math.PI / 2); ctx.translate(-s / 2, -s / 2);
    switch (kind) {
      case 0: G.disc(ctx, 0, 0, s, b); break;                                  // quarter disc
      case 1: G.disc(ctx, s / 2, s, s / 2, b); break;                          // half disc
      case 2: G.disc(ctx, s / 2, s / 2, s / 2, b); G.disc(ctx, s * 0.62, s * 0.42, s * 0.13, cc); break;
      case 3: { ctx.save(); ctx.beginPath(); ctx.arc(s / 2, s, s / 2, Math.PI, 0); ctx.clip();
        for (let i = 0; i < 7; i++) { ctx.fillStyle = i % 2 ? b : cc; ctx.fillRect(0, s / 2 + i * s / 14, s, s / 14); }
        ctx.restore(); break; }
      case 4: { const k = s / 4;                                               // fish-scale waves
        for (let row = 0; row < 5; row++) for (let i = -1; i < 5; i++) {
          const cx = i * k + (row % 2 ? k / 2 : 0), cy = row * k * 0.5 + k * 0.5;
          G.disc(ctx, cx, cy, k * 0.5, row % 2 ? b : cc); G.disc(ctx, cx, cy, k * 0.3, a);
        } break; }
      case 5: { G.disc(ctx, s / 2, s / 2, s / 2, b);                           // dot scales
        ctx.save(); ctx.beginPath(); ctx.arc(s / 2, s / 2, s / 2, 0, Math.PI * 2); ctx.clip();
        const k = s / 6; for (let j = 0; j < 7; j++) for (let i = 0; i < 7; i++) G.disc(ctx, i * k + (j % 2 ? k / 2 : 0), j * k, k * 0.36, cc);
        ctx.restore(); break; }
      case 7: for (let i = 5; i >= 1; i--) G.disc(ctx, 0, s, (s * i) / 5, i % 2 ? b : a); break; // concentric arcs
      case 8: { const R = s * 0.3; ctx.fillStyle = b; ctx.beginPath();          // sun wheel
        for (let i = 0; i < 16; i++) { const t0 = (i / 16) * Math.PI * 2; ctx.moveTo(s / 2, s / 2); ctx.arc(s / 2, s / 2, R * 1.35, t0, t0 + Math.PI / 32); }
        ctx.fill(); G.disc(ctx, s / 2, s / 2, R, b); G.disc(ctx, s / 2, s / 2, R * 0.55, cc); break; }
      case 9: { G.disc(ctx, s, s, s * 0.9, b); const k = s / 7;                 // checks
        for (let j = 0; j < 7; j++) for (let i = 0; i < 7; i++) if ((i + j) % 2 === 0) { ctx.fillStyle = cc; ctx.fillRect(i * k + k * 0.2, j * k + k * 0.2, k * 0.6, k * 0.6); }
        break; }
      case 10: G.disc(ctx, s / 2, s / 2, s * 0.46, b); G.disc(ctx, s * 0.66, s * 0.38, s * 0.4, a); break; // crescent
      case 11: G.disc(ctx, 0, s / 2, s / 2, b); G.disc(ctx, s, s / 2, s / 2, cc); break;                    // S wave
      case 13: for (let i = 0; i < 9; i++) { ctx.globalAlpha = 1 - i / 10; ctx.fillStyle = b; ctx.fillRect(0, s * 0.1 + i * s * 0.09, s * (1 - i * 0.06), s * 0.045); } ctx.globalAlpha = 1; break;
      // ── this film's motifs ──
      case 14: { const k = s / 4;                                              // raindrop scales
        for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) G.drop(ctx, k * (i + 0.5) + (j % 2 ? k / 2 : 0) - k / 4, k * (j + 0.72), k * 0.17, (i + j) % 2 ? b : cc);
        break; }
      case 15: G.cloud(ctx, s / 2, s * 0.74, s * 0.46, b); break;               // cloud
      case 16: { for (let i = 0; i < 5; i++) G.seg(ctx, [s * (0.12 + i * 0.2), s * 0.15 + (i % 2) * s * 0.18], [s * (0.04 + i * 0.2), s * 0.55 + (i % 2) * s * 0.18], s * 0.05, i % 2 ? b : cc); break; } // rain strokes
      case 17: G.sunIcon(ctx, s / 2, s / 2, s * 0.2, b); break;                 // sun
      case 18: G.umbrella(ctx, s / 2, s * 0.6, s * 0.4, 1, 0, b, cc, b); break; // umbrella (foreshadowing)
      case 19: G.disc(ctx, s / 2, s / 2, s * 0.4, b); G.disc(ctx, s / 2, s / 2, s * 0.24, a); G.disc(ctx, s / 2, s / 2, s * 0.08, cc); break; // wheel
      case 20: { ctx.lineJoin = 'round'; ctx.strokeStyle = b; ctx.lineWidth = s * 0.1; ctx.lineCap = 'round';  // chevrons (wayfinding)
        for (let i = 0; i < 2; i++) { ctx.beginPath(); ctx.moveTo(s * (0.28 + i * 0.24), s * 0.25); ctx.lineTo(s * (0.48 + i * 0.24), s * 0.5); ctx.lineTo(s * (0.28 + i * 0.24), s * 0.75); ctx.stroke(); }
        break; }
    }
    ctx.restore();
  }
  G.motif = motif;
  G.MOTIFS = {
    rain: [1, 4, 5, 7, 10, 11, 14, 14, 15, 16, 16, 4, 18],
    sun: [0, 1, 2, 3, 8, 11, 13, 17, 17, 19, 20, 9],
  };

  const patCache = new Map();
  G.pattern = function (pk, seed = 1, o = {}) {
    const spread = o.spread ?? 1, density = o.density ?? 0.5, set = o.set || 'rain';
    const key = [pk, seed, spread, density, set].join('|');
    if (patCache.has(key)) { const v = patCache.get(key); patCache.delete(key); patCache.set(key, v); return v; }
    if (patCache.size > 10) patCache.delete(patCache.keys().next().value);
    const S = CELL, P = PAL[pk], base = P.t[2];
    const T = P.t.map((c) => mix(base, c, spread));
    const cols = Math.ceil(W / S) + 3, rows = Math.ceil(H / S) + 1;
    const cv = G.canvas(cols * S, rows * S), ctx = cv.getContext('2d');
    const r = rng(seed * 7919 + 13);
    ctx.fillStyle = T[1]; ctx.fillRect(0, 0, cv.width, cv.height);
    for (let j = -1; j < rows; j++) for (let i = -1; i < cols; i++) {
      const k = r(), cx = i * S, cy = j * S;
      if (k < 0.34) G.disc(ctx, cx + S, cy + S, S, T[Math.floor(r() * 4)]);
      else if (k < 0.5) { G.disc(ctx, cx + S, cy + S, S, T[3]); G.disc(ctx, cx + S, cy + S, S * 0.5, T[0]); }
    }
    const lib = G.MOTIFS[set];
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      if (r() > density) continue;
      const pick = () => T[Math.floor(r() * 5)];
      let a = pick(), b = pick(); while (b === a) b = pick();
      let cc = pick(); while (cc === b) cc = pick();
      motif(ctx, lib[Math.floor(r() * lib.length)], i * S, j * S, S, [a, b, cc], r);
    }
    patCache.set(key, cv);
    return cv;
  };
  // Pattern with whole-row offsets; offs(row) → px. dy shifts the whole pattern vertically (camera).
  G.drawPattern = function (ctx, pat, offs, o = {}) {
    const S = CELL, rows = Math.ceil(H / S);
    for (let j = 0; j < rows + 1; j++) {
      let dx = offs ? offs(j) : 0;
      dx = ((dx % S) + S) % S - S; // wrap: rows can travel forever
      const y = j * S;
      ctx.drawImage(pat, 0, j * S, pat.width, S, dx, y, pat.width, S + 0.5);
    }
  };

  // ───────── type ─────────
  G.F = {
    en: (w, px) => `${w} ${px}px "Inter Tight"`,
    zh: (w, px) => `${w} ${px}px "Noto Sans SC"`,
    mono: (px, w = 500) => `${w} ${px}px "DM Mono"`,
  };
  G.maskText = function (ctx, text, x, y, font, col, p, o = {}) {
    ctx.save();
    ctx.font = font; ctx.letterSpacing = o.ls || '0px'; ctx.textAlign = o.align || 'left'; ctx.textBaseline = 'alphabetic';
    const m = ctx.measureText(text);
    const asc = m.actualBoundingBoxAscent, desc = m.actualBoundingBoxDescent, h = asc + desc;
    const w = m.width + 40;
    const x0 = o.align === 'center' ? x - w / 2 : o.align === 'right' ? x - w : x - 20;
    ctx.beginPath(); ctx.rect(x0, y - asc - 8, w, h + 16); ctx.clip();
    const dy = (1 - E.oExp(p)) * (h + 20);
    ctx.fillStyle = col; ctx.fillText(text, x, y + dy);
    ctx.restore();
    return m.width;
  };
  G.hair = (ctx, x, y, w, col, p = 1, lw = 2) => { ctx.fillStyle = col; ctx.fillRect(x, y, w * clamp(p), lw); };
  G.typeText = function (ctx, text, x, y, font, col, p, o = {}) {
    const n = Math.floor(text.length * clamp(p) + 0.001);
    ctx.save(); ctx.font = font; ctx.letterSpacing = o.ls || '0px'; ctx.fillStyle = col; ctx.textAlign = o.align || 'left';
    ctx.fillText(text.slice(0, n), x, y);
    ctx.restore();
  };
})();
