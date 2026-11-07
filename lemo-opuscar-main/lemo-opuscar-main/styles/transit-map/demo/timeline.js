// Direction of 《6 公里》: facts, growth phases, camera, printed annotations, overlays, sound cues.
// Every number shown on screen comes from FX below; FACTS.md holds the source of each.
import { clamp, lerp, seg, ss, eio, eo, ei, back, monotone, track, hash } from '/core/lib.js';

const DUR = 44.5; // story time (tau); film time runs 47.0 s through WARP below
const W = v => v * 100;

// ------------------------------------------------------------------ facts (see FACTS.md)
export const FX = {
  firstDate: '1993.5.28', firstKm: 6, firstStations: 5,
  km: [[1993, 6.0], [1995, 16.1], [2010, 420], [2026, 906]], // landing values only (network length, km)
  nowYear: 2026, nowLines: 21, nowStations: 523,
  ride: { value: 1339.7, date: '2024.3.8' },                 // daily ridership record, 10k trips
  london: { open: 1863, openKm: 6, nowKm: 402 },
};

// film time (t) -> story time (tau): everything below is written in tau; film.js maps. The 1995 beat plays slower
// (so its counter values can be read) and the verdict holds 0.8 s longer.
export const WARP = [[0, 0], [6.2, 6.2], [9.0, 7.3], [29.7, 28.0], [30.5, 28.0], [47.0, 44.5]];
const FIRST5 = ['JJLY', 'SHNZ', 'CBL', 'TYG', 'XJH'];
// register a line of text for window.TEXTS (readcheck): box from the current font and alignment, alphabetic baseline
function rt(c, R, id, s, x, y, size, a = 1, screen = false) {
  if (!R || !R.regW) return;
  const w = c.measureText(s).width, al = c.textAlign, x0 = al === 'center' ? x - w / 2 : al === 'right' ? x - w : x, y0 = y - size * .9, y1 = y + size * .25;
  if (screen) R.regS(id, s, x0, y0, x0 + w, y1, a); else R.regW(id, s, x0, y0, x0 + w, y1, a, 12);
}
// ------------------------------------------------------------------ shots (seconds)
const S = { tunnel: [0, 1.4], first: [1.4, 6.2], early: [6.2, 12.6], burst: [12.6, 20.0], verdict: [20.0, 28.0], now: [28.0, 36.0], back: [36.0, 42.5], end: [41.5, 44.5] };

// ------------------------------------------------------------------ growth phases: path, from, to, t0, t1, year
// line 2 follows hand keys so the camera can ride its tip: ring slam at People's Square, dive under the river
const L2KEYS = [[7.62, 'ZSGY'], [7.95, 'JSL'], [8.25, 'JAS'], [8.5, 'NJXL'], [8.78, 'RMGC'], [9.2, 'NJDL'], [10.32, 'LJZ'], [10.6, 'DCL'], [10.88, 'SJDD'], [11.3, 'LYL']];
const P = (path, a, b, t0, t1, year, extra = {}) => ({ path, a, b, t0, t1, year, ...extra });
const PHASES = [
  P('1', 'JJLY', 'XJH', 0, 0, 1993, { yearLabel: '1993', keys: [[1.42, 'JJLY'], [1.75, 'JJLY'], [2.55, 'SHNZ'], [3.2, 'CBL'], [3.82, 'TYG'], [4.35, 'XJH']] }),
  P('1', 'XJH', 'SHZ', 6.28, 6.65, 1995),
    P('2', 'ZSGY', 'LYL', 0, 0, 1999, { keys: L2KEYS, yearLabel: '1999' }),
  P('3', 'SHNZ', 'JWZ', 11.45, 12.55, 2000, { yearLabel: '2000' }),
  // 2001–2010 burst (12.6–18.6, one film second per 1.67 years)
  P('M', 'LYL', 'PDJC', 13.5, 14.1, 2002, { yearLabel: '2002' }),
  P('5', 'XZ', 'MHKF', 14.2, 15.0, 2003, { yearLabel: '2003' }),
  P('1', 'JJLY', 'XZ', 13.4, 13.9, 1996),
  P('1', 'SHZ', 'GFXC', 14.9, 15.5, 2004),
  P('4', 'BSL', 'LCL2', 15.3, 16.1, 2005, { yearLabel: '2005', loopFrom: true }),
  P('2', 'ZSGY', 'SHL', 15.8, 16.4, 2006),
  P('3', 'JWZ', 'JYBL', 15.8, 16.3, 2006),
  P('4', 'LCL2', 'YSL', 16.2, 17.1, 2007, { bLast: true }),
  P('4', 'YSL', 'BSL', 16.2, 16.9, 2007),
  P('6', 'GCL', 'DMLU', 16.5, 17.5, 2007, { yearLabel: '2007' }),
  P('8', 'JPL', 'YHL', 16.5, 17.4, 2007, { yearLabel: '2007' }),
  P('9', 'SJNZ', 'GLL9', 16.5, 17.3, 2007, { yearLabel: '2007' }),
  P('1', 'GFXC', 'FJL', 16.6, 17.1, 2007),
  P('9', 'GLL9', 'YSL', 17.2, 17.6, 2008),
  P('8', 'YHL', 'SDGL', 17.6, 18.1, 2009),
  P('7', 'MLH', 'HXL', 17.6, 18.7, 2009, { yearLabel: '2009' }),
  P('11', 'JDB', 'JSL', 17.7, 18.5, 2009, { yearLabel: '2009' }),
  P('9', 'YSL', 'YGZL', 17.7, 18.4, 2009),
  P('2', 'SHL', 'XJD', 18.1, 18.6, 2010),
  P('2', 'LYL', 'PDJC', 18.1, 18.7, 2010),
  P('10', 'XJWC', 'HQZ', 18.1, 18.9, 2010, { yearLabel: '2010' }),
  P('10b', 'HQ1', 'JTL', 18.4, 18.8, 2010),
  P('13', 'MDL', 'CSL8', 18.2, 18.7, 2010, { yearLabel: '2010' }),
  P('11', 'JSL', 'LH', 18.3, 18.8, 2010),
  // 2011–2026 (28.1–29.9)
  P('6', 'DMLU', 'DFTY', 28.1, 28.5, 2011),
  P('8', 'JPL', 'SGL', 28.1, 28.5, 2011),
  P('11', 'LH', 'DSN', 28.25, 29.0, 2013),
  P('11b', 'HQ11', 'SHXZ', 28.3, 28.8, 2013),
  P('12', 'QXL', 'JHL', 28.3, 29.2, 2013, { yearLabel: '2013' }),
  P('16', 'LYL', 'DSH', 28.35, 29.0, 2013, { yearLabel: '2013' }),
  P('13', 'JYL', 'MDL', 28.45, 29.1, 2012, { yearLabel: '2012' }),
  P('13', 'CSL8', 'ZKL', 28.6, 29.2, 2018),
  P('9', 'YGZL', 'CL', 28.5, 29.0, 2017),
  P('17', 'HQZ', 'DFL', 28.7, 29.3, 2017, { yearLabel: '2017' }),
  P('P', 'DFTY', 'SHGZ', 28.8, 29.2, 2018, { yearLabel: '2018' }),
  P('5b', 'DCL5', 'FXXC', 28.8, 29.3, 2018),
  P('18', 'CJNL', 'YSH', 28.9, 29.7, 2020, { yearLabel: '2020' }),
  P('15', 'GCGY', 'ZZGX', 29.0, 29.7, 2021, { yearLabel: '2021' }),
  P('14', 'FL', 'GQL', 29.05, 29.75, 2021, { yearLabel: '2021' }),
  P('A', 'HQZ', 'PDJC', 29.2, 29.85, 2024, { yearLabel: '2024' }),
  P('7', 'LYL', 'HXL', 0, 0, 2009, { skip: true }),
];

