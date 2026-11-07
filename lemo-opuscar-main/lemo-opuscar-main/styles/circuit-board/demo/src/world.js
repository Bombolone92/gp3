// The corridor board: the Yangtze corridor from Baihetan to the river mouth, 1 unit ≈ 1 km.
// Only real things are drawn: the river (a bare channel in the copper), four lakes, the coast at the east end,
// the dam and its 16 units, the two converter stations, the ±800 kV pair, test pads every 500 km.
// Everything the film shows on this board lives here, so the closing pull-out shows the same silkscreen.
import { P, octi, offset, measure, at, sub, frameAt } from './geo.js';
import { textWidth } from './font.js';
import { bridge, ground, tag, box, xformer, reactor, capBank, chamferBox } from './parts.js';

// the south-east corner is cut off at 45° (open sea there): a square corner would reach 25.1° N at 122.9° E and take in
// the northern tip of Taiwan with nothing drawn on it; the cut keeps the whole island and its islets off the board
export const BOARD = { x0: -60, y0: -90, x1: 2140, y1: 1010, r: 36, inset: 14, cut: 210 };
const LL = pts => pts.map(p => (typeof p[0] === 'number' && p.length >= 2 && Math.abs(p[0]) < 200 && Math.abs(p[1]) < 90 && p[0] > 90) ? [...P(p[0], p[1]), p[2]] : p);

// ---------- Baihetan: the dam complex (local units scaled by DS around D) ----------
export const D = P(102.9, 27.21);
export const DS = 1.5;
const d = (x, y) => [D[0] + x * DS, D[1] + y * DS];
export const PEN_N = 8, PEN_PITCH = 6, PAD_Y = 12, BUS_Y = 20;
const padX = k => 36 + PEN_PITCH * k;                               // local x of generator k on the right bank
// penstocks: from the reservoir wall, across under the dam, to each generator (s = -1 left bank, +1 right bank)
export const PENS = [];
for (const s of [1, -1]) for (let k = 0; k < PEN_N; k++) {
  const yk = -6 - PEN_PITCH * k;
  PENS.push({ id: `pen${s > 0 ? 'R' : 'L'}${k}`, s, k, pts: [d(s * 10, yk), d(s * 16, yk), d(s * padX(k), PAD_Y - 2.9)], w: 1.7 * DS });
}
// generators: right bank G1..G8 (to Jiangsu), left bank G9..G16 (to Zhejiang)
export const GENS = [];
for (const s of [1, -1]) for (let k = 0; k < PEN_N; k++) {
  const [x, y] = d(s * padX(k), PAD_Y);
  GENS.push({ id: `G${s > 0 ? 1 + k : 9 + k}`, s, k, x, y, w: 4.4 * DS, h: 5.4 * DS, shape: 'rect', r: 0.7 * DS });
}
export const DAM = { x0: d(-74, 0)[0], x1: d(74, 0)[0], y0: d(0, -2.6)[1], y1: d(0, 2.6)[1] };
// reservoir (a widening of the channel above the dam)
export const RESERVOIR = [d(-2.4, -92), d(2.4, -92), d(10, -84.4), d(10, -2.6), d(-10, -2.6), d(-10, -84.4)];
// generator leads into the two bus bars
export const LEADS = GENS.map(g => ({ id: 'lead' + g.id, pts: [[g.x, g.y + g.h / 2], [g.x, d(0, BUS_Y)[1]]], w: 1.2 * DS, net: 'ac' }));

// ---------- Butuo converter (AC -> DC) ----------
export const BR = 7;
export const BUTUO = bridge(d(126, -96), BR, { id: 'butuo', sw: 0.42 });
// ---------- Yucheng converter (DC -> AC), the mirror ----------
export const YC = P(120.75, 31.65);
export const YUCHENG = bridge(YC, BR, { id: 'yucheng', sw: 0.42 });

