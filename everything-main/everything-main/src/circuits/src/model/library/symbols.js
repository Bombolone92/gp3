// Schematic symbol generators. Coordinates are written in mils for
// readability and converted to nanometres. Pin ends always land on the
// 100 mil grid so wires snap to them.

import { mil } from '../../core/units.js';

const n = (v) => mil(v);

export const line = (x1, y1, x2, y2, w = 0) => ({ t: 'line', x1: n(x1), y1: n(y1), x2: n(x2), y2: n(y2), w: w ? n(w) : 0 });
export const rect = (x1, y1, x2, y2, fill) => {
  const g = { t: 'rect', x1: n(x1), y1: n(y1), x2: n(x2), y2: n(y2), w: 0 };
  if (fill) g.fill = fill;
  return g;
};
export const circle = (cx, cy, r, fill) => {
  const g = { t: 'circle', cx: n(cx), cy: n(cy), r: n(r), w: 0 };
  if (fill) g.fill = fill;
  return g;
};
export const arc = (cx, cy, r, a0, sweep) => ({ t: 'arc', cx: n(cx), cy: n(cy), r: n(r), a0, sweep, w: 0 });
export const poly = (pts, fill) => {
  const g = { t: 'poly', pts: pts.map((v) => n(Math.round(v * 100) / 100)), w: 0 };
  if (fill) g.fill = fill;
  return g;
};
export const polyline = (pts, w = 0) => ({ t: 'polyline', pts: pts.map(n), w: w ? n(w) : 0 });

/** Pin with its connection end at (x, y) mils, pointing `rot` toward the body. */
export function pin(num, name, x, y, rot, type = 'passive', length = 100, extra = {}) {
  return { num: String(num), name: String(name), x: n(x), y: n(y), length: n(length), rot, type, ...extra };
}

const pos = (x, y) => ({ x: n(x), y: n(y) });
const hidden = { hideName: true, hideNum: true };

/** Line with a solid arrowhead at (x2, y2). */
export function arrow(x1, y1, x2, y2, head = 25, half = 10) {
  const len = Math.hypot(x2 - x1, y2 - y1);
  const dx = (x2 - x1) / len, dy = (y2 - y1) / len;
  const bx = x2 - dx * head, by = y2 - dy * head;
  return [
    line(x1, y1, bx, by),
    poly([x2, y2, bx - dy * half, by + dx * half, bx + dy * half, by - dx * half], 'solid'),
  ];
}

/** Horizontal two-terminal symbol frame: pin `a` on the left, `b` on the right. */
function twoPin(graphics, { a = '1', b = '2', aName = '1', bName = '2', labelY = 100, valueY = -150, aType = 'passive', bType = 'passive' } = {}) {
  return {
    pins: [pin(a, aName, -200, 0, 0, aType, 100, hidden), pin(b, bName, 200, 0, 180, bType, 100, hidden)],
    graphics,
    designatorPos: pos(-100, labelY),
    valuePos: pos(-100, valueY),
  };
}

// ---------------------------------------------------------------- passives

export const resistor = () => twoPin([rect(-100, -40, 100, 40)]);

export const capacitor = () => twoPin([
  line(-100, 0, -25, 0), line(25, 0, 100, 0),
  line(-25, -90, -25, 90, 16), line(25, -90, 25, 90, 16),
]);

/** Polarized capacitor: pin 1 is positive (left). */
export const polarizedCapacitor = () => twoPin([
  line(-100, 0, -25, 0), line(25, 0, 100, 0),
  line(-25, -90, -25, 90, 16), rect(20, -90, 40, 90, 'solid'),
  line(-85, 70, -45, 70), line(-65, 50, -65, 90),
], { aName: '+', bName: '-' });

export const inductor = () => twoPin([
  arc(-75, 0, 25, 0, 180), arc(-25, 0, 25, 0, 180), arc(25, 0, 25, 0, 180), arc(75, 0, 25, 0, 180),
]);

export const ferriteBead = () => twoPin([
  line(-100, 0, -45, 0), line(45, 0, 100, 0),
  poly([-50, -40, 10, 40, 50, 40, -10, -40], 'solid'),
]);

export const fuse = () => twoPin([rect(-80, -30, 80, 30), line(-100, 0, 100, 0)]);

export const thermistor = () => twoPin([rect(-100, -40, 100, 40), line(-80, -70, 60, 70), line(60, 70, 100, 70)]);

/** Potentiometer: pins 1 and 3 are the track, 2 is the wiper (top). */
export function potentiometer() {
  return {
    pins: [
      pin('1', '1', -200, 0, 0, 'passive', 100, hidden),
      pin('3', '3', 200, 0, 180, 'passive', 100, hidden),
      pin('2', 'W', 0, 200, 270, 'passive', 100, hidden),
    ],
    graphics: [rect(-100, -40, 100, 40), ...arrow(0, 100, 0, 42)],
    designatorPos: pos(50, 150),
    valuePos: pos(-100, -150),
  };
}