// ------------------------------------------------------------------ helpers filled at init
let H = null;
const tipOf = (key, t) => { const o = H.PH.find(o => o.path.key === key && o.t0 <= t + 1e-6 && (o === H.PH.find(p => p.path.key === key && p.t1 >= t) || true)); return null; };
function phaseTip(idx, t) { const o = H.PH[idx]; const s = o.t0 >= t ? o.s0 : o.t1 <= t ? o.s1 : lerp(o.s0, o.s1, clamp(o.f(t))); return H.pointAt(o.path, s); }
function smoothTip(idx, t, span = .35) { let x = 0, y = 0; for (let k = -4; k <= 4; k++) { const q = phaseTip(idx, t + k * span / 4); x += q[0]; y += q[1]; } return [x / 9, y / 9]; }
const st = id => { const n = H.SNODE[id]; return [n.cx, n.cy]; };

// ------------------------------------------------------------------ camera
const lz = (a, b, u) => Math.exp(lerp(Math.log(a), Math.log(b), u));
function mixCam(a, b, u) { return { x: lerp(a.x, b.x, u), y: lerp(a.y, b.y, u), z: lz(a.z, b.z, u), tilt: lerp(a.tilt, b.tilt, u), head: lerp(a.head, b.head, u), ap: lerp(a.ap || 0, b.ap || 0, u), focus: 1 }; }
const STRIP = { x: -885, y: 2465, z: .665 };
const ENDC = { x: 1260, y: 2120, z: 1.5 };
function camera(t) {
  if (t < S.first[0]) return { x: -410, y: 730, z: 2.6, tilt: 30, head: -14, ap: 0 };
  if (t < S.first[1]) {
    const tp = smoothTip(0, t, .5), u = ss(seg(t, 1.4, 4.4)), j = st('JJLY'), w = ss(seg(t, 1.55, 2.4));
    const span = Math.hypot(tp[0] - j[0], tp[1] - j[1]);
    const a = { x: lerp(j[0], (j[0] + tp[0]) / 2 + 90, w), y: lerp(j[1], (j[1] + tp[1]) / 2, w), z: Math.min(lz(2.6, 1.55, u), 1080 / (span * 1.15 + 420)), tilt: lerp(30, 16, u), head: lerp(-14, -4, u), ap: 16 };
    const hold = { x: -228, y: 520, z: 1.3, tilt: 7, head: 0, ap: 6 };
    return mixCam(a, hold, eio(seg(t, 4.25, 5.6)));
  }
  if (t < 7.38) {
    const a = camera(6.199), b = { x: -190, y: 300, z: .86, tilt: 9, head: 0, ap: 4 };
    return mixCam(a, b, eio(seg(t, 6.2, 7.25)));
  }
  if (t < 11.3) {
    const iL2 = H.PH.findIndex(o => o.path.key === '2' && o.keys), tp = smoothTip(iL2, Math.max(t, 7.7), .45);
    const ride = { x: tp[0] + 140, y: tp[1] + 70, z: 1.5, tilt: 24, head: -5, ap: 16 };
    // under the river: the camera drops low and turns so the line dives across the frame
    const dive = ss(seg(t, 9.05, 9.6)) * (1 - ss(seg(t, 10.35, 10.95)));
    if (dive > 0) { const d = { x: 215, y: -10, z: 1.85, tilt: 61, head: -10, ap: 26 }; Object.assign(ride, mixCam(ride, d, dive)); }
    // the slam at People's Square: a short push
    const k = t - 8.78; if (k > -.3 && k < .7) ride.z *= 1 + .07 * Math.exp(-Math.abs(k) * 5);
    if (t < 7.9) { const a = camera(7.379); return mixCam(a, ride, eio(seg(t, 7.38, 7.9))); }
    return ride;
  }
  if (t < S.burst[0]) {
    const a = camera(11.299), b = { x: -170, y: 230, z: .78, tilt: 12, head: 2, ap: 6 };
    return mixCam(a, b, eio(seg(t, 11.3, 12.55)));
  }
  if (t < S.verdict[0]) {
    const u = seg(t, 12.6, 18.7);
    const a = { x: -170, y: 230, z: .78, tilt: 12, head: 2, ap: 6 }, b = { x: -150, y: 170, z: .52, tilt: 0, head: 0, ap: 0 };
    const c = mixCam(a, b, 1 - Math.pow(1 - u, 2.2)); return c;
  }
  if (t < S.now[0]) { // glide down the sheet to the time-line panel, then hold still
    const a = { x: -150, y: 170, z: .52, tilt: 0, head: 0, ap: 0 }, b = { x: STRIP.x, y: STRIP.y, z: STRIP.z, tilt: 0, head: 0, ap: 0 };
    const near = { x: STRIP.x - 40, y: STRIP.y - 10, z: STRIP.z * .965, tilt: 0, head: 0, ap: 0 };
    if (t < 21.2) { const u = eio(seg(t, 20.0, 21.2)); const c = mixCam(a, near, u); c.tilt = 26 * Math.sin(Math.PI * u); c.ap = 8 * Math.sin(Math.PI * u); return c; }
    return mixCam(near, b, ss(seg(t, 21.2, 23.25)));
  }
  if (t < 29.9) {
    const a = { x: STRIP.x, y: STRIP.y, z: STRIP.z, tilt: 0, head: 0, ap: 0 }, m = { x: -420, y: 700, z: .42, tilt: 30, head: 14, ap: 6 }, b = sweep(29.9);
    const u = seg(t, 28.0, 29.9);
    if (u < .5) return mixCam(a, m, eio(u * 2));
    return mixCam(m, b, eio(u * 2 - 1));
  }
  if (t < 34.6) return sweep(t);
  if (t < S.back[0] + .01) {
    const a = sweep(34.6), b = { x: -330, y: 470, z: .62, tilt: 4, head: 0, ap: 3 };
    return mixCam(a, b, eio(seg(t, 34.6, 36.0)));
  }
  if (t < S.end[0]) {
    const a = { x: -330, y: 470, z: .62, tilt: 4, head: 0, ap: 3 }, b = { x: -225, y: 510, z: 1.42, tilt: 0, head: 0, ap: 0 };
    return mixCam(a, b, eio(seg(t, 36.0, 39.6)));
  }
  return { x: ENDC.x, y: ENDC.y, z: lz(ENDC.z * .97, ENDC.z, eo(seg(t, 41.5, 44.0))), tilt: 0, head: 0, ap: 0 };
}
function sweep(t) {
  const u = seg(t, 29.9, 34.6);
  return { x: lerp(-470, 470, u), y: lerp(140, -10, u), z: 1.02, tilt: lerp(57, 62, u), head: lerp(26, -14, ss(u)), ap: 24, far: 9 };
}