// ---------- the river ----------
const up = octi([[62.4, -111], [62.4, 255], [124.8, 327, 'd'], [124.8, 560], [220.8, 656, 'd'], d(0, -88)]);
const yz = LL([
  d(0, 0), d(0, 40), [...d(12, 52), 'd'], [420, d(0, 52)[1]], [554, d(0, 52)[1] - 134, 'd'], [554, 560], [106.58, 29.56, 's'],
  [107.39, 29.71, 'd'], [108.04, 30.30, 's'], [108.41, 30.81, 'd'], [109.47, 31.02, 's'], [110.34, 31.04, 'd'], [111.29, 30.70, 's'], [111.76, 30.42, 'd'],
  [112.24, 30.30, 's'], [112.95, 29.55, 'd'], [113.55, 29.62, 's'], [114.30, 30.45, 'd'], [114.85, 30.40, 's'], [115.55, 29.80, 'd'], [116.10, 29.75, 's'], [117.05, 30.52, 'd'], [117.82, 30.95, 's'], [118.38, 31.33, 'd'], [118.50, 31.70, 's'], [118.78, 32.07, 'd'],
  [119.45, 32.21, 's'], [120.28, 31.92, 'd'], [120.86, 32.00, 's'], [121.40, 31.72, 'd'], [122.6, 31.45, 's'],
]);
const main = octi(yz);
// tributaries (narrower channels): Jialing, Wu, Han, Xiang, Gan
const trib = pts => octi(LL(pts));
export const RIVER = [
  { id: 'jinsha', pts: up, w: 7, kind: 'river' },
  { id: 'yangtze', pts: main, w: 12, kind: 'river' },
  { id: 'jialing', pts: trib([[106.05, 35.3], [106.05, 32.4], [106.3, 31.0, 'd'], [106.3, 30.2, 's'], [106.58, 29.62, 'd']]), w: 5, kind: 'river' },
  { id: 'wu', pts: trib([[107.2, 25.0], [107.2, 27.6], [107.6, 28.4, 'd'], [107.6, 29.0, 's'], [107.39, 29.68, 'd']]), w: 5, kind: 'river' },
  { id: 'han', pts: trib([[109.6, 35.3], [109.6, 33.0], [111.2, 32.6, 'd'], [112.2, 31.7, 'd'], [112.6, 30.9, 's'], [113.6, 30.65, 'd'], [114.25, 30.56, 's']]), w: 5, kind: 'river' },
  { id: 'xiang', pts: trib([[112.6, 25.0], [112.6, 27.2], [112.95, 27.9, 'd'], [112.95, 29.0, 's']]), w: 5, kind: 'river' },
  { id: 'gan', pts: trib([[115.6, 25.0], [115.6, 27.6], [115.9, 28.2, 'd'], [116.3, 28.9, 'd']]), w: 5, kind: 'river' },
  { id: 'hukou', pts: trib([[116.2, 29.4], [116.2, 29.78]]), w: 6, kind: 'river' },
];
// the tailrace below the dam is wider
export const TAIL = { id: 'tail', pts: [d(0, 5.5), d(0, 40), d(12, 52), [d(12, 52)[0] + 30, d(0, 52)[1]]], w: 15, kind: 'river' };

// ---------- lakes and the sea (no copper) ----------
const lake = pts => octi([...LL(pts), LL([pts[0]])[0]]);
export const LAKES = [
  lake([[112.35, 29.45], [112.85, 29.55, 'd'], [113.1, 29.35, 's'], [113.0, 28.95, 'd'], [112.6, 28.8, 's'], [112.3, 29.0, 'd']]),     // Dongting
  lake([[115.95, 29.6], [116.35, 29.45, 'd'], [116.7, 29.05, 's'], [116.55, 28.7, 'd'], [116.2, 28.8, 's'], [116.05, 29.2, 'd']]),     // Poyang
  lake([[117.3, 31.65], [117.7, 31.7, 's'], [117.85, 31.55, 'd'], [117.55, 31.45, 's'], [117.3, 31.5, 'd']]),                         // Chaohu
  lake([[119.95, 31.5], [120.45, 31.5, 's'], [120.6, 31.2, 'd'], [120.4, 30.95, 's'], [120.0, 31.0, 'd'], [119.9, 31.2, 's']]),       // Taihu
];
const coast = octi(LL([[119.3, 35.3], [119.3, 34.6], [120.2, 34.3, 'd'], [120.5, 33.6, 's'], [120.8, 32.8, 'd'], [121.3, 32.4, 'd'], [121.95, 31.75, 'd'],
  [121.95, 31.2, 's'], [121.85, 30.9, 'd'], [121.1, 30.65, 's'], [120.6, 30.4, 'd'], [121.1, 30.2, 'd'], [121.7, 29.95, 's'], [121.95, 29.6, 'd'],
  [121.6, 28.9, 's'], [121.4, 28.2, 'd'], [120.9, 27.6, 's'], [120.4, 26.8, 'd'], [119.9, 26.1, 's'], [119.6, 24.6, 'd']]));
export const SEA = [...coast, [BOARD.x1 + 50, coast[coast.length - 1][1]], [BOARD.x1 + 50, coast[0][1]]];

// ---------- the ±800 kV pair ----------
const B0 = BUTUO.c, Y0 = YUCHENG.c;
export const LINE_C = octi([
  [B0[0] + 58, B0[1]], [600, B0[1]], [666, 566, 'd'], [778, 566], [878, 466, 'd'], [960, 466], [1087.5, 338.5, 'd'], [1632, 338.5], [1687.5, 283, 'd'], [Y0[0] - 58, Y0[1]],
]);
export const PAIR = 3.0;                          // half the pitch of the pair in the corridor
const plus = offset(LINE_C, PAIR), minus = offset(LINE_C, -PAIR);
const bT = BUTUO.T, bB = BUTUO.B, yT = YUCHENG.T, yB = YUCHENG.B;
const leadIn = (V, s, p0) => { const dy = p0[1] - V[1]; return [V, [p0[0] - Math.abs(dy), V[1]], p0]; };
const leadOut = (V, s, p1) => { const dy = p1[1] - V[1]; return [p1, [p1[0] + Math.abs(dy), V[1]], V]; };
export const DCP = { id: 'dcp', pts: dedupe([...leadIn(bT, -1, plus[0]), ...plus.slice(1, -1), ...leadOut(yT, -1, plus[plus.length - 1])]), w: 1.8, net: 'dc' };
export const DCN = { id: 'dcn', pts: dedupe([...leadIn(bB, 1, minus[0]), ...minus.slice(1, -1), ...leadOut(yB, 1, minus[minus.length - 1])]), w: 1.8, net: 'dc' };
function dedupe(p) { const o = [p[0]]; for (let i = 1; i < p.length; i++) if (Math.hypot(p[i][0] - o[o.length - 1][0], p[i][1] - o[o.length - 1][1]) > 0.01) o.push(p[i]); return o; }

