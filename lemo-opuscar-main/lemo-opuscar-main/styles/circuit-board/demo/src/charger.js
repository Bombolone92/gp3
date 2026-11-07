// The charger board: a 20 W phone charger's primary side, in millimetres. Layout is invented; the chain is the
// common one (fuse -> bridge -> bulk capacitor -> flyback transformer -> USB-C). DB1 uses the same footprint
// as the converter stations on the corridor board, at 4.5/7 of the size.
import { measure } from './geo.js';
import { bridge, chip, ecap, xfmr, ground, box } from './parts.js';

export const BOARD = { x0: -16, y0: -6, x1: 53, y1: 33, r: 1.6, inset: 0.5 };
export const K = 4.5 / 7;                       // DB1 is the station footprint at this scale (mm per corridor unit)
export const DB1 = bridge([17.5, 14], 7 * K, { id: 'db1', sw: 0.42 * K });
const F1 = chip([8.2, 14], 3.2, 1.1, 1.5, { sw: 0.16 });
const C1 = ecap([35.2, 10.2], 2.7, { sw: 0.14 });
const T1 = xfmr([41.2, 15.4], 6.4, 7.2, 4, { sw: 0.14 });
const U1 = chip([35.6, 18.6], 2.4, 0.7, 0.9, { sw: 0.12 });
const C2 = chip([43.2, 10.6], 1.8, 0.8, 1.1, { sw: 0.12 });
export const LPAD = [3, 14], NPAD = [3, 22];
export const VIA_N = [DB1.R[0] + 3.2 * K, DB1.R[1]];
export const USB = [0, 1, 2, 3, 4, 5].map(i => ({ x: 51.4, y: 20.6 + i * 1.2 + (i > 2 ? 1.6 : 0), w: 1.8, h: 0.62, shape: 'rect', r: 0.12, id: 'usb' + i }));

const tr = (id, pts, w, net, layer) => ({ id, pts, w, net, layer: layer || 'top' });
export const TRACES = [
  tr('L', [LPAD, F1.a], 0.9, 'ac'),
  tr('L2', [F1.b, DB1.L], 0.9, 'ac'),
  tr('N', [NPAD, [8, NPAD[1]], [11, NPAD[1] + 3], [VIA_N[0] + 1.4, NPAD[1] + 3], [VIA_N[0] + 1.4, VIA_N[1] + 1.4], [VIA_N[0], VIA_N[1]]], 0.9, 'ac', 'bottom'),
  tr('ret', [DB1.R, VIA_N], 0.7, 'ret'),
  tr('plus', [DB1.T, [30.6, DB1.T[1]], [C1.plus[0], C1.plus[1] - 0.7], [C1.plus[0], C1.plus[1]]], 1.0, 'dc'),
  tr('minus', [DB1.B, [32.6, DB1.B[1]], [36.3, 14.8], [C1.minus[0], 14.8], C1.minus], 1.0, 'dc'),
  tr('pri', [C1.plus, [C1.plus[0], 7.4], [T1.pin(-1, 0)[0], 7.4], T1.pin(-1, 0)], 0.8, 'dc'),
  tr('sw', [T1.pin(-1, 3), [U1.b[0] + 0.8, T1.pin(-1, 3)[1]], [U1.b[0] + 0.8, U1.b[1]], U1.b], 0.5, 'dc'),
  tr('sec', [T1.pin(1, 0), [C2.a[0] - 1, T1.pin(1, 0)[1]], [C2.a[0] - 1, C2.a[1]], C2.a], 0.6, 'dc'),
  tr('vbus', [C2.b, [46.8, C2.b[1]], [46.8, USB[0].y - 1.6], [48.4, USB[0].y], [USB[0].x, USB[0].y]], 0.6, 'dc'),
].map(t => ({ ...t, m: measure(t.pts) }));
export const byId = id => TRACES.find(t => t.id === id);

