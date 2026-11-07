// Seven Milliseconds — timeline: cameras, scene state per board, subtitles, sound events. render(t) depends on t only.
// Four nested boards (levels.js): corridor (km) ⊃ city (10 m) ⊃ street (10 cm) ⊃ charger (mm); plus a stand-alone
// "loss" board for the one shot that shows what would happen to AC sent that far.
// Shots follow the voice (voice/, edge-tts +20%); VO[] holds each line's start time.
import { Board, setSize, camFor, camMatrix, toScreen } from './render.js';
import * as CW from './world.js';
import * as CT from './city.js';
import * as HS from './house.js';
import * as CH from './charger.js';
import * as LS from './loss.js';
import { makeLevels, toChild, toParent, baseOf, drawLevel } from './levels.js';
import { makePost } from './post.js';
import { at } from './geo.js';
import { clamp, lerp, seg, ss, eio, eo, ei, monotone } from '/core/lib.js';

const W = 1920, H = 1080;                     // always drawn at 1080p; the page scales it to any viewport
setSize(W, H);
const cv = document.getElementById('c'); cv.width = W; cv.height = H;
const ctx = cv.getContext('2d');
const LV = makeLevels([
  { name: 'corridor', world: CW, unit: 1 },
  { name: 'city', world: CT, unit: 1, parent: 'corridor', at: CW.CHILD.at, s: CW.CHILD.s },
  { name: 'house', world: HS, unit: 1, parent: 'city', at: CT.CHILD.at, s: CT.CHILD.s },
  { name: 'charger', world: CH, unit: 0.05, parent: 'house', at: HS.CHILD.at, s: HS.CHILD.s },
  { name: 'loss', world: LS, unit: 2 },
], W, H);
const bcv = new OffscreenCanvas(W, H), bubbleBoard = new Board(bcv, CW, { unit: 1, noDesig: true });
const post = makePost(W, H);
const subFont = new FontFace('SubSC', 'url(fonts/NotoSansSC-Medium-sub.ttf)');
document.fonts.add(await subFont.load());
const [EN, VOTXT, DURS] = await Promise.all([fetch('data/subs_en.json').then(r => r.json()), fetch('voice/lines.json').then(r => r.json()), fetch('voice/dur.json').then(r => r.json())]);

export const DUR = 60;
const LN = Math.log, logLerp = (a, b, e) => Math.exp(lerp(LN(a), LN(b), e));
const BPM = 100, B16 = 60 / BPM / 4;
// the voice: start of each line (gaps of 0.3 s), its subtitle in Chinese (the line itself) and English
const VO = [0.40, 5.58, 10.22, 14.55, 19.24, 23.53, 27.15, 34.20, 42.24, 48.39, 53.05];
const SUBS = VO.map((t0, i) => { const id = VOTXT[i].id; return { id, t0: t0 - 0.05, t1: t0 + DURS[id] + 0.12, cn: VOTXT[i].text, en: EN[i][1] }; });

// ======================= the corridor board =======================
const ORDER = []; for (let k = 0; k < 8; k++) ORDER.push(`G${1 + k}`, `G${9 + k}`);
const tGen = id => ORDER.indexOf(id) * B16;
const PEN_T = 0.42;
const genOf = id => CW.GENS.find(g => g.id === id), penOf = g => CW.PENS.find(p => p.s === g.s && p.k === g.k);
const G1 = genOf('G1'), D = CW.D, BT = CW.BUTUO.c, YC = CW.YUCHENG.c;
const T = id => CW.byId(id);
const ACR = T('acR'), ACB2 = T('acB2'), ACL = T('acL'), BARR = T('barR'), BARL = T('barL'), DCP = T('dcp'), DCN = T('dcn'), L = DCP.m.len;
const fR = monotone([[1.2, 0], [3.6, 0.35 * ACR.m.len], [4.9, ACR.m.len]]);
const fB2 = t => ACB2.m.len * clamp((t - 15.0) / 0.4);
// AC phase: the mains rhythm, slowed right down while the voice explains it (5.4–10.1 s), so the swing reads
const acPhase = t => 2 * Math.PI * (t < 5.4 ? 2.2 * t : t < 10.1 ? 2.2 * 5.4 + 0.55 * (t - 5.4) : 2.2 * 5.4 + 0.55 * 4.7 + 2.2 * (t - 10.1));
const T_IN = 16.3;                                                                                 // Butuo starts conducting
const headS = monotone([[16.5, 0], [17.6, 55], [18.8, 130], [19.1, 175], [20.3, 0.42 * L], [21.8, 0.7 * L], [23.0, L]]);
const headT = s => { let a = 16.5, b = 23.0; for (let i = 0; i < 40; i++) { const m = (a + b) / 2; if (headS(m) < s) a = m; else b = m; } return a; };
const T_ARR = 23.0, T_AC = 27.4;                                                                   // DC lands; AC leaves Yucheng

