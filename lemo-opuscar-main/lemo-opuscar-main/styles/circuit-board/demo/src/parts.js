// Footprint builders shared by every board. Each returns primitives the renderer knows:
// pads (gold), silk (polylines / dots), keep (copper clearances), glow paths (for current), plus anchor points.
import { textWidth } from './font.js';

export const box = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
const chamferBox = (x0, y0, x1, y1, c) => [[x0 + c, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0 + c], [x0 + c, y0]];

// A diode drawn on an edge from a to b (anode -> cathode): triangle pointing to b, bar at its tip.
function diode(a, b, s) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L, nx = -uy, ny = ux;
  const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], h = s * 0.5;
  const base = [m[0] - ux * h, m[1] - uy * h], tip = [m[0] + ux * h, m[1] + uy * h];
  return {
    tri: [[base[0] + nx * h, base[1] + ny * h], [tip[0], tip[1]], [base[0] - nx * h, base[1] - ny * h], [base[0] + nx * h, base[1] + ny * h]],
    bar: [[tip[0] + nx * h, tip[1] + ny * h], [tip[0] - nx * h, tip[1] - ny * h]],
    lead: [[a[0], a[1]], [base[0], base[1]], null, [tip[0], tip[1]], [b[0], b[1]]],
  };
}

// The bridge: a square package turned 45 degrees (a diamond), one pad at each vertex.
// AC in at the left vertex, the return at the right vertex, + at the top, − at the bottom.
// Diodes on the four edges point from − to + . R = centre-to-vertex.
export function bridge(c, R, o = {}) {
  const [x, y] = c, L = [x - R, y], T = [x, y - R], Rv = [x + R, y], B = [x, y + R];
  const pr = R * 0.17, sw = o.sw ?? R * 0.055, ds = R * 0.32;
  const pads = [L, T, Rv, B].map(([px, py], i) => ({ x: px, y: py, r: pr, shape: 'round', hole: o.th ? pr * 0.42 : 0, id: (o.id || 'br') + ':' + 'LTRB'[i] }));
  const silk = [];
  const k = R + pr * 1.9;   // silk outline just outside the pads
  silk.push({ pts: [[x - k, y], [x, y - k], [x + k, y], [x, y + k], [x - k, y]], w: sw });
  // inner diamond with the four diodes: L->T, R->T (into +), B->L, B->R (from −)
  const q = R - pr * 1.6, Li = [x - q, y], Ti = [x, y - q], Ri = [x + q, y], Bi = [x, y + q];
  for (const [a, b] of [[Li, Ti], [Ri, Ti], [Bi, Li], [Bi, Ri]]) {
    const d = diode(a, b, ds);
    silk.push({ pts: d.tri, w: sw, fill: true }, { pts: d.bar, w: sw * 1.2 });
    silk.push({ pts: [d.lead[0], d.lead[1]], w: sw }, { pts: [d.lead[3], d.lead[4]], w: sw });
  }
  // terminal marks
  const mk = R * 0.2, mo = pr * 2.6;
  silk.push({ tilde: [x - R - mo - mk * 0.2, y - pr * 2.4], s: mk, w: sw });
  silk.push({ tilde: [x + R + mo * 0.15, y - pr * 2.4], s: mk, w: sw });
  const px = x + R * 0.98, py = y - R - pr - mk * 0.75, ny = y + R + pr + mk * 0.75;
  silk.push({ pts: [[px, py], [px + mk, py]], w: sw }, { pts: [[px + mk / 2, py - mk / 2], [px + mk / 2, py + mk / 2]], w: sw });
  silk.push({ pts: [[px, ny], [px + mk, ny]], w: sw });
  const keep = [{ poly: [[x - k - pr, y], [x, y - k - pr], [x + k + pr, y], [x, y + k + pr]] }];
  // the paths current takes through the symbol (for the glow): in at L, out at T (+) ; return B -> R
  const flow = { plus: [L, Li, Ti, T], minus: [B, Bi, Ri, Rv], all: [[Li, Ti], [Ri, Ti], [Bi, Li], [Bi, Ri]] };
  return { pads, silk, keep, L, T, R: Rv, B, flow, c, Rad: R };
}

// Ground symbol (silk) hanging from point p, pointing right
export function ground(p, s, sw, dir = 1) {
  const [x, y] = p, X = k => x + dir * s * k;
  return [
    { pts: [[x, y], [X(0.8), y]], w: sw },
    { pts: [[X(0.8), y - s * 0.7], [X(0.8), y + s * 0.7]], w: sw },
    { pts: [[X(1.15), y - s * 0.45], [X(1.15), y + s * 0.45]], w: sw },
    { pts: [[X(1.5), y - s * 0.2], [X(1.5), y + s * 0.2]], w: sw },
  ];
}