export const PADS = [
  { x: LPAD[0], y: LPAD[1], r: 1.25, shape: 'round', hole: 0.55, id: 'L' }, { x: NPAD[0], y: NPAD[1], r: 1.25, shape: 'round', hole: 0.55, id: 'N' },
  ...F1.pads, ...DB1.pads, ...C1.pads, ...T1.pads, ...U1.pads, ...C2.pads, ...USB,
];
export const VIAS = [[...VIA_N, 0.55, 0.25]];
export const KEEP = [...F1.keep, ...DB1.keep, ...C1.keep, ...T1.keep, ...U1.keep, ...C2.keep, { rect: [50.2, 19.8, 53, 28.6] }];
export const SILK = [
  ...DB1.silk, ...F1.silk, ...C1.silk, ...T1.silk, ...U1.silk, ...C2.silk,
  { circle: [LPAD[0], LPAD[1], 1.9], w: 0.16 }, { circle: [NPAD[0], NPAD[1], 1.9], w: 0.16 },
  { pts: box(49.7, 19.8, 52.4, 28.6), w: 0.14 },
];
// Detail A: the corridor board shown through a round window, Butuo's bridge at DB1's size
export const BUBBLE = { c: [38.4, 13.0], r: 8.0, at: [38.4, 14] };      // `at` = where Butuo's centre lands
export const LABELS = [
  { id: 'chg', text: '充电器', x: -12.5, y: -4.2, cap: 2.4, sw: 0.24, align: 'left' },
  { id: 'chgE', text: 'CHARGER', x: -12.4, y: -0.9, cap: 1.0, sw: 0.18, align: 'left' },
  { id: 'acdc', text: '交流 → 直流', x: DB1.c[0], y: 4.6, cap: 1.1, sw: 0.14, align: 'center' },
  { id: 'acdcE', text: 'AC → DC', x: DB1.c[0], y: 6.3, cap: 0.6, sw: 0.11, align: 'center' },
  { id: 'zlq', text: '整流桥', x: DB1.c[0], y: 21.9, cap: 1.1, sw: 0.14, align: 'center' },
  { id: 'zlqE', text: 'BRIDGE RECTIFIER', x: DB1.c[0], y: 23.6, cap: 0.6, sw: 0.11, align: 'center' },
  { id: 'csV', text: '换流站', x: BUBBLE.c[0], y: 21.9, cap: 1.1, sw: 0.14, align: 'center' },
  { id: 'csVE', text: 'CONVERTER STATION', x: BUBBLE.c[0], y: 23.6, cap: 0.6, sw: 0.11, align: 'center' },
  { id: 'eq', text: '=', x: 26.2, y: 12.1, cap: 3.6, sw: 0.36, align: 'center' },
  { id: 'same', text: '同一个电路原理', x: 27.4, y: 4.6, cap: 1.0, sw: 0.13, align: 'center' },
  { id: 'sameE', text: 'THE SAME CIRCUIT', x: 27.4, y: 6.3, cap: 0.6, sw: 0.11, align: 'center' },
  { id: 'x4', text: '功率差 4 亿倍', x: 27.9, y: 25.1, cap: 1.1, sw: 0.14, align: 'center' },
  { id: 'x4E', text: '400 MILLION × THE POWER', x: 27.9, y: 26.8, cap: 0.6, sw: 0.11, align: 'center' },
];
export const DESIG = [
  { text: 'USB-C · 20 W', x: 48.4, y: 26.9, cap: 0.5, align: 'right' },
  { text: 'L', x: LPAD[0], y: LPAD[1] - 3.5, cap: 0.9, align: 'center' }, { text: 'N', x: NPAD[0], y: NPAD[1] - 3.5, cap: 0.9, align: 'center' },
  { text: 'F1', x: F1.a[0] + 1.6, y: 11.2, cap: 0.8, align: 'center' },
  { text: 'DB1', x: DB1.L[0] - 0.4, y: DB1.T[1] - 0.6, cap: 0.8, align: 'right' },
  { text: 'C1', x: 35.2, y: 13.1, cap: 0.7, align: 'center' },
  { text: 'T1', x: 41.2, y: 19.6, cap: 0.7, align: 'center' },
  { text: 'U1', x: U1.a[0] + 1.2, y: 19.6, cap: 0.6, align: 'center' },
  { text: 'C2', x: C2.a[0] + 0.9, y: 10.4, cap: 0.6, align: 'center' },
];
export const HOLES = [[-14.3, -4.3], [51.3, -4.3], [-14.3, 31.3], [51.3, 31.3]];
export const FIDS = [[6.4, -4.4], [46.6, 31.4]];
export const TITLE = null;
export const CLR = 0.28, VIA_R = 0.3, HOLE_R = 1.1, FID_R = 0.45;
// more of a real charger: a varistor and an X capacitor across the input, the isolation slot under T1,
// a Y capacitor and an optocoupler bridging it, the output diode and capacitor on the secondary side
const RV1 = ecap([7.6, 19.4], 1.5, { sw: 0.12 }), CX1 = chip([12.6, 19.6], 2.6, 0.9, 1.2, { sw: 0.12 });
const CY1 = chip([41.2, 6.2], 3.0, 0.9, 1.2, { sw: 0.12 }), U2 = chip([39.6, 20.2], 3.0, 0.9, 1.3, { sw: 0.12 });
export const SLOTS = [{ pts: [[41.2, 8.4], [41.2, 21.4]], w: 0.7 }];
PADS.push(...RV1.pads, ...CX1.pads, ...CY1.pads, ...U2.pads, { x: 6.4, y: 8.6, r: 0.55, shape: 'round', hole: 0.22, id: 'tp1' }, { x: 3.0, y: 26.6, r: 0.55, shape: 'round', hole: 0.22, id: 'tp2' });
SILK.push(...RV1.silk, ...CX1.silk, ...CY1.silk, ...U2.silk, { circle: [6.4, 8.6, 0.9], w: 0.1 }, { circle: [3.0, 26.6, 0.9], w: 0.1 });
KEEP.push(...RV1.keep, ...CX1.keep, ...CY1.keep, ...U2.keep);
DESIG.push({ text: 'RV1', x: 7.6, y: 21.4, cap: 0.6, align: 'center' }, { text: 'CX1', x: 12.6, y: 21.0, cap: 0.6, align: 'center' }, { text: 'CY1', x: 39.0, y: 5.8, cap: 0.6, align: 'right' },
  { text: 'U2', x: 41.6, y: 18.6, cap: 0.6, align: 'left' },
  { text: 'TP1', x: 7.6, y: 8.2, cap: 0.55, align: 'left' }, { text: 'TP2', x: 4.1, y: 26.3, cap: 0.55, align: 'left' },
  { text: 'PRIMARY', x: 40.6, y: 1.6, cap: 0.5, align: 'right' }, { text: 'SECONDARY', x: 41.8, y: 1.6, cap: 0.5, align: 'left' },
  { text: 'REV B', x: 2.4, y: -3.0, cap: 0.6, align: 'left' });