// cameras
const camDam = t => {
  const zA = 62, zB = 6.1, cA = [G1.x + 2, G1.y + 2], cB = [D[0], D[1] - 6 * CW.DS];
  const e = eio(seg(t, 0.35, 2.05)), k = ss(seg(t, 0.35, 1.9));
  return { x: lerp(cA[0], cB[0], k), y: lerp(cA[1], cB[1], k), z: logLerp(zA, zB, e) * (1 + 0.012 * Math.max(0, t - 2.05)), r: 0 };
};
const BUSPT = [D[0] + 96 * CW.DS, D[1] + 4 * CW.DS];                                              // a point on the right-bank bus
const camBus = t => {                                                                              // 4.7–10.1: in to the bus, hold
  const a = camDam(4.7), b = camFor(BUSPT, [1400, 560], 20), e = eio(seg(t, 4.7, 5.9));
  const c = { x: lerp(a.x, b.x, e), y: lerp(a.y, b.y, e) - 0.2 * Math.max(0, t - 5.9), z: logLerp(a.z, 22, e) };
  return { ...c, r: 0 };
};
const camLoss = t => { const e = ss(seg(t, 10.1, 14.4)); return { x: lerp(200, 760, e), y: 262, z: lerp(2.45, 2.3, e), r: 0 }; };
const ZB0 = 20, ZB1 = 27;
const camButuo = t => camFor(BT, [700, 470], logLerp(ZB0, ZB1, ss(seg(t, 14.4, 18.6))));
const ZT = 2.0, ZF = 1.12, CF = [(BT[0] + YC[0]) / 2 - 36, (BT[1] + YC[1]) / 2 + 40];
const camTrack = t => camFor(at(DCP.m, headS(Math.min(t, T_ARR))), [1340, 540], ZT);
const camWhip = t => { const k = ei(seg(t, 18.75, 19.1)), a = camButuo(18.75), b = camTrack(19.1); return { x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), z: logLerp(a.z, b.z, k), r: 0 }; };
const YCAM = camFor([YC[0] + 10, YC[1] + 5], [960, 500], 26);
const camCorr = t => {
  if (t < T_ARR) { const tr = camTrack(t), e = eio(seg(t, 19.7, 21.4)); return { x: lerp(tr.x, CF[0], e), y: lerp(tr.y, CF[1], e), z: logLerp(ZT, ZF, e), r: 0 }; }
  const e = ei(seg(t, T_ARR, 23.5)), z = logLerp(ZF, 26, e);
  const p = toScreen(camMatrix({ x: CF[0], y: CF[1], z: ZF, r: 0 }), [YCAM.x, YCAM.y]);
  return camFor([YCAM.x, YCAM.y], [lerp(p[0], 960, ss(seg(t, T_ARR, 23.4))), lerp(p[1], 540, ss(seg(t, T_ARR, 23.4)))], z);
};
const camYuch = t => ({ ...YCAM, z: 26 * (1 + 0.008 * (t - 23.5)) });

// the step-down cuts: the same symbol at the same screen size (300 px), four scales
const CUTS = [
  { t0: 29.6, level: 'corridor', c: CW.T1.c, s: CW.T1.s, push: 0.05 },
  { t0: 30.3, level: 'city', c: CT.T2.c, s: CT.T2.s, push: 0.05 },
  { t0: 31.0, level: 'city', c: CT.T3.c, s: CT.T3.s, push: 0.05 },
  { t0: 31.7, level: 'house', c: HS.T4.c, s: HS.T4.s, push: 0.22 },
];
const camCut = (k, t) => { const c = CUTS[k], z = 300 / c.s * (1 + c.push * eio(seg(t, c.t0, c.t0 + 0.7))); return { x: c.c[0], y: c.c[1], z, r: 0 }; };

