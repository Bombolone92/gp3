import { HANZI } from './hanzi.js';
// "Routed" — a monoline silkscreen stroke font drawn like PCB traces:
// 0/45/90-degree runs, chamfered corners, round caps. Cap height = 10 units, y down.
// Each glyph: { w: advance width (without tracking), s: [[x,y, x,y, ...], ...] strokes }.

const oct = (cx, cy, r) => {               // small octagon ring (for %)
  const k = r * 0.4142, p = [];
  [[-k, -r], [k, -r], [r, -k], [r, k], [k, r], [-k, r], [-r, k], [-r, -k], [-k, -r]].forEach(([x, y]) => p.push(cx + x, cy + y));
  return p;
};
const D = 0.01;   // zero-length dot (round cap)

export const GLYPHS = {
  'A': { w: 6, s: [[0, 10, 0, 3, 3, 0, 6, 3, 6, 10], [0, 6.3, 6, 6.3]] },
  'B': { w: 6, s: [[0, 5, 0, 0, 4.2, 0, 5.7, 1.5, 5.7, 3.5, 4.2, 5, 0, 5], [4.2, 5, 6, 6.8, 6, 8.2, 4.2, 10, 0, 10, 0, 5]] },
  'C': { w: 6, s: [[6, 0, 2, 0, 0, 2, 0, 8, 2, 10, 6, 10]] },
  'D': { w: 6, s: [[0, 0, 3.8, 0, 6, 2.2, 6, 7.8, 3.8, 10, 0, 10, 0, 0]] },
  'E': { w: 5.4, s: [[5.4, 0, 0, 0, 0, 10, 5.4, 10], [0, 5, 4.4, 5]] },
  'F': { w: 5.4, s: [[5.4, 0, 0, 0, 0, 10], [0, 5, 4.4, 5]] },
  'G': { w: 6, s: [[6, 0, 2, 0, 0, 2, 0, 8, 2, 10, 6, 10, 6, 5.2, 3.4, 5.2]] },
  'H': { w: 6, s: [[0, 0, 0, 10], [6, 0, 6, 10], [0, 5, 6, 5]] },
  'I': { w: 0, s: [[0, 0, 0, 10]] },
  'J': { w: 5.4, s: [[5.4, 0, 5.4, 8, 3.4, 10, 2, 10, 0, 8]] },
  'K': { w: 6, s: [[0, 0, 0, 10], [6, 0, 1, 5, 6, 10], [0, 5, 1, 5]] },
  'L': { w: 5.4, s: [[0, 0, 0, 10, 5.4, 10]] },
  'M': { w: 8, s: [[0, 10, 0, 0, 4, 4, 8, 0, 8, 10]] },
  'N': { w: 6, s: [[0, 10, 0, 0, 6, 10, 6, 0]] },
  'O': { w: 6, s: [[2, 0, 4, 0, 6, 2, 6, 8, 4, 10, 2, 10, 0, 8, 0, 2, 2, 0]] },
  'P': { w: 6, s: [[0, 10, 0, 0, 4.2, 0, 6, 1.8, 6, 3.8, 4.2, 5.6, 0, 5.6]] },
  'Q': { w: 6, s: [[2, 0, 4, 0, 6, 2, 6, 8, 4, 10, 2, 10, 0, 8, 0, 2, 2, 0], [3.6, 7.6, 6.4, 10.4]] },
  'R': { w: 6, s: [[0, 10, 0, 0, 4.2, 0, 6, 1.8, 6, 3.6, 4.2, 5.4, 0, 5.4], [3.8, 5.4, 6, 7.6, 6, 10]] },
  'S': { w: 6, s: [[6, 0, 1.8, 0, 0, 1.8, 0, 3.2, 1.8, 5, 4.2, 5, 6, 6.8, 6, 8.2, 4.2, 10, 0, 10]] },
  'T': { w: 6, s: [[0, 0, 6, 0], [3, 0, 3, 10]] },
  'U': { w: 6, s: [[0, 0, 0, 8, 2, 10, 4, 10, 6, 8, 6, 0]] },
  'V': { w: 6.4, s: [[0, 0, 3.2, 10, 6.4, 0]] },
  'W': { w: 8.6, s: [[0, 0, 2.1, 10, 4.3, 3.4, 6.5, 10, 8.6, 0]] },
  'X': { w: 6, s: [[0, 0, 6, 10], [6, 0, 0, 10]] },
  'Y': { w: 6, s: [[0, 0, 0, 2, 3, 5, 6, 2, 6, 0], [3, 5, 3, 10]] },
  'Z': { w: 6, s: [[0, 0, 6, 0, 0, 10, 6, 10]] },
  'a': { w: 4.8, s: [[0.4, 3.4, 3.4, 3.4, 4.8, 4.8, 4.8, 10], [4.8, 6.4, 1.4, 6.4, 0, 7.8, 0, 8.6, 1.4, 10, 3.4, 10, 4.8, 8.6]] },
  'b': { w: 4.8, s: [[0, 0, 0, 10, 3.4, 10, 4.8, 8.6, 4.8, 4.8, 3.4, 3.4, 0, 3.4]] },
  'd': { w: 4.8, s: [[4.8, 0, 4.8, 10, 1.4, 10, 0, 8.6, 0, 4.8, 1.4, 3.4, 4.8, 3.4]] },
  'e': { w: 4.8, s: [[0, 6.8, 4.8, 6.8, 4.8, 4.8, 3.4, 3.4, 1.4, 3.4, 0, 4.8, 0, 8.6, 1.4, 10, 4.6, 10]] },
  'l': { w: 1.4, s: [[0, 0, 0, 8.6, 1.4, 10]] },
  'o': { w: 4.8, s: [[1.4, 3.4, 3.4, 3.4, 4.8, 4.8, 4.8, 8.6, 3.4, 10, 1.4, 10, 0, 8.6, 0, 4.8, 1.4, 3.4]] },
  'p': { w: 4.8, s: [[0, 13, 0, 3.4, 3.4, 3.4, 4.8, 4.8, 4.8, 8.6, 3.4, 10, 0, 10]] },
  'u': { w: 4.8, s: [[0, 3.4, 0, 8.6, 1.4, 10, 3.4, 10, 4.8, 8.6], [4.8, 3.4, 4.8, 10]] },
  'k': { w: 5, s: [[0, 0, 0, 10], [5, 3.4, 0.8, 7.6], [1.6, 6.6, 5, 10]] },
  'm': { w: 7, s: [[0, 10, 0, 3.4], [0, 4.8, 1.4, 3.4, 2.6, 3.4, 3.5, 4.3, 3.5, 10], [3.5, 4.3, 4.4, 3.4, 5.6, 3.4, 7, 4.8, 7, 10]] },
  'z': { w: 4.8, s: [[0, 3.4, 4.8, 3.4, 4.8, 4.2, 0, 9, 0, 10, 4.8, 10]] },
  '~': { w: 6.6, s: [[0, 6, 1.4, 4.6, 2.6, 4.6, 4, 6, 5.2, 6, 6.6, 4.6]] },
  '−': { w: 5, s: [[0, 5.4, 5, 5.4]] },
  '±': { w: 6, s: [[0, 4.2, 6, 4.2], [3, 1.2, 3, 7.2], [0, 9.8, 6, 9.8]] },
  's': { w: 4.8, s: [[4.8, 3.4, 1.4, 3.4, 0, 4.8, 0, 5.4, 1.2, 6.6, 3.6, 6.6, 4.8, 7.8, 4.8, 8.6, 3.4, 10, 0, 10]] },
  '0': { w: 5.6, s: [[2, 0, 3.6, 0, 5.6, 2, 5.6, 8, 3.6, 10, 2, 10, 0, 8, 0, 2, 2, 0]] },
  '1': { w: 2.2, s: [[0, 2.2, 2.2, 0, 2.2, 10]] },
  '2': { w: 5.6, s: [[0, 2, 2, 0, 3.6, 0, 5.6, 2, 5.6, 3.8, 0, 9.4, 0, 10, 5.6, 10]] },
  '3': { w: 5.6, s: [[0, 0, 3.8, 0, 5.6, 1.8, 5.6, 3.2, 3.8, 5, 1.6, 5], [3.8, 5, 5.6, 6.8, 5.6, 8.2, 3.8, 10, 0, 10]] },
  '4': { w: 6, s: [[4.4, 10, 4.4, 0, 0, 4.4, 0, 6.8, 6, 6.8]] },
  '5': { w: 5.6, s: [[5.6, 0, 0, 0, 0, 4.6, 3.8, 4.6, 5.6, 6.4, 5.6, 8.2, 3.8, 10, 0, 10]] },
  '6': { w: 5.6, s: [[5, 0, 2, 0, 0, 2, 0, 8, 2, 10, 3.6, 10, 5.6, 8, 5.6, 6.6, 3.6, 4.6, 0, 4.6]] },
  '7': { w: 5.6, s: [[0, 0, 5.6, 0, 5.6, 1.6, 1.8, 5.4, 1.8, 10]] },
  '8': { w: 5.8, s: [[1.8, 5, 0.4, 3.6, 0.4, 1.6, 2, 0, 3.8, 0, 5.4, 1.6, 5.4, 3.6, 4, 5, 1.8, 5, 0, 6.8, 0, 8.2, 1.8, 10, 4, 10, 5.8, 8.2, 5.8, 6.8, 4, 5]] },
  '9': { w: 5.6, s: [[0.6, 10, 3.6, 10, 5.6, 8, 5.6, 2, 3.6, 0, 2, 0, 0, 2, 0, 3.4, 2, 5.4, 5.6, 5.4]] },
  '.': { w: 0, s: [[0, 10, D, 10]] },
  ',': { w: 0.8, s: [[0.8, 9.4, 0, 11.6]] },
  ':': { w: 0, s: [[0, 3.6, D, 3.6], [0, 10, D, 10]] },
  '·': { w: 0, s: [[0, 5.2, D, 5.2]] },
  '-': { w: 4, s: [[0, 5.4, 4, 5.4]] },
  '–': { w: 6, s: [[0, 5.4, 6, 5.4]] },
  '+': { w: 6, s: [[0, 5.4, 6, 5.4], [3, 2.4, 3, 8.4]] },
  '×': { w: 5, s: [[0, 3, 5, 8], [5, 3, 0, 8]] },
  '=': { w: 5, s: [[0, 3.8, 5, 3.8], [0, 7, 5, 7]] },
  '≈': { w: 6, s: [[0, 4.6, 1.4, 3.2, 2.4, 3.2, 3.6, 4.4, 4.6, 4.4, 6, 3.0], [0, 8.0, 1.4, 6.6, 2.4, 6.6, 3.6, 7.8, 4.6, 7.8, 6, 6.4]] },
  '%': { w: 6.6, s: [[0.4, 10, 6.2, 0], oct(1.5, 1.8, 1.5), oct(5.1, 8.2, 1.5)] },
  '/': { w: 5, s: [[0, 10, 5, 0]] },
  '(': { w: 2, s: [[2, -1, 0, 1, 0, 9, 2, 11]] },
  ')': { w: 2, s: [[0, -1, 2, 1, 2, 9, 0, 11]] },
  '?': { w: 5.6, s: [[0, 2, 2, 0, 3.6, 0, 5.6, 2, 5.6, 3.6, 2.8, 6.4, 2.8, 7.4], [2.8, 10, 2.8 + D, 10]] },
  '!': { w: 0, s: [[0, 0, 0, 7], [0, 10, D, 10]] },
  "'": { w: 0, s: [[0, 0, 0, 2.8]] },
  '→': { w: 9, s: [[0, 5, 9, 5], [5.4, 1.4, 9, 5, 5.4, 8.6]] },
  '#': { w: 6, s: [[1.6, 0, 1.6, 10], [4.4, 0, 4.4, 10], [0, 3.4, 6, 3.4], [0, 6.6, 6, 6.6]] },
};