// A two-pad chip (fuse, resistor, ceramic cap): centre, length along x, pad size
export function chip(c, len, pw, ph, o = {}) {
  const [x, y] = c, sw = o.sw ?? ph * 0.09;
  const pads = [{ x: x - len / 2, y, w: pw, h: ph, shape: 'rect', r: ph * 0.12 }, { x: x + len / 2, y, w: pw, h: ph, shape: 'rect', r: ph * 0.12 }];
  const bx = len / 2 + pw / 2 + sw * 2.5, by = ph / 2 + sw * 2.5;
  const silk = [{ pts: [[x - bx + pw * 0.9, y - by], [x + bx - pw * 0.9, y - by]], w: sw }, { pts: [[x - bx + pw * 0.9, y + by], [x + bx - pw * 0.9, y + by]], w: sw }];
  const keep = [{ rect: [x - bx, y - by, x + bx, y + by] }];
  return { pads, silk, keep, a: [x - len / 2, y], b: [x + len / 2, y] };
}

// Electrolytic capacitor footprint: silk circle with a hatched − half, two round pads
export function ecap(c, r, o = {}) {
  const [x, y] = c, sw = o.sw ?? r * 0.045, pr = r * 0.2, d = r * 0.42;
  const pads = [{ x: x - d, y, r: pr, shape: 'square', hole: pr * 0.45 }, { x: x + d, y, r: pr, shape: 'round', hole: pr * 0.45 }];
  const silk = [{ circle: [x, y, r], w: sw }];
  for (let i = 1; i <= 5; i++) { const xx = x + r * (0.32 + i * 0.12); const hh = Math.sqrt(Math.max(0, r * r - (xx - x) ** 2)) * 0.96; silk.push({ pts: [[xx, y - hh], [xx, y + hh]], w: sw * 0.8 }); }
  silk.push({ pts: [[x - r * 0.62, y - r * 0.62], [x - r * 0.38, y - r * 0.62]], w: sw }, { pts: [[x - r * 0.5, y - r * 0.74], [x - r * 0.5, y - r * 0.5]], w: sw });
  return { pads, silk, keep: [{ circle: [x, y, r + sw * 2] }], plus: [x - d, y], minus: [x + d, y] };
}

// Transformer: rectangular bobbin outline, two winding symbols, pins on both sides
export function xfmr(c, w, h, n, o = {}) {
  const [x, y] = c, sw = o.sw ?? h * 0.022, pr = h * 0.06;
  const pads = [], pin = (s, i) => [x + s * w / 2, y - h / 2 + h * (i + 0.5) / n];
  for (let i = 0; i < n; i++) for (const s of [-1, 1]) pads.push({ x: pin(s, i)[0], y: pin(s, i)[1], r: pr, shape: i === 0 && s < 0 ? 'square' : 'round', hole: pr * 0.45 });
  const silk = [{ pts: box(x - w / 2 + pr * 2.2, y - h / 2 - pr * 0.6, x + w / 2 - pr * 2.2, y + h / 2 + pr * 0.6), w: sw }];
  // windings: bumps (primary left, secondary right) and the core bars
  const bump = (cx, dir) => { const pts = []; const r = h * 0.07; for (let k = 0; k < 4; k++) { const cy = y - h * 0.28 + k * r * 2; for (let a = 0; a <= 8; a++) { const an = -Math.PI / 2 + Math.PI * a / 8; pts.push([cx + dir * Math.cos(an) * r, cy + r + Math.sin(an) * r]); } } return pts; };
  silk.push({ pts: bump(x - w * 0.12, -1), w: sw }, { pts: bump(x + w * 0.12, 1), w: sw });
  silk.push({ pts: [[x - w * 0.03, y - h * 0.3], [x - w * 0.03, y + h * 0.3]], w: sw }, { pts: [[x + w * 0.03, y - h * 0.3], [x + w * 0.03, y + h * 0.3]], w: sw });
  return { pads, silk, keep: [{ rect: [x - w / 2 - pr * 2, y - h / 2 - pr * 2, x + w / 2 + pr * 2, y + h / 2 + pr * 2] }], pin };
}

// The step-down transformer symbol used in the city cut: two coils facing, as copper-and-silk art
export function xsym(c, s, ratio, sw) {
  const [x, y] = c, silk = [];
  const coil = (cx, n, dir) => { const pts = []; const r = s * 0.42 / n; for (let k = 0; k < n; k++) { const cy = y - s * 0.42 + k * 2 * r; for (let a = 0; a <= 10; a++) { const an = -Math.PI / 2 + Math.PI * a / 10; pts.push([cx + dir * Math.cos(an) * r, cy + r + Math.sin(an) * r]); } } return pts; };
  silk.push({ pts: coil(x - s * 0.18, ratio[0], -1), w: sw }, { pts: coil(x + s * 0.18, ratio[1], 1), w: sw });
  silk.push({ pts: [[x - s * 0.04, y - s * 0.46], [x - s * 0.04, y + s * 0.46]], w: sw }, { pts: [[x + s * 0.04, y - s * 0.46], [x + s * 0.04, y + s * 0.46]], w: sw });
  return silk;
}