// the street: the block flashes by, the socket wall, the plunge into the live hole
const SK = HS.SOCKET;
const SKC = { x: SK.c[0] + 6, y: SK.c[1] + 10, z: 8.6 };
const camStreet = t => {
  if (t < 34.0) {
    const a = { x: 450, y: 380, z: 2.0 }, e = eio(seg(t, 32.45, 32.95));
    return { x: lerp(a.x, SKC.x, e), y: lerp(a.y, SKC.y, e), z: logLerp(a.z, SKC.z, e) * (1 + 0.06 * ss(seg(t, 32.95, 34.0))), r: 0 };
  }
  const e = ei(seg(t, 34.0, 34.6)), z0 = SKC.z * 1.06, z = logLerp(z0, 2600, e);
  const p = toScreen(camMatrix({ x: SKC.x, y: SKC.y, z: z0, r: 0 }), SK.holeL);
  return camFor(SK.holeL, [lerp(p[0], 960, ss(seg(t, 34.0, 34.3))), lerp(p[1], 540, ss(seg(t, 34.0, 34.3)))], z);
};

// the charger: out of the L pad's hole, the whole small board, then in to the bridge
const ZC = 36, DBPOS = [640, 410];
const camVerdictBase = camFor(CH.DB1.c, DBPOS, ZC);
const WHOLE = { x: 18.5, y: 14, z: 20 };
const camCharger = t => {
  if (t < 35.35) { const e = eo(seg(t, 34.6, 35.35)), p = [lerp(CH.LPAD[0], WHOLE.x, ss(seg(t, 34.75, 35.35))), lerp(CH.LPAD[1], WHOLE.y, ss(seg(t, 34.75, 35.35)))]; return { x: p[0], y: p[1], z: logLerp(2400, WHOLE.z, e), r: 0 }; }
  if (t < 37.3) return { x: WHOLE.x + 0.15 * (t - 35.35), y: WHOLE.y, z: WHOLE.z * (1 + 0.01 * (t - 35.35)), r: 0 };
  const a = { x: WHOLE.x + 0.3, y: WHOLE.y, z: WHOLE.z * 1.02 }, b = camVerdictBase, e = eio(seg(t, 37.3, 38.6));
  if (t >= 38.6) { const d = 1 - ss(seg(t, 42.1, 42.8)); return { x: b.x + d * 0.15, y: b.y, z: ZC * (1 - 0.006 * d), r: 0 }; }
  return { x: lerp(a.x, b.x, e), y: lerp(a.y, b.y, e), z: logLerp(a.z, b.z, e), r: 0 };
};

// the pull-out: from the charger through every board to the whole corridor board on the desk
function camUp(name, cam) { let c = cam, n = name; while (LV[n].parent) { c = toParent(c, LV[n]); n = LV[n].parent; } return c; }
function camDown(cam0) { let c = cam0; for (const n of ['city', 'house', 'charger']) c = toChild(c, LV[n]); return c; }
const PULL0 = 52.9, PULL1 = 54.5;
const START = camUp('charger', camVerdictBase);
const DB_L0 = camUp('charger', { x: CH.DB1.c[0], y: CH.DB1.c[1], z: 1, r: 0 });
const ZE = 0.8, RE = -0.03, BC = [1010, 470];
const endCam = t => { const k = 1 + 0.04 * ss(seg(t, PULL1, DUR)); return { x: BC[0], y: BC[1], z: ZE * k, r: RE * (1 + 0.15 * ss(seg(t, PULL1, DUR))) }; };
const sEnd = toScreen(camMatrix(endCam(PULL1)), [DB_L0.x, DB_L0.y]);
const camPull = t => {
  if (t >= PULL1) return endCam(t);
  const p = seg(t, PULL0, PULL1), e = 1 - Math.pow(1 - p, 2.6);
  const z = logLerp(START.z, ZE, e), r = RE * ss(seg(t, PULL0 + 0.8, PULL1));
  const sp = [lerp(DBPOS[0], sEnd[0], ss(p)), lerp(DBPOS[1], sEnd[1], ss(p))];
  return camFor([DB_L0.x, DB_L0.y], sp, z, r);
};