// ------------------------------------------------------------------ sheet furniture (printed)
const SHEET = [-2520, -1320, 2000, 3420];
const YX = y => -2200 + (y - 1860) * 15;           // time-line panel: year -> x
const ROWL = 2240, ROWS = 2510, AXY = 2730;
const NAVY = '#24346e';
function furniture(c, t, view, k) {
  const { F, INK, MUTED } = k;
  // north-west title block of the printed map
  c.save(); c.textBaseline = 'alphabetic'; c.textAlign = 'left';
  c.fillStyle = INK; c.fillRect(-2240, -1215, 90, 10);
  c.font = F(800, 64); c.fillText('上海地铁', -2240, -1120);
  c.font = F(600, 30); c.fillText('Shanghai Metro', -2240, -1076);
  c.font = F(500, 24); c.fillStyle = MUTED; c.fillText('线网示意图 · 非官方致敬', -2240, -1030); c.fillText('Network schematic · unofficial tribute', -2240, -998);
  // scale-less note and compass
  c.restore();
  // time-line panel
  c.save(); c.strokeStyle = 'rgba(27,28,30,.55)'; c.lineWidth = 3; c.strokeRect(-2290, 2050, 2810, 830);
  // axis
  c.strokeStyle = INK; c.lineWidth = 3; c.beginPath(); c.moveTo(YX(1858), AXY); c.lineTo(YX(2030), AXY); c.stroke();
  c.font = F(600, 34); c.textAlign = 'center'; c.fillStyle = INK;
  for (let y = 1860; y <= 2030; y += 10) { const x = YX(y), big = y % 20 === 0; c.beginPath(); c.moveTo(x, AXY); c.lineTo(x, AXY + (big ? 18 : 10)); c.stroke(); if (big) { c.fillText(String(y), x, AXY + 50); rt(c, k, 'axis-' + y, String(y), x, AXY + 50, 34); } }
  c.font = F(700, 28); c.fillStyle = MUTED; c.textAlign = 'right'; c.fillText('年份', YX(2030), AXY + 90); rt(c, k, 'axis-unit', '年份', YX(2030), AXY + 90, 28); c.font = F(600, 24); c.fillText('Year', YX(2030), AXY + 120); rt(c, k, 'axis-unit-en', 'Year', YX(2030), AXY + 120, 24);
  c.restore();
  // end-card title block (bottom right of the sheet)
  DATAend(c, t, k);
}
function DATAend(c, t, K) { const { F, INK, MUTED } = K;
  if (t < 41.4) return;
  const x = 970, y = 1880, k = t - 41.5;
  c.save();
  c.strokeStyle = INK; c.lineWidth = 3; c.strokeRect(x - 60, y - 70, 700, 620);
  // a short red line runs out to a terminus
  const u = eo(clamp(k / .55)), xe = x + 200 * u;
  c.lineCap = 'round'; c.strokeStyle = '#E3002B'; c.lineWidth = 15; c.beginPath(); c.moveTo(x, y + 40); c.lineTo(xe, y + 40); c.stroke();
  const r = back(seg(k, .5, .75), 3); if (r > 0) { c.save(); c.translate(x + 200, y + 40); c.scale(r, r); c.beginPath(); c.arc(0, 0, 15, 0, 7); c.fillStyle = '#fff'; c.fill(); c.lineWidth = 6; c.strokeStyle = INK; c.stroke(); c.restore(); }
  c.textAlign = 'left'; c.textBaseline = 'alphabetic'; c.fillStyle = INK; c.globalAlpha = 1;
  const A = c.globalAlpha;
  c.font = F(800, 92); c.fillText('6 公里', x, y + 190); rt(c, K, 'end-title', '6 公里', x, y + 190, 92, A);
  c.font = F(600, 44); c.fillText('6 Kilometres', x, y + 248); rt(c, K, 'end-title-en', '6 Kilometres', x, y + 248, 44, A);
  c.fillStyle = INK; c.fillRect(x, y + 290, 120, 5);
  c.font = F(700, 30); c.fillText('地铁线路图', x, y + 344); rt(c, K, 'end-style', '地铁线路图', x, y + 344, 30, A); c.font = F(600, 26); c.fillText('Transit Map', x, y + 380); rt(c, K, 'end-style-en', 'Transit Map', x, y + 380, 26, A);
  c.font = F(500, 30); c.fillText('LemoLab × Claude Opus 5.5', x, y + 436); rt(c, K, 'end-credit', 'LemoLab × Claude Opus 5.5', x, y + 436, 30, A);
  c.font = F(500, 21); c.fillStyle = MUTED; c.fillText('非官方致敬片，与运营方无关', x, y + 484); rt(c, K, 'end-note', '非官方致敬片，与运营方无关', x, y + 484, 21, A); c.fillText('Unofficial fan film, not affiliated with the operator', x, y + 512); rt(c, K, 'end-note-en', 'Unofficial fan film, not affiliated with the operator', x, y + 512, 21, A);
  c.restore();
}
function riverLabels(c, t, view, { F }) {
  c.save(); c.fillStyle = '#5f88ad'; c.textBaseline = 'middle';
  c.translate(W(2.0), W(3.6)); c.rotate(-Math.PI / 2); c.textAlign = 'center'; c.font = F(700, 22); c.fillText('黄浦江', 0, -12); c.font = F(600, 17); c.fillText('Huangpu River', 0, 12);
  c.restore();
  c.save(); c.fillStyle = '#5f88ad'; c.textBaseline = 'middle'; c.translate(W(8.0), W(-8.0)); c.rotate(-Math.PI / 2); c.textAlign = 'center'; c.font = F(700, 22); c.fillText('黄浦江', 0, -12); c.font = F(600, 17); c.fillText('Huangpu River', 0, 12); c.restore();
}