// A small silk frame with a label inside (timestamps)
export function tag(x, y, text, cap, sw, padX = 0.9, padY = 0.75) {
  const tw = textWidth(text, cap);
  return { frame: chamferBox(x - cap * padX, y - cap * padY, x + tw + cap * padX, y + cap * (1 + padY), cap * 0.45), w: sw, text: { text, x, y, cap }, width: tw + 2 * cap * padX };
}

// An in-line transformer footprint (horizontal: in on the left, out on the right), size s = body width.
// ratio = [primary bumps, secondary bumps]; the coils are silkscreen, the two terminals are pads.
export function xformer(c, s, ratio, sw, o = {}) {
  const [x, y] = c, h = s * 0.82, pw = s * 0.12, ph = s * 0.22;
  const inP = [x - s / 2, y], outP = [x + s / 2, y];
  const pads = [{ x: inP[0], y, w: pw, h: ph, shape: 'rect', r: pw * 0.2 }, { x: outP[0], y, w: pw, h: ph, shape: 'rect', r: pw * 0.2 }];
  const silk = [{ pts: chamferBox(x - s / 2 + pw, y - h / 2, x + s / 2 - pw, y + h / 2, s * 0.08), w: sw }];
  const coil = (cx, n, dir) => { const pts = [[cx, y - h * 0.38]]; const r = h * 0.38 / n; for (let k = 0; k < n; k++) { const cy = y - h * 0.38 + k * 2 * r; for (let a = 0; a <= 10; a++) { const an = -Math.PI / 2 + Math.PI * a / 10; pts.push([cx + dir * Math.cos(an) * r, cy + r + Math.sin(an) * r]); } } return pts; };
  silk.push({ pts: coil(x - s * 0.12, ratio[0], -1), w: sw }, { pts: coil(x + s * 0.12, ratio[1], 1), w: sw });
  silk.push({ pts: [[x - s * 0.03, y - h * 0.42], [x - s * 0.03, y + h * 0.42]], w: sw }, { pts: [[x + s * 0.03, y - h * 0.42], [x + s * 0.03, y + h * 0.42]], w: sw });
  // leads from the pads into the coils
  silk.push({ pts: [[inP[0] + pw / 2, y], [x - s * 0.2, y]], w: sw * 0.7, dash: [sw * 2, sw * 2] }, { pts: [[outP[0] - pw / 2, y], [x + s * 0.2, y]], w: sw * 0.7, dash: [sw * 2, sw * 2] });
  return { pads, silk, keep: [{ rect: [x - s / 2 - pw, y - h / 2 - sw, x + s / 2 + pw, y + h / 2 + sw] }], inP, outP, c, s };
}
// A smoothing reactor sitting on a horizontal trace: two pads and a row of silk bumps above (dir -1) or below (+1)
export function reactor(c, len, sw, dir = -1) {
  const [x, y] = c, pw = len * 0.16, ph = len * 0.3;
  const pads = [{ x: x - len / 2, y, w: pw, h: ph, shape: 'rect', r: pw * 0.2 }, { x: x + len / 2, y, w: pw, h: ph, shape: 'rect', r: pw * 0.2 }];
  const n = 4, r = (len - pw * 1.6) / (2 * n), pts = [];
  for (let k = 0; k < n; k++) { const cx = x - len / 2 + pw * 0.8 + r + k * 2 * r; for (let a = 0; a <= 8; a++) { const an = Math.PI + Math.PI * a / 8; pts.push([cx + Math.cos(an) * r * -1 * -1, y + dir * (ph * 0.9) + dir * -Math.sin(an) * r]); } }
  return { pads, silk: [{ pts, w: sw }], keep: [] };
}
// A bank of small chip capacitors hanging off a horizontal line at height y, to a ground rail
export function capBank(x0, y, n, pitch, len, sw, dir = 1) {
  const pads = [], silk = [], traces = [];
  for (let i = 0; i < n; i++) {
    const x = x0 + i * pitch, a = y + dir * len * 0.55, b = y + dir * len * 1.35;
    pads.push({ x, y: a, w: len * 0.38, h: len * 0.28, shape: 'rect', r: len * 0.05 }, { x, y: b, w: len * 0.38, h: len * 0.28, shape: 'rect', r: len * 0.05 });
    silk.push({ pts: [[x - len * 0.32, (a + b) / 2], [x + len * 0.32, (a + b) / 2]], w: sw }, { pts: [[x - len * 0.32, (a + b) / 2 + dir * len * 0.1], [x + len * 0.32, (a + b) / 2 + dir * len * 0.1]], w: sw });
    traces.push([[x, y], [x, a]]);
  }
  const rail = y + dir * len * 1.7;
  for (let i = 0; i < n; i++) traces.push([[x0 + i * pitch, y + dir * len * 1.35], [x0 + i * pitch, rail]]);
  traces.push([[x0 - pitch * 0.3, rail], [x0 + (n - 1) * pitch + pitch * 0.3, rail]]);
  return { pads, silk, traces, rail };
}
export { chamferBox };
