// The street module (a child board of the city), 1 unit = 10 cm. One residential block of 18 floors drawn as a pad
// array (no windows, no people), the pole transformer T4 on the street, a wall socket, and the charger beside it.
import { measure } from './geo.js';
import { xformer, box, chamferBox } from './parts.js';
import { stepLabel } from './world.js';
import { mulberry } from '/core/lib.js';

export const BOARD = { x0: 0, y0: 0, x1: 900, y1: 900, r: 4, inset: 1 };
export const CLR = 1.6, VIA_R = 1.4, FENCE_R = 1;
export const STREETS = [{ pts: [[-10, 812], [910, 812]], w: 40 }, { pts: [[-10, 784], [910, 784]], w: 3 }];
export const T4 = xformer([110, 752], 30, [8, 2], 0.8);
// the building: 18 floors x 6 homes
export const FLOORS = 18, HOMES = 6, BX = 300, BY = 120, FH = 30, HW = 48;
export const homePos = (f, u) => [BX + 10 + u * HW + 21, BY + (FLOORS - 1 - f) * FH + 15];   // f = 0 is the ground floor
export const TPADS = [];
for (let f = 0; f < FLOORS; f++) for (let u = 0; u < HOMES; u++) { const [x, y] = homePos(f, u); TPADS.push({ x, y, w: 40, h: 17, lit: true, home: true, f, u, r: 2 }); }
const RISER = 282;
const tr = (id, pts, w, net) => ({ id, pts, w, net });
const feed = [tr('in', [[0, 752], T4.inP], 1.3, 'ac'), tr('out', [T4.outP, [RISER, 752], [RISER, BY + 8]], 0.65, 'ac')];
const floors = [];
for (let f = 0; f < FLOORS; f++) { const y = homePos(f, 0)[1]; floors.push(tr('fl' + f, [[RISER, y], [homePos(f, 0)[0] - 20, y]], 0.5, 'ac')); }
// the socket: a wall plate with two oval holes; floor 3's last home feeds it
export const SOCKET = { c: [740, 560], s: 74, holeL: [722, 556], holeN: [758, 556] };
const sF = 3, sy = homePos(sF, HOMES - 1)[1];
const toSocket = tr('sock', [[homePos(sF, HOMES - 1)[0] + 20, sy], [612, sy], [612, 507], [SOCKET.holeL[0], 507], [SOCKET.holeL[0], SOCKET.holeL[1] - 9]], 0.6, 'ac');
// the wall: neutral and earth run beside the live wire to a switch, this socket and the next one
const wall = [tr('N', [[618, 513], [SOCKET.holeN[0], 513], [SOCKET.holeN[0], SOCKET.holeN[1] - 9]], 0.6, 'idle'), tr('PE', [[624, 519], [SOCKET.c[0], 519], [SOCKET.c[0], 527]], 0.6, 'idle'),
  tr('L2', [[SOCKET.holeL[0], 507], [912 - 100, 507], [812, 547]], 0.6, 'idle'), tr('N2', [[SOCKET.holeN[0], 513], [848, 513], [848, 547]], 0.6, 'idle'),
  tr('S1', [[612, 507], [612, 530], [640, 530], [640, 540]], 0.6, 'idle')];