// ------------------------------------------------------------------ annotations (printed / pen)
function plaque(c, t, K) { const { F, INK, MUTED } = K;
  const a = seg(t, 3.95, 4.45) * (1 - seg(t, 10.9, 11.4)); if (a <= 0) return;
  const x = W(-2.7), y = W(4.3);
  c.save(); c.globalAlpha = a;
  // leader from the segment
  const u = eo(seg(t, 3.95, 4.5));
  c.beginPath(); c.rect(x - 20, y - 90, 640 * u + 20, 330); c.clip();
  c.fillStyle = '#E3002B'; c.fillRect(x, y - 52, 10, 160);
  c.fillStyle = INK; c.textAlign = 'left'; c.textBaseline = 'alphabetic';
  const ra = a * (u > .99 ? 1 : 0), s1 = `1 号线首段 · ${FX.firstKm} 公里 · ${FX.firstStations} 站`, s2 = `Line 1, first section · ${FX.firstKm} km · ${FX.firstStations} stations`;
  c.font = F(800, 58); c.fillText(FX.firstDate, x + 30, y + 4); rt(c, K, 'plaque-date', FX.firstDate, x + 30, y + 4, 58, ra);
  c.font = F(700, 34); c.fillText(s1, x + 30, y + 58); rt(c, K, 'plaque-zh', s1, x + 30, y + 58, 34, ra);
  c.font = F(500, 24); c.fillStyle = '#3d3a34'; c.fillText(s2, x + 30, y + 96); rt(c, K, 'plaque-en', s2, x + 30, y + 96, 24, ra);
  c.restore();
}
function expo(c, t, { F, INK }) {
  const a = seg(t, 18.35, 18.65); if (a <= 0) return;
  const x = W(1.0), y = W(6.35);
  c.save(); c.globalAlpha = a * (1 - seg(t, 19.7, 20.2));
  if (c.globalAlpha <= 0.001) { c.restore(); return; }
  const sc = back(seg(t, 18.35, 18.7), 2.4);
  c.translate(x, y); c.scale(sc, sc);
  c.fillStyle = '#E3002B'; c.beginPath(); for (let i = 0; i < 10; i++) { const r = i % 2 ? 11 : 26, an = -Math.PI / 2 + i * Math.PI / 5; c.lineTo(Math.cos(an) * r, Math.sin(an) * r); } c.closePath(); c.fill();
  c.fillStyle = INK; c.textAlign = 'left'; c.textBaseline = 'alphabetic'; c.font = F(800, 40); c.fillText('2010 世博会', 40, 4); c.font = F(600, 26); c.fillText('Expo 2010', 40, 38);
  c.restore();
}
// People's Square falls onto the paper before it lands at t2 (the engine draws the fall); dropRing overrides the landing
const drops = { RMGC: true };
function dropRing(c, n, k2, { capsule, INK }) {
  if (k2 < 0) return;
  const u = seg(k2, 0, .18);
  // shockwaves
  if (k2 < .9) { const v = k2 / .9; c.save(); c.globalAlpha *= (1 - v) * .75; c.lineWidth = 7; c.strokeStyle = INK; c.beginPath(); c.arc(n.cx, n.cy, 30 + 230 * eo(v), 0, 7); c.stroke();
    c.lineWidth = 5; c.strokeStyle = '#8CC220'; c.beginPath(); c.arc(n.cx, n.cy, 26 + 170 * eo(clamp(v * 1.15)), 0, 7); c.stroke();
    c.strokeStyle = '#E3002B'; c.beginPath(); c.arc(n.cx, n.cy, 22 + 120 * eo(clamp(v * 1.3)), 0, 7); c.stroke(); c.restore(); }
  capsule(c, n, 1 + .18 * Math.exp(-k2 * 14) * Math.cos(k2 * 40), 7);
}
// time-line panel content: London and Shanghai drawn as two lines over one axis
function timeLines(c, t, K) { const { F, INK, MUTED } = K; let nid = 0;
  if (t < 20.5) return;
  const L = FX.london, KM10 = FX.km.find(k => k[0] === 2010)[1], NOW = FX.km[FX.km.length - 1][1];
  const draw = (y, color, years, t0, t1, lw = 15) => { const u = clamp((t - t0) / (t1 - t0)); if (u <= 0) return; const x0 = YX(years[0]), x1 = YX(years[1]), x = lerp(x0, x1, u);
    c.save(); c.strokeStyle = color; c.lineWidth = lw; c.lineCap = 'round'; c.beginPath(); c.moveTo(x0, y); c.lineTo(x, y); c.stroke(); c.restore();
    if (u < 1) { c.save(); const g = c.createRadialGradient(x, y, 0, x, y, 70); g.addColorStop(0, 'rgba(255,255,255,.9)'); g.addColorStop(.25, color + '66'); g.addColorStop(1, color + '00'); c.fillStyle = g; c.beginPath(); c.arc(x, y, 70, 0, 7); c.fill(); c.restore(); } };
  const ring = (x, y, color, a, big) => { if (a <= 0) return; c.save(); c.globalAlpha = a; c.beginPath(); c.arc(x, y, big ? 19 : 13, 0, 7); c.fillStyle = '#fff'; c.fill(); c.lineWidth = big ? 7.5 : 6; c.strokeStyle = big ? INK : color; c.stroke(); c.restore(); };
  const lab = (x, y, zh, en, a, align = 'center', dy = -40) => { if (a <= 0) return; c.save(); c.globalAlpha = a; c.textAlign = align; c.textBaseline = 'alphabetic'; c.fillStyle = INK; c.font = F(800, 60); c.fillText(zh, x, y + dy - 44); rt(c, K, 'tl-' + zh, zh, x, y + dy - 44, 60, a); c.font = F(600, 38); c.fillStyle = '#3d3a34'; c.fillText(en, x, y + dy); rt(c, K, 'tl-' + zh + '-en', en, x, y + dy, 38, a); c.restore(); };
  const rn = (x, y, zh, en, a, align) => { if (a <= 0) return; c.save(); c.globalAlpha = a; c.textAlign = align; c.textBaseline = 'alphabetic'; c.fillStyle = INK; c.font = F(800, 58); c.fillText(zh, x, y - 84); rt(c, K, 'row-' + y, zh, x, y - 84, 58, a); c.font = F(600, 38); c.fillStyle = '#3d3a34'; c.fillText(en, x, y - 36); rt(c, K, 'row-' + y + '-en', en, x, y - 36, 38, a); c.restore(); };
  // London: 1863 (6 km) -> today (402 km)
  rn(YX(L.open) - 14, ROWL, `伦敦地铁  ${L.open} 年 · ${L.openKm} 公里`, `London Underground · ${L.open} · ${L.openKm} km`, seg(t, 20.95, 21.3), 'left');
  draw(ROWL, NAVY, [L.open, FX.nowYear], 21.0, 22.4);
  ring(YX(L.open), ROWL, NAVY, seg(t, 21.0, 21.12));
  ring(YX(FX.nowYear), ROWL, NAVY, seg(t, 22.35, 22.45), true);
  lab(YX(FX.nowYear) + 34, ROWL + 52, `${L.nowKm}`, 'km', seg(t, 22.4, 22.65), 'left', 0);
  // Shanghai: 1993 (6 km) -> 2010 (420 km) -> today (906 km)
  rn(YX(1993) - 34, ROWS, `上海地铁  1993 年 · ${FX.firstKm} 公里`, `Shanghai Metro · 1993 · ${FX.firstKm} km`, seg(t, 22.45, 22.8), 'right');
  draw(ROWS, '#E3002B', [1993, 2010], 22.55, 22.85);
  draw(ROWS, '#E3002B', [2010, FX.nowYear], 22.85, 23.1);
  ring(YX(1993), ROWS, '#E3002B', seg(t, 22.55, 22.65));
  ring(YX(2010), ROWS, '#E3002B', seg(t, 22.82, 22.92), true);
  lab(YX(2010), ROWS - 6, '2010', `${KM10} km`, seg(t, 22.85, 23.1), 'center');
  ring(YX(FX.nowYear), ROWS, '#E3002B', seg(t, 23.05, 23.15), true);
  lab(YX(FX.nowYear) + 34, ROWS + 52, `${NOW}`, 'km', seg(t, 23.1, 23.35), 'left', 0);
  // verdict at 26.0: brackets with the spans; the Shanghai one is stamped
  const V = 25.8;
  const br = (y, xa, xb, color, zh, en, a, stamp, lx) => { if (a <= 0) return; c.save(); c.globalAlpha = Math.min(1, a * 1.6); c.strokeStyle = color; c.lineWidth = 6; const yy = y + 40 + 14 * (1 - eo(a));
    c.beginPath(); c.moveTo(xa, yy - 14); c.lineTo(xa, yy); c.lineTo(xb, yy); c.lineTo(xb, yy - 14); c.stroke();
    c.textAlign = 'center'; c.textBaseline = 'alphabetic'; c.fillStyle = color; const xm = lx ?? (xa + xb) / 2; const ra = Math.min(1, a * 1.6); c.font = F(800, 58); c.fillText(zh, xm, yy + 64); rt(c, K, 'br-' + zh, zh, xm, yy + 64, 58, ra); c.font = F(600, 36); c.fillText(en, xm, yy + 106); rt(c, K, 'br-' + en, en, xm, yy + 106, 36, ra);
    if (stamp > 0) { c.globalAlpha = Math.min(1, stamp * 1.5); c.lineWidth = 8; const s = 1 + .5 * (1 - eo(stamp)); c.beginPath(); c.ellipse(xm, yy + 50, 290 * s, 100 * s, -.04, 0, 7); c.stroke(); }
    c.restore(); };
  br(ROWL, YX(L.open), YX(FX.nowYear), NAVY, `${FX.nowYear - L.open} 年 → ${L.nowKm} 公里`, `${FX.nowYear - L.open} years to ${L.nowKm} km`, seg(t, V, V + .3), 0, YX(1910));
  br(ROWS, YX(1993), YX(2010), '#E3002B', `17 年 → ${KM10} 公里`, `17 years to ${KM10} km`, seg(t, V + .4, V + .7), seg(t, V + .65, V + .95));
}
// the end: first section glows, "you are here", the line that started it all
function highlight(c, t, { PATHS, pointAt, subPath }, top = false) {
  const g = seg(t, 36.4, 37.6); if (g <= 0) return;
  const p = PATHS['1'], a = p.st.find(q => q.id === 'JJLY').s, b = p.st.find(q => q.id === 'XJH').s;
  c.save(); c.lineCap = 'round';
  if (!top) { c.strokeStyle = `rgba(227,0,43,${.22 * g})`; c.lineWidth = 60; c.beginPath(); subPath(c, p, a, b); c.stroke(); }
  else { c.strokeStyle = '#E3002B'; c.lineWidth = 15; c.beginPath(); subPath(c, p, a, b); c.stroke(); for (const id of ['JJLY', 'SHNZ', 'CBL', 'TYG', 'XJH']) { const q = p.st.find(s => s.id === id); const pp = pointAt(p, q.s); c.beginPath(); c.arc(pp[0], pp[1], 8.5, 0, 7); c.fillStyle = '#fff'; c.fill(); c.lineWidth = 4.6; c.strokeStyle = '#E3002B'; c.stroke(); } }
  c.restore();
}
function veil(t) { return ss(seg(t, 36.3, 37.5)) * (t < S.end[0] ? 1 : 0); }
function stationDim(n, t, v) { if (v <= 0) return 1; return ['JJLY', 'SHNZ', 'CBL', 'TYG', 'XJH'].includes(n.id) ? 1 : 1 - .78 * v; }
function hereMarker(c, t, K) { const { F, INK } = K;
  const a = seg(t, 37.4, 37.7); if (a <= 0 || t >= S.end[0]) return;
  const n = H.SNODE.JJLY, x = n.cx, y = n.cy;
  c.save();
  const pulse = (t - 37.4) % 1.2 / 1.2;
  c.globalAlpha = a * (1 - pulse) * .6; c.strokeStyle = '#E3002B'; c.lineWidth = 4; c.beginPath(); c.arc(x, y, 22 + 40 * pulse, 0, 7); c.stroke();
  c.globalAlpha = a; c.fillStyle = '#E3002B'; c.beginPath(); c.arc(x, y, 17 * back(seg(t, 37.4, 37.7), 3), 0, 7); c.fill(); c.lineWidth = 4; c.strokeStyle = '#fff'; c.stroke();
  c.textAlign = 'right'; c.textBaseline = 'alphabetic'; c.font = F(800, 36); const hw = Math.max(c.measureText('你在这里').width, 150);
  c.fillStyle = 'rgba(244,240,231,.94)'; c.beginPath(); c.roundRect(x - 44 - hw - 14, y - 34, hw + 28, 86, 8); c.fill();
  c.fillStyle = INK; c.fillText('你在这里', x - 44, y + 6); rt(c, K, 'here', '你在这里', x - 44, y + 6, 36, a); c.font = F(600, 24); c.fillText('You are here', x - 44, y + 38); rt(c, K, 'here-en', 'You are here', x - 44, y + 38, 24, a);
  c.restore();
  // caption where the 1993 plaque was
  const b = seg(t, 37.75, 38.15); if (b <= 0) return;
  const cx = W(-2.7), cy = W(3.9);
  c.save(); c.globalAlpha = b; c.beginPath(); c.rect(cx - 20, cy - 100, 900 * eo(b) + 20, 280); c.clip();
  c.fillStyle = 'rgba(244,240,231,.96)'; c.shadowColor = 'rgba(0,0,0,.18)'; c.shadowBlur = 18; c.shadowOffsetY = 6; c.beginPath(); c.roundRect(cx - 18, cy - 82, 640, 172, 10); c.fill(); c.shadowColor = 'transparent';
  c.fillStyle = '#E3002B'; c.fillRect(cx, cy - 58, 10, 132);
  const cb = b * (eo(b) > .99 ? 1 : 0);
  c.fillStyle = INK; c.textAlign = 'left'; c.font = F(800, 52); c.fillText(`一切从 ${FX.firstKm} 公里开始`, cx + 30, cy); rt(c, K, 'caption', `一切从 ${FX.firstKm} 公里开始`, cx + 30, cy, 52, cb);
  c.font = F(600, 30); c.fillStyle = '#3d3a34'; c.fillText(`It all started with ${FX.firstKm} km`, cx + 30, cy + 48); rt(c, K, 'caption-en', `It all started with ${FX.firstKm} km`, cx + 30, cy + 48, 30, cb);
  c.restore();
  // the unofficial note, printed small under the caption; the end card carries the same lines
  const d = seg(t, 38.6, 38.9); if (d <= 0) return;
  c.save(); c.globalAlpha = d; c.textAlign = 'left'; c.textBaseline = 'alphabetic'; c.fillStyle = 'rgba(244,240,231,.96)'; c.beginPath(); c.roundRect(cx - 18, cy + 100, 640, 92, 10); c.fill();
  c.fillStyle = '#5a5650'; c.font = F(600, 24); c.fillText('非官方致敬片，与运营方无关', cx + 30, cy + 136); rt(c, K, 'end-note', '非官方致敬片，与运营方无关', cx + 30, cy + 136, 24, d);
  c.font = F(500, 21); c.fillText('Unofficial fan film, not affiliated with the operator', cx + 30, cy + 170); rt(c, K, 'end-note-en', 'Unofficial fan film, not affiliated with the operator', cx + 30, cy + 170, 21, d);
  c.restore();
}
function annotations(c, t, view, k) {
  plaque(c, t, k); expo(c, t, k); timeLines(c, t, k); hereMarker(c, t, k);
}