// ---------------------------------------------------------------- diodes
// Diode pins: 1 = cathode (right), 2 = anode (left), matching footprints.

const diodeBody = (bar) => [
  line(-100, 0, -50, 0), line(50, 0, 100, 0),
  poly([-50, -60, -50, 60, 50, 0], 'solid'),
  ...bar,
];

const diodeFrame = (graphics, labelY = 100) =>
  twoPin(graphics, { a: '2', b: '1', aName: 'A', bName: 'K', labelY });

export const diode = () => diodeFrame(diodeBody([line(50, -60, 50, 60, 12)]));

export const zener = () => diodeFrame(diodeBody([polyline([30, -75, 50, -60, 50, 60, 70, 75], 12)]));

export const schottky = () => diodeFrame(diodeBody([polyline([75, -45, 75, -60, 50, -60, 50, 60, 25, 60, 25, 45], 12)]));

export const led = () => diodeFrame([
  ...diodeBody([line(50, -60, 50, 60, 12)]),
  ...arrow(5, 70, 50, 115), ...arrow(45, 70, 90, 115),
], 200);

/** Bidirectional TVS: two opposing triangles. */
export function tvs() {
  return twoPin([
    line(-100, 0, -60, 0), line(60, 0, 100, 0),
    poly([-60, -50, -60, 50, 0, 0], 'solid'), poly([60, -50, 60, 50, 0, 0], 'solid'),
    polyline([-20, -70, 0, -50, 0, 50, 20, 70], 12),
  ], { labelY: 100 });
}

// ---------------------------------------------------------------- transistors

/** NPN / PNP bipolar transistor. map gives the pin numbers for b, c, e. */
export function bjt(kind = 'npn', map = { b: '1', e: '2', c: '3' }) {
  const npn = kind === 'npn';
  const cy = npn ? 200 : -200, ey = npn ? -200 : 200;
  const g = [
    line(-100, 0, -40, 0), line(-40, -65, -40, 65, 14),
    line(-40, npn ? 30 : -30, 100, npn ? 100 : -100),
    circle(25, 0, 125),
  ];
  // Emitter with arrow: outward for NPN, inward (toward the base bar) for PNP.
  if (npn) g.push(...arrow(-40, -30, 86, -93));
  else g.push(line(-40, 30, 100, 100), ...arrow(60, 80, 0, 50));
  return {
    pins: [
      pin(map.b, 'B', -200, 0, 0, 'input', 100, hidden),
      pin(map.c, 'C', 100, cy, npn ? 270 : 90, 'passive', 100, hidden),
      pin(map.e, 'E', 100, ey, npn ? 90 : 270, 'passive', 100, hidden),
    ],
    graphics: g,
    designatorPos: pos(200, 50),
    valuePos: pos(200, -100),
  };
}

/** N- or P-channel enhancement MOSFET. map gives pin numbers for g, d, s. */
export function mosfet(kind = 'n', map = { g: '1', s: '2', d: '3' }) {
  const nch = kind === 'n';
  const dy = nch ? 200 : -200, sy = nch ? -200 : 200;
  const dSeg = nch ? 60 : -60, sSeg = nch ? -60 : 60;
  const g = [
    line(-100, 0, -50, 0), line(-50, -70, -50, 70, 14),
    line(-20, 45, -20, 80, 14), line(-20, -15, -20, 15, 14), line(-20, -45, -20, -80, 14),
    line(-20, dSeg, 100, dSeg), line(100, dSeg, 100, nch ? 100 : -100),
    line(-20, sSeg, 100, sSeg), line(100, sSeg, 100, nch ? -100 : 100),
    line(100, 0, 100, sSeg),
    circle(25, 0, 125),
  ];
  // Body arrow on the centre channel segment: into the channel for N, out for P.
  if (nch) g.push(...arrow(100, 0, -15, 0, 30, 12));
  else g.push(...arrow(-20, 0, 85, 0, 30, 12));
  return {
    pins: [
      pin(map.g, 'G', -200, 0, 0, 'input', 100, hidden),
      pin(map.d, 'D', 100, dy, nch ? 270 : 90, 'passive', 100, hidden),
      pin(map.s, 'S', 100, sy, nch ? 90 : 270, 'passive', 100, hidden),
    ],
    graphics: g,
    designatorPos: pos(200, 50),
    valuePos: pos(200, -100),
  };
}

// ---------------------------------------------------------------- amplifiers