// ---------- AC buses ----------
const BUSR = [d(padX(0) - 2.2, BUS_Y), d(96, BUS_Y), d(96, -96), [BUTUO.L[0] - 20, BUTUO.L[1]]];
const BUSL = [d(-padX(0) + 2.2, BUS_Y), d(-92, BUS_Y), d(-92, 31)];
export const ACR = { id: 'acR', pts: BUSR, w: 1.8, net: 'ac' };
export const ACL = { id: 'acL', pts: BUSL, w: 1.8, net: 'ac' };
export const BARR = { id: 'barR', pts: [d(padX(0) - 2.2, BUS_Y), d(padX(7) + 2.2, BUS_Y)], w: 2.2 * DS, net: 'ac' };
export const BARL = { id: 'barL', pts: [d(-padX(0) + 2.2, BUS_Y), d(-padX(7) - 2.2, BUS_Y)], w: 2.2 * DS, net: 'ac' };
// AC out of Yucheng (towards the city)
export const CITY_AT = [1976, 306], CITY_S = 0.01, CITY_W = 1200, CITY_H = 800;          // the city module (a child board)
export const T21 = xformer([YUCHENG.R[0] + 8.5, YUCHENG.R[1]], 6, [5, 6], 0.24);            // converter transformer
export const T1 = xformer([YUCHENG.R[0] + 25, YUCHENG.R[1]], 4, [6, 4], 0.17); 
export const stepLabel = (T) => [{ id: 'step', gid: 'step', text: '降压', x: T.c[0], y: T.c[1] - T.s * 1.02, cap: T.s * 0.17, sw: T.s * 0.017, align: 'center' }, { id: 'stepE', gid: 'stepE', text: 'STEP DOWN', x: T.c[0], y: T.c[1] - T.s * 0.76, cap: T.s * 0.08, sw: T.s * 0.012, align: 'center' }];            // regional 500 kV -> 220 kV
const cityIn = [CITY_AT[0], CITY_AT[1] + 120 * CITY_S];
export const ACY = { id: 'acY', pts: [YUCHENG.R, T21.inP], w: 1.4, net: 'ac' };
export const ACY2 = { id: 'acY2', pts: [T21.outP, T1.inP], w: 1.4, net: 'ac' };
export const ACY3 = { id: 'acY3', pts: [T1.outP, [1973.2, T1.outP[1]], [1973.2, cityIn[1]], cityIn], w: 0.7, net: 'ac' };
// station equipment: converter transformers on the AC side, AC filter banks, smoothing reactors on both poles
export const T11 = xformer([BUTUO.L[0] - 17, BUTUO.L[1]], 6, [6, 5], 0.24);
export const FILT_B = capBank(BUTUO.L[0] - 36.5, BUTUO.L[1], 4, 3.4, 3.2, 0.2, 1);
export const FILT_Y = capBank(YUCHENG.R[0] + 13.6, YUCHENG.R[1], 3, 3.0, 3.2, 0.2, -1);
export const REACT = [
  reactor([BUTUO.T[0] + 37, BUTUO.T[1]], 7, 0.24, -1), reactor([BUTUO.B[0] + 37, BUTUO.B[1]], 7, 0.24, 1),
  reactor([YUCHENG.T[0] - 37, YUCHENG.T[1]], 7, 0.24, -1), reactor([YUCHENG.B[0] - 37, YUCHENG.B[1]], 7, 0.24, 1),
];
// the returns: Butuo's right vertex and Yucheng's left vertex go to earth through a via
export const VIAS = [];
const viaB = [BUTUO.R[0] + 3.2, BUTUO.R[1]], viaY = [YUCHENG.L[0] - 3.2, YUCHENG.L[1]];
VIAS.push([...viaB, 1.3, 0.6], [...viaY, 1.3, 0.6]);
export const RET = [{ id: 'retB', pts: [BUTUO.R, viaB], w: 1.4, net: 'ret' }, { id: 'retY', pts: [YUCHENG.L, viaY], w: 1.4, net: 'ret' }];

// ---------- J2: the connector the left bank leaves the board through ----------
const J2 = d(-92, 36);
export const J2PADS = [0, 1, 2, 3].map(i => ({ x: J2[0] - 2.25 * DS + (i % 2) * 4.5 * DS, y: J2[1] + Math.floor(i / 2) * 4.5 * DS, r: 1.5 * DS, shape: i ? 'round' : 'square', hole: 0.7 * DS, id: 'J2:' + i }));