// ------------------------------------------------------------------ trains
function trains(c, t, { PATHS, PH, phaseHead, train, pointAt }) {
  // 1993: one train shuttles on the first section
  const sh = seg(t, 4.2, 4.5) * (1 - seg(t, 12.4, 12.8));
  if (sh > 0) { const p = PATHS['1'], a = p.st.find(q => q.id === 'JJLY').s, b = p.st.find(q => q.id === 'XJH').s;
    const ph = (t - 4.2) / 2.6, u = .5 - .5 * Math.cos(Math.PI * ph); train(c, p, lerp(a + 26, b - 26, u), '#E3002B', sh, 1.15); }
  // now: every line runs
  const run = seg(t, 29.0, 29.6) * (1 - seg(t, 36.0, 36.6)); if (run <= 0) return;
  for (const path of Object.values(PATHS)) {
    const n = Math.max(1, Math.floor(path.total / 420)), gap = path.total / n, v = 210;
    for (let k = 0; k < n; k++) for (const dir of [1, -1]) {
      let s = (k * gap + (hash(path.total + k) * gap) + dir * (t - 28) * v) % path.total; if (s < 0) s += path.total;
      if (s < 30 || s > path.total - 30) continue;
      train(c, path, s, path.color, run, path.line === 'M' ? .8 : 1);
    }
  }
}

