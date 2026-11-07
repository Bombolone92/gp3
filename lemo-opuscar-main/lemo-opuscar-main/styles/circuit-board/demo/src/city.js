// The city module next to Yucheng (a child board of the corridor board), 1 unit = 10 m.
// Streets are bare channels in the copper; buildings are silk footprints holding tiny pads (lit at noon);
// the feed comes in on the left, steps down at T2 (city substation) and T3 (district), and leaves for the street module.
import { measure } from './geo.js';
import { xformer, box } from './parts.js';
import { stepLabel } from './world.js';
import { mulberry } from '/core/lib.js';

export const BOARD = { x0: 0, y0: 0, x1: 1200, y1: 800, r: 6, inset: 1 };
export const CLR = 2.2, VIA_R = 1.6, FENCE_R = 1.2;
const AVE = [230, 470, 700, 930], ROAD = [210, 420, 610], MINX = [115, 350, 585, 815, 1065], MINY = [105, 315, 515, 705];
export const STREETS = [
  ...AVE.map(x => ({ pts: [[x, -10], [x, 810]], w: 9 })), ...ROAD.map(y => ({ pts: [[-10, y], [1210, y]], w: 9 })),
  ...MINX.map(x => ({ pts: [[x, -10], [x, 810]], w: 3.4 })), ...MINY.map(y => ({ pts: [[-10, y], [1210, y]], w: 3.4 })),
];
export const T2 = xformer([200, 160], 60, [6, 3], 1.6);
export const T3 = xformer([390, 360], 12, [7, 3], 0.36);
export const HOUSE_AT = [520, 520], HOUSE_S = 0.01;                      // the street module (900 x 900 at 10 cm)
const houseIn = [HOUSE_AT[0], HOUSE_AT[1] + 760 * HOUSE_S];
const tr = (id, pts, w, net) => ({ id, pts, w, net });
export const TRACES = [
  tr('in', [[0, 160], T2.inP], 10.7, 'ac'),
  tr('c1', [T2.outP, [330, 160], [330, 360], T3.inP], 5.3, 'ac'),
  tr('c2', [T3.outP, [440, 360], [440, houseIn[1]], houseIn], 0.53, 'ac'),
  // other feeders of the city grid (not lit): along the streets to the other substations
  tr('f1', [[T2.outP[0] + 30, 160], [T2.outP[0] + 30, 260], [760, 260], [760, 160], [850 - 30, 160]], 2.6, 'idle'),
  tr('f2', [[330, 360], [330, 470], [650, 470], [650, 560], [1000, 560], [1000, 500]], 2.6, 'idle'),
  tr('f3', [[330, 260], [180, 260], [180, 660], [250 - 6, 660]], 2.6, 'idle'),
].map(t => ({ ...t, m: measure(t.pts) }));
export const byId = id => TRACES.find(t => t.id === id);
const OTH = [xformer([850, 160], 60, [6, 3], 1.6), xformer([1000, 470], 24, [6, 3], 0.7), xformer([250, 660], 12, [7, 3], 0.36)];
export const PADS = [...T2.pads, ...T3.pads, ...OTH.flatMap(o => o.pads)];
export const SILK = [...T2.silk, ...T3.silk, ...OTH.flatMap(o => o.silk),
  { pts: box(HOUSE_AT[0] - 0.3, HOUSE_AT[1] - 0.3, HOUSE_AT[0] + 9.3, HOUSE_AT[1] + 9.3), w: 0.12 }];
export const KEEP = [...T2.keep, ...T3.keep, ...OTH.flatMap(o => o.keep), { rect: [HOUSE_AT[0] - 0.6, HOUSE_AT[1] - 0.6, HOUSE_AT[0] + 9.6, HOUSE_AT[1] + 9.6] }];
export const VIAS = [];
export const DESIG = [
  { text: 'T4', x: 850, y: 120, cap: 9, align: 'center' }, { text: 'T5', x: 1000, y: 452, cap: 4, align: 'center' }, { text: 'T6', x: 250, y: 650, cap: 2, align: 'center' },
  { text: 'M2', x: HOUSE_AT[0] - 0.6, y: HOUSE_AT[1] + 0.3, cap: 0.9, align: 'right' },
];
export const LABELS = [...stepLabel(T2).map(l => ({ ...l, id: l.id + '2' })), ...stepLabel(T3).map(l => ({ ...l, id: l.id + '3' }))];
// buildings: silk footprints, each a grid of small pads (homes); block interiors seeded, kept clear of the feed and parts
const xs = [0, ...AVE, ...MINX, 1200].sort((a, b) => a - b), ys = [0, ...ROAD, ...MINY, 800].sort((a, b) => a - b);
export const TPADS = [];
const rnd = mulberry(17);
const busy = [[0, 125, 240, 195], [100, 150, 340, 170], [320, 150, 340, 370], [330, 350, 450, 370], [430, 350, 450, 540], [440, 515, 535, 535],
  [HOUSE_AT[0] - 4, HOUSE_AT[1] - 4, HOUSE_AT[0] + 14, HOUSE_AT[1] + 14], [150, 120, 250, 200], [800, 120, 900, 200], [985, 455, 1015, 485], [240, 650, 262, 670],
  [100, 250, 770, 270], [750, 150, 770, 270], [320, 460, 660, 480], [640, 460, 660, 570], [640, 550, 1010, 570], [990, 490, 1010, 570], [170, 250, 190, 670], [170, 650, 250, 670]];
const hit = (x0, y0, x1, y1) => busy.some(b => x0 < b[2] && x1 > b[0] && y0 < b[3] && y1 > b[1]);
for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < ys.length - 1; j++) {
  const bx0 = xs[i] + 8, bx1 = xs[i + 1] - 8, by0 = ys[j] + 8, by1 = ys[j + 1] - 8;
  let y = by0;
  while (y < by1 - 14) {
    const h = 14 + Math.floor(rnd() * 3) * 6; let x = bx0;
    while (x < bx1 - 12) {
      const w = 12 + Math.floor(rnd() * 4) * 5;
      if (x + w <= bx1 && y + h <= by1 && !hit(x, y, x + w, y + h) && rnd() > 0.12) {
        SILK.push({ pts: box(x, y, x + w, y + h), w: 0.5 });
        KEEP.push({ rect: [x, y, x + w, y + h] });
        const nx = Math.max(1, Math.floor((w - 3) / 4.2)), ny = Math.max(1, Math.floor((h - 3) / 3.6));
        for (let a = 0; a < nx; a++) for (let b = 0; b < ny; b++) TPADS.push({ x: x + 2.4 + a * (w - 4.8) / Math.max(1, nx - 1) - (nx === 1 ? -(w - 4.8) / 2 : 0), y: y + 2.4 + b * (h - 4.8) / Math.max(1, ny - 1) - (ny === 1 ? -(h - 4.8) / 2 : 0), w: 2.6, h: 1.8, lit: rnd() < 0.82 });
      }
      x += w + 4;
    }
    y += h + 4;
  }
}
export const CHILD = { name: 'house', at: HOUSE_AT, s: HOUSE_S };