export const TRACK = 3.1;     // gap added after each glyph (units of cap/10)
export const SPACE = 4.6;
export const HZ_ADV = 14.2;   // hanzi advance: 12-unit box + gap

// Hanzi strokes come in a 12-unit box; shift to y = -1..11 and chamfer every 90-degree corner like a routed trace.
const CH = 0.75;
function chamfer(s) {
  const pts = []; for (let i = 0; i < s.length; i += 2) pts.push([s[i], s[i + 1] - 1]);
  const closed = pts.length > 3 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 1e-6;
  const n = pts.length, out = [];
  const corner = (a, b, c) => {
    const d1 = [b[0] - a[0], b[1] - a[1]], d2 = [c[0] - b[0], c[1] - b[1]], l1 = Math.hypot(...d1), l2 = Math.hypot(...d2);
    if (l1 < 2 * CH || l2 < 2 * CH) return null;
    if (Math.abs(d1[0] * d2[0] + d1[1] * d2[1]) > 1e-6 * l1 * l2) return null;   // only right angles
    return [[b[0] - d1[0] / l1 * CH, b[1] - d1[1] / l1 * CH], [b[0] + d2[0] / l2 * CH, b[1] + d2[1] / l2 * CH]];
  };
  for (let i = 0; i < n; i++) {
    const b = pts[i];
    let a = pts[i - 1], c = pts[i + 1];
    if (closed && i === 0) a = pts[n - 2];
    if (closed && i === n - 1) c = pts[1];
    const k = a && c ? corner(a, b, c) : null;
    if (k) out.push(...k); else out.push(b);
  }
  if (closed) { out[out.length - 1] = out[0]; }
  return out.flat();
}
const HZ = {};
for (const [ch, strokes] of Object.entries(HANZI)) HZ[ch] = { w: 12, s: strokes.map(chamfer) };
export const isHanzi = ch => !!HZ[ch];