// ======================= shots =======================
const SHOTS = [
  { t0: 0, t1: 4.7, level: 'corridor', cam: camDam },
  { t0: 4.7, t1: 10.1, level: 'corridor', cam: camBus },
  { t0: 10.1, t1: 14.4, level: 'loss', cam: camLoss },
  { t0: 14.4, t1: 18.75, level: 'corridor', cam: camButuo },
  { t0: 18.75, t1: 19.1, level: 'corridor', cam: camWhip },
  { t0: 19.1, t1: 23.5, level: 'corridor', cam: camCorr },
  { t0: 23.5, t1: 29.6, level: 'corridor', cam: camYuch },
  ...CUTS.map((c, k) => ({ t0: c.t0, t1: c.t0 + 0.7, level: c.level, cam: t => camCut(k, t) })),
  { t0: 32.4, t1: 34.6, level: 'house', cam: camStreet },
  { t0: 34.6, t1: PULL0, level: 'charger', cam: camCharger },
  { t0: PULL0, t1: DUR + 1, level: 'corridor', cam: camPull, deep: true },
];
const shotOf = t => SHOTS.find(s => t >= s.t0 && t < s.t1) || SHOTS[SHOTS.length - 1];
const blurGroup = s => s.t1 <= 10.1 ? [0, 10.1] : (s.t0 >= 14.4 && s.t1 <= 29.6) ? [14.4, 29.6] : [s.t0, s.t1];

// ======================= scene: the corridor board =======================
// [start, plot time, end] — labels plot stroke by stroke and stay until `end` (if given)
const PLOT_C = { title: [0.6, 0.7], titleE: [0.95, 0.6], acBus: [6.4, 0.5], acBusE: [6.6, 0.3],
  acIn: [14.6, 0.5], acInE: [14.8, 0.3], csB: [15.3, 0.6], csBE: [15.5, 0.5], dcOut: [16.7, 0.5], dcOutE: [16.85, 0.3],
  sc: [19.1, 0.4], scE: [19.3, 0.35], len: [20.5, 0.6], lenE: [20.7, 0.4], js: [20.6, 0.4], jsE: [20.8, 0.35],
  csY: [23.5, 0.5], csYE: [23.7, 0.4], ms7: [24.0, 0.45], ms7E: [24.2, 0.3], acOut: [27.2, 0.45, 29.6], acOutE: [27.35, 0.3, 29.6],
  step: [29.6, 0.35], stepE: [29.7, 0.3],
  tbBox: [54.4, 0.8], tb: [54.8, 0.8], tbE: [55.3, 0.6], sign: [56.0, 0.7] };