// ------------------------------------------------------------------ overlay (screen space, 1920x1080)
function tunnel(c, t, { F }) {
  // the camera rushes down a running tunnel; an oncoming train's headlights grow, light the walls, and flare
  const vx = 960, vy = 548, K = 760, speed = 30, zc = t * speed;
  const zt = lerp(42, 1.2, Math.pow(clamp(t / 1.3), 1.5));          // distance to the oncoming train (m)
  const lit = z => clamp(1.4 / (1 + Math.pow(Math.max(0, zt - z) / 9, 2)));  // headlight spill on the tunnel at depth z
  const bg = c.createRadialGradient(vx, vy, 0, vx, vy, 900); bg.addColorStop(0, '#1a1c1f'); bg.addColorStop(1, '#030405'); c.fillStyle = bg; c.fillRect(0, 0, 1920, 1080);
  const P = (x, y, z) => [vx + K * x / z, vy - K * y / z];
  // tunnel lining rings every 1.5 m (radius 2.75 m, centre 1.6 m above the rail)
  for (let i = 90; i >= 0; i--) {
    const z = (Math.floor(zc / 1.5) + i + 1) * 1.5 - zc; if (z < .5 || z > zt + .5) continue;
    const r = K * 2.75 / z, cy = vy - K * 1.6 / z, l = .1 + .9 * lit(z) + .25 * clamp(3 / z);
    c.strokeStyle = `rgba(${150 * l | 0},${146 * l | 0},${138 * l | 0},${clamp(.25 + l)})`; c.lineWidth = Math.max(.8, K * .12 / z);
    c.beginPath(); c.arc(vx, cy, r, Math.PI * .16, Math.PI * .84, true); c.stroke();
  }
  // track bed, sleepers, rails
  for (let i = 60; i >= 0; i--) { const z = (Math.floor(zc / .65) + i + 1) * .65 - zc; if (z < .5 || z > zt) continue; const a = P(-1.0, -1.45, z), b = P(1.0, -1.45, z), l = .15 + .8 * lit(z);
    c.strokeStyle = `rgba(${90 * l | 0},${84 * l | 0},${76 * l | 0},.9)`; c.lineWidth = Math.max(1, K * .18 / z); c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke(); }
  for (const x of [-.72, .72]) { const a = P(x, -1.4, .55), b = P(x, -1.4, zt); const g = c.createLinearGradient(a[0], a[1], b[0], b[1]); g.addColorStop(0, 'rgba(200,205,210,.5)'); g.addColorStop(1, 'rgba(255,245,225,.95)');
    c.strokeStyle = g; c.lineWidth = 4; c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke(); }
  // cable trays along the left wall
  for (const [x, y] of [[-2.55, .2], [-2.62, .55], [-2.66, .9]]) { const a = P(x, y, .6), b = P(x, y, zt); c.strokeStyle = 'rgba(70,72,74,.9)'; c.lineWidth = 3; c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke(); }
  // wall lamps streaking past, every 8 m
  for (let i = 0; i < 26; i++) { const z = (Math.floor(zc / 8) + i + 1) * 8 - zc - 4; if (z < .4 || z > zt) continue;
    for (const sd of [-1, 1]) { const a = P(sd * 2.45, 1.0, z), b = P(sd * 2.45, 1.0, z + 1.1), w = Math.max(1.5, K * .1 / z);
      c.strokeStyle = `rgba(255,214,150,${clamp(4 / z)})`; c.lineWidth = w; c.lineCap = 'round'; c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke();
      c.fillStyle = `rgba(255,200,120,${clamp(1.2 / z) * .25})`; c.beginPath(); c.arc(a[0], a[1], w * 5, 0, 7); c.fill(); } }
  // the train face and its headlights
  const s = K / zt, tw = 2.9 * s, th = 3.4 * s, tx = vx - tw / 2, ty = vy - K * 1.9 / zt - th / 2 + 0.2 * s;
  c.fillStyle = `rgba(30,32,36,${clamp(.6 + 1 / zt)})`; c.beginPath(); c.roundRect(tx, ty, tw, th, .35 * s); c.fill();
  for (const ox of [-1.0, 1.0]) {
    const [x, y] = P(ox, -.6, zt), r = Math.max(2.5, .2 * s);
    const g = c.createRadialGradient(x, y, 0, x, y, r * 9); g.addColorStop(0, 'rgba(255,255,252,1)'); g.addColorStop(.1, 'rgba(255,250,236,.95)'); g.addColorStop(.35, 'rgba(255,232,196,.28)'); g.addColorStop(1, 'rgba(255,220,180,0)');
    c.fillStyle = g; c.beginPath(); c.arc(x, y, r * 9, 0, 7); c.fill();
    c.fillStyle = `rgba(255,244,226,${clamp(.2 + t * .5)})`; c.fillRect(x - r * 18 - 60, y - Math.max(1, r * .1), r * 36 + 120, Math.max(2, r * .2));
    const g2 = c.createRadialGradient(x, y, 0, x, y, 40 + r * 3); g2.addColorStop(0, 'rgba(255,248,230,.55)'); g2.addColorStop(1, 'rgba(255,240,210,0)'); c.fillStyle = g2; c.beginPath(); c.arc(x, y, 40 + r * 3, 0, 7); c.fill();
  }
  const fl = seg(t, 1.1, 1.4); if (fl > 0) { c.fillStyle = `rgba(255,252,245,${ei(fl)})`; c.fillRect(0, 0, 1920, 1080); }
}
function matchFlash(c, t, b, toScreen) {
  // after the cut the white flare collapses into the red dot of the first station
  const k = t - 1.4; if (k < 0 || k > .55) return;
  const n = H.SNODE.JJLY, q = toScreen(b, n.cx, n.cy); if (!q) return;
  const u = eo(clamp(k / .5)), R = lerp(1500, 18, u);
  const g = c.createRadialGradient(q[0], q[1], 0, q[0], q[1], R);
  g.addColorStop(0, `rgba(255,255,255,${1 - u * .6})`); g.addColorStop(.25, `rgba(255,${lerp(250, 80, u)},${lerp(245, 90, u)},${.9 * (1 - u)})`); g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g; c.fillRect(0, 0, 1920, 1080);
  if (k < .12) { c.fillStyle = `rgba(255,252,245,${1 - k / .12})`; c.fillRect(0, 0, 1920, 1080); }
}
// odometer: a small enamel counter with rolling drums
function digitsAt(v, n) { const out = []; for (let i = n - 1; i >= 0; i--) { const p = Math.pow(10, i); let d = Math.floor(v / p) % 10; const rest = v % p; const roll = p === 1 ? v % 1 : (rest > p - 1 ? rest - (p - 1) : 0); out.push(d + (p === 1 ? v % 1 : roll)); } return out; }
function drum(c, x, y, w, h, pos, F, dim, blur = 0) {
  c.save(); c.beginPath(); c.roundRect(x, y, w, h, 5); c.clip();
  const g = c.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, '#9c968a'); g.addColorStop(.18, '#efe9dc'); g.addColorStop(.5, '#faf6ee'); g.addColorStop(.82, '#efe9dc'); g.addColorStop(1, '#9c968a');
  c.fillStyle = g; c.fillRect(x, y, w, h);
  const d = Math.floor(pos) % 10, f = pos - Math.floor(pos);
  c.font = F(800, h * .7); c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = dim ? 'rgba(27,28,30,.28)' : '#1b1c1e';
  const n = blur > 0 ? 7 : 1;
  for (let k = 0; k < n; k++) { const off = n > 1 ? (k / (n - 1) - .5) * blur * h * .9 : 0; c.globalAlpha = n > 1 ? .26 : 1;
    for (const dd of [-1, 0, 1, 2]) c.fillText(String((d + dd + 10) % 10), x + w / 2, y + h / 2 + (dd - f) * h + 2 + off); }
  c.globalAlpha = 1;
  const sh = c.createLinearGradient(0, y, 0, y + h); sh.addColorStop(0, 'rgba(0,0,0,.35)'); sh.addColorStop(.25, 'rgba(0,0,0,0)'); sh.addColorStop(.75, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(0,0,0,.35)'); c.fillStyle = sh; c.fillRect(x, y, w, h);
  c.restore();
}
const yearTrack = monotone([[0, 1993], [6.22, 1993], [6.45, 1995], [7.36, 1995], [7.68, 1999], [11.38, 1999], [11.6, 2000], [13.42, 2000], [18.2, 2010], [28.05, 2010], [29.85, FX.nowYear]]);
export const YEAR_HOLDS = [[1.95, 6.22], [6.45, 7.36], [7.68, 11.38], [11.6, 13.42], [18.2, 28.05], [29.85, 99]];
const kmKeys = () => [[0, 0], [1.75, 0], [4.35, FX.firstKm], [6.28, FX.firstKm], [6.65, FX.km[1][1]], [7.62, FX.km[1][1]], [18.2, FX.km[2][1]], [28.05, FX.km[2][1]], [29.85, FX.km[3][1]]];
const KM_HOLDS = [[4.35, 6.28], [6.65, 7.62], [18.2, 28.05], [29.85, 99]];
// between two sourced landings the drums spin (unreadable) and settle on the next value
const SPINS = [[7.62, 18.2], [28.05, 29.85]];
function kmCells(t) {
  const sp = SPINS.find(([a, b]) => t > a && t < b);
  const val = kmTrack(t), d = digitsAt(Math.round(Math.max(0, val) * 10 * 1000) / 1000, 4);
  if (!sp) return d.map(p => ({ pos: p, blur: 0 }));
  const [a, b] = sp, target = digitsAt(Math.round(kmTrack(b) * 10), 4), rem = b - t, wake = seg(t, a, a + .5);
  return target.map((p, i) => { const rate = [3, 9, 17, 26][i] * wake; const g = rem < 1.2 ? Math.pow(rem / 1.2, 2) * 1.2 : rem;
    return { pos: ((p - rate * g) % 10 + 10) % 10, blur: clamp(rate * (rem < 1.2 ? 2 * rem / 1.2 : 1) / 6) }; });
}
let kmTrack = null;
function odometer(c, t, F, R) {
  const vis = seg(t, 1.95, 2.35) * (1 - seg(t, 20.0, 20.35)) + seg(t, 28.2, 28.6) * (1 - seg(t, 35.6, 36.0));
  if (vis <= 0) return;
  const rideOn = seg(t, 31.2, 31.6) * (1 - seg(t, 35.6, 36.0));
  const x = 46 - 30 * (1 - eo(vis)), y = 40, w = 660, rows = 2 + (t > 31.2 && t < 36 ? 1 : 0), rh = 86, h = 26 + rows * rh - (rows === 3 ? (1 - eo(rideOn)) * rh : 0);
  c.save(); c.globalAlpha = vis;
  // plate
  c.shadowColor = 'rgba(0,0,0,.35)'; c.shadowBlur = 18; c.shadowOffsetY = 6;
  c.beginPath(); c.roundRect(x, y, w, h, 14); const pg = c.createLinearGradient(0, y, 0, y + h); pg.addColorStop(0, '#2a2d31'); pg.addColorStop(1, '#17191c'); c.fillStyle = pg; c.fill();
  c.shadowColor = 'transparent'; c.lineWidth = 1.5; c.strokeStyle = 'rgba(255,255,255,.12)'; c.stroke();
  for (const [sx, sy] of [[x + 12, y + 12], [x + w - 12, y + 12], [x + 12, y + h - 12], [x + w - 12, y + h - 12]]) { c.beginPath(); c.arc(sx, sy, 3.2, 0, 7); c.fillStyle = '#8b8577'; c.fill(); }
  c.beginPath(); c.rect(x, y, w, h); c.clip();
  const row = (i, zh, en, cells, unitZh, unitEn, val, ra = vis) => {
    const ry = y + 18 + i * rh;
    c.fillStyle = '#efe8d8'; c.textAlign = 'left'; c.textBaseline = 'alphabetic'; c.font = F(700, 24); c.fillText(zh, x + 26, ry + 34); rt(c, R, 'odo-' + i, zh, x + 26, ry + 34, 24, ra, true); c.font = F(500, 17); c.fillStyle = '#aaa395'; c.fillText(en, x + 26, ry + 60); rt(c, R, 'odo-' + i + '-en', en, x + 26, ry + 60, 17, ra, true);
    const vx0 = x + w - 26 - cells.reduce((a, q) => a + (q === '.' ? 12 : 42), 0) - (unitZh ? 110 : 0);
    if (val != null && R && R.regS) R.regS('odo-' + i + '-value', val, vx0, ry + 6, vx0 + cells.reduce((a, q) => a + (q === '.' ? 12 : 42), 0), ry + 66, ra);
    let cx = x + w - 26 - cells.reduce((a, q) => a + (q === '.' ? 12 : 42), 0) - (unitZh ? 110 : 0);
    for (const q of cells) { if (q === '.') { c.fillStyle = '#efe8d8'; c.beginPath(); c.arc(cx + 6, ry + 58, 3.5, 0, 7); c.fill(); cx += 12; continue; } drum(c, cx, ry + 6, 38, 60, q.pos, F, q.dim, q.blur || 0); cx += 42; }
    if (unitZh) { c.fillStyle = '#efe8d8'; c.font = F(700, 20); c.textAlign = 'left'; c.fillText(unitZh, cx + 8, ry + 34); rt(c, R, 'odo-' + i + '-unit', unitZh, cx + 8, ry + 34, 20, ra, true); c.font = F(500, 16); c.fillStyle = '#aaa395'; c.fillText(unitEn, cx + 8, ry + 58); rt(c, R, 'odo-' + i + '-unit-en', unitEn, cx + 8, ry + 58, 16, ra, true); }
  };
  const held = (H2, tt) => H2.some(([a, b]) => tt >= a && tt <= b);
  const yr = yearTrack(t); row(0, '年份', 'Year', digitsAt(yr, 4).map(p => ({ pos: p })), null, null, held(YEAR_HOLDS, t) ? String(Math.round(yr)) : null);
  const km = Math.max(0, kmTrack(t)), kc = kmCells(t), spin = kc[0].blur > 0;
  row(1, '运营里程', 'Route length', [{ ...kc[0], dim: km < 100 && !spin }, { ...kc[1], dim: km < 10 && !spin }, kc[2], '.', kc[3]], '公里', 'km', held(KM_HOLDS, t) ? km.toFixed(1) : null);
  if (rows === 3) { const rv = lerp(0, FX.ride.value, eo(seg(t, 31.4, 32.9))); const rd = digitsAt(Math.round(rv * 10), 5);
    c.globalAlpha = vis * rideOn; row(2, '日客流纪录', `Daily record · ${FX.ride.date}`, [{ pos: rd[0], dim: rv < 1000 }, { pos: rd[1] }, { pos: rd[2] }, { pos: rd[3] }, '.', { pos: rd[4] }], '万人次', `${(FX.ride.value / 100).toFixed(1)} million`, t >= 32.9 ? FX.ride.value.toFixed(1) : null, rideOn >= .99 ? vis : 0); }
  c.restore();
}
// a station name plate passes close to the lens during the low sweep
// a station name plate stands on the sheet near the lens during the low sweep: a billboard in the world, out of focus
let signImg = null;
function makeSign(F) {
  // a cream enamel station plate in a dark frame on a grey post (drawn once, used as a billboard)
  const W0 = 1000, H0 = 900, c = document.createElement('canvas'); c.width = W0; c.height = H0; const g = c.getContext('2d');
  // post
  const pg = g.createLinearGradient(470, 0, 530, 0); pg.addColorStop(0, '#5d5f62'); pg.addColorStop(.5, '#9a9c9f'); pg.addColorStop(1, '#4a4c4f');
  g.fillStyle = pg; g.fillRect(476, 330, 48, 570);
  // frame and enamel face
  g.fillStyle = '#2b2d31'; g.beginPath(); g.roundRect(0, 0, W0, 360, 26); g.fill();
  const fg = g.createLinearGradient(0, 18, 0, 342); fg.addColorStop(0, '#fbf9f3'); fg.addColorStop(1, '#e9e4d8');
  g.fillStyle = fg; g.beginPath(); g.roundRect(18, 18, W0 - 36, 324, 16); g.fill();
  g.fillStyle = '#E3002B'; g.fillRect(18, 268, W0 - 36, 16);
  [['1', '#E3002B', '#fff'], ['2', '#82BF25', '#1b1c1e'], ['8', '#0094D8', '#fff']].forEach(([n, col, f], i) => {
    g.beginPath(); g.arc(90, 70 + i * 74, 30, 0, 7); g.fillStyle = col; g.fill(); g.fillStyle = f; g.font = F(800, 38); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(n, 90, 72 + i * 74); });
  g.fillStyle = '#1b1c1e'; g.textAlign = 'left'; g.textBaseline = 'alphabetic'; g.font = F(800, 120); g.fillText('人民广场', 160, 166);
  g.font = F(600, 52); g.fillStyle = '#3d3a34'; g.fillText("People's Square", 166, 236);
  return c;
}
function foregroundSign(c, t, F, b, toScreen) {
  if (t < 29.95 || t > 35.6) return;
  if (!signImg) signImg = makeSign(F);
  // stands on the paper south-east of the centre, near the lens; passes through the lower right corner
  const X = 800, Y = 820, h = 400;
  const base = toScreen(b, X, Y, 0), top = toScreen(b, X, Y, h); if (!base || !top) return;
  const ph = base[1] - top[1]; if (ph < 4) return;
  const pw = ph * 1000 / 900, cx = (base[0] + top[0]) / 2;
  const blur = Math.min(5, 6 * Math.abs(base[2] - b.D) / base[2]);
  c.save(); c.globalAlpha = seg(t, 29.95, 30.3) * (1 - seg(t, 35.3, 35.6));
  // contact shadow on the paper
  c.filter = `blur(${(blur + 6).toFixed(1)}px)`; c.fillStyle = 'rgba(0,0,0,.25)'; c.beginPath(); c.ellipse(base[0] + pw * .05, base[1], pw * .12, ph * .02 + 3, 0, 0, 7); c.fill();
  c.filter = `blur(${blur.toFixed(1)}px)`;
  c.drawImage(signImg, cx - pw / 2, top[1], pw, ph); c.restore();
}
function overlay(c, t, O) { const { b, toScreen, F, INK, view } = O;
  if (t < S.tunnel[1]) { tunnel(c, t, { F }); return; }
  matchFlash(c, t, b, toScreen);
  foregroundSign(c, t, F, b, toScreen);
  odometer(c, t, F, O);
  // the end card fades from paper white in, and the film ends on the held card
  
}