TRACES.push(...[['mov', [[LPAD[0] + 1.6, 14], [5.4, 14], [5.4, 19.4], [RV1.plus[0], 19.4]], 0.5], ['cx', [[RV1.minus[0], 19.4], [CX1.a[0], 19.6]], 0.5],
].map(([id, pts, w]) => ({ id, pts, w, net: 'sig', m: measure(pts) })));
// the plug: two blade terminals on the left, inside a silkscreened housing, wired to L and N
PADS.push({ x: -8.5, y: 14, w: 6.4, h: 1.9, shape: 'rect', r: 0.3, id: 'pinL' }, { x: -8.5, y: 22, w: 6.4, h: 1.9, shape: 'rect', r: 0.3, id: 'pinN' });
SILK.push({ pts: box(-13.4, 10.6, -2.6, 25.4), w: 0.2 }, { pts: box(-12.6, 11.4, -3.4, 24.6), w: 0.1, dash: [0.5, 0.4] });
KEEP.push({ rect: [-12.2, 12.6, -4.8, 15.4] }, { rect: [-12.2, 20.6, -4.8, 23.4] });
TRACES.push(...[['pL', [[-5.3, 14], [LPAD[0] - 1.3, 14]], 1.1], ['pN', [[-5.3, 22], [NPAD[0] - 1.3, 22]], 1.1]].map(([id, pts, w]) => ({ id, pts, w, net: 'ac', m: measure(pts) })));
DESIG.push({ text: 'AC IN', x: -8, y: 8.6, cap: 0.7, align: 'center' }, { text: 'P1', x: -8, y: 26.2, cap: 0.6, align: 'center' });
export { F1, C1, T1 };