export const ACB2 = { id: 'acB2', pts: [T11.outP, BUTUO.L], w: 1.8, net: 'ac' };
const bankTr = (b, id) => b.traces.map((p, i) => ({ id: id + i, pts: p, w: 0.7, net: 'gnd' }));
export const TRACES = [ACR, ACB2, ACL, BARR, BARL, ...LEADS, DCP, DCN, ACY, ACY2, ACY3, ...RET, ...bankTr(FILT_B, 'fb'), ...bankTr(FILT_Y, 'fy')].map(t => ({ ...t, m: measure(t.pts) }));
export const byId = id => TRACES.find(t => t.id === id);
export const LINE_M = measure(LINE_C);
export const CLEARLINES = [{ pts: LINE_C, w: 2 * PAIR }];

// ---------- test pads every 500 km ----------
export const TPS = [500, 1000, 1500].map((km, i) => {
  const f = frameAt(LINE_M, LINE_M.len * km / 2080), q = [f.p[0] + f.n[0] * (PAIR + 9), f.p[1] + f.n[1] * (PAIR + 9)];
  const onPlus = [f.p[0] + f.n[0] * PAIR, f.p[1] + f.n[1] * PAIR];
  return { km, p: q, stub: [onPlus, q], s: LINE_M.len * km / 2080, text: `${km.toLocaleString('en-US')} km` };
});

// ---------- silkscreen ----------
const CN = 44, EN = 20, SWN = 3.2;     // place names: Chinese line over an English line, one stroke width
function lineY(x) { for (let i = 1; i < LINE_C.length; i++) { const a = LINE_C[i - 1], b = LINE_C[i]; if ((a[0] - x) * (b[0] - x) <= 0 && a[0] !== b[0]) return a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]); } return LINE_C[0][1]; }
const name = (id, cn, en, lon, gap) => {
  const x = P(lon, 0)[0], y = gap > 0 ? lineY(x) - gap - CN * 1.3 - EN : lineY(x) - gap;
  return [{ id: id, text: cn, x, y, cap: CN, sw: SWN, align: 'center' }, { id: id + 'E', text: en, x, y: y + CN * 1.3, cap: EN, sw: SWN, align: 'center' }];
};
const dl = (x, y) => d(x, y);
export const LABELS = [
  // Baihetan
  // Butuo
  // the corridor
  ...name('sc', '四川', 'SICHUAN', 105.6, 22),
  { id: 'js', text: '江苏', x: 1858, y: 136, cap: CN, sw: SWN, align: 'center' }, { id: 'jsE', text: 'JIANGSU', x: 1858, y: 136 + CN * 1.3, cap: EN, sw: SWN, align: 'center' },
  { id: 'len', text: '2,080 公里', x: 1300, y: 338.5 - 22 - CN * 1.3 - EN, cap: CN, sw: SWN, align: 'center' }, { id: 'lenE', text: '2,080 km', x: 1300, y: 338.5 - 22 - EN, cap: EN, sw: SWN, align: 'center' },
  // the stations, as the voice names them
  { id: 'csB', text: '换流站', x: BUTUO.c[0], y: BUTUO.c[1] + BR + 3.4, cap: 2.6, sw: 0.25, align: 'center' },
  { id: 'csBE', text: 'CONVERTER STATION', x: BUTUO.c[0], y: BUTUO.c[1] + BR + 7.0, cap: 1.2, sw: 0.22, align: 'center' },
  { id: 'acIn', text: '交流电', x: BUTUO.L[0] - 9, y: BUTUO.c[1] - 6.4, cap: 2.2, sw: 0.24, align: 'center' },
  { id: 'acInE', text: 'AC', x: BUTUO.L[0] - 9, y: BUTUO.c[1] - 3.3, cap: 1.2, sw: 0.22, align: 'center' },
  { id: 'dcOut', text: '直流电', x: BUTUO.c[0] + 21, y: BUTUO.c[1] - 2.4, cap: 2.2, sw: 0.24, align: 'center' },
  { id: 'dcOutE', text: 'DC', x: BUTUO.c[0] + 21, y: BUTUO.c[1] + 0.8, cap: 1.2, sw: 0.22, align: 'center' },
  { id: 'csY', text: '换流站', x: YUCHENG.c[0], y: YUCHENG.c[1] + BR + 3.4, cap: 2.6, sw: 0.25, align: 'center' },
  { id: 'csYE', text: 'CONVERTER STATION', x: YUCHENG.c[0], y: YUCHENG.c[1] + BR + 7.0, cap: 1.2, sw: 0.22, align: 'center' },
  { id: 'acOut', text: '交流电', x: YUCHENG.R[0] + 8.5, y: YUCHENG.c[1] + 3.5, cap: 2.2, sw: 0.24, align: 'center' },
  { id: 'acOutE', text: 'AC', x: YUCHENG.R[0] + 8.5, y: YUCHENG.c[1] + 6.5, cap: 1.2, sw: 0.22, align: 'center' },
  // Yucheng
];
// timestamps: the Butuo tag sits between the + and − lines; Yucheng repeats it above its own, digit for digit
export const TS0 = tag(BUTUO.c[0] + BR + 9.5, BUTUO.c[1] - 1.0, '12:00:00.000', 2.0, 0.24);
// Yucheng: one frame, Butuo's time on top, Yucheng's under it, digit for digit; the difference beside it
const TSX = YUCHENG.c[0] + 13.2, TSY = YUCHENG.c[1] + 9.6;
export const TS1 = { frame: chamferBox(TSX - 1.6, TSY + 0.4, TSX + 21.6, TSY + 10.2, 1), w: 0.3 };
LABELS.push({ id: 'ms7', text: '7 毫秒', x: TSX + 10, y: TSY + 1.8, cap: 3.4, sw: 0.36, align: 'center' }, { id: 'ms7E', text: '7 ms', x: TSX + 10, y: TSY + 6.7, cap: 1.8, sw: 0.3, align: 'center' });
LABELS.push(
);