// Layout a string: returns { strokes: [[x,y,...] in units], width, len }
const cache = new Map();
export function layout(str) {
  if (cache.has(str)) return cache.get(str);
  let x = 0; const strokes = [];
  for (const ch of str) {
    if (ch === ' ') { x += SPACE; continue; }
    const hz = HZ[ch], g = hz || GLYPHS[ch] || GLYPHS['?'];
    for (const s of g.s) { const o = new Array(s.length); for (let i = 0; i < s.length; i += 2) { o[i] = s[i] + x; o[i + 1] = s[i + 1]; } strokes.push(o); }
    x += hz ? HZ_ADV : g.w + TRACK;
  }
  const last = [...str].pop();
  const width = Math.max(0, x - (HZ[last] ? HZ_ADV - 12 : TRACK));
  let len = 0;
  for (const s of strokes) for (let i = 2; i < s.length; i += 2) len += Math.hypot(s[i] - s[i - 2], s[i + 1] - s[i - 1]);
  const r = { strokes, width, len };
  cache.set(str, r); return r;
}
export const textWidth = (str, cap) => layout(str).width * cap / 10;

// Draw text with cap height `cap` (in the ctx's current units), left/centre/right aligned at baseline-top (x, y = top of caps).
// opts: { weight (stroke width as fraction of cap, default .15), align, progress (0..1 plotting), color }
export function drawText(ctx, str, x, y, cap, opts = {}) {
  const L = layout(str), k = cap / 10, w = opts.sw ?? (opts.weight ?? 0.15) * cap;
  const ax = opts.align === 'center' ? -L.width * k / 2 : opts.align === 'right' ? -L.width * k : 0;
  const prog = opts.progress ?? 1;
  if (prog <= 0) return L.width * k;
  let budget = prog >= 1 ? Infinity : prog * L.len;
  ctx.lineWidth = w; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (opts.color) ctx.strokeStyle = opts.color;
  ctx.beginPath();
  for (const s of L.strokes) {
    if (budget <= 0) break;
    ctx.moveTo(x + ax + s[0] * k, y + s[1] * k);
    for (let i = 2; i < s.length; i += 2) {
      const sl = Math.hypot(s[i] - s[i - 2], s[i + 1] - s[i - 1]);
      if (sl <= budget) { ctx.lineTo(x + ax + s[i] * k, y + s[i + 1] * k); budget -= sl; }
      else { const f = budget / sl; ctx.lineTo(x + ax + (s[i - 2] + (s[i] - s[i - 2]) * f) * k, y + (s[i - 1] + (s[i + 1] - s[i - 1]) * f) * k); budget = 0; break; }
    }
  }
  ctx.stroke();
  return L.width * k;
}