export const TRACES = [...feed, ...floors, toSocket, ...wall].map(t => ({ ...t, m: measure(t.pts) }));
export const byId = id => TRACES.find(t => t.id === id);
// the neighbours along the street (pad arrays, unlit mostly)
const rnd = mulberry(5);
for (const [x0, y0, nx, ny] of [[20, 380, 4, 9], [660, 660, 4, 3], [180, 640, 2, 2], [-6, 692, 5, 1], [150, 850, 6, 1], [-20, 850, 3, 1]]) {
  for (let a = 0; a < nx; a++) for (let b = 0; b < ny; b++) TPADS.push({ x: x0 + 21 + a * 48, y: y0 + 15 + b * 30, w: 40, h: 17, lit: rnd() < 0.7, r: 2 });
}
export const CHARGER_AT = [740, 616], CHARGER_S = 0.2;
const SW = [650, 566], S2 = [830, 560];
import { } from './geo.js';                     // 1 mm = 0.2 units (drawn large)
const plate = SOCKET.s / 2;
export const PADS = [...T4.pads, { x: SOCKET.holeL[0], y: SOCKET.holeL[1] - 9, r: 1.6, shape: 'round', hole: 0, id: 'sL' }];
export const SCREWS = [[SOCKET.c[0], SOCKET.c[1] - 27], [SOCKET.c[0], SOCKET.c[1] + 27]];
export const VIAS = [...SCREWS, [SW[0], SW[1] - 22], [SW[0], SW[1] + 22], [S2[0], S2[1] - 27], [S2[0], S2[1] + 27]].map(p => [p[0], p[1], 3.2, 1.6]);
export const SILK = [
  ...T4.silk,
  { pts: box(BX, BY - 6, BX + 10 + HOMES * HW + 6, BY + FLOORS * FH + 4), w: 1.2 },                         // building outline
  { pts: chamferBox(SOCKET.c[0] - plate, SOCKET.c[1] - plate, SOCKET.c[0] + plate, SOCKET.c[1] + plate, 10), w: 1.6 },
  { pts: chamferBox(SOCKET.c[0] - plate + 6, SOCKET.c[1] - plate + 6, SOCKET.c[0] + plate - 6, SOCKET.c[1] + plate - 6, 7), w: 0.7 },
  // the switch beside it, the next socket, and the wall boxes behind all three (dashed)
  { pts: chamferBox(SW[0] - 28, SW[1] - 28, SW[0] + 28, SW[1] + 28, 8), w: 1.4 }, { pts: box(SW[0] - 9, SW[1] - 16, SW[0] + 9, SW[1] + 16), w: 1 }, { pts: [[SW[0] - 9, SW[1]], [SW[0] + 9, SW[1]]], w: 0.8 },
  { pts: chamferBox(S2[0] - plate, S2[1] - plate, S2[0] + plate, S2[1] + plate, 10), w: 1.6 },
  ...[[SW, 32], [SOCKET.c, plate + 4], [S2, plate + 4]].map(([c, r]) => ({ pts: box(c[0] - r, c[1] - r, c[0] + r, c[1] + r), w: 0.5, dash: [3, 2.4] })),
  { pts: [[600, 507], [606, 507]], w: 0.6 }, 
  { pts: box(CHARGER_AT[0] - 16 * CHARGER_S - 0.6, CHARGER_AT[1] - 6 * CHARGER_S - 0.6, CHARGER_AT[0] + 53 * CHARGER_S + 0.6, CHARGER_AT[1] + 33 * CHARGER_S + 0.6), w: 0.06 },
  // noon: a sun and a clock (hands both at twelve), drawn, no figures
  { circle: [690, 160, 16], w: 1.4 }, ...[...Array(8).keys()].map(k => { const a = k * Math.PI / 4; return { pts: [[690 + Math.cos(a) * 22, 160 + Math.sin(a) * 22], [690 + Math.cos(a) * 30, 160 + Math.sin(a) * 30]], w: 1.4 }; }),
  { circle: [770, 160, 26], w: 1.4 }, { pts: [[770, 160], [770, 140]], w: 2 }, { pts: [[770, 160], [770, 146]], w: 3 },
  ...[...Array(12).keys()].map(k => { const a = k * Math.PI / 6; return { pts: [[770 + Math.cos(a) * 21, 160 + Math.sin(a) * 21], [770 + Math.cos(a) * 24, 160 + Math.sin(a) * 24]], w: 1 }; }),
];
export const KEEP = [...T4.keep, { rect: [BX - 2, BY - 8, BX + 10 + HOMES * HW + 8, BY + FLOORS * FH + 6] },
  { rect: [SOCKET.c[0] - plate - 2, SOCKET.c[1] - plate - 2, SOCKET.c[0] + plate + 2, SOCKET.c[1] + plate + 2] },
  { rect: [SW[0] - 30, SW[1] - 30, SW[0] + 30, SW[1] + 30] }, { rect: [S2[0] - plate - 2, S2[1] - plate - 2, S2[0] + plate + 2, S2[1] + plate + 2] },
  { rect: [CHARGER_AT[0] - 16 * CHARGER_S - 1, CHARGER_AT[1] - 6 * CHARGER_S - 1, CHARGER_AT[0] + 53 * CHARGER_S + 1, CHARGER_AT[1] + 33 * CHARGER_S + 1] },
];
export const HOLES_OVAL = [SOCKET.holeL, SOCKET.holeN, [S2[0] - 18, S2[1] - 4], [S2[0] + 18, S2[1] - 4]];
export const DESIG = [
  { text: 'X1', x: SOCKET.c[0] - plate + 4, y: SOCKET.c[1] + plate + 6.5, cap: 4, align: 'left' }, { text: 'X2', x: S2[0] - plate + 4, y: S2[1] + plate + 6.5, cap: 4, align: 'left' },
  { text: 'S1', x: SW[0] - 26, y: SW[1] + 34.5, cap: 4, align: 'left' }, { text: '220 V ~ 50 Hz', x: SOCKET.c[0] + plate - 4, y: SOCKET.c[1] + plate + 6.5, cap: 3.6, align: 'right' },
  { text: 'L', x: 597, y: 505, cap: 3, align: 'right' }, { text: 'N', x: 615, y: 511, cap: 3, align: 'right' }, { text: 'PE', x: 621, y: 517, cap: 3, align: 'right' },
  { text: 'L', x: SOCKET.holeL[0] - 4.5, y: SOCKET.holeL[1] + 17, cap: 4, align: 'left' }, { text: 'N', x: SOCKET.holeN[0] - 4.5, y: SOCKET.holeN[1] + 17, cap: 4, align: 'left' },
  ...[...Array(FLOORS).keys()].map(f => ({ text: `${f + 1}F`, x: BX - 6, y: homePos(f, 0)[1] - 2.5, cap: 5, align: 'right' })),
];
export const LABELS = stepLabel(T4).map(l => ({ ...l, id: l.id + '4' }));
export const CHILD = { name: 'charger', at: CHARGER_AT, s: CHARGER_S };