// ---------- the opening title, printed beside the right-bank generators ----------
LABELS.push(
  { id: 'title', text: '七毫秒', x: d(86, -56)[0], y: d(86, -56)[1], cap: 6.2 * DS, sw: 0.5 * DS, align: 'right' },
  { id: 'titleE', text: 'SEVEN MILLISECONDS', x: d(86, -46.6)[0], y: d(86, -46.6)[1], cap: 2.5 * DS, sw: 0.5 * DS, align: 'right' },
  { id: 'acBus', text: '交流电', x: d(93, -10)[0], y: d(93, -10)[1], cap: 2.6, sw: 0.25, align: 'right' }, { id: 'acBusE', text: 'AC', x: d(93, -7.2)[0], y: d(93, -7.2)[1], cap: 1.2, sw: 0.2, align: 'right' },
);

// ---------- the other ±800 kV lines of the west-to-east corridor (drawn, never lit, never labelled) ----------
// three lanes south of ours; each ends in its own small converter footprint at both ends (routes schematic)
const LM0 = measure(LINE_C);
export const OTHERS = [];
const otherEnds = [
  { d: 11, w0: [505, 692], e: [[1782, 380, 'd'], [1934, 380], [1934, 352]] },          // to Suzhou (Tongli)
  { d: 20, w0: [490, 712], e: [[1760, 398, 'd'], [1974, 398], [2004, 368, 'd']] },     // to Shanghai (Fengxian)
  { d: 29, w0: [475, 732], e: [[1824, 560, 'd']] },                                    // to Jinhua
];
const OTHER_PADS = [], OTHER_SILK = [];
otherEnds.forEach((o, i) => {
  const lane = offset(LINE_C, -o.d), m = measure(lane);
  let sA = 0; while (sA < m.len && at(m, sA)[0] < 590 + i * 4) sA += 1;
  let sB = m.len; while (sB > 0 && at(m, sB)[0] > 1690 - i * 6) sB -= 1;
  const mid = sub(m, sA, sB), w = octi([[...o.w0], [mid[0][0], mid[0][1], 'd']]);
  const east = octi([mid[mid.length - 1], ...o.e]);
  for (const k of [-1, 1]) {
    const pts = dedupe([...w.slice(0, -1), ...mid, ...east.slice(1)]);
    OTHERS.push({ id: `oth${i}${k}`, pts: offset(pts, k * 1.1), w: 0.9, net: 'idle' });
  }
  for (const p of [o.w0, east[east.length - 1]]) { const b = bridge(p, 2.4, { id: 'ob' + i, sw: 0.18 }); OTHER_PADS.push(...b.pads); OTHER_SILK.push(...b.silk.slice(0, 1)); }
});

// ---------- real cities as test points (the AC grid's nodes): a round pad, a ring, a pinyin tag ----------
const CITIES = [['CHENGDU', 104.07, 30.67], ['CHONGQING', 106.55, 29.56], ['GUIYANG', 106.71, 26.58], ['WANZHOU', 108.41, 30.81], ["XI'AN", 108.94, 34.34],
  ['YICHANG', 111.29, 30.70], ['XIANGYANG', 112.14, 32.04], ['CHANGSHA', 112.94, 28.23], ['WUHAN', 114.31, 30.59],
  ['NANCHANG', 115.86, 28.68], ['ANQING', 117.05, 30.53], ['HEFEI', 117.23, 31.82], ['NANJING', 118.80, 32.06], ['HANGZHOU', 120.16, 30.27],
  ['SHANGHAI', 121.47, 31.23], ['NINGBO', 121.55, 29.87], ['WENZHOU', 120.70, 28.0], ['FUZHOU', 119.30, 26.08], ['GUILIN', 110.29, 25.27]];
export const CITY_PTS = [];

