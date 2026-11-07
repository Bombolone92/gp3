// LEFT BEHIND — one timeline for the whole 50 s film (120 BPM: beat 0.5 s, bar 2 s).
// render(t) draws film second t; ?a=&b= renders a span of it, ?nocap=1 hides the subtitles.
(function () {
  const { W, H, E, PAL, clamp, lerp, inv, rgba, mix, CELL } = G;
  const F = G.F;
  const FULL = 50;

  // ───────── shot list (film seconds) ─────────
  const SHOTS = [
    { id: 'S1', t0: 0.0, kind: 'rainOpen' },
    { id: 'S2', t0: 2.5, kind: 'busStop' },
    { id: 'S5', t0: 6.5, kind: 'title' },
    { id: 'S6', t0: 10.5, kind: 'track' },
    { id: 'S7a', t0: 13.5, kind: 'ladder', i: 0 },
    { id: 'S7b', t0: 14.5, kind: 'ladder', i: 1 },
    { id: 'S7c', t0: 15.5, kind: 'ladder', i: 2 },
    { id: 'S8', t0: 16.5, kind: 'lastStop' },
    { id: 'S9', t0: 18.5, kind: 'lost' },
    { id: 'S10', t0: 21.5, kind: 'wall' },
    { id: 'S12', t0: 28.0, kind: 'storm' },
    { id: 'S13', t0: 31.0, kind: 'split' },
    { id: 'S14', t0: 34.0, kind: 'shutter' },
    { id: 'S15', t0: 36.5, kind: 'bloom' },
    { id: 'S16', t0: 40.5, kind: 'route' },
    { id: 'S17', t0: 44.0, kind: 'echo' },
    { id: 'S18', t0: 46.5, kind: 'end' },
  ];
  SHOTS.forEach((s, i) => (s.t1 = i + 1 < SHOTS.length ? SHOTS[i + 1].t0 : FULL));
  // grid transitions at shot boundaries (others are built into the shots: match cut 2.5, flip 4.0, iris 6.5,
  // descent 18.5, wall 21.5→28 is one camera move, lightning 28.0, shutter → wall 36.5)
  const TRANS = { 10.5: 'rows', 13.5: 'cols', 14.5: 'cols', 15.5: 'cols', 16.5: 'slide', 21.5: 'quarter', 31.0: 'split', 34.0: 'flip', 40.5: 'quarter', 44.0: 'rows', 46.5: 'rows' };

  // ───────── sound / cue events (film seconds) ─────────
  const EV = [
    { t: 0.0, type: 'rain_on' }, { t: 0.5, type: 'pop' },
    ...[0.5, 1.0, 1.5, 2.0].map((t) => ({ t, type: 'step_wet' })),
    { t: 2.0, type: 'furl' }, { t: 2.5, type: 'cut' }, { t: 3.0, type: 'clink' }, { t: 3.0, type: 'brake' }, { t: 3.5, type: 'ding' },
    { t: 4.0, type: 'flip' }, { t: 4.0, type: 'rain_off' }, { t: 4.5, type: 'door_open' },
    ...[5.0, 5.5, 6.0].map((t) => ({ t, type: 'step_dry' })),
    { t: 6.0, type: 'door_close' }, { t: 6.5, type: 'iris' }, { t: 7.0, type: 'title' }, { t: 9.0, type: 'drip' }, { t: 10.0, type: 'drip' },
    { t: 10.5, type: 'rows' }, ...[11.0, 11.5, 12.0, 12.5, 13.0].map((t) => ({ t, type: 'whip' })),
    ...[13.5, 14.5, 15.5].map((t) => ({ t, type: 'card' })),
    { t: 16.5, type: 'slide' }, { t: 17.0, type: 'brake' }, { t: 17.5, type: 'moon' }, { t: 18.05, type: 'descend' },
    { t: 18.5, type: 'slam' }, { t: 19.5, type: 'tag' }, { t: 21.5, type: 'quarter' }, { t: 24.0, type: 'count' },
    ...[26.0, 26.25, 26.5, 26.75, 27.0, 27.25, 27.5, 27.75].map((t) => ({ t, type: 'tick' })),
    { t: 28.0, type: 'thunder' }, { t: 29.5, type: 'thunder2' }, { t: 31.0, type: 'split' },
    { t: 34.0, type: 'flipT' }, { t: 34.5, type: 'signflip' },
    ...[35.0, 35.25, 35.5, 35.75, 36.0, 36.25].map((t) => ({ t, type: 'shutter' })),
    { t: 36.5, type: 'bloom' }, ...[39.0, 39.5, 40.0].map((t) => ({ t, type: 'rowshift' })),
    { t: 40.5, type: 'quarter' }, ...Array.from({ length: 12 }, (_, i) => ({ t: 41.0 + i * 0.25, type: 'stop', i })),
    { t: 44.0, type: 'rows' }, ...[44.5, 45.0, 45.5, 46.0].map((t) => ({ t, type: 'step_soft' })),
    { t: 46.5, type: 'end' },
  ];

  // ───────── helpers ─────────
  const rowDrift = (t, seed, sp = 26, amp = 22) => (j) => (j % 2 ? 1 : -1) * t * sp + Math.sin(j * 1.7 + seed) * amp;

  function stageDisc(ctx, x, y, r, col, lt) {
    G.disc(ctx, x, y, r, col);
    ctx.save(); ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.clip();
    const sx = x - r * 1.6 + E.o3(inv(0.1, 2.6, lt)) * r * 3.2;
    const g = ctx.createLinearGradient(sx - r * 0.5, y - r, sx + r * 0.5, y + r);
    g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,0.09)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
    ctx.restore();
  }

  // Rain: pictogram drops in columns. shelter(x, y) → true where a drop is hidden; roof(x) → y where drops splash.
  function rain(ctx, t, o = {}) {
    const v = o.v || 760, col = o.col, scroll = o.scroll || 0, r = o.r || 7.5;
    const n = 34, gap = W / n;
    for (let i = 0; i < n; i++) {
      const ph = G.hash(i + 3), jit = (G.hash(i + 77) - 0.5) * gap * 0.5;
      let x = ((i * gap + jit - scroll) % W + W) % W;
      const period = 0.25;
      const n0 = Math.floor((t - (H + 160) / v) / period) - 1, n1 = Math.floor(t / period) + 1;
      for (let k = n0; k <= n1; k++) {
        const ts = (k + ph) * period;
        const y = -60 + (t - ts) * v;
        if (y < -60 || y > H + 60) continue;
        const xx = x + (G.hash(k * 31 + i) - 0.5) * 18 - (o.slant ? (H - y) * o.slant : 0);
        const roofY = o.roof ? o.roof(xx) : null;
        if (roofY != null && y > roofY) {
          const since = (y - roofY) / v;
          if (since < 0.12) { // splash crown
            const p = since / 0.12, a = 1 - p;
            ctx.globalAlpha = a;
            G.disc(ctx, xx - 6 - 14 * p, roofY - 6 - 10 * p, 3.2, col);
            G.disc(ctx, xx + 6 + 14 * p, roofY - 6 - 10 * p, 3.2, col);
            ctx.globalAlpha = 1;
          }
          continue;
        }
        if (o.shelter && o.shelter(xx, y)) continue;
        G.drop(ctx, xx, y, r, col);
      }
    }
  }

  // ───────── S1 · rain, the umbrella pops open ─────────
  const S1 = { ux: 960, uy: 440, R: 290 };
  const s1Open = (t) => (t < 2 ? E.oBack(inv(0.5, 0.82, t)) : 1 - E.io3(inv(2.0, 2.45, t)));
  const s1Cam = (t) => 300 * Math.min(t, 2) + 75 * E.o3(inv(2, 2.5, t));
  function rainOpen(ctx, t) {
    const P = PAL.navy;
    ctx.fillStyle = P.t[1]; ctx.fillRect(0, 0, W, H);
    const cam = s1Cam(t);
    const pop = (j) => (j % 2 ? 1 : -1) * CELL * 0.25 * E.oExp(inv(0.5, 0.8, t));
    const dr = rowDrift(t, 2);
    G.drawPattern(ctx, G.pattern('navy', 11, { spread: 0.55, density: 0.5, set: 'rain' }), (j) => dr(j) - cam * 0.35 + pop(j));
    stageDisc(ctx, S1.ux, S1.uy + 30, 430, P.t[0], t);
    // umbrella geometry
    const o = s1Open(t);
    const bob = 7 * [0.5, 1.0, 1.5, 2.0].reduce((a, b) => a + (t > b ? Math.exp(-(t - b) * 9) * Math.sin((t - b) * 18) : 0), 0);
    const ux = S1.ux, uy = S1.uy + bob, R = S1.R;
    const w = lerp(0.15, 1, Math.min(o, 1)) * R, h = lerp(1.12, 0.62, Math.min(o, 1)) * R, ry = uy + lerp(0.52, 0, Math.min(o, 1)) * R;
    const domeY = (x) => { const dx = (x - ux) / w; return Math.abs(dx) > 1 ? null : ry - h * Math.sqrt(1 - dx * dx); };
    rain(ctx, t, {
      col: P.t[4], scroll: cam * 0.6,
      roof: (x) => domeY(x),
      shelter: (x, y) => false,
    });
    // footprints under the umbrella (someone is walking)
    for (let k = -1; k < 4; k++) {
      const ts = 0.5 + k * 0.5;
      if (t < ts) continue;
      const wx = 1130 + 150 * k, sx = wx - cam, sy = k % 2 ? 848 : 796;
      const a = 1 - inv(ts + 0.6, ts + 1.6, t);
      if (a <= 0) continue;
      const s = 44 * E.oExp(inv(ts, ts + 0.12, t));
      ctx.globalAlpha = a; G.foot(ctx, sx, sy, s, Math.PI / 2 + (k % 2 ? 0.1 : -0.1), rgba(G.CREAM, 0.88), k % 2 ? 1 : -1);
      // a small splash ring on landing
      const rp = inv(ts, ts + 0.4, t);
      if (rp < 1) { ctx.globalAlpha = a * (1 - rp); G.ring(ctx, sx, sy, 22 + 44 * E.oExp(rp), 3, P.t[4]); }
      ctx.globalAlpha = 1;
    }
    G.umbrella(ctx, ux, uy, R, o, 0, G.UMB, G.UMB2, G.UMB);
  }

  // ───────── S2–S4 · the bus, the stop, the sun, the doors ─────────
  // World coordinates at scale 1 = the final wide frame.
  const BUS = { x: 140, y: 330, w: 1340, h: 490 };
  const RAIL_Y = 422, WIN = [[200, 380], [404, 584], [608, 788], [812, 992], [1016, 1196]];
  const DOOR = [1236, 1396];
  const HOOK = [698, RAIL_Y];
  const UR = 70; // umbrella size in the bus
  const C_HOOK = [-0.13, 0.98];
  const U_REST = [HOOK[0] - C_HOOK[0] * UR, HOOK[1] + C_HOOK[1] * UR]; // origin when hanging (rot = π)
  const busX = (t) => -540 * (1 - E.o3(inv(2.5, 3.5, t)));
  const doorO = (t) => E.oExp(inv(4.5, 4.78, t)) * (1 - E.io3(inv(6.0, 6.3, t)));
  function busCam(t) {
    // returns {k, cx, cy, ax, ay}: world (cx, cy) maps to screen (ax, ay), scale k
    const p = E.io3(inv(2.5, 3.45, t));
    const k0 = S1.R / UR;
    const bx = busX(t);
    let k = lerp(k0, 1, p), cx = lerp(U_REST[0] + bx, 960, p), cy = lerp(U_REST[1], 540, p), ax = lerp(S1.ux, 960, p), ay = lerp(S1.uy, 540, p);
    const q = E.io3(inv(6.0, 6.5, t)); // a small push toward the umbrella before the iris
    k *= 1 + 0.16 * q; cx = lerp(cx, U_REST[0], q * 0.5); cy = lerp(cy, U_REST[1], q * 0.5);
    return { k, cx, cy, ax, ay };
  }
  const toScreen = (c, x, y) => [(x - c.cx) * c.k + c.ax, (y - c.cy) * c.k + c.ay];
  function umbrellaPose(t) {
    // starts tip-up and furled (matching S1's last frame), turns over and hooks onto the rail on beat 3.0
    const p = E.io3(inv(2.55, 3.0, t));
    const rot = Math.PI * p + Math.sin(Math.PI * clamp((t - 3.0) / 0.5)) * 0.06 * Math.exp(-(t - 3.0) * 4) * (t > 3 ? 1 : 0);
    return { rot, x: U_REST[0], y: U_REST[1] };
  }

  function busStop(ctx, t, wx) {
    const P = wx === 'sun' ? PAL.teal : PAL.navy;
    const cream = G.CREAM, far = mix(cream, P.t[2], 0.42);
    ctx.fillStyle = P.t[1]; ctx.fillRect(0, 0, W, H);
    const c = busCam(t), bx = busX(t);
    const dr = rowDrift(t, 5);
    const pat = G.pattern(P.key, wx === 'sun' ? 21 : 12, { spread: 0.5, density: 0.48, set: wx === 'sun' ? 'sun' : 'rain' });
    G.drawPattern(ctx, pat, (j) => dr(j) + bx * 0.5);
    ctx.save();
    ctx.translate(c.ax, c.ay); ctx.scale(c.k, c.k); ctx.translate(-c.cx, -c.cy);
    // sun (after the flip)
    if (wx === 'sun') {
      stageDisc(ctx, 330, 190, 150, P.t[0], t - 4);
      G.sunIcon(ctx, 330, 190, 62, PAL.yellow.t[4], t * 0.25);
    }
    // road
    ctx.fillStyle = P.t[0]; ctx.fillRect(-3000, 860, 9000, 900);
    ctx.fillStyle = P.t[1]; ctx.fillRect(-3000, 868, 9000, 92);
    ctx.fillStyle = rgba(cream, 0.5); ctx.fillRect(-3000, 860, 9000, 4); ctx.fillRect(-3000, 958, 9000, 3);
    // rain behind the bus
    if (wx === 'rain') {
      ctx.restore(); ctx.save();
      const roof = (x) => { const [wx0] = toScreen(c, BUS.x + bx, 0), [wx1, wy] = toScreen(c, BUS.x + bx + BUS.w, BUS.y); return x > wx0 + 30 && x < wx1 - 30 ? wy : null; };
      const [, roadY] = toScreen(c, 0, 862);
      rain(ctx, t, { col: P.t[4], scroll: bx * 0.6, roof: (x) => roof(x) ?? roadY });
      ctx.translate(c.ax, c.ay); ctx.scale(c.k, c.k); ctx.translate(-c.cx, -c.cy);
    }
    // stop sign
    const sx = 1700;
    G.seg(ctx, [sx, 860], [sx, 420], 16, far);
    G.rrect(ctx, sx - 110, 250, 220, 220, 26, cream);
    ctx.fillStyle = P.t[2]; ctx.font = F.en(900, 132); ctx.textAlign = 'center'; ctx.letterSpacing = '0px';
    ctx.fillText('4', sx - 40, 405);
    G.rrect(ctx, sx + 20, 300, 64, 46, 12, P.t[2]); // tiny bus glyph
    G.disc(ctx, sx + 34, 350, 9, P.t[2]); G.disc(ctx, sx + 70, 350, 9, P.t[2]);
    ctx.font = F.mono(26); ctx.letterSpacing = '2px'; ctx.textAlign = 'center';
    ctx.fillText('ELM ST', sx, 452);
    ctx.save(); ctx.translate(bx, 0); drawBus(ctx, P, doorO(t), bx / 66, null); ctx.restore();
    // the umbrella (moves with the bus)
    const up = umbrellaPose(t);
    G.umbrella(ctx, up.x + bx, up.y, UR, 0, up.rot, G.UMB, G.UMB2, G.UMB);
    // footprints out of the door (dry, the sun is out)
    if (wx === 'sun') {
      const steps = [[1320, 890], [1470, 934], [1620, 890], [1770, 934], [1920, 890]];
      steps.forEach(([fx, fy], k) => {
        const ts = 5.0 + k * 0.5;
        if (t < ts) return;
        const s = 44 * E.oExp(inv(ts, ts + 0.12, t));
        G.foot(ctx, fx, fy, s, Math.PI / 2 + (k % 2 ? 0.1 : -0.1), rgba(cream, 0.94), k % 2 ? 1 : -1);
      });
    }
    ctx.restore();
    return c;
  }

  // ───────── S5 · LEFT BEHIND ─────────
  const ST = { x: 1330, y: 500, r: 370, hook: [1330, 262], R: 200 };
  const bandBuf = G.canvas();
  function titleStage(ctx, t, lt) {
    const P = PAL.teal, cream = G.CREAM, far = P.far;
    stageDisc(ctx, ST.x, ST.y, ST.r, P.t[1], lt);
    // grab rail + seat (side view)
    G.seg(ctx, [1060, ST.hook[1]], [1610, ST.hook[1]], 18, far);
    G.seg(ctx, [1060, ST.hook[1]], [1060, 180], 18, far);
    G.seg(ctx, [1610, ST.hook[1]], [1610, 180], 18, far);
    G.seg(ctx, [1500, 560], [1530, 760], 58, cream);   // seat back
    G.seg(ctx, [1530, 778], [1190, 778], 58, cream);   // seat
    G.seg(ctx, [1360, 800], [1360, 850], 30, far);     // pedestal
    G.seg(ctx, [1290, 856], [1430, 856], 22, far);
    // umbrella hanging from the rail
    const R = ST.R, ox = ST.hook[0] - (-0.13) * R, oy = ST.hook[1] + 0.98 * R;
    const sway = Math.sin(lt * 2.4) * 0.025 * Math.exp(-lt * 0.6);
    ctx.save(); ctx.translate(ST.hook[0], ST.hook[1]); ctx.rotate(sway); ctx.translate(-ST.hook[0], -ST.hook[1]);
    G.umbrella(ctx, ox, oy, R, 0, Math.PI, G.UMB, G.UMB2, G.UMB);
    // drips from the ferrule
    const tip = [ox, oy + 0.74 * R + 6];
    for (const td of [9.0, 10.0]) {
      const grow = inv(td - 0.7, td, t), fall = inv(td, td + 0.24, t);
      if (grow <= 0 || fall >= 1) continue;
      const y = tip[1] + 10 + (778 - 29 - tip[1] - 10) * fall * fall;
      G.drop(ctx, tip[0], y, 9 * (0.4 + 0.6 * grow), PAL.sky.t[3]);
    }
    ctx.restore();
    for (const td of [9.0, 10.0]) {
      const sp = inv(td + 0.24, td + 0.7, t);
      if (sp <= 0 || sp >= 1) continue;
      ctx.globalAlpha = 1 - sp;
      G.disc(ctx, ox - 10 - 26 * sp, 742 - 22 * Math.sin(sp * Math.PI), 4.5, PAL.sky.t[3]);
      G.disc(ctx, ox + 10 + 26 * sp, 742 - 22 * Math.sin(sp * Math.PI), 4.5, PAL.sky.t[3]);
      ctx.globalAlpha = 1;
    }
  }
  function titleCard(ctx, t) {
    const lt = t - 6.5, P = PAL.teal, fg = P.fg;
    ctx.fillStyle = P.t[2]; ctx.fillRect(0, 0, W, H);
    const dr = rowDrift(lt, 9);
    G.drawPattern(ctx, G.pattern('teal', 31, { spread: 0.42, density: 0.42, set: 'sun' }), dr);
    // stage, assembled from horizontal bands sliding into register
    const asm = inv(0.0, 0.45, lt);
    if (asm >= 1) titleStage(ctx, t, lt);
    else {
      const b = bandBuf.getContext('2d'); b.setTransform(1, 0, 0, 1, 0, 0); b.clearRect(0, 0, W, H);
      titleStage(b, t, lt);
      const bh = 54;
      for (let j = 0; j * bh < H; j++) {
        const d = (j % 2 ? 1 : -1) * (90 + 160 * G.hash(j + 5)) * (1 - E.oExp(clamp(asm * 1.25 - (j % 5) * 0.04)));
        ctx.drawImage(bandBuf, 0, j * bh, W, bh, d, j * bh, W, bh);
      }
    }
    // type
    const x = 130;
    G.typeText(ctx, 'LINE 4   ·   STOP 03 / 12', x + 4, 236, F.mono(22), rgba(fg, 0.75), inv(0.15, 0.5, lt), { ls: '3px' });
    const k0 = 0.5; // title lands on beat 7.0
    const px = 214;
    G.maskText(ctx, 'LEFT', x - 6, 446, F.en(900, px), fg, inv(k0, k0 + 0.5, lt), { ls: -0.02 * px + 'px' });
    G.maskText(ctx, 'BEHIND', x - 6, 640, F.en(900, px), fg, inv(k0 + 0.08, k0 + 0.58, lt), { ls: -0.02 * px + 'px' });
    G.maskText(ctx, '被落下的伞', x, 744, F.zh(900, 74), fg, inv(k0 + 0.16, k0 + 0.66, lt), { ls: '6px' });
    // lost-property tag chip
    const tag = 'LOST ITEM  ·  UMBRELLA, YELLOW';
    ctx.save(); ctx.font = F.mono(20); ctx.letterSpacing = '3px';
    const tw = ctx.measureText(tag).width + 30, p = E.oExp(inv(k0 + 0.25, k0 + 0.6, lt));
    ctx.fillStyle = fg; ctx.fillRect(x, 786, tw * p, 40);
    ctx.beginPath(); ctx.rect(x, 786, tw * p, 40); ctx.clip();
    ctx.fillStyle = P.t[1]; ctx.fillText(tag, x + 15, 813);
    ctx.restore();
  }


  // ───────── shared pieces ─────────
  const pad2 = (n) => String(n).padStart(2, '0');
  function chip(ctx, x, y, text, fg, bg, p, px = 20) {
    if (p <= 0) return 0;
    ctx.save(); ctx.font = F.mono(px); ctx.letterSpacing = '3px'; ctx.textAlign = 'left';
    const tw = ctx.measureText(text).width + 30, h = Math.round(px * 2);
    ctx.fillStyle = bg; ctx.fillRect(x, y, tw * p, h);
    ctx.beginPath(); ctx.rect(x, y, tw * p, h); ctx.clip();
    ctx.fillStyle = fg; ctx.fillText(text, x + 15, y + px * 1.36);
    ctx.restore(); return tw;
  }
  // Title block: meta line, 1–2 title lines (mask slide-up), second-language line, tag chip. y = first title baseline.
  function textBlock(ctx, lt, x, y, o) {
    const k = o.k || 1, d0 = o.d0 || 0, fg = o.fg;
    const lines = Array.isArray(o.title) ? o.title : [o.title];
    let px = o.px;
    ctx.save(); ctx.font = F.en(900, px); ctx.letterSpacing = -0.02 * px + 'px';
    const wmax = Math.max(...lines.map((l) => ctx.measureText(l).width)); ctx.restore();
    if (o.maxW && wmax > o.maxW) px = Math.floor(px * o.maxW / wmax);
    const lh = o.lh || px * 0.92;
    if (o.meta) G.typeText(ctx, o.meta, x + 4, y - px * 0.74 - 34, F.mono(22), rgba(fg, 0.75), inv(d0, d0 + 0.35 * k, lt), { ls: '3px' });
    lines.forEach((ln, i) => G.maskText(ctx, ln, x - px * 0.03, y + i * lh, F.en(900, px), fg, inv(d0 + 0.08 * i * k, d0 + (0.5 + 0.08 * i) * k, lt), { ls: -0.02 * px + 'px' }));
    let yy = y + (lines.length - 1) * lh;
    if (o.zh) { yy += o.zpx + 28; G.maskText(ctx, o.zh, x, yy, F.zh(900, o.zpx), fg, inv(d0 + 0.16 * k, d0 + 0.66 * k, lt), { ls: '6px' }); }
    if (o.tag) chip(ctx, x, yy + 34, o.tag, o.tagFg, o.tagBg || fg, E.oExp(inv(d0 + 0.25 * k, d0 + 0.6 * k, lt)));
  }
  function roadBand(ctx, P, y) {
    ctx.fillStyle = P.t[0]; ctx.fillRect(0, y, W, H - y);
    ctx.fillStyle = P.t[1]; ctx.fillRect(0, y + 8, W, 92);
    ctx.fillStyle = rgba(G.CREAM, 0.5); ctx.fillRect(0, y, W, 4); ctx.fillRect(0, y + 98, W, 3);
  }
  // Stop sign on its pole. (x, yBase) = foot of the pole, s = scale.
  function stopSign(ctx, x, yBase, num, name, P, s = 1) {
    const cream = G.CREAM, far = mix(cream, P.t[2], 0.42);
    ctx.save(); ctx.translate(x, yBase); ctx.scale(s, s);
    G.seg(ctx, [0, 0], [0, -440], 16, far);
    G.rrect(ctx, -110, -610, 220, 220, 26, cream);
    ctx.fillStyle = P.t[2]; ctx.textAlign = 'center'; ctx.letterSpacing = '0px';
    const big = String(num);
    ctx.font = F.en(900, big.length > 1 ? 104 : 132); ctx.fillText(big, big.length > 1 ? -32 : -40, -455);
    G.rrect(ctx, 26, -560, 58, 42, 11, P.t[2]); G.disc(ctx, 39, -514, 8, P.t[2]); G.disc(ctx, 71, -514, 8, P.t[2]);
    ctx.font = F.mono(name.length > 7 ? 21 : 26); ctx.letterSpacing = '2px'; ctx.fillText(name, 0, -408);
    ctx.restore();
  }
  // The bus, drawn in its world frame (BUS rect); dO = doors open, roll = wheel turn, uRot = the umbrella's rotation (null = none)
  function drawBus(ctx, P, dO, roll, uRot) {
    const cream = G.CREAM, far = mix(cream, P.t[2], 0.42), inside = P.t[0];
    const { x, y, w, h } = BUS;
    G.rrect(ctx, x, y, w, h, 64, cream);
    G.rrect(ctx, x, y + h - 84, w, 84, [0, 0, 64, 64], far);
    for (const [a, b] of WIN) {
      G.rrect(ctx, a, 380, b - a, 220, 22, inside);
      ctx.save(); ctx.beginPath(); ctx.roundRect(a, 380, b - a, 220, 22); ctx.clip();
      G.rrect(ctx, a + 30, 520, 46, 120, 23, mix(cream, inside, 0.62));
      G.rrect(ctx, a + 110, 520, 46, 120, 23, mix(cream, inside, 0.62));
      G.seg(ctx, [a - 10, RAIL_Y], [b + 10, RAIL_Y], 7, mix(cream, inside, 0.45));
      ctx.restore();
    }
    G.rrect(ctx, DOOR[0] - 8, 372, DOOR[1] - DOOR[0] + 16, 442, 18, far);
    ctx.save(); ctx.beginPath(); ctx.rect(DOOR[0], 380, DOOR[1] - DOOR[0], 434); ctx.clip();
    ctx.fillStyle = mix(inside, G.INK, 0.4); ctx.fillRect(DOOR[0], 380, DOOR[1] - DOOR[0], 434);
    const pw = (DOOR[1] - DOOR[0]) / 2;
    for (const side of [-1, 1]) {
      const px = (side < 0 ? DOOR[0] : DOOR[0] + pw) + side * pw * 0.92 * dO;
      G.rrect(ctx, px + 4, 384, pw - 8, 426, 12, cream);
      G.rrect(ctx, px + 16, 396, pw - 32, 200, 10, inside);
      G.rrect(ctx, px + 16, 612, pw - 32, 170, 10, inside);
    }
    ctx.restore();
    G.rrect(ctx, 1424, 380, 40, 260, [10, 30, 30, 10], inside);
    G.disc(ctx, 1458, 742, 14, PAL.yellow.t[4]);
    G.rrect(ctx, 200, 344, 110, 26, 8, inside);
    ctx.fillStyle = cream; ctx.font = F.mono(19); ctx.letterSpacing = '2px'; ctx.textAlign = 'left'; ctx.fillText('4', 214, 364);
    G.rrect(ctx, 236, 353, 62, 8, 4, PAL.yellow.t[4]);
    for (const wxp of [420, 1120]) {
      G.disc(ctx, wxp, 820, 72, P.t[0]); G.disc(ctx, wxp, 820, 62, G.INK); G.disc(ctx, wxp, 820, 28, far);
      G.disc(ctx, wxp + Math.cos(roll) * 16, 820 + Math.sin(roll) * 16, 7, G.INK);
    }
    if (uRot != null) G.umbrella(ctx, U_REST[0], U_REST[1], UR, 0, uRot, G.UMB, G.UMB2, G.UMB);
  }
  const busAt = (ctx, sx, sy, s) => { ctx.translate(sx, sy); ctx.scale(s, s); ctx.translate(-BUS.x, -BUS.y); };

  // ───────── S6 · ALL DAY: the bus rides, the stops whip past ─────────
  const STREETS = ['ELM ST', 'MILL RD', 'PARK AVE', 'RIVER ST', 'HILL RD', 'OAK LANE'];
  const WHIPS = [11.0, 11.5, 12.0, 12.5, 13.0];
  const trackCam = (t) => 42 * (t - 10.5) + WHIPS.reduce((a, b) => a + W * E.ioExp(inv(b - 0.14, b + 0.24, t)), 0);
  function track(ctx, t) {
    const P = PAL.teal, lt = t - 10.5, fg = P.fg, cam = trackCam(t);
    ctx.fillStyle = P.t[1]; ctx.fillRect(0, 0, W, H);
    const dr = rowDrift(lt, 7);
    G.drawPattern(ctx, G.pattern('teal', 41, { spread: 0.5, density: 0.46, set: 'sun' }), (j) => dr(j) - cam * (j % 2 ? 0.5 : 0.32));
    G.sunIcon(ctx, 1480 - cam * 0.03, 170, 46, PAL.yellow.t[4], lt * 0.4);
    roadBand(ctx, P, 860);
    for (let k = 0; k < 6; k++) { const x = 1560 + k * W - cam; if (x > -300 && x < W + 300) stopSign(ctx, x, 860, k + 3, STREETS[k], P, 0.8); }
    ctx.save(); busAt(ctx, 300, 500 + Math.sin(lt * 9) * 2, 0.62); drawBus(ctx, P, 0, cam / 41, Math.PI); ctx.restore();
    textBlock(ctx, lt, 130, 300, { meta: 'CH.02   ·   LINE 4', title: 'ALL DAY', px: 170, zh: '一整天', zpx: 66, fg, d0: 0.1, k: 0.8 });
  }

  // ───────── S7 · pace ladder: the clock runs, the umbrella stays ─────────
  const LAD = [
    { tm: '10:00', zh: '上午十点', pk: 'teal', tag: 'NOT NEEDED', stop: 9, h: 10 },
    { tm: '14:00', zh: '下午两点', pk: 'sky', tag: 'STILL HERE', stop: 10, h: 14 },
    { tm: '18:00', zh: '傍晚六点', pk: 'coral', tag: 'NO RAIN TODAY', stop: 11, h: 18 },
  ];
  function ladder(ctx, t, i) {
    const c = LAD[i], P = PAL[c.pk], lt = t - (13.5 + i), fg = P.fg, light = fg !== G.CREAM;
    ctx.fillStyle = P.t[2]; ctx.fillRect(0, 0, W, H);
    G.drawPattern(ctx, G.pattern(c.pk, 50 + i, { spread: 0.42, density: 0.42, set: 'sun' }), rowDrift(lt + i, 11 + i));
    const cx = 1260, cy = 540, r = 350;
    stageDisc(ctx, cx, cy, r, light ? P.t[4] : P.t[1], lt + 0.6);
    const h0 = i ? LAD[i - 1].h : 8.5, hh = lerp(h0, c.h, E.oExp(inv(0, 0.4, lt)));
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      G.seg(ctx, [cx + Math.cos(a) * r * 0.8, cy + Math.sin(a) * r * 0.8], [cx + Math.cos(a) * r * 0.88, cy + Math.sin(a) * r * 0.88], 10, rgba(fg, 0.45));
    }
    const ha = ((hh % 12) / 12) * Math.PI * 2 - Math.PI / 2, ma = (hh % 1) * Math.PI * 2 - Math.PI / 2;
    G.seg(ctx, [cx, cy], [cx + Math.cos(ma) * r * 0.66, cy + Math.sin(ma) * r * 0.66], 18, rgba(fg, 0.8));
    G.seg(ctx, [cx, cy], [cx + Math.cos(ha) * r * 0.44, cy + Math.sin(ha) * r * 0.44], 32, fg);
    G.disc(ctx, cx, cy, 24, fg);
    // the sun walks the rim: 06:00 on the left, noon on top, 18:00 on the right
    const sa = Math.PI + ((hh - 6) / 12) * Math.PI;
    G.sunIcon(ctx, cx + Math.cos(sa) * (r + 4), cy + Math.sin(sa) * (r + 4), 38, PAL.yellow.t[4], lt);
    // the umbrella, still on its rail
    const far = light ? mix(fg, P.t[2], 0.55) : P.far, hk = [1630, 330], R = 150;
    G.seg(ctx, [1520, hk[1]], [1740, hk[1]], 14, far); G.seg(ctx, [1520, hk[1]], [1520, 260], 14, far); G.seg(ctx, [1740, hk[1]], [1740, 260], 14, far);
    G.umbrella(ctx, hk[0] + 0.13 * R, hk[1] + 0.98 * R, R, 0, Math.PI, G.UMB, G.UMB2, G.UMB);
    textBlock(ctx, lt, 130, 540, { meta: `LINE 4   ·   STOP ${pad2(c.stop)} / 12`, title: c.tm, px: 230, zh: c.zh, zpx: 70, tag: c.tag, tagFg: P.t[1], fg, k: 0.7, maxW: 760 });
  }

  // ───────── S8 · LAST STOP: the sun goes down, the moon comes up ─────────
  function lastStop(ctx, t) {
    const P = PAL.navy, lt = t - 16.5, fg = P.fg;
    ctx.fillStyle = P.t[1]; ctx.fillRect(0, 0, W, H);
    G.drawPattern(ctx, G.pattern('navy', 61, { spread: 0.5, density: 0.44, set: 'sun' }), rowDrift(lt, 4));
    // sun sets behind the road, then the moon rises
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, 860); ctx.clip();
    const sy = lerp(240, 960, E.io3(inv(0.0, 0.9, lt)));
    G.sunIcon(ctx, 1330, sy, 58, PAL.yellow.t[4], lt * 0.3);
    ctx.restore();
    const mp = E.oExp(inv(1.0, 1.5, lt));
    if (mp > 0) { stageDisc(ctx, 1330, 230, 120 * mp, P.t[0], lt - 1.0); G.moon(ctx, 1330, 230, 56 * mp, PAL.yellow.t[4]); }
    roadBand(ctx, P, 860);
    stopSign(ctx, 1640, 860, 12, 'DEPOT', P, 1.0);
    const bx = lerp(-760, 300, E.o3(inv(0, 0.5, lt)));
    ctx.save(); busAt(ctx, bx, 500, 0.62); drawBus(ctx, P, 0, bx / 41, Math.PI); ctx.restore();
  }

  // ───────── S9 · LOST & FOUND chapter card ─────────
  function lostSign(ctx, x, y, s, P) { // our own lost-property sign: umbrella + question mark on a rounded square
    G.rrect(ctx, x - s / 2, y - s / 2, s, s, s * 0.14, G.CREAM);
    G.umbrella(ctx, x - s * 0.13, y - s * 0.02, s * 0.27, 1, 0, P.t[0], P.t[0], P.t[0]);
    ctx.save(); ctx.fillStyle = P.t[2]; ctx.font = F.en(900, s * 0.6); ctx.textAlign = 'center'; ctx.letterSpacing = '0px';
    ctx.fillText('?', x + s * 0.27, y + s * 0.23); ctx.restore();
  }
  function lost(ctx, t) {
    const P = PAL.coral, lt = t - 18.5, fg = P.fg;
    ctx.fillStyle = P.t[2]; ctx.fillRect(0, 0, W, H);
    const step = (j) => [19.5, 20.0, 20.5].reduce((a, b) => a + E.oExp(inv(b, b + 0.35, t)) * (j % 2 ? 1 : -1) * CELL * 0.25, 0);
    const dr = rowDrift(lt, 3, 30);
    G.drawPattern(ctx, G.pattern('coral', 71, { spread: 0.95, density: 0.55, set: 'sun' }), (j) => dr(j) + step(j));
    const bp = E.o5(inv(0.0, 0.4, lt)), by = 2 * CELL - 90, bh = 2 * CELL;
    ctx.fillStyle = P.t[0]; ctx.fillRect(W / 2 - (W / 2) * bp, by, W * bp, bh);
    ctx.save(); ctx.beginPath(); ctx.rect(0, by, W, bh); ctx.clip();
    const sc = lerp(1.4, 1, E.oExp(inv(0.05, 0.35, lt)));
    lostSign(ctx, 330, by + bh / 2, 250 * sc, P);
    G.typeText(ctx, 'CH.03   ·   DEPOT, LINE 4', 564, by + 70, F.mono(22), rgba(fg, 0.75), inv(0.15, 0.6, lt), { ls: '4px' });
    G.maskText(ctx, 'LOST & FOUND', 556, by + 222, F.en(900, 150), fg, inv(0.05, 0.45, lt), { ls: '-3px' });
    G.maskText(ctx, '失物招领', 562, by + 312, F.zh(900, 66), fg, inv(0.1, 0.5, lt), { ls: '6px' });
    ctx.restore();
    G.hair(ctx, W / 2 - (W / 2) * bp, by - 10, W * bp, rgba(fg, 0.5), 1, 2);
    G.hair(ctx, W / 2 - (W / 2) * bp, by + bh + 8, W * bp, rgba(fg, 0.5), 1, 2);
    // our umbrella gets its number
    const tp = E.oExp(inv(1.0, 1.3, lt));
    if (tp > 0) {
      G.seg(ctx, [330, by + bh + 8], [330, by + bh + 8 + 40 * tp], 4, fg);
      chip(ctx, 250, by + bh + 46, 'No. 313', P.t[0], G.CREAM, tp, 24);
    }
  }

  // ───────── S10–S11 · the shelf: pull back to all 313, then the days pass ─────────
  const WALL = { cols: 20, rows: 16, c: 90 };
  const OURS = [11, 7];
  const ITEMS = { '3,2': 0, '16,4': 1, '7,12': 2, '13,14': 3, '1,9': 0, '18,11': 2, '9,3': 1 };
  const LOSTCOLS = [PAL.ink.t[3], PAL.navy.t[3], PAL.teal.t[3], PAL.navy.t[4], PAL.coral.t[0], PAL.ink.t[4], PAL.sky.t[0], PAL.teal.t[1]];
  // o: { open(i,j) 0..1, sweep(i,j) 0..1 to yellow, shift(j) px, bg }
  function drawWall(ctx, cam, t, o = {}) {
    const c = WALL.c;
    ctx.save(); ctx.translate(cam.ax, cam.ay); ctx.scale(cam.k, cam.k); ctx.translate(-cam.cx, -cam.cy);
    const x0 = cam.cx - cam.ax / cam.k - c, x1 = cam.cx + (W - cam.ax) / cam.k + c, y0 = cam.cy - cam.ay / cam.k - c, y1 = cam.cy + (H - cam.ay) / cam.k + c;
    const coral = PAL.coral;
    for (let j = 0; j < WALL.rows; j++) {
      const sh = o.shift ? o.shift(j) : 0, cy = j * c;
      if (cy > y1 || cy + c < y0) continue;
      for (let i = -1; i <= WALL.cols; i++) {
        const ii = ((i % WALL.cols) + WALL.cols) % WALL.cols;
        const cx = i * c + sh;
        if (cx > x1 || cx + c < x0) continue;
        if ((i < 0 || i >= WALL.cols) && !sh) continue;
        const h = G.hash(ii * 31 + j * 7 + 5), sw = o.sweep ? o.sweep(ii, j) : 0;
        const yel = PAL.yellow.t[2 + Math.floor(h * 3)], op0 = o.open ? Math.min(1, o.open(ii, j)) : 0;
        const frameCol = mix(coral.t[0], PAL.yellow.t[0], sw);
        ctx.fillStyle = frameCol; ctx.fillRect(cx, cy, c + 0.5, c + 0.5);
        G.rrect(ctx, cx + 4, cy + 4, c - 8, c - 8, 8, mix(mix(coral.t[1], PAL.yellow.t[1], sw), frameCol, op0));
        const key = ii + ',' + j;
        const ours = ii === OURS[0] && j === OURS[1];
        if (ITEMS[key] != null) { G.item(ctx, ITEMS[key], cx + c / 2, cy + c / 2, c, mix(LOSTCOLS[Math.floor(h * 8)], yel, sw)); continue; }
        const op = o.open ? o.open(ii, j) : 0;
        const col = ours ? G.UMB : mix(LOSTCOLS[Math.floor(h * 8)], yel, sw), col2 = ours ? G.UMB2 : mix(col, '#000000', 0.22);
        const R = c * lerp(0.4, 0.8, Math.min(1, op));
        G.umbrella(ctx, cx + c / 2, cy + c * lerp(0.5, 0.62, Math.min(1, op)), R, op, 0, col, col2, col);
      }
    }
    ctx.restore();
  }
  const WALL_C = [WALL.cols * WALL.c / 2, WALL.rows * WALL.c / 2];
  const OURS_C = [(OURS[0] + 0.5) * WALL.c, (OURS[1] + 0.5) * WALL.c];
  function wallCam(t) {
    const p = E.io3(inv(21.65, 24.0, t));
    let k = lerp(4.2, 0.62, p), cx = lerp(OURS_C[0], WALL_C[0], p), cy = lerp(OURS_C[1], WALL_C[1], p), ax = lerp(1300, 1310, p), ay = lerp(520, 545, p);
    const q = E.io3(inv(25.0, 25.7, t)); // S11: push back in and drift along the shelf
    if (q > 0) {
      const drift = 46 * Math.max(0, Math.min(t, 27.5) - 25.0);
      k = lerp(k, 1.45, q); cx = lerp(cx, OURS_C[0] + 140 - drift, q); cy = lerp(cy, OURS_C[1] - 30, q); ax = lerp(ax, 1320, q); ay = lerp(ay, 470, q);
    }
    return { k, cx, cy, ax, ay };
  }
  function wall(ctx, t) {
    const P = PAL.coral, fg = P.fg, lt = t - 21.5;
    ctx.fillStyle = P.t[0]; ctx.fillRect(0, 0, W, H);
    drawWall(ctx, wallCam(t), t);
    // the counting panel
    const pp = E.o5(inv(0.5, 0.9, lt)), pw = 720;
    if (pp <= 0) return;
    ctx.fillStyle = P.t[1]; ctx.fillRect(0, 0, pw * pp, H);
    ctx.fillStyle = rgba(fg, 0.35); ctx.fillRect(pw * pp - 3, 0, 3, H);
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, pw * pp, H); ctx.clip();
    const n = Math.max(1, Math.round(1 + 312 * E.o3(inv(22.1, 24.0, t))));
    const slam = t >= 24.0 ? 1 + 0.07 * Math.exp(-(t - 24.0) * 9) : 1;
    G.typeText(ctx, 'CH.03   ·   SHELF A–T', 94, 236, F.mono(22), rgba(fg, 0.75), inv(0.6, 1.0, lt), { ls: '3px' });
    ctx.save(); ctx.translate(90, 470); ctx.scale(slam, slam);
    ctx.font = F.en(900, 270); ctx.letterSpacing = '-8px'; ctx.fillStyle = fg; ctx.textAlign = 'left'; ctx.fillText(String(n), 0, 0);
    ctx.restore();
    const tp = inv(2.5, 3.0, lt);
    G.maskText(ctx, '把被落下的伞', 96, 552, F.zh(900, 56), fg, tp, { ls: '4px' });
    G.maskText(ctx, 'UMBRELLAS, LEFT ON SUNNY DAYS', 98, 610, F.mono(22), rgba(fg, 0.8), inv(2.6, 3.1, lt), { ls: '2px' });
    // S11: the days go by, all of them dry
    const days = [26.0, 26.25, 26.5, 26.75, 27.0, 27.25, 27.5, 27.75].filter((b) => t >= b).length;
    const dp = E.oExp(inv(24.85, 25.2, t));
    if (dp > 0) {
      G.hair(ctx, 96, 650, 540 * dp, rgba(fg, 0.45), 1, 2);
      for (let d = 0; d < days + 1; d++) {
        const ap = d === 0 ? dp : E.oExp(inv(25.75 + d * 0.25, 25.95 + d * 0.25, t));
        G.sunIcon(ctx, 116 + d * 62, 704, 13 * ap, PAL.yellow.t[4], 0);
      }
      G.maskText(ctx, 'DAY ' + pad2(days + 1) + '  ·  NO RAIN', 98, 776, F.mono(24), fg, dp, { ls: '2px' });
      G.maskText(ctx, '一直没下雨', 96, 836, F.zh(900, 40), fg, inv(24.85, 25.2, t), { ls: '4px' });
    }
    ctx.restore();
  }

  // ───────── S12 · STORM ─────────
  function storm(ctx, t) {
    const P = PAL.ink, lt = t - 28, fg = P.fg;
    ctx.fillStyle = P.t[1]; ctx.fillRect(0, 0, W, H);
    const gust = (j) => [29.0, 29.5, 30.0, 30.5].reduce((a, b) => a + E.oExp(inv(b, b + 0.3, t)) * (j % 2 ? 1 : -1) * CELL * 0.5, 0);
    G.drawPattern(ctx, G.pattern('ink', 81, { spread: 1, density: 0.55, set: 'rain' }), (j) => (j % 2 ? 1 : -1) * lt * 90 + gust(j));
    stageDisc(ctx, 1330, 500, 370, P.t[3], lt);
    const fl = Math.max(Math.exp(-lt * 10) * (lt >= 0 ? 1 : 0), t >= 29.5 ? Math.exp(-(t - 29.5) * 10) : 0);
    if (fl > 0.05) G.bolt(ctx, 1316, 420, 380, rgba(PAL.yellow.t[2], Math.min(1, fl * 1.6)));
    G.cloud(ctx, 1330, 470, 250, mix(G.CREAM, P.t[3], 0.3));
    rain(ctx, t, { col: '#8e9ab3', v: 1100, slant: 0.22, r: 6.5 });
    textBlock(ctx, lt, 130, 560, { meta: 'CH.04   ·   18:05   ·   RUSH HOUR', title: 'STORM', px: 250, zh: '暴雨', zpx: 96, fg, d0: 0.0, k: 0.8 });
    if (fl > 0.02) { ctx.fillStyle = rgba(G.CREAM, 0.45 * fl); ctx.fillRect(0, 0, W, H); }
  }

  // ───────── S13 · split: the wet stop and the dry shelf ─────────
  function split(ctx, t) {
    const lt = t - 31, P = PAL.ink, fg = P.fg;
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W / 2, H); ctx.clip();
    ctx.fillStyle = P.t[1]; ctx.fillRect(0, 0, W / 2, H);
    G.drawPattern(ctx, G.pattern('ink', 82, { spread: 0.8, density: 0.5, set: 'rain' }), (j) => (j % 2 ? 1 : -1) * (lt + 2) * 90);
    roadBand(ctx, P, 860);
    stopSign(ctx, 700, 860, 4, 'ELM ST', PAL.navy, 1.0);
    // people waiting: pairs of footprints facing the road, puddles round them
    const feet = [[150, 790], [300, 806], [450, 784], [560, 820]];
    feet.forEach(([x, y], k) => {
      for (let q = 0; q < 2; q++) {
        const pr = ((lt * 1.6 + G.hash(k * 5 + q)) % 1);
        ctx.globalAlpha = 1 - pr; G.ring(ctx, x + (q ? 46 : -46), y + 30, 14 + 50 * pr, 3, '#8e9ab3'); ctx.globalAlpha = 1;
      }
      G.foot(ctx, x - 20, y, 38, 0, rgba(G.CREAM, 0.9), -1); G.foot(ctx, x + 20, y, 38, 0, rgba(G.CREAM, 0.9), 1);
    });
    rain(ctx, t, { col: '#8e9ab3', v: 1100, slant: 0.22, r: 6.5 });
    chip(ctx, 64, 150, 'ELM ST  ·  18:07  ·  WAITING', P.t[1], G.CREAM, E.oExp(inv(0.1, 0.4, lt)), 22);
    G.maskText(ctx, '等车的人', 66, 260, F.zh(900, 48), fg, inv(0.1, 0.4, lt), { ls: '4px' });
    ctx.restore();
    // right: the shelf, dry
    ctx.save(); ctx.beginPath(); ctx.rect(W / 2, 0, W / 2, H); ctx.clip();
    ctx.fillStyle = PAL.coral.t[0]; ctx.fillRect(W / 2, 0, W / 2, H);
    drawWall(ctx, { k: 1.15, cx: OURS_C[0] - 60 + lt * 20, cy: OURS_C[1] + 40, ax: 1440, ay: 560 }, t);
    chip(ctx, W / 2 + 40, 150, 'DEPOT  ·  313 DRY', PAL.coral.t[0], G.CREAM, E.oExp(inv(0.15, 0.45, lt)), 22);
    G.maskText(ctx, '伞是干的', W / 2 + 42, 260, F.zh(900, 48), G.CREAM, inv(0.15, 0.45, lt), { ls: '4px' });
    ctx.restore();
    ctx.fillStyle = G.CREAM; ctx.fillRect(W / 2 - 3, 0, 6, H);
  }

  // ───────── S14 · the shutter rolls up, the sign turns ─────────
  const SHUT = [35.0, 35.25, 35.5, 35.75, 36.0, 36.25];
  const bloomCam = (t) => { const p = E.io3(inv(36.5, 40.5, t)); return { k: lerp(1.1, 0.8, p), cx: WALL_C[0], cy: WALL_C[1], ax: 960, ay: 540 }; };
  function shutter(ctx, t) {
    const lt = t - 34, P = PAL.ink, fg = P.fg;
    ctx.fillStyle = PAL.coral.t[0]; ctx.fillRect(0, 0, W, H);
    drawWall(ctx, bloomCam(36.5), t);
    const n = SHUT.reduce((a, b) => a + E.oExp(inv(b, b + 0.2, t)), 0);
    const off = -n * CELL;
    for (let j = 0; j < 6; j++) {
      const y = j * CELL + off;
      if (y + CELL < 0) continue;
      ctx.fillStyle = P.t[3]; ctx.fillRect(0, y, W, CELL);
      for (let g = 0; g < 3; g++) { ctx.fillStyle = P.t[1]; ctx.fillRect(0, y + 34 + g * 50, W, 14); }
      ctx.fillStyle = P.t[4]; ctx.fillRect(0, y, W, 4);
    }
    G.rrect(ctx, 0, 6 * CELL + off - 26, W, 26, 0, P.t[0]);
    // the sign: CLOSED turns to TAKE ONE on beat 34.0, then drops away as the last row goes up
    const sx = 400, drop = E.i3(inv(36.25, 36.5, t)) * 900;
    ctx.save(); ctx.translate(0, drop);
    G.seg(ctx, [sx, 1080], [sx, 600], 18, P.t[4]);
    const fp = inv(34.5, 34.8, t), sxs = Math.abs(Math.cos(fp * Math.PI)), back = fp >= 0.5;
    ctx.save(); ctx.translate(sx, 430); ctx.scale(Math.max(0.02, sxs), 1);
    if (!back) {
      G.rrect(ctx, -190, -190, 380, 380, 40, P.t[0]);
      ctx.fillStyle = G.CREAM; ctx.textAlign = 'center'; ctx.font = F.en(900, 84); ctx.letterSpacing = '-1px'; ctx.fillText('CLOSED', 0, 10);
      ctx.font = F.zh(900, 52); ctx.letterSpacing = '8px'; ctx.fillText('休息', 0, 100);
    } else {
      G.rrect(ctx, -190, -190, 380, 380, 40, PAL.yellow.t[2]);
      G.umbrella(ctx, -60, -40, 80, 1, 0, PAL.yellow.fg, PAL.yellow.fg, PAL.yellow.fg);
      G.seg(ctx, [40, -40], [120, -40], 22, PAL.yellow.fg);
      G.poly(ctx, [[150, -40], [110, -78], [110, -2]], PAL.yellow.fg);
      ctx.fillStyle = PAL.yellow.fg; ctx.textAlign = 'center'; ctx.font = F.en(900, 76); ctx.letterSpacing = '-1px'; ctx.fillText('TAKE ONE', 0, 110);
      ctx.font = F.zh(900, 44); ctx.letterSpacing = '6px'; ctx.fillText('拿一把', 0, 166);
    }
    ctx.restore(); ctx.restore();
    G.typeText(ctx, 'CH.04   ·   DEPOT, 18:10', 134, 236, F.mono(22), rgba(fg, 0.75), inv(0.1, 0.5, lt) * (1 - inv(35.0, 35.2, t)), { ls: '3px' });
  }

  // ───────── S15 · BLOOM: 313 umbrellas open at once and become the pattern ─────────
  function bloomOpen(i, j, t) { const d = 36.5 + Math.hypot(i - OURS[0], j - OURS[1]) * 0.014; return E.oExp(inv(d, d + 0.32, t)); }
  function bloomSweep(i, j, t) { const s = 37.5 + j * 0.07; return E.io3(inv(s, s + 0.3, t)); }
  const bloomShift = (t) => (j) => [39.0, 39.5, 40.0].reduce((a, b) => a + E.oExp(inv(b, b + 0.3, t)) * (j % 2 ? 1 : -1) * WALL.c * 0.5, 0);
  function bloom(ctx, t) {
    const lt = t - 36.5;
    ctx.fillStyle = PAL.yellow.t[0]; ctx.fillRect(0, 0, W, H);
    G.drawPattern(ctx, G.pattern('yellow', 91, { spread: 0.8, density: 0.5, set: 'rain' }), (j) => rowDrift(lt, 6)(j) + bloomShift(t)(j) * 0.74);
    drawWall(ctx, bloomCam(t), t, { open: (i, j) => bloomOpen(i, j, t), sweep: (i, j) => bloomSweep(i, j, t), shift: bloomShift(t) });
    rain(ctx, t, { col: PAL.sky.t[3], v: 900, r: 6.5 });
  }

  // ───────── S16 · EVERY STOP: the umbrellas run down Line 4 ─────────
  const RX = (i) => 180 + i * (1560 / 11), RY = 610;
  const reach = (i) => 41.0 + (11 - i) * 0.25; // stop index i (0 = stop 01) is reached at…
  function route(ctx, t) {
    const P = PAL.navy, lt = t - 40.5, fg = P.fg;
    ctx.fillStyle = P.t[1]; ctx.fillRect(0, 0, W, H);
    G.drawPattern(ctx, G.pattern('navy', 101, { spread: 0.45, density: 0.44, set: 'rain' }), rowDrift(lt, 8));
    rain(ctx, t, { col: P.t[4], v: 800, r: 6 });
    const p = E.io3(inv(40.5, 41.8, t));
    const k = lerp(1.8, 1, p), cx = lerp(RX(11) - 80, 960, p), cy = lerp(RY, 540, p);
    ctx.save(); ctx.translate(960, 540); ctx.scale(k, k); ctx.translate(-cx, -cy);
    const far = P.far;
    G.seg(ctx, [RX(0), RY], [RX(11), RY], 22, far);
    const front = lerp(RX(11), RX(0), clamp((t - 41.0) / 2.75));
    if (t > 40.75) G.seg(ctx, [front, RY], [RX(11), RY], 22, PAL.yellow.t[2]);
    // the stream of umbrellas, running left along the line
    if (t > 40.75) for (let x = RX(11) - ((t * 280) % 42); x > front; x -= 42) G.umbrella(ctx, x, RY - 30, 17, 1, 0, PAL.yellow.t[3], PAL.yellow.t[1], PAL.yellow.t[3]);
    for (let i = 0; i < 12; i++) {
      const x = RX(i), r = reach(i), q = E.oExp(inv(r, r + 0.25, t));
      G.disc(ctx, x, RY, 26, q > 0 ? mix(G.CREAM, PAL.yellow.t[2], q) : G.CREAM); G.disc(ctx, x, RY, 11, P.t[0]);
      for (let u = 0; u < 3; u++) {
        const qq = E.oExp(inv(r + u * 0.06, r + u * 0.06 + 0.22, t));
        if (qq > 0) G.umbrella(ctx, x + (u - 1) * 30, RY - 66 - (u === 1 ? 16 : 0), 26 * qq, qq, 0, G.UMB, G.UMB2, G.UMB);
      }
      ctx.fillStyle = rgba(fg, 0.8); ctx.font = F.mono(20); ctx.letterSpacing = '2px'; ctx.textAlign = 'center';
      ctx.fillText(pad2(i + 1), x, RY + 64);
      if (i === 2 || i === 11) { ctx.fillStyle = fg; ctx.fillText(i === 2 ? 'ELM ST' : 'DEPOT', x, RY + 96); }
    }
    ctx.restore();
    textBlock(ctx, lt, 130, 300, { meta: 'CH.05   ·   LINE 4, ALL STOPS', title: 'EVERY STOP', px: 150, zh: '每一站', zpx: 60, fg, d0: 0.3 });
  }

  // ───────── S17 · the next morning, 07:42 again ─────────
  function echo(ctx, t) {
    const P = PAL.navy, lt = t - 44.0;
    const push = 1 + 0.05 * E.io(lt / 2.5);
    ctx.save(); ctx.translate(960, 540); ctx.scale(push, push); ctx.translate(-960, -540);
    ctx.fillStyle = P.t[1]; ctx.fillRect(-100, -100, W + 200, H + 200);
    const cam = 300 * lt;
    G.drawPattern(ctx, G.pattern('navy', 11, { spread: 0.55, density: 0.5, set: 'rain' }), (j) => rowDrift(lt, 2)(j) - cam * 0.35);
    stageDisc(ctx, S1.ux, S1.uy + 30, 430, P.t[0], lt);
    const steps = [44.5, 45.0, 45.5, 46.0];
    const bob = 7 * steps.reduce((a, b) => a + (t > b ? Math.exp(-(t - b) * 9) * Math.sin((t - b) * 18) : 0), 0);
    const ux = S1.ux, uy = S1.uy + bob, R = S1.R;
    const domeY = (x) => { const dx = (x - ux) / R; return Math.abs(dx) > 1 ? null : uy - 0.62 * R * Math.sqrt(1 - dx * dx); };
    // puddles all round, none under the umbrella
    for (let k = 0; k < 40; k++) {
      const ph = (lt * 2.2 + G.hash(k + 900)) % 1, n = Math.floor(lt * 2.2 + G.hash(k + 900));
      const x = 120 + G.hash(k * 13 + n * 7) * 1680, y = 760 + G.hash(k * 3 + n * 11) * 110;
      if (Math.abs(x - ux) < R * 1.05) continue;
      ctx.globalAlpha = 1 - ph; G.ring(ctx, x, y, 10 + 40 * ph, 3, P.t[4]); ctx.globalAlpha = 1;
    }
    rain(ctx, t, { col: P.t[4], scroll: cam * 0.6, roof: domeY });
    steps.forEach((ts, k) => {
      if (t < ts) return;
      const sy = k % 2 ? 848 : 796, x = 1000 - 300 * (t - ts);
      const a = 1 - inv(ts + 1.2, ts + 2.4, t);
      if (a <= 0) return;
      ctx.globalAlpha = a; G.foot(ctx, x, sy, 44 * E.oExp(inv(ts, ts + 0.12, t)), Math.PI / 2 + (k % 2 ? 0.1 : -0.1), rgba(G.CREAM, 0.92), k % 2 ? 1 : -1); ctx.globalAlpha = 1;
    });
    G.umbrella(ctx, ux, uy, R, 1, 0, G.UMB, G.UMB2, G.UMB);
    ctx.restore();
  }

  // ───────── S18 · end card ─────────
  function endCard(ctx, t) {
    const P = PAL.navy, lt = t - 46.5, fg = P.fg;
    ctx.fillStyle = P.t[1]; ctx.fillRect(0, 0, W, H);
    const dr = rowDrift(1, 2);
    G.drawPattern(ctx, G.pattern('navy', 11, { spread: 0.45, density: 0.5, set: 'rain' }), (j) => dr(j) + (j % 2 ? 1 : -1) * 26 * Math.min(lt, 0.2 + j * 0.18));
    stageDisc(ctx, 1330, 470, 330, P.t[0], lt + 0.5);
    G.umbrella(ctx, 1330, 450, 200, E.oExp(inv(0.1, 0.5, lt)), 0, G.UMB, G.UMB2, G.UMB);
    const x = 130;
    G.maskText(ctx, 'LEFT BEHIND', x - 4, 420, F.en(900, 150), fg, inv(0.0, 0.4, lt), { ls: '-3px' });
    G.maskText(ctx, '被落下的伞', x, 510, F.zh(900, 64), fg, inv(0.05, 0.45, lt), { ls: '6px' });
    G.hair(ctx, x, 562, 700, rgba(fg, 0.55), E.oExp(inv(0.3, 0.8, lt)), 2);
    G.maskText(ctx, 'PICTOGRAM MOTION', x, 624, F.mono(26), fg, inv(0.35, 0.8, lt), { ls: '3px' });
    ctx.save(); ctx.font = F.mono(26); ctx.letterSpacing = '3px'; const pw = ctx.measureText('PICTOGRAM MOTION').width; ctx.restore();
    G.maskText(ctx, '象形运动图形', x + pw + 28, 626, F.zh(700, 30), fg, inv(0.4, 0.85, lt), { ls: '3px' });
    G.maskText(ctx, 'LemoLab × Claude Opus 5.5', x, 690, F.mono(28), fg, inv(0.5, 0.95, lt), { ls: '2px' });
  }

  // ───────── HUD + subtitles ─────────
  function palAt(t) {
    if (t < 4.25) return PAL.navy;
    if (t < 12.5) return PAL.teal;
    if (t < 13.5) return PAL.teal;
    if (t < 16.5) return PAL[LAD[Math.min(2, Math.floor(t - 13.5))].pk];
    if (t < 18.5) return PAL.navy;
    if (t < 28) return PAL.coral;
    if (t < 37.7) return PAL.ink;
    if (t < 40.5) return PAL.yellow;
    return PAL.navy;
  }
  const CHS = [[0, '01', 'RAIN'], [10.5, '02', 'THE LINE'], [18.5, '03', 'LOST & FOUND'], [28, '04', 'STORM'], [36.5, '05', 'BLOOM'], [44, '06', 'RAIN']];
  function hudInfo(t) {
    if (t < 4.25) return { time: '07:42', wx: 'SHOWERS', g: 'cloud', cur: t < 3.5 ? 2 : 3 };
    if (t < 10.5) return { time: '07:51', wx: 'CLEARING', g: 'sun', cur: 3 };
    if (t < 13.5) return { time: '08:30', wx: 'SUNNY', g: 'sun', cur: 3 + WHIPS.filter((b) => t >= b).length };
    if (t < 16.5) { const c = LAD[Math.min(2, Math.floor(t - 13.5))]; return { time: c.tm, wx: 'SUNNY', g: 'sun', cur: c.stop }; }
    if (t < 18.5) return { time: '19:40', wx: 'DUSK', g: 'moon', cur: 12 };
    if (t < 25) return { time: '20:15', wx: 'CLEAR NIGHT', g: 'moon', cur: 12 };
    if (t < 28) return { time: 'DAY ' + pad2(1 + [26.0, 26.25, 26.5, 26.75, 27.0, 27.25, 27.5, 27.75].filter((b) => t >= b).length), wx: 'SUNNY', g: 'sun', cur: 12 };
    if (t < 40.5) return { time: t < 31 ? '18:05' : t < 34 ? '18:07' : t < 36.5 ? '18:10' : '18:12', wx: 'STORM', g: 'storm', cur: 12 };
    if (t < 44) return { time: '18:20', wx: 'STORM', g: 'storm', cur: 0, lit: (i) => t >= reach(i - 1) };
    return { time: '07:42', wx: 'SHOWERS', g: 'cloud', cur: 3 };
  }
  function hud(ctx, t, P) {
    if (t >= 46.5) return;
    const fg = P.fg, info = hudInfo(t), ch = CHS.filter((c) => c[0] <= t).pop();
    ctx.save();
    ctx.font = F.mono(17); ctx.letterSpacing = '3px'; ctx.fillStyle = rgba(fg, 0.8); ctx.textAlign = 'left';
    ctx.fillText('LINE 4', 64, 70); ctx.fillText(info.time, 64, 96);
    ctx.textAlign = 'right';
    ctx.fillText('CH.' + ch[1] + '   ' + ch[2], W - 64, 70); ctx.fillText(info.wx, W - 64, 96);
    ctx.font = F.mono(17); const ww = ctx.measureText(info.wx).width;
    const gx = W - 64 - ww - 26, col = rgba(fg, 0.8);
    if (info.g === 'cloud') G.cloud(ctx, gx, 100, 17, col);
    else if (info.g === 'sun') G.sunIcon(ctx, gx, 89, 7, col);
    else if (info.g === 'moon') G.moon(ctx, gx, 89, 10, col);
    else { G.cloud(ctx, gx, 96, 17, col); G.bolt(ctx, gx - 2, 92, 16, col); }
    const x0 = 64, x1 = W - 64, y = H - 58;
    for (let i = 1; i <= 12; i++) {
      const x = lerp(x0, x1, (i - 1) / 11);
      const now = info.lit ? info.lit(i) : i === info.cur, done = info.lit ? false : i < info.cur;
      ctx.fillStyle = rgba(fg, now ? 1 : done ? 0.75 : 0.28);
      ctx.fillRect(Math.round(x) - (now ? 2 : 1), y - (now ? 14 : 6), now ? 4 : 2, now ? 20 : 12);
    }
    ctx.restore();
  }
  function subtitles(ctx, t, P) {
    const c = (window.CUES || []).find((q) => t >= q.t0 - 0.01 && t < q.t1);
    if (!c) return;
    const lt = t - c.t0, out = c.t1 - t;
    const band = P.fg === G.CREAM ? P.t[0] : PAL.ink.t[1];
    ctx.save();
    ctx.font = F.zh(700, 36); ctx.letterSpacing = '1px';
    const wz = ctx.measureText(c.zh).width;
    ctx.font = F.mono(25); ctx.letterSpacing = '0.5px';
    const we = ctx.measureText(c.en).width;
    const bw = Math.max(wz, we) + 64, x = 64, y = 872, bh = 116;
    const p = E.oExp(inv(0, 0.22, lt)) * E.oExp(inv(0, 0.2, out));
    ctx.fillStyle = band; ctx.fillRect(x, y, bw * p, bh);
    ctx.beginPath(); ctx.rect(x, y, bw * p, bh); ctx.clip();
    G.maskText(ctx, c.zh, x + 32, y + 48, F.zh(700, 36), G.CREAM, inv(0.04, 0.3, lt), { ls: '1px' });
    G.maskText(ctx, c.en, x + 32, y + 94, F.mono(25), rgba(G.CREAM, 0.9), inv(0.08, 0.34, lt), { ls: '0.5px' });
    ctx.restore();
  }

  // ───────── transitions + frame ─────────
  const TA = 0.12, TB = 0.26;
  const bufA = G.canvas(), bufB = G.canvas(), bufSub = G.canvas();
  function shotIdx(t) { for (let i = SHOTS.length - 1; i >= 0; i--) if (t >= SHOTS[i].t0) return i; return 0; }
  function drawShot(ctx, s, t, wx) {
    ctx.save();
    switch (s.kind) {
      case 'rainOpen': rainOpen(ctx, t); break;
      case 'busStop': busStop(ctx, t, wx || (t < 4.25 ? 'rain' : 'sun')); break;
      case 'title': titleCard(ctx, t); break;
      case 'track': track(ctx, t); break;
      case 'ladder': ladder(ctx, t, s.i); break;
      case 'lastStop': lastStop(ctx, t); break;
      case 'lost': lost(ctx, t); break;
      case 'wall': wall(ctx, t); break;
      case 'storm': storm(ctx, t); break;
      case 'split': split(ctx, t); break;
      case 'shutter': shutter(ctx, t); break;
      case 'bloom': bloom(ctx, t); break;
      case 'route': route(ctx, t); break;
      case 'echo': echo(ctx, t); break;
      case 'end': endCard(ctx, t); break;
    }
    ctx.restore();
  }
  function composite(ctx, type, p, A, B) {
    const S = CELL;
    if (type === 'rows') {
      ctx.drawImage(A, 0, 0);
      for (let j = 0; j < 6; j++) {
        const pj = E.ioExp(clamp(p * 1.5 - j * 0.1)), dir = j % 2 ? 1 : -1;
        ctx.drawImage(A, 0, j * S, W, S, dir * W * 0.25 * pj, j * S, W, S);
        ctx.drawImage(B, 0, j * S, W, S, -dir * W * (1 - pj), j * S, W, S);
      }
    } else if (type === 'cols') {
      const cw = 240; ctx.drawImage(A, 0, 0);
      for (let i = 0; i < 8; i++) {
        const pj = E.ioExp(clamp(p * 1.5 - i * 0.07)), dir = i % 2 ? 1 : -1;
        ctx.drawImage(B, i * cw, 0, cw, H, i * cw, -dir * H * (1 - pj), cw, H);
      }
    } else if (type === 'slide') {
      const pj = E.ioExp(p);
      ctx.drawImage(A, -W * 0.3 * pj, 0); ctx.drawImage(B, W * (1 - pj), 0);
      ctx.fillStyle = `rgba(0,0,0,${0.15 * (1 - Math.abs(pj - 0.5) * 2)})`; ctx.fillRect(W * (1 - pj) - 8, 0, 8, H);
    } else if (type === 'split') {
      const pj = E.ioExp(p); ctx.drawImage(A, 0, 0);
      ctx.drawImage(B, 0, 0, W / 2, H, 0, -H * (1 - pj), W / 2, H);
      ctx.drawImage(B, W / 2, 0, W / 2, H, W / 2, H * (1 - pj), W / 2, H);
    } else if (type === 'quarter') {
      ctx.drawImage(A, 0, 0);
      ctx.save(); ctx.beginPath();
      for (let j = 0; j < 6; j++) for (let i = 0; i < 11; i++) {
        const d = (i + j) * 0.035, r = S * 1.42 * E.o3(clamp((p - d) / 0.55));
        if (r <= 0) continue;
        const corner = (i + j) % 4, cx = i * S + (corner === 1 || corner === 2 ? S : 0), cy = j * S + (corner >= 2 ? S : 0);
        ctx.moveTo(cx, cy); ctx.arc(cx, cy, r, 0, Math.PI * 2);
      }
      ctx.clip(); ctx.drawImage(B, 0, 0); ctx.restore();
    } else if (type === 'flip') flip(ctx, p, A, B);
  }
  function flip(ctx, p, A, B) {
    const cols = 11, rows = 6, S = CELL;
    ctx.drawImage(B, 0, 0); ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillRect(0, 0, W, H);
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const d = ((i * 0.6 + j) / (cols * 0.6 + rows)) * 0.5, pc = clamp((p - d) / 0.5);
      const src = pc < 0.5 ? A : B, sx = Math.abs(Math.cos(pc * Math.PI)), x = i * S, y = j * S, w = S * sx;
      ctx.drawImage(src, x, y, S, S, x + (S - w) / 2, y, Math.max(1, w), S);
      if (pc > 0 && pc < 1) { ctx.fillStyle = `rgba(0,0,0,${0.3 * (1 - sx)})`; ctx.fillRect(x + (S - w) / 2, y, w, S); }
    }
  }
  const buffers = () => { const ca = bufA.getContext('2d'), cb = bufB.getContext('2d'); ca.setTransform(1, 0, 0, 1, 0, 0); cb.setTransform(1, 0, 0, 1, 0, 0); return [ca, cb]; };
  function frame(ctx, t) {
    const i = shotIdx(t), s = SHOTS[i], nx = SHOTS[i + 1];
    let tr = null;
    if (nx && TRANS[nx.t0] && t >= nx.t0 - TA) tr = [s, nx];
    else if (i > 0 && TRANS[s.t0] && t < s.t0 + TB) tr = [SHOTS[i - 1], s];
    const [ca, cb] = buffers();
    if (tr) {
      const [a, b] = tr, p = clamp((t - (b.t0 - TA)) / (TA + TB));
      drawShot(ca, a, t); drawShot(cb, b, Math.max(t, b.t0));
      composite(ctx, TRANS[b.t0], p, bufA, bufB);
    } else if (s.kind === 'busStop' && t >= 3.88 && t < 4.62) {
      drawShot(ca, s, t, 'rain'); drawShot(cb, s, t, 'sun');
      flip(ctx, clamp((t - 3.88) / 0.74), bufA, bufB);
    } else if (t >= 6.38 && t < 6.78) {
      const c = busStop(ca, Math.min(t, 6.5), 'sun');
      titleCard(cb, Math.max(t, 6.5));
      const [cx, cy] = toScreen(c, U_REST[0], U_REST[1] + 10);
      const p = clamp((t - 6.38) / 0.4), r = 2300 * E.ioExp(p);
      ctx.drawImage(bufA, 0, 0);
      ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip(); ctx.drawImage(bufB, 0, 0); ctx.restore();
      G.ring(ctx, cx, cy, r, 26 * (1 - p), PAL.yellow.t[2]);
    } else if (t >= 18.05 && t < 18.5) {
      // descent: the street slides up by grid rows, the depot rises from below
      const p = E.ioExp(inv(18.05, 18.5, t)), dy = Math.round(p * 6) / 6 * 0.25 + p * 0.75;
      lastStop(ca, t); lost(cb, 18.5);
      ctx.drawImage(bufA, 0, -H * dy); ctx.drawImage(bufB, 0, H * (1 - dy));
    } else if (t >= 28.0 && t < 28.36) {
      // lightning splits the shelf along a zigzag and the storm is underneath
      const p = E.ioExp(inv(28.0, 28.36, t));
      wall(ca, 27.99); storm(ctx, t);
      const zig = [[1180, -20], [1010, 300], [1120, 330], [880, 700], [990, 720], [760, 1100]];
      for (const side of [-1, 1]) {
        ctx.save(); ctx.translate(side * W * 0.6 * p, side * H * 0.1 * p); ctx.beginPath();
        ctx.moveTo(side < 0 ? -10 : W + 10, -20); zig.forEach(([x, y]) => ctx.lineTo(x, y)); ctx.lineTo(side < 0 ? -10 : W + 10, 1100); ctx.closePath();
        ctx.clip(); ctx.drawImage(bufA, 0, 0); ctx.restore();
      }
      if (p < 0.6) { ctx.strokeStyle = rgba(PAL.yellow.t[2], 1 - p / 0.6); ctx.lineWidth = 16; ctx.lineJoin = 'round'; ctx.beginPath(); zig.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke(); }
    } else drawShot(ctx, s, t);
    const P = palAt(t);
    hud(ctx, t, P);
    if (!NOCAP) subtitles(ctx, t, P);
  }
  const FAST = [[0.45, 0.85], [1.95, 3.55], [3.88, 4.65], [4.45, 4.8], [5.95, 6.8], [6.95, 7.7], [10.38, 10.76], [10.8, 13.3], [13.38, 13.76], [14.38, 14.76], [15.38, 15.76],
    [16.38, 17.0], [18.0, 18.6], [18.5, 18.9], [21.45, 24.1], [25.0, 25.7], [28.0, 28.4], [30.88, 31.3], [33.88, 34.3], [34.95, 36.6], [36.5, 36.95], [38.95, 40.35], [40.38, 41.85], [43.88, 44.3], [46.38, 46.8]];
  const isFast = (t) => FAST.some(([a, b]) => t >= a && t < b);

  // ───────── page contract ─────────
  const Q = new URLSearchParams(location.search);
  const A = +(Q.get('a') ?? 0), B = +(Q.get('b') ?? FULL), NOCAP = Q.get('nocap') === '1';
  const ctxMain = document.getElementById('c').getContext('2d');
  window.DUR = B - A;
  window.EV = EV.filter((e) => e.t >= A && e.t < B).map((e) => ({ ...e, t: +(e.t - A).toFixed(4) }));
  window.SHOTS = SHOTS;
  window.render = (lt) => {
    const t = A + lt, ctx = ctxMain;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (!isFast(t)) { frame(ctx, t); return; }
    const N = 5, shutter = 0.45 / 24, sc = bufSub.getContext('2d'), i0 = shotIdx(t);
    for (let k = 0; k < N; k++) {
      sc.setTransform(1, 0, 0, 1, 0, 0);
      let ts = t - shutter / 2 + (shutter * k) / (N - 1);
      if (shotIdx(ts) !== i0) ts = t;
      frame(sc, ts);
      ctx.globalAlpha = 1 / (k + 1); ctx.drawImage(bufSub, 0, 0);
    }
    ctx.globalAlpha = 1;
  };
  // every text on screen, for readcheck: the titles and chips that must be read
  window.TEXTS = (lt) => {
    const t = A + lt, s = SHOTS[shotIdx(t)], out = [];
    const add = (id, text, x0, y0, x1, y1) => out.push({ id, text, x0, y0, x1, y1 });
    if (s.kind === 'title' && t > 7.66) { add('t1', 'LEFT BEHIND', 124, 280, 900, 650); add('t2', '被落下的伞', 124, 670, 900, 760); }
    if (s.kind === 'track' && t > 10.9) { add('a1', 'ALL DAY', 124, 170, 800, 310); add('a2', '一整天', 124, 330, 800, 420); }
    if (s.kind === 'ladder' && t - s.t0 > 0.55) add('l' + s.i, LAD[s.i].tm + ' ' + LAD[s.i].zh, 124, 330, 900, 700);
    if (s.kind === 'lost' && t > 19.02) { add('f1', 'LOST & FOUND', 550, 300, 1700, 450); add('f2', '失物招领', 550, 470, 1700, 600); }
    if (s.kind === 'wall' && t > 24.6) { add('c1', '313', 90, 250, 700, 480); add('c2', '把被落下的伞', 90, 500, 700, 560); }
    if (s.kind === 'wall' && t > 25.22) add('c3', '一直没下雨', 90, 790, 700, 850);
    if (s.kind === 'storm' && t > 28.5) { add('s1', 'STORM', 124, 360, 900, 570); add('s2', '暴雨', 124, 600, 900, 700); }
    if (s.kind === 'split' && t > 31.45) { add('w1', '等车的人', 60, 200, 900, 270); add('w2', '伞是干的', 1000, 200, 1900, 270); }
    if (s.kind === 'shutter' && t > 34.8 && t < 36.25) add('k1', 'TAKE ONE 拿一把', 210, 240, 590, 620);
    if (s.kind === 'route' && t > 41.2) { add('e1', 'EVERY STOP', 124, 170, 900, 310); add('e2', '每一站', 124, 330, 900, 380); }
    if (s.kind === 'end' && t > 46.96) { add('n1', 'LEFT BEHIND', 124, 300, 900, 430); add('n2', '被落下的伞', 124, 450, 900, 520); }
    return out;
  };
})();
