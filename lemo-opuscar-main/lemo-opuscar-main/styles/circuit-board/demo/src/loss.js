// "If you sent it as it is": a long straight board with one AC trace whose light fades as it goes.
// A stand-alone board (not nested), units are arbitrary (the bus runs 1,200 units).
import { measure } from './geo.js';
import { box, chip } from './parts.js';
import { mulberry } from '/core/lib.js';

export const BOARD = { x0: -200, y0: 0, x1: 1500, y1: 520, r: 10, inset: 3 };
export const CLR = 3, VIA_R = 2.6, FENCE_R = 2;
const Y = 260;
const tr = (id, pts, w, net) => ({ id, pts, w, net });
export const TRACES = [
  tr('ac', [[-210, Y], [1510, Y]], 12, 'ac'),
  ...[-2, -1, 1, 2].map(k => tr('idle' + k, [[-210, Y + k * 30 + Math.sign(k) * 10], [1510, Y + k * 30 + Math.sign(k) * 10]], 3, 'idle')),
].map(t => ({ ...t, m: measure(t.pts) }));
export const byId = id => TRACES.find(t => t.id === id);
export const PADS = [], SILK = [], KEEP = [], DESIG = [], VIAS = [];
// distance ruler on the silkscreen above the bus, a test pad every 200 units
for (let x = -200; x <= 1500; x += 50) SILK.push({ pts: [[x, Y - 92], [x, Y - 92 - (x % 200 === 0 ? 14 : 7)]], w: 1.4 });
SILK.push({ pts: [[-200, Y - 92], [1500, Y - 92]], w: 1.2 });
for (let x = 0; x <= 1400; x += 200) { PADS.push({ x, y: Y - 40, r: 6, shape: 'round', hole: 2.4, id: 'tp' + x }); SILK.push({ circle: [x, Y - 40, 10], w: 1.2 }); TRACES.push({ id: 'st' + x, pts: [[x, Y - 4], [x, Y - 34]], w: 2, net: 'idle', m: measure([[x, Y - 4], [x, Y - 34]]) }); }
// decoupling parts along the idle buses (texture), seeded
const rnd = mulberry(41);
for (let x = -150; x < 1450; x += 70 + Math.floor(rnd() * 60)) for (const yy of [Y + 128, Y - 138]) {
  if (yy < Y && x > 640 && x < 890) continue;
  const c = chip([x, yy], 10, 4, 6, { sw: 0.9 }); PADS.push(...c.pads); SILK.push(...c.silk); KEEP.push(...c.keep);
}
export const LABELS = [
  { id: 'loss', gid: 'loss', text: '损耗', x: 765, y: Y - 196, cap: 36, sw: 3.6, align: 'center' },
  { id: 'lossE', gid: 'lossE', text: 'LOSS', x: 765, y: Y - 140, cap: 16, sw: 2.6, align: 'center' },
];

export const CHILD = null;