// ---------- silkscreen furniture ----------
const ticks = [];
for (let km = 100; km < 2080; km += 100) if (km % 500) {
  const f = frameAt(LINE_M, LINE_M.len * km / 2080), a = PAIR + 2.6, b = PAIR + 5.2;
  ticks.push({ pts: [[f.p[0] + f.n[0] * a, f.p[1] + f.n[1] * a], [f.p[0] + f.n[0] * b, f.p[1] + f.n[1] * b]], w: 0.55 });
}
// designators and fixed silk (texture: drawn whenever large enough)
export const DESIG = [
  { text: 'G1–G8', x: d(57, 24.2)[0], y: d(57, 24.2)[1], cap: 2.1 * DS, align: 'center' },
  { text: 'G9–G16', x: d(-57, 24.2)[0], y: d(-57, 24.2)[1], cap: 2.1 * DS, align: 'center' },
  ...GENS.map(g => ({ text: g.id, x: g.x, y: g.y - g.h / 2 - 1.9, cap: 0.75 * DS, align: 'center' })),
  { text: 'J2', x: d(-92, 45.6)[0], y: d(-92, 45.6)[1], cap: 1.8 * DS, align: 'center' },
  { text: 'SPILLWAY', x: D[0], y: d(0, -1.5)[1], cap: 1.1 * DS, align: 'center' },
  { text: 'T11', x: T11.c[0], y: T11.c[1] - 4.6, cap: 1.1, align: 'center' }, { text: 'T21', x: T21.c[0], y: T21.c[1] - 4.6, cap: 1.1, align: 'center' },

  { text: 'C11–C14', x: FILT_B.pads[0].x - 1, y: FILT_B.rail + 0.9, cap: 0.75, align: 'left' }, 
  { text: 'AC FILTER', x: FILT_B.pads[0].x - 1, y: FILT_B.rail + 2.2, cap: 0.75, align: 'left' },
  { text: 'L11', x: REACT[0].pads[0].x + 3.5, y: BUTUO.T[1] - 4.4, cap: 0.9, align: 'center' }, { text: 'L12', x: REACT[1].pads[0].x + 3.5, y: BUTUO.B[1] + 3.3, cap: 0.9, align: 'center' },
  { text: 'L21', x: REACT[2].pads[0].x + 3.5, y: YUCHENG.T[1] - 4.4, cap: 0.9, align: 'center' }, { text: 'L22', x: REACT[3].pads[0].x + 3.5, y: YUCHENG.B[1] + 3.3, cap: 0.9, align: 'center' },
  { text: 'VALVE HALL', x: BUTUO.c[0] - 46, y: BUTUO.c[1] - 20.8, cap: 0.9, align: 'left' }, { text: 'VALVE HALL', x: YUCHENG.c[0] - 46, y: YUCHENG.c[1] - 20.8, cap: 0.9, align: 'left' },
  ...TPS.map((tp, i) => ({ text: 'TP' + (i + 1), x: tp.p[0] + 5, y: tp.p[1] - 1.2, cap: 2.2, align: 'left' })),
  { text: '±800 kV DC  ·  2,080 km  ·  8 GW', x: 640, y: 960, cap: 6, align: 'left' },
  { text: 'LAYER 1 OF 4  ·  COPPER 2 OZ', x: 640, y: 974, cap: 4, align: 'left' },
];
DESIG.push(
  { text: '白鹤滩', x: dl(-100, -56)[0], y: dl(-100, -56)[1], cap: 4.2 * DS, align: 'left' }, { text: 'BAIHETAN', x: dl(-100, -49.6)[0], y: dl(-100, -49.6)[1], cap: 1.8 * DS, align: 'left' },
  ...[['CHONGQING', 108.1], ['ANHUI', 116.75]].map(([t, lon]) => ({ text: t, x: P(lon, 0)[0], y: lineY(P(lon, 0)[0]) - 36, cap: 9, align: 'center' })),
  ...TPS.map(tp => ({ text: tp.text, x: tp.p[0], y: tp.p[1] - 12, cap: 4, align: 'center' })),
);
export const SILK = [
  ...BUTUO.silk, ...YUCHENG.silk, ...T11.silk, ...T21.silk, ...T1.silk, ...FILT_B.silk, ...FILT_Y.silk, ...REACT.flatMap(r => r.silk),
  ...ground([viaB[0] + 1.4, viaB[1]], 1.6, 0.26), ...ground([viaY[0] - 1.4, viaY[1]], 1.6, 0.26, -1),
  ...ground([FILT_B.pads[0].x - 1.6, FILT_B.rail], 1.2, 0.2, -1), ...ground([FILT_Y.pads[0].x - 1.6, FILT_Y.rail], 1.2, 0.2, -1),
  { pts: TS1.frame, w: TS1.w, plot: 'ms7' },
  // valve-hall courtyards (dashed) around both stations
  { pts: box(BUTUO.c[0] - 47, BUTUO.c[1] - 22, BUTUO.c[0] + 49, BUTUO.c[1] + 20), w: 0.22, dash: [1.4, 1] },
  { pts: box(YUCHENG.c[0] - 47, YUCHENG.c[1] - 22, YUCHENG.c[0] + 45, YUCHENG.c[1] + 25), w: 0.22, dash: [1.4, 1] },
  // J2 outline
  { pts: box(J2[0] - 4.6 * DS, J2[1] - 2.4 * DS, J2[0] + 4.6 * DS, J2[1] + 6.9 * DS), w: 0.3 * DS },
  // the dam: generator row outlines, spillway gates, a step-up transformer on every lead
  { pts: box(d(padX(0) - 4, PAD_Y - 4.2)[0], d(0, PAD_Y - 4.2)[1], d(padX(7) + 4, 0)[0], d(0, PAD_Y + 4.2)[1]), w: 0.22 * DS, dash: [1.4 * DS, 1 * DS] },
  { pts: box(d(-padX(7) - 4, PAD_Y - 4.2)[0], d(0, PAD_Y - 4.2)[1], d(-padX(0) + 4, 0)[0], d(0, PAD_Y + 4.2)[1]), w: 0.22 * DS, dash: [1.4 * DS, 1 * DS] },
  ...GENS.flatMap(g => { const y = (g.y + g.h / 2 + d(0, BUS_Y)[1]) / 2, r = 0.55 * DS; return [{ circle: [g.x - r * 0.55, y, r], w: 0.13 * DS }, { circle: [g.x + r * 0.55, y, r], w: 0.13 * DS }]; }),
  // the city module footprint
  { pts: box(CITY_AT[0] - 0.4, CITY_AT[1] - 0.4, CITY_AT[0] + CITY_W * CITY_S + 0.4, CITY_AT[1] + CITY_H * CITY_S + 0.4), w: 0.16 },
  ...ticks, ...OTHER_SILK,
];
export const PADS = [...BUTUO.pads, ...YUCHENG.pads, ...J2PADS, ...T11.pads, ...T21.pads, ...T1.pads, ...FILT_B.pads, ...FILT_Y.pads, ...REACT.flatMap(r => r.pads), ...OTHER_PADS,
  ...TPS.map((tp, i) => ({ x: tp.p[0], y: tp.p[1], r: 2.4, shape: 'round', hole: 0.9, id: 'TP' + i }))];