// ------------------------------------------------------------------ cues for the score
const CUES = [
  { t: 0.0, type: 'tunnel' }, { t: 1.12, type: 'flare' }, { t: 1.4, type: 'cut' }, { t: 1.55, type: 'chime' },
  { t: 3.95, type: 'plaque' }, { t: 4.2, type: 'shuttle' }, { t: 6.3, type: 'year' }, { t: 7.62, type: 'year' },
  { t: 8.36, type: 'fall' }, { t: 9.2, type: 'dive' }, { t: 10.32, type: 'surface' }, { t: 11.45, type: 'year' },
  { t: 12.6, type: 'burst' }, { t: 18.35, type: 'expo' }, { t: 18.2, type: 'landing' },
  { t: 20.0, type: 'glide' }, { t: 21.0, type: 'london' }, { t: 22.7, type: 'shanghai' }, { t: 23.3, type: 'hold' },
  { t: 25.8, type: 'verdict' }, { t: 26.45, type: 'stamp' },
  { t: 28.0, type: 'rise' }, { t: 29.9, type: 'sweep' }, { t: 32.6, type: 'sign' }, { t: 31.4, type: 'ride' }, { t: 32.9, type: 'rideland' },
  { t: 34.6, type: 'lift' }, { t: 36.0, type: 'push' }, { t: 37.4, type: 'here' }, { t: 37.75, type: 'caption' },
  { t: 41.5, type: 'end' }, { t: 42.0, type: 'endring' },
];