/** One amplifier triangle centred at y = cy (mils), signs at the inputs. */
function triangle(cy) {
  return [
    poly([-200, cy + 200, -200, cy - 200, 200, cy], 'body'),
    line(-180, cy + 100, -140, cy + 100),
    line(-180, cy - 100, -140, cy - 100), line(-160, cy - 120, -160, cy - 80),
  ];
}

/** Single op-amp or comparator. pins: {out, inn, inp, vp, vn}. */
export function opamp(pins = { out: '1', vn: '2', inp: '3', inn: '4', vp: '5' }, { outType = 'output' } = {}) {
  return {
    pins: [
      pin(pins.inn, '-', -400, 100, 0, 'input', 200, hidden),
      pin(pins.inp, '+', -400, -100, 0, 'input', 200, hidden),
      pin(pins.out, 'OUT', 400, 0, 180, outType, 200, hidden),
      pin(pins.vp, 'V+', 0, 300, 270, 'power', 200, { hideName: true }),
      pin(pins.vn, 'V-', 0, -300, 90, 'power', 200, { hideName: true }),
    ],
    graphics: triangle(0),
    designatorPos: pos(50, 200),
    valuePos: pos(50, -250),
  };
}

/** Two amplifiers in one symbol (common 8-pin dual pinout). */
export function dualOpamp({ outType = 'output' } = {}) {
  return {
    pins: [
      pin('1', 'OUTA', 400, 300, 180, outType, 200, hidden),
      pin('2', '-INA', -400, 400, 0, 'input', 200, hidden),
      pin('3', '+INA', -400, 200, 0, 'input', 200, hidden),
      pin('4', 'V-', 0, -600, 90, 'power', 200, { hideName: true }),
      pin('5', '+INB', -400, -400, 0, 'input', 200, hidden),
      pin('6', '-INB', -400, -200, 0, 'input', 200, hidden),
      pin('7', 'OUTB', 400, -300, 180, outType, 200, hidden),
      pin('8', 'V+', 0, 600, 270, 'power', 200, { hideName: true }),
    ],
    graphics: [...triangle(300), ...triangle(-300)],
    designatorPos: pos(100, 500),
    valuePos: pos(100, -550),
  };
}

// ---------------------------------------------------------------- generic IC

/** Approximate text advance of a pin name in mils. */
const nameWidth = (s) => String(s).replace(/^~/, '').length * 50;

/**
 * Rectangular IC symbol. Each side lists pins {num, name, type} in order:
 * left and right top to bottom, top and bottom left to right.
 */
export function icSymbol({ left = [], right = [], top = [], bottom = [], minWidth = 600 } = {}) {
  const rows = Math.max(left.length, right.length, 1);
  const maxL = Math.max(0, ...left.map((p) => nameWidth(p.name)));
  const maxR = Math.max(0, ...right.map((p) => nameWidth(p.name)));
  const maxT = Math.max(0, ...top.map((p) => nameWidth(p.name)));
  const maxB = Math.max(0, ...bottom.map((p) => nameWidth(p.name)));
  const cols = Math.max(top.length, bottom.length);
  let W = Math.max(minWidth, maxL + maxR + 200, (cols + 1) * 100);
  W = Math.ceil(W / 200) * 200;
  const hw = W / 2;
  const topY = Math.floor(rows / 2) * 100;
  const extraT = top.length ? Math.ceil((maxT + 100) / 100) * 100 : 0;
  const extraB = bottom.length ? Math.ceil((maxB + 100) / 100) * 100 : 0;
  const bodyTop = topY + 100 + Math.max(0, extraT - 100);
  const bodyBottom = topY - rows * 100 - Math.max(0, extraB - 100);
  const pins = [];
  left.forEach((p, i) => pins.push(pin(p.num, p.name, -hw - 200, topY - i * 100, 0, p.type || 'passive', 200, p.extra)));
  right.forEach((p, i) => pins.push(pin(p.num, p.name, hw + 200, topY - i * 100, 180, p.type || 'passive', 200, p.extra)));
  const start = (k) => -Math.floor((k - 1) / 2) * 100;
  top.forEach((p, i) => pins.push(pin(p.num, p.name, start(top.length) + i * 100, bodyTop + 200, 270, p.type || 'power', 200, p.extra)));
  bottom.forEach((p, i) => pins.push(pin(p.num, p.name, start(bottom.length) + i * 100, bodyBottom - 200, 90, p.type || 'power', 200, p.extra)));
  return {
    pins,
    graphics: [rect(-hw, bodyBottom, hw, bodyTop, 'body')],
    designatorPos: pos(-hw, bodyTop + (top.length ? 250 : 50)),
    valuePos: pos(-hw, bodyBottom - (bottom.length ? 300 : 150)),
  };
}

// ---------------------------------------------------------------- connectors