export const KEEP = [...BUTUO.keep, ...YUCHENG.keep, ...T11.keep, ...T21.keep, ...T1.keep, { rect: [J2[0] - 5 * DS, J2[1] - 2.8 * DS, J2[0] + 5 * DS, J2[1] + 7.3 * DS] },
  { rect: [CITY_AT[0] - 0.8, CITY_AT[1] - 0.8, CITY_AT[0] + CITY_W * CITY_S + 0.8, CITY_AT[1] + CITY_H * CITY_S + 0.8] }];
export const STUBS = TPS.map(tp => ({ id: 'stub' + tp.km, pts: tp.stub, w: 1.2, net: 'dc' }));
TRACES.push(...STUBS.map(t => ({ ...t, m: measure(t.pts) })), ...OTHERS.map(t => ({ ...t, m: measure(t.pts) })));

// board furniture for the closing reveal: holes, fiducials, the title block (title, sheet line, sign-off)
export const HOLES = [[BOARD.x0 + 60, BOARD.y0 + 60], [BOARD.x1 - 60, BOARD.y0 + 60], [BOARD.x0 + 60, BOARD.y1 - 60], [BOARD.x1 - 60, BOARD.y1 - BOARD.cut - 30]];
export const TITLE = { x: 1120, y: -60, w: 620, h: 270 };
export const FIDS = [[BOARD.x0 + 130, BOARD.y0 + 46], [BOARD.x1 - BOARD.cut / 2 - 33, BOARD.y1 - BOARD.cut / 2 - 33], [BOARD.x0 + 46, BOARD.y1 - 130]];
SILK.push(
  { pts: box(TITLE.x, TITLE.y, TITLE.x + TITLE.w, TITLE.y + TITLE.h), w: 3.2, plot: 'tbBox' },
  { pts: [[TITLE.x, TITLE.y + 190], [TITLE.x + TITLE.w, TITLE.y + 190]], w: 2, plot: 'tbBox' },
);
LABELS.push(
  { id: 'tb', text: '七毫秒', x: TITLE.x + 34, y: TITLE.y + 26, cap: 90, sw: 7, align: 'left' },
  { id: 'tbE', text: 'SEVEN MILLISECONDS', x: TITLE.x + 36, y: TITLE.y + 140, cap: 30, sw: 3.8, align: 'left' },
  { id: 'sign', text: 'LemoLab × Claude Opus 5.5', x: TITLE.x + 38, y: TITLE.y + 214, cap: 30, sw: 3.8, align: 'left' },
);
DESIG.push({ text: 'REV A', x: TITLE.x + TITLE.w - 24, y: TITLE.y + 22, cap: 14, align: 'right' }, { text: 'SHEET 1 OF 1', x: TITLE.x + TITLE.w - 24, y: TITLE.y + 44, cap: 9, align: 'right' });

// reservoir flow: slow, wide
export const RES_FLOW = [{ id: 'res', pts: [d(0, -90), d(0, -5.5)], w: 17 * DS }];
export const CLR = 1.4, VIA_R = 1.6, FENCE_R = 1.15, HOLE_R = 14, FID_R = 5;
export const CHILD = { name: 'city', at: CITY_AT, s: CITY_S };