const lineYear = {}; for (const p of PHASES) { const k = p.path.replace('b', ''); lineYear[k] = Math.min(lineYear[k] ?? 9999, p.year); }
const SWEEP_LABELS = ['RMGC', 'SJDD', 'XJH', 'JAS', 'ZSGY', 'LJZ', 'SHZ', 'LYL', 'YSL', 'LXM'];
export const DATA = {
  labelOnly: t => t < 7.4 ? FIRST5 : t < 11.3 ? [...FIRST5, 'RMGC', 'LJZ', 'SJDD', 'LYL'] : t < 20 ? (H.__hubs ??= Object.values(H.SNODE).filter(n => n.tier === 1 && n.t1 < 16.6).map(n => n.id)) : t < 28 ? [] : t < 35.6 ? SWEEP_LABELS : FIRST5,
  DUR, SHEET, PHASES: PHASES.filter(p => !p.skip), camera, furniture, riverLabels, annotations, overlay, trains, highlight, veil, stationDim,
  drops, dropRing, noRoundel: [], roundelPos: { '1': [-4.9, 6.9], '2': [-4.95, 0.55], '3': [-2.75, 7.15], '4': [-0.6, -2.35], '5': [-6.5, 10.3], 'M': [9.4, 3.35] },
  roundelAlpha: (t, id, z) => clamp(1 - seg(t, 19.6, 20.2) * (t < 28 ? 1 : 0) - (t >= 28 ? seg(t, 30.4, 31.0) : 0) - (t >= 28 && lineYear[id] < 2011 ? 1 : 0)), roundelScale: z => clamp(Math.pow(.9 / z, .55), 1, 1.8),
  forceLabel: (n, t) => 0, hubLabelScale: z => clamp(Math.pow(.85 / z, .6), 1, 1.75),
  tunnelOnly: t => t < S.tunnel[1], cues: CUES, LABEL_PREF: { JJLY: 'e', SHNZ: 'e', CBL: 'w', TYG: 'w', XJH: 'w', LJZ: 'sw', SJDD: 'ne', RMGC: 'ne' },
  nameAt: (n, t) => n.id === 'SHNZ' && t < 7.62 ? ['新龙华', 'Xinlonghua'] : [n.zh, n.en],
  init(h) { H = h; kmTrack = monotone(kmKeys()); },
};