const plot = (tab, t) => { const o = {}; for (const [id, [t0, d, t1]] of Object.entries(tab)) o[id] = t1 !== undefined && t > t1 ? 0 : clamp((t - t0) / d); return o; };
function sceneCorridor(t, opt = {}) {
  const sc = { t, labels: plot(PLOT_C, t), gens: {}, ac: [], dc: [], glow: [], flashes: [] };
  const pen = {};
  for (const g of CW.GENS) pen[penOf(g).id] = clamp((t - (tGen(g.id) - PEN_T)) / PEN_T);
  sc.water = { res: 1, up: 1, river: t < 10.1 ? 0.75 : 0.6, tail: clamp((t - 0.2) / 1.2), pen, penA: 1 };
  for (const g of CW.GENS) {
    const dt = t - tGen(g.id); if (dt < 0) continue;
    sc.gens[g.id] = 0.16 + 0.84 * Math.exp(-dt / 0.18);
    sc.flashes.push({ p: [g.x, g.y], r: 5.5 * CW.DS, a: 0.22, c: { h: [255, 214, 140], g: [255, 170, 60] } });
    if (dt < 0.4) sc.flashes.push({ p: [g.x, g.y], r: 9 * CW.DS, a: Math.exp(-dt / 0.12) });
    const lead = T('lead' + g.id); sc.ac.push({ trace: lead, s0: 0, s1: lead.m.len * clamp(dt / 0.12), a: 1, lam: 1.7 * CW.DS, phase: acPhase(t) });
  }
  const tR = tGen('G1'), tL = tGen('G9');
  if (t > tR + 0.1) sc.ac.push({ trace: BARR, s1: BARR.m.len * clamp((t - tR - 0.1) / 1.6), a: 1, lam: 3.4 * CW.DS, phase: acPhase(t) });
  if (t > tL + 0.1) sc.ac.push({ trace: BARL, s1: BARL.m.len * clamp((t - tL - 0.1) / 1.6), a: 1, lam: 3.4 * CW.DS, phase: acPhase(t) });
  const slow = t >= 5.0 && t < 10.1;                                                               // the close-up: big, slow swing
  if (t > 1.2) sc.ac.push({ trace: ACR, s1: fR(Math.min(t, 4.9)), a: 1, lam: slow ? 8 : 4.2, amp: slow ? 0.42 : 0.32, phase: acPhase(t) });
  if (t > 15.0) sc.ac.push({ trace: ACB2, s1: fB2(t), a: 1, lam: 4.2, phase: acPhase(t) });
  if (t > 1.4) sc.ac.push({ trace: ACL, s1: ACL.m.len * clamp((t - 1.4) / 1.4), a: 1, lam: 4.2, phase: acPhase(t) });
  if (t > T_IN - 0.2) {
    const k = clamp((t - T_IN + 0.2) / 0.3);
    for (const e of CW.BUTUO.flow.all) sc.glow.push({ pts: e, w: 0.55, a: 0.55 * k * (0.75 + 0.25 * Math.sin(2 * Math.PI * 2.2 * t)) });
    if (t < T_IN + 0.5) sc.flashes.push({ p: BT, r: 9, a: Math.sin(Math.PI * clamp((t - T_IN + 0.2) / 0.7)) * 0.7 });
  }
  if (t > 16.5) { const h = headS(Math.min(t, T_ARR)); for (const tr of [DCP, DCN]) sc.dc.push({ trace: tr, head: h, a: 0.95, decay: t > T_ARR ? 2000 : 520, floor: 0.7, v: 200, maxPx: 60, minPx: 6.5 }); }
  for (const tp of CW.TPS) { const th = headT(tp.s); if (t > th && t < th + 0.5) sc.flashes.push({ p: tp.p, r: 9, a: 1 - (t - th) / 0.5 }); }
  if (t > T_ARR) {
    const k = clamp((t - T_ARR) / 0.3);
    for (const e of CW.YUCHENG.flow.all) sc.glow.push({ pts: e, w: 0.55, a: 0.55 * k * (0.75 + 0.25 * Math.sin(2 * Math.PI * 2.2 * t)) });
    if (t < T_ARR + 0.6) sc.flashes.push({ p: YC, r: 12, a: Math.sin(Math.PI * clamp((t - T_ARR) / 0.6)) * 0.9 });
    const fy = s => clamp((t - s) / 1.0);
    sc.ac.push({ trace: T('acY'), s1: T('acY').m.len * fy(T_AC), a: 1, lam: 3.4, phase: acPhase(t) }, { trace: T('acY2'), s1: T('acY2').m.len * fy(T_AC + 0.6), a: 1, lam: 3.4, phase: acPhase(t) },
      { trace: T('acY3'), s1: T('acY3').m.len * fy(T_AC + 1.2), a: 1, lam: 1.8, phase: acPhase(t) });
  }
  if (opt.bubble) { sc.labels = {}; sc.dc.forEach(d => { d.decay = 1e9; d.a = 0.8; d.minPx = 3.6; }); }
  return sc;
}
// ======================= scene: the loss board =======================
function sceneLoss(t) {
  const sc = { t, labels: plot({ loss: [11.4, 0.5], lossE: [11.6, 0.4] }, t), ac: [], dc: [], glow: [], flashes: [] };
  sc.ac.push({ trace: LS.byId('ac'), a: 1, fade: 260, x0: 520, lam: 84, v: 150 });
  return sc;
}
// ======================= scene: city and street =======================
const PLOT_CT = { step2: [29.6, 0.35], stepE2: [29.7, 0.3], step3: [29.6, 0.35], stepE3: [29.7, 0.3] };
function sceneCity(t) {
  const sc = { t, labels: plot(PLOT_CT, t), ac: [], dc: [], glow: [], flashes: [], lit: 0.8 };
  for (const id of ['in', 'c1', 'c2']) sc.ac.push({ trace: CT.byId(id), a: 1, lam: CT.byId(id).w * 4.2, phase: acPhase(t) });
  return sc;
}
function sceneHouse(t) {
  const sc = { t, labels: plot({ step4: [29.6, 0.35], stepE4: [29.7, 0.3] }, t), ac: [], dc: [], glow: [], flashes: [], lit: 1 };
  for (const tr of HS.TRACES) {
    if (tr.net !== 'ac') continue;
    const s1 = tr.id === 'sock' ? tr.m.len * clamp((t - 32.7) / 1.1) : tr.m.len;
    sc.ac.push({ trace: tr, s1, a: 1, lam: Math.max(tr.w * 4.2, 3), phase: acPhase(t) });
  }
  if (t > 33.75) sc.flashes.push({ p: [SK.holeL[0], SK.holeL[1] - 9], r: 8, a: clamp((t - 33.75) / 0.2) * 0.9 });
  return sc;
}
// ======================= scene: the charger =======================
const PLOT_H3 = { chg: [35.3, 0.5], chgE: [35.45, 0.35], zlq: [38.5, 0.45], zlqE: [38.65, 0.4], acdc: [39.9, 0.45, 42.9], acdcE: [40.05, 0.35, 42.9],
  csV: [42.9, 0.45], csVE: [43.05, 0.4], eq: [47.6, 0.25], same: [47.7, 0.6], sameE: [47.9, 0.4], x4: [49.4, 0.55], x4E: [49.6, 0.4] };