// ---------- geometry tests ----------
const segDist = (p, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2)); return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy); };
const polyDist = (p, pts) => { let m = 1e9; for (let i = 1; i < pts.length; i++) m = Math.min(m, segDist(p, pts[i - 1], pts[i])); return m; };
const inside = (p, pts) => { let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const a = pts[i], b = pts[j]; if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
const DAMBOX = [d(-150, -100), d(150, 60)], BTBOX = [[BUTUO.c[0] - 50, BUTUO.c[1] - 26], [BUTUO.c[0] + 60, BUTUO.c[1] + 24]], YCBOX = [[YUCHENG.c[0] - 50, YUCHENG.c[1] - 26], [YUCHENG.c[0] + 75, YUCHENG.c[1] + 32]];
const inBox = (p, b) => p[0] > b[0][0] && p[0] < b[1][0] && p[1] > b[0][1] && p[1] < b[1][1];
function clearOf(p, gap, labels = true) {
  if (p[0] < BOARD.x0 + 30 || p[0] > BOARD.x1 - 30 || p[1] < BOARD.y0 + 30 || p[1] > BOARD.y1 - 30) return false;
  if (inBox(p, DAMBOX) || inBox(p, BTBOX) || inBox(p, YCBOX)) return false;
  if (inside(p, SEA) || polyDist(p, SEA) < gap) return false;
  for (const L of LAKES) if (inside(p, L) || polyDist(p, L) < gap) return false;
  for (const r of RIVER) if (polyDist(p, r.pts) < r.w / 2 + gap) return false;
  for (const t of TRACES) if (t.layer !== 'bottom' && polyDist(p, t.pts) < t.w / 2 + gap) return false;
  if (polyDist(p, LINE_C) < PAIR + 6 + gap) return false;
  if (labels) for (const L of LABELS) { const wd = textWidth(L.text, L.cap); const x0 = L.align === 'center' ? L.x - wd / 2 : L.align === 'right' ? L.x - wd : L.x; if (p[0] > x0 - 6 && p[0] < x0 + wd + 6 && p[1] > L.y - 6 && p[1] < L.y + L.cap + 6) return false; }
  if (p[0] > TITLE.x - 20 && p[0] < TITLE.x + TITLE.w + 20 && p[1] > TITLE.y - 20 && p[1] < TITLE.y + TITLE.h + 20) return false;
  for (const tp of TPS) if (Math.hypot(p[0] - tp.p[0], p[1] - tp.p[1]) < 30) return false;
  for (const c of CITY_PTS) if (Math.hypot(p[0] - c[0], p[1] - c[1]) < 22) return false;
  for (const h of HOLES) if (Math.hypot(p[0] - h[0], p[1] - h[1]) < 40) return false;
  return true;
}
// place the city nodes off the river and the lines (nudged north if needed)
for (const [nm, lon, lat] of CITIES) {
  let [x, y] = P(lon, lat), ok = false;
  for (let k = 0; k < 12 && !ok; k++) { if (clearOf([x, y], 7, false)) ok = true; else y -= 6; }
  if (!ok) continue;
  CITY_PTS.push([x, y]);
  PADS.push({ x, y, r: 3.2, shape: 'round', hole: 1.3, id: 'city' + nm });
  SILK.push({ circle: [x, y, 5.6], w: 0.7 });
  DESIG.push({ text: nm, x: x + 8, y: y - 3, cap: 6.5, align: 'left' });
}
export function fence() {
  const out = [];
  for (const r of RIVER) for (const s of [1, -1]) {
    const o = offset(r.pts, s * (r.w / 2 + 3.2)), m = measure(o);
    for (let x = 3; x < m.len; x += 6.5) {
      const p = at(m, x);
      if (inBox(p, DAMBOX) || inBox(p, BTBOX) || inBox(p, YCBOX) || inside(p, SEA) || p[1] < BOARD.y0 + 20 || p[1] > BOARD.y1 - 20 || p[0] < BOARD.x0 + 20) continue;
      let bad = false; for (const t of TRACES) if (t.layer !== 'bottom' && polyDist(p, t.pts) < t.w / 2 + 2.4) { bad = true; break; }
      if (!bad && polyDist(p, LINE_C) < PAIR + 3.4) bad = true;
      if (!bad) for (const r2 of RIVER) if (r2 !== r && polyDist(p, r2.pts) < r2.w / 2 + 2) { bad = true; break; }
      if (!bad) out.push(p);
    }
  }
  for (const L of LAKES) { const o = L, m = measure([...o, o[0]]); for (let x = 0; x < m.len; x += 6.5) { const q = at(m, x), c = L.reduce((a, b) => [a[0] + b[0] / L.length, a[1] + b[1] / L.length], [0, 0]), dx = q[0] - c[0], dy = q[1] - c[1], k = Math.hypot(dx, dy); out.push([q[0] + dx / k * 4.2, q[1] + dy / k * 4.2]); } }
  return out;
}
export function stitch() {
  const out = [], P0 = 30;
  for (let j = 0, y = BOARD.y0 + 40; y < BOARD.y1 - 30; y += P0 * 0.866, j++) for (let x = BOARD.x0 + 40 + (j % 2) * P0 / 2; x < BOARD.x1 - 30; x += P0) if (clearOf([x, y], 7)) out.push([x, y]);
  return out;
}

LABELS.push(...stepLabel(T1));

// a silkscreen sine beside the AC label on the right-bank bus: back and forth
{ const [x0, y0] = d(85, -3.1), pts = []; for (let i = 0; i <= 48; i++) { const u = i / 48; pts.push([x0 + u * 12, y0 + 1.6 * Math.sin(u * 4 * Math.PI)]); }
  SILK.push({ pts, w: 0.22, plot: 'acBus' }, { pts: [[x0, y0], [x0 + 12.6, y0]], w: 0.1, plot: 'acBus' }); }