/** Single-row connector, pins on the left. */
export function connector1(count) {
  const topY = Math.floor((count - 1) / 2) * 100;
  const pins = [];
  for (let i = 0; i < count; i++) pins.push(pin(i + 1, String(i + 1), -200, topY - i * 100, 0, 'passive', 100, { hideName: true }));
  const g = [rect(-100, topY - count * 100, 100, topY + 100, 'body')];
  for (let i = 0; i < count; i++) g.push(line(-100, topY - i * 100, -40, topY - i * 100));
  return { pins, graphics: g, designatorPos: pos(-100, topY + 150), valuePos: pos(-100, topY - count * 100 - 150) };
}

/** Dual-row connector: odd pins left, even pins right (header numbering). */
export function connector2(rows) {
  const topY = Math.floor((rows - 1) / 2) * 100;
  const pins = [];
  for (let i = 0; i < rows; i++) {
    pins.push(pin(2 * i + 1, String(2 * i + 1), -300, topY - i * 100, 0, 'passive', 100, { hideName: true }));
    pins.push(pin(2 * i + 2, String(2 * i + 2), 300, topY - i * 100, 180, 'passive', 100, { hideName: true }));
  }
  return {
    pins,
    graphics: [rect(-200, topY - rows * 100, 200, topY + 100, 'body')],
    designatorPos: pos(-200, topY + 150),
    valuePos: pos(-200, topY - rows * 100 - 150),
  };
}

// ---------------------------------------------------------------- misc

export const crystal = () => twoPin([
  line(-100, 0, -60, 0), line(60, 0, 100, 0),
  line(-60, -80, -60, 80, 12), line(60, -80, 60, 80, 12),
  rect(-35, -100, 35, 100),
]);

/** Four-pin crystal: 1 and 3 are the resonator, 2 and 4 the case. */
export function crystal4() {
  const s = crystal();
  return {
    ...s,
    pins: [
      pin('1', '1', -200, 0, 0, 'passive', 100, hidden),
      pin('3', '3', 200, 0, 180, 'passive', 100, hidden),
      pin('2', 'GND', 0, -200, 90, 'passive', 100, hidden),
      pin('4', 'GND', 0, 200, 270, 'passive', 100, hidden),
    ],
    graphics: s.graphics,
    designatorPos: pos(100, 150),
    valuePos: pos(100, -200),
  };
}

export function switchSPST() {
  return twoPin([
    circle(-85, 0, 15), circle(85, 0, 15),
    line(-72, 8, 90, 70),
  ], { labelY: 150 });
}

export function pushButton() {
  return twoPin([
    circle(-85, 0, 15), circle(85, 0, 15),
    line(-100, 50, 100, 50), line(0, 50, 0, 110), line(-30, 110, 30, 110),
  ], { labelY: 150 });
}

/** Battery cell: pin 1 positive (left, long plate). */
export const battery = () => twoPin([
  line(-100, 0, -30, 0), line(30, 0, 100, 0),
  line(-30, -100, -30, 100), line(30, -50, 30, 50, 20),
  line(-80, 60, -50, 60), line(-65, 45, -65, 75),
], { aName: '+', bName: '-', labelY: 150 });

/** Test point: a single pin below a small ring. */
export function testPoint() {
  return {
    pins: [pin('1', '1', 0, -100, 90, 'passive', 100, hidden)],
    graphics: [circle(0, 30, 30)],
    designatorPos: pos(50, 50),
    valuePos: pos(50, -50),
  };
}

export const mountingHole = () => ({
  pins: [],
  graphics: [circle(0, 0, 100), circle(0, 0, 50)],
  designatorPos: pos(150, 50),
  valuePos: pos(150, -50),
});

export const fiducial = () => ({
  pins: [],
  graphics: [circle(0, 0, 80), circle(0, 0, 40, 'solid')],
  designatorPos: pos(150, 50),
  valuePos: pos(150, -50),
});

/** Speaker / buzzer, pin 1 positive. */
export function buzzer() {
  return {
    pins: [
      pin('1', '+', -200, 100, 0, 'passive', 100, hidden),
      pin('2', '-', -200, -100, 0, 'passive', 100, hidden),
    ],
    graphics: [rect(-100, -120, -40, 120), poly([-40, -120, 60, -220, 60, 220, -40, 120]), line(-170, 160, -130, 160), line(-150, 140, -150, 180)],
    designatorPos: pos(100, 250),
    valuePos: pos(100, -300),
  };
}

/** Three-terminal regulator: input left, output right, ground at the bottom. */
export function regulator({ vin = '3', vout = '2', gnd = '1', gndName = 'GND' } = {}) {
  return icSymbol({
    left: [{ num: vin, name: 'VIN', type: 'power' }],
    right: [{ num: vout, name: 'VOUT', type: 'power' }],
    bottom: [{ num: gnd, name: gndName, type: 'power' }],
    minWidth: 600,
  });
}