const CB = id => CH.byId(id);
const T_DB = 39.4;
function sceneCharger(t) {
  const sc = { t, labels: plot(PLOT_H3, t), ac: [], dc: [], glow: [], flashes: [] };
  const tt = Math.max(t, 34.6);
  sc.ac.push({ trace: CB('pL'), s1: CB('pL').m.len * clamp((tt - 34.7) / 0.5), a: 1, lam: 1.7, phase: acPhase(t) }, { trace: CB('L'), s1: CB('L').m.len * clamp((tt - 35.2) / 0.9), a: 1, lam: 1.7, phase: acPhase(t) }, { trace: CB('L2'), s1: CB('L2').m.len * clamp((tt - 37.6) / 1.4), a: 1, lam: 1.7, phase: acPhase(t) });
  if (t > T_DB - 0.2) {
    const fl = t >= 47.6 ? Math.exp(-(t - 47.6) / 0.35) : 0, k = clamp((t - T_DB + 0.2) / 0.3);
    for (const e of CH.DB1.flow.all) sc.glow.push({ pts: e, w: 0.35 * CH.K, a: (0.5 + 0.5 * fl) * k });
    if (t < T_DB + 0.5) sc.flashes.push({ p: CH.DB1.c, r: 6, a: Math.sin(Math.PI * clamp((t - T_DB + 0.2) / 0.7)) * 0.7 });
    if (fl > 0.01) sc.flashes.push({ p: CH.DB1.c, r: 6, a: 0.8 * fl });
  }
  const run = (id, t0, dur) => { const tr = CB(id); if (t > t0) sc.dc.push({ trace: tr, head: tr.m.len * clamp((t - t0) / dur), a: 0.8, headGlow: t < t0 + dur, v: 14, floor: 1, maxPx: 40 }); };
  run('plus', T_DB + 0.2, 0.7); run('minus', T_DB + 0.2, 0.7); run('pri', T_DB + 0.8, 0.5); run('sec', T_DB + 1.4, 0.4); run('vbus', T_DB + 1.8, 0.4);
  if (t >= 42.1) sc.after = (g, M, z) => drawBubble(g, M, z, t);
  return sc;
}
function drawBubble(g, M, z, t) {
  const open = clamp((t - 42.2) / 0.6) * (1 - clamp((t - 52.55) / 0.35));
  const B = CH.BUBBLE, c = toScreen(M, B.c), at_ = toScreen(M, B.at), r = B.r * z * eo(open);
  if (r < 1) return;
  const fl = t >= 47.6 ? Math.exp(-(t - 47.6) / 0.35) : 0;
  const cam = camFor(BT, at_, z * CH.K), sc = sceneCorridor(Math.max(t, 26), { bubble: true });
  sc.glow.forEach(q => q.a = Math.min(1, q.a + 0.5 * fl)); if (fl > 0.01) sc.flashes.push({ p: BT, r: 9, a: 0.8 * fl });
  bubbleBoard.frame(cam, sc);
  g.save(); g.setTransform(1, 0, 0, 1, 0, 0);
  g.beginPath(); g.arc(c[0], c[1], r, 0, 6.2832); g.save(); g.clip(); g.drawImage(bcv, 0, 0); g.restore();
  const sh = g.createRadialGradient(c[0], c[1], r * 0.82, c[0], c[1], r); sh.addColorStop(0, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(0,0,0,0.38)');
  g.fillStyle = sh; g.fill(); g.lineWidth = 0.2 * z; g.strokeStyle = '#F2EEE1'; g.stroke();
  g.lineWidth = 0.08 * z; g.beginPath(); g.arc(c[0], c[1], r + 0.45 * z, 0, 6.2832); g.stroke();
  g.restore();
}
const SCENES = { corridor: sceneCorridor, city: sceneCity, house: sceneHouse, charger: sceneCharger, loss: sceneLoss };

// ======================= frame =======================
function stackAt(t) {
  const sh = shotOf(t); let cam = sh.cam(t), name = sh.level;
  if (sh.deep) { cam = camDown(cam); name = 'charger'; }
  const b = baseOf(LV, name, cam, W, H);
  return { sh, base: b.l, cam: b.cam };
}
function drawAt(t) {
  const { base, cam } = stackAt(t);
  drawLevel(LV, base, cam, n => SCENES[n](t), W, H);
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.drawImage(base.cv, 0, 0);
}
// depth of field: strong in macro moments without words, light where text must be read
const DOF = [[0, 0.8, 0.9], [0.8, 4.7, 0.15], [4.7, 10.1, 0.45], [10.1, 14.4, 0.12], [14.4, 19.1, 0.25], [19.1, 23.5, 0.08], [23.5, 29.6, 0.12], [29.6, 32.4, 0.5],
  [32.4, 34.6, 0.6], [34.6, 38.6, 0.35], [38.6, 52.9, 0.1], [52.9, 60, 0.05]];
function postFor(t, st) {
  const d = DOF.find(q => t >= q[0] && t < q[1]) || DOF[DOF.length - 1];
  const o = { t, dof: d[2], motes: t >= PULL1 ? 0.5 : 1, px: st.cam.x * st.cam.z, py: st.cam.y * st.cam.z };
  if (t > PULL1 - 0.6 && st.base.name === 'corridor') {
    const a = 0.5 * ss(seg(t, PULL1 - 0.6, PULL1 + 1.2)), m = 50 * (t - PULL1);
    o.window = { cam: st.cam, a, soft: 30, quad: [[60 + m, -200], [720 + m, -200], [420 + m, 1300], [-240 + m, 1300]], mullion: [[400 + m, -200], [430 + m, -200], [130 + m, 1300], [100 + m, 1300]] };
  }
  return o;
}
// subtitles: one cue per spoken line, Chinese over English, in the bottom safe area
const SUB_CN = 34, SUB_EN = 24, SUB_Y = 974;
function subBox(s) {
  ctx.font = `500 ${SUB_CN}px SubSC`; const wc = ctx.measureText(s.cn).width;
  ctx.font = `500 ${SUB_EN}px SubSC`; const we = ctx.measureText(s.en).width;
  return { wc, we, w: Math.max(wc, we) };
}
function drawSubs(t) {
  for (const s of SUBS) {
    const a = ss(seg(t, s.t0, s.t0 + 0.12)) * (1 - ss(seg(t, s.t1 - 0.12, s.t1))); if (a <= 0) continue;
    const b = subBox(s);
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = a;
    ctx.fillStyle = 'rgba(3,14,9,0.62)'; ctx.beginPath(); ctx.roundRect(W / 2 - b.w / 2 - 22, SUB_Y - SUB_CN - 14, b.w + 44, SUB_CN + SUB_EN + 38, 6); ctx.fill();
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#F7F4EA'; ctx.font = `500 ${SUB_CN}px SubSC`; ctx.fillText(s.cn, W / 2, SUB_Y);
    ctx.fillStyle = 'rgba(247,244,234,0.86)'; ctx.font = `500 ${SUB_EN}px SubSC`; ctx.fillText(s.en, W / 2, SUB_Y + SUB_EN + 12);
    ctx.restore();
  }
}
const acc = new OffscreenCanvas(W, H), actx = acc.getContext('2d');
const SHUT = 1 / 60;
function motionPx(t, sh) {
  const [g0, g1] = blurGroup(sh), a = clamp(t - SHUT / 2, g0, g1 - 1e-4), b = clamp(t + SHUT / 2, g0, g1 - 1e-4);
  const sa = shotOf(a), sb = shotOf(b);
  if (sa.level !== sb.level || sa.deep) return sh.deep ? motionDeep(a, b) : 0;
  const ca = camMatrix(sa.cam(a)), Mb = camMatrix(sb.cam(b));
  const inv = (M, p) => { const det = M[0] * M[3] - M[1] * M[2], x = p[0] - M[4], y = p[1] - M[5]; return [(M[3] * x - M[2] * y) / det, (-M[1] * x + M[0] * y) / det]; };
  let m = 0; for (const p of [[0, 0], [W, 0], [0, H], [W, H], [W / 2, H / 2]]) { const w = inv(ca, p), q = toScreen(Mb, w); m = Math.max(m, Math.hypot(q[0] - p[0], q[1] - p[1])); }
  return m;
}
function motionDeep(a, b) { const za = camPull(a).z, zb = camPull(b).z; return Math.abs(LN(zb / za)) * 260; }
window.DUR = DUR;
const Q = new URLSearchParams(location.search);
window.render = t => {
  const sh = shotOf(t), [g0, g1] = blurGroup(sh), N = Math.min(sh.deep ? 6 : 20, Math.max(1, Math.ceil(motionPx(t, sh) / 2.6)));
  if (N <= 1) drawAt(t);
  else {
    for (let i = 0; i < N; i++) { const ti = clamp(t + (i / (N - 1) - 0.5) * SHUT, g0, g1 - 1e-4); drawAt(ti); actx.globalAlpha = 1 / (i + 1); actx.drawImage(cv, 0, 0); }
    actx.globalAlpha = 1; ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(acc, 0, 0);
  }
  post(ctx, postFor(t, stackAt(t)));
  if (!Q.has('nosub')) drawSubs(t);
};
// every piece of text on screen, with its box (readcheck). Subtitles are reported only with ?subs=1:
// a spoken line is read along with the voice, not at the 4.5 characters/s the check assumes.
window.TEXTS = t => {
  const { base, cam } = stackAt(t), out = [];
  const walk = (l, c, clip) => {
    for (const b of l.board.texts(c, SCENES[l.name](t), l.name + ':')) { if (clip && (b.x0 < clip[0] || b.x1 > clip[2] || b.y0 < clip[1] || b.y1 > clip[3])) continue; out.push(b); }
    const M = camMatrix(c);
    for (const k of l.kids) {
      const B = k.world.BOARD, p0 = toScreen(M, [k.at[0] + B.x0 * k.s, k.at[1] + B.y0 * k.s]), p1 = toScreen(M, [k.at[0] + B.x1 * k.s, k.at[1] + B.y1 * k.s]);
      const r = [Math.min(p0[0], p1[0]), Math.min(p0[1], p1[1]), Math.max(p0[0], p1[0]), Math.max(p0[1], p1[1])];
      if (r[2] - r[0] > 3) walk(k, toChild(c, k), r);
    }
  };
  walk(base, cam, null);
  if (Q.get('subs') === '1') for (const s of SUBS) if (t >= s.t0 + 0.12 && t < s.t1 - 0.12) {
    const b = subBox(s);
    out.push({ id: 'sub:' + s.id, text: s.cn, x0: W / 2 - b.wc / 2, y0: SUB_Y - SUB_CN, x1: W / 2 + b.wc / 2, y1: SUB_Y + 8 }, { id: 'subE:' + s.id, text: s.en, x0: W / 2 - b.we / 2, y0: SUB_Y + 12, x1: W / 2 + b.we / 2, y1: SUB_Y + SUB_EN + 18 });
  }
  return out;
};
window.SUBS = SUBS;

// ======================= sound events (exported by events.mjs for audio.py) =======================
const EV = [{ t: 0, type: 'water' }];
for (const id of ORDER) EV.push({ t: Math.round(tGen(id) * 1000) / 1000, type: 'gen', i: ORDER.indexOf(id) });
for (const tab of [PLOT_C, PLOT_H3]) for (const [id, [t0, d]] of Object.entries(tab)) EV.push({ t: Math.round(t0 * 1000) / 1000, type: 'plot', d, big: ['title', 'tb', 'same', 'eq', 'ms7', 'x4'].includes(id) });
VO.forEach((t0, i) => EV.push({ t: t0, type: 'vo', id: VOTXT[i].id, d: DURS[VOTXT[i].id] }));
EV.push({ t: 4.7, type: 'hum' }, { t: 10.1, type: 'cut', i: 0 }, { t: 14.4, type: 'cut', i: 1 }, { t: T_IN, type: 'smooth', n: 0 }, { t: 18.75, type: 'whip' });
for (const tp of CW.TPS) EV.push({ t: Math.round(headT(tp.s) * 1000) / 1000, type: 'km' });
EV.push({ t: T_ARR, type: 'impact' }, { t: 24.0, type: 'bell', n: 91 }, { t: T_AC, type: 'chop' });
CUTS.forEach((c, i) => EV.push({ t: c.t0, type: 'step', i }));
EV.push({ t: 32.4, type: 'outside' }, { t: 34.0, type: 'suck' }, { t: 34.6, type: 'pop' }, { t: T_DB, type: 'smooth', n: 2 }, { t: 42.2, type: 'still' }, { t: 47.6, type: 'equal' },
  { t: PULL0, type: 'pullout' }, { t: 54.8, type: 'final' }, { t: 56.0, type: 'sign' }, { t: DUR, type: 'end' });
window.EV = EV.sort((a, b) => a.t - b.t);
window.READY = true;
