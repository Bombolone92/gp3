/**
 * Built-in brushes: the default set new documents start with and the
 * brush libraries (Window > Brush Libraries). All artwork here is drawn in
 * code, so it is resolution-free and easy to read.
 */
import { anchor } from '../../model/bezier.js';
import { KAPPA } from '../../model/shapes.js';
import { makeBrush, artBounds, setBrushSource } from './brush-model.js';
import { rng } from './generate.js';

const BLACK = { type: 'solid', color: '#000000' };
const solid = (color) => ({ type: 'solid', color });

// ---- drawing helpers (art space) ----

function ellipse(cx, cy, rx, ry) {
  const kx = rx * KAPPA;
  const ky = ry * KAPPA;
  return {
    closed: true,
    anchors: [
      anchor(cx + rx, cy, cx + rx, cy - ky, cx + rx, cy + ky),
      anchor(cx, cy + ry, cx + kx, cy + ry, cx - kx, cy + ry),
      anchor(cx - rx, cy, cx - rx, cy + ky, cx - rx, cy - ky),
      anchor(cx, cy - ry, cx - kx, cy - ry, cx + kx, cy - ry),
    ],
  };
}

const poly = (pts, closed = true) => ({ closed, anchors: pts.map(([x, y]) => anchor(x, y)) });

/** A pointed lens from (x0, y) to (x1, y), widest (2 * half) at fraction `peak`. */
function lens(x0, x1, y, half, peak = 0.5, lean = 0) {
  const xm = x0 + (x1 - x0) * peak;
  const a = (xm - x0) * 0.55;
  const b = (x1 - xm) * 0.55;
  return {
    closed: true,
    anchors: [
      anchor(x0, y),
      anchor(xm, y - half + lean, xm - a, y - half + lean, xm + b, y - half + lean),
      anchor(x1, y),
      anchor(xm, y + half + lean, xm + b, y + half + lean, xm - a, y + half + lean),
    ],
  };
}

function star(cx, cy, r1, r2, points = 5, rot = -Math.PI / 2) {
  const pts = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 ? r2 : r1;
    const a = rot + (i * Math.PI) / points;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return poly(pts);
}

const fillItem = (subpaths, paint = BLACK, extra = {}) => ({ subpaths: Array.isArray(subpaths) ? subpaths : [subpaths], fill: paint, stroke: null, ...extra });
const strokeItem = (subpaths, width, paint = BLACK, extra = {}) => ({ subpaths: Array.isArray(subpaths) ? subpaths : [subpaths], fill: null, stroke: paint, strokeWidth: width, strokeCap: 'round', strokeJoin: 'round', ...extra });
const art = (...items) => ({ items, bounds: artBounds(items) });

/** A band with ragged edges along x (charcoal, chalk), tapered at both ends. */
function ragged(len, half, seed, roughness = 0.35, step = 3) {
  const rand = rng(seed);
  const top = [];
  const bottom = [];
  for (let x = 0; x <= len; x += step) {
    const env = Math.min(1, x / (len * 0.12), (len - x) / (len * 0.12));
    const e = Math.sqrt(Math.max(0, env));
    top.push([x, -half * e * (1 - roughness * rand())]);
    bottom.push([x, half * e * (1 - roughness * rand())]);
  }
  return poly([...top, ...bottom.reverse()]);
}

// ---- calligraphic ----

const cal = (id, name, angle, roundness, size, extra = {}) =>
  makeBrush({ id, name, type: 'calligraphic', angle: { mode: 'fixed', value: angle, variation: 0 }, roundness: { mode: 'fixed', value: roundness, variation: 0 }, size: { mode: 'fixed', value: size, variation: 0 }, ...extra });

const CALLIGRAPHIC = [
  cal('lib.cal.round-1', 'Round 1 pt', 0, 100, 1),
  cal('lib.cal.round-3', 'Round 3 pt', 0, 100, 3),
  cal('lib.cal.round-6', 'Round 6 pt', 0, 100, 6),
  cal('lib.cal.chisel-30', 'Chisel 30°', 30, 22, 6),
  cal('lib.cal.chisel-45', 'Chisel 45°', 45, 15, 8),
  cal('lib.cal.broad-nib', 'Broad Nib', -40, 10, 12),
  cal('lib.cal.oval-pen', 'Oval Pen', 60, 45, 5),
  cal('lib.cal.hairline-flat', 'Flat Hairline', 0, 8, 4),
  cal('lib.cal.sketchy', 'Sketchy Round', 0, 80, 3, { size: { mode: 'random', value: 3, variation: 1.5 }, angle: { mode: 'random', value: 0, variation: 40 }, roundness: { mode: 'random', value: 70, variation: 25 } }),
  cal('lib.cal.pressure-pen', 'Pressure Pen', 20, 60, 4, { size: { mode: 'pressure', value: 4, variation: 3.5 } }),
];

// ---- art ----

const artBrush = (id, name, a, extra = {}) => makeBrush({ id, name, type: 'art', art: a, ...extra });
const tints = { method: 'tints', key: '#000000' };

const ART = [
  artBrush('lib.art.ink-taper', 'Ink Taper', art(fillItem(lens(0, 240, 0, 6))), { colorize: tints }),
  artBrush('lib.art.quill', 'Quill', art(fillItem({ closed: true, anchors: [anchor(0, -5, -3, -5, 60, -6), anchor(240, 0, 200, -1, 240, 0), anchor(0, 5, 60, 6, -3, 5), anchor(-4, 0, -4, 3, -4, -3)] })), { colorize: tints }),
  artBrush('lib.art.brush-swell', 'Brush Swell', art(fillItem(lens(0, 240, 0, 9, 0.3, -1))), { colorize: tints }),
  artBrush('lib.art.charcoal', 'Charcoal', art(fillItem(ragged(240, 7, 11), BLACK, { opacity: 0.92 }), fillItem(ragged(220, 3, 23, 0.6), solid('#5a5a5a'), { opacity: 0.6 })), { colorize: tints }),
  artBrush('lib.art.chalk', 'Chalk Line', art(fillItem(ragged(240, 4, 37, 0.7, 2), BLACK, { opacity: 0.75 })), { colorize: tints }),
  artBrush(
    'lib.art.dry-ink',
    'Dry Ink',
    art(
      fillItem(lens(0, 236, -6, 1.6, 0.4)),
      fillItem(lens(6, 240, -2.5, 2.2, 0.45)),
      fillItem(lens(0, 232, 1.5, 2, 0.35)),
      fillItem(lens(10, 238, 5.5, 1.4, 0.5)),
    ),
    { colorize: tints },
  ),
  artBrush('lib.art.ribbon', 'Ribbon', art(fillItem(poly([[0, -6], [240, -6], [240, 6], [0, 6]]), solid('#c8102e')), fillItem(poly([[0, -6], [240, -6], [240, -3], [0, -3]]), solid('#e85a6b'))), { colorize: { method: 'hueShift', key: '#c8102e' } }),
  artBrush('lib.art.marker', 'Marker', art(fillItem({ closed: true, anchors: [anchor(0, -5, 0, -5, 0, -5), anchor(240, -5), anchor(240, 5), anchor(0, 5)] }, BLACK, { opacity: 0.8 })), { colorize: tints }),
];

const ARROWS = [
  artBrush('lib.arrow.simple', 'Simple Arrow', art(fillItem(poly([[0, -1.2], [214, -1.2], [214, -7], [240, 0], [214, 7], [214, 1.2], [0, 1.2]]))), {
    scaling: 'guides',
    guides: { start: 0.02, end: 0.85 },
    colorize: tints,
  }),
  artBrush(
    'lib.arrow.fletched',
    'Fletched Arrow',
    art(
      fillItem(poly([[14, -0.9], [214, -0.9], [214, -6], [240, 0], [214, 6], [214, 0.9], [14, 0.9]])),
      fillItem(poly([[0, -6], [8, -6], [22, -0.9], [14, -0.9]])),
      fillItem(poly([[0, 6], [8, 6], [22, 0.9], [14, 0.9]])),
    ),
    { scaling: 'guides', guides: { start: 0.1, end: 0.86 }, colorize: tints },
  ),
  artBrush('lib.arrow.tapered', 'Tapered Arrow', art(fillItem(poly([[0, 0], [200, -3], [200, -9], [240, 0], [200, 9], [200, 3]]))), {
    scaling: 'guides',
    guides: { start: 0.0, end: 0.82 },
    colorize: tints,
  }),
  artBrush('lib.arrow.double', 'Double Arrow', art(fillItem(poly([[0, 0], [24, -7], [24, -1.2], [216, -1.2], [216, -7], [240, 0], [216, 7], [216, 1.2], [24, 1.2], [24, 7]]))), {
    scaling: 'guides',
    guides: { start: 0.11, end: 0.89 },
    colorize: tints,
  }),
];

// ---- scatter ----

const scatterBrush = (id, name, a, extra = {}) => makeBrush({ id, name, type: 'scatter', art: a, ...extra });
const R = (min, max = min, mode = min === max ? 'fixed' : 'random') => ({ mode, min, max });

const leafArt = art(fillItem(lens(-10, 10, 0, 4.5, 0.45)), strokeItem(poly([[-10, 0], [8, 0]], false), 0.5, solid('#ffffff')));
leafArt.items[0].fill = solid('#3f8f3a');

const SCATTER = [
  scatterBrush('lib.scatter.dots', 'Dot Trail', art(fillItem(ellipse(0, 0, 4, 4))), { spacing: R(160), colorize: tints }),
  scatterBrush('lib.scatter.stars', 'Star Dust', art(fillItem(star(0, 0, 6, 2.6))), {
    size: R(50, 120),
    spacing: R(90, 200),
    scatter: R(-80, 80),
    rotation: R(-180, 180),
    colorize: tints,
  }),
  scatterBrush('lib.scatter.sparkle', 'Sparkle', art(fillItem(star(0, 0, 6, 1.2, 4))), { size: R(40, 110), spacing: R(120, 260), scatter: R(-60, 60), rotation: R(-15, 15), colorize: tints }),
  scatterBrush('lib.scatter.leaves', 'Leaf Vine', leafArt, { size: R(80, 110), spacing: R(70, 90), scatter: R(-40, 40), rotation: R(-35, 35), rotateRelative: 'path', colorize: { method: 'hueShift', key: '#3f8f3a' } }),
  scatterBrush('lib.scatter.bubbles', 'Bubbles', art(strokeItem(ellipse(0, 0, 5, 5), 1)), { size: R(40, 140), spacing: R(80, 160), scatter: R(-90, 90), colorize: tints }),
  scatterBrush(
    'lib.scatter.confetti',
    'Confetti',
    art(
      fillItem(poly([[-6, -2], [-1, -2], [-1, 0], [-6, 0]]), solid('#ff4f7b')),
      fillItem(ellipse(4, 3, 2, 2), solid('#2f9bff')),
      fillItem(poly([[0, -7], [3, -3], [-3, -3]]), solid('#ffc21a')),
    ),
    { size: R(70, 140), spacing: R(80, 140), scatter: R(-100, 100), rotation: R(-180, 180) },
  ),
  scatterBrush('lib.scatter.hearts', 'Hearts', art(fillItem({ closed: true, anchors: [anchor(0, 6, 3, 3.5, -3, 3.5), anchor(-6, -1, -6, 2.5, -6, -4), anchor(-3, -5, -5, -5, -1, -5), anchor(0, -2.5, 0, -4, 0, -4), anchor(3, -5, 1, -5, 5, -5), anchor(6, -1, 6, -4, 6, 2.5)] }, solid('#e0245e'))), {
    size: R(70, 100),
    spacing: R(130),
    rotation: R(0),
    rotateRelative: 'path',
    colorize: { method: 'hueShift', key: '#e0245e' },
  }),
];

// ---- pattern ----

const patternBrush = (id, name, tiles, extra = {}) => makeBrush({ id, name, type: 'pattern', tiles: { side: null, outer: 'auto', inner: 'auto', start: null, end: null, ...tiles }, ...extra });

const PATTERN = [
  patternBrush('lib.pattern.stitch', 'Stitch', { side: art(fillItem({ closed: true, anchors: [anchor(0, -1.4, -1.4, -1.4, 0, -1.4), anchor(12, -1.4), anchor(12, 1.4, 13.4, 1.4, 12, 1.4), anchor(0, 1.4)] })) }, { spacing: 60, colorize: tints }),
  patternBrush(
    'lib.pattern.rope',
    'Rope',
    { side: art(fillItem(poly([[0, 5], [6, -5], [12, -5], [6, 5]])), fillItem(poly([[6, 5], [12, -5], [12, -5], [12, 5]]), solid('#7a7a7a'))) },
    { colorize: tints },
  ),
  patternBrush('lib.pattern.chain', 'Chain', { side: art(strokeItem(ellipse(8, 0, 7, 3.6), 1.6), strokeItem(poly([[15, 0], [20, 0]], false), 1.6)) }, { colorize: tints }),
  patternBrush('lib.pattern.zigzag', 'Zigzag', { side: art(strokeItem(poly([[0, 4], [5, -4], [10, 4]], false), 1.2)) }, { colorize: tints }),
  patternBrush(
    'lib.pattern.scallop',
    'Scallop Edge',
    { side: art(fillItem({ closed: true, anchors: [anchor(0, 4), anchor(0, 0, 0, 0, 0, -5), anchor(12, 0, 12, -5, 12, 0), anchor(12, 4)] })) },
    { colorize: tints },
  ),
  patternBrush(
    'lib.pattern.dot-frame',
    'Dotted Frame',
    {
      side: art(fillItem(ellipse(6, 0, 2.2, 2.2)), fillItem(poly([[0, -5.5], [12, -5.5], [12, -4.6], [0, -4.6]])), fillItem(poly([[0, 4.6], [12, 4.6], [12, 5.5], [0, 5.5]]))),
      outer: art(fillItem(poly([[-5.5, -5.5], [5.5, -5.5], [5.5, 5.5], [-5.5, 5.5]])), fillItem(poly([[-3.5, -3.5], [3.5, -3.5], [3.5, 3.5], [-3.5, 3.5]]), solid('#ffffff')), fillItem(ellipse(0, 0, 2.2, 2.2))),
      inner: art(fillItem(poly([[0, -5.5], [5.5, 0], [0, 5.5], [-5.5, 0]]))),
    },
    { colorize: tints },
  ),
  patternBrush(
    'lib.pattern.laurel',
    'Laurel',
    {
      side: art(strokeItem(poly([[0, 0], [16, 0]], false), 0.8), fillItem(lens(2, 12, -3.2, 1.8, 0.5, 0)), fillItem(lens(4, 14, 3.2, 1.8, 0.5, 0))),
      start: art(strokeItem(poly([[2, 0], [10, 0]], false), 0.8), fillItem(ellipse(2.5, 0, 2.2, 2.2))),
      end: art(strokeItem(poly([[0, 0], [6, 0]], false), 0.8), fillItem(lens(4, 14, 0, 2.4, 0.4))),
    },
    { colorize: { method: 'hueShift', key: '#2e7d32' } },
  ),
  patternBrush(
    'lib.pattern.railroad',
    'Rail Track',
    { side: art(fillItem(poly([[0, -4.5], [14, -4.5], [14, -3.7], [0, -3.7]])), fillItem(poly([[0, 3.7], [14, 3.7], [14, 4.5], [0, 4.5]])), fillItem(poly([[5.5, -6], [8.5, -6], [8.5, 6], [5.5, 6]]))) },
    { colorize: tints },
  ),
];
// Laurel leaves are green until colorized.
for (const it of PATTERN[6].tiles.side.items.slice(1)) it.fill = solid('#2e7d32');
PATTERN[6].tiles.end.items[1].fill = solid('#2e7d32');

// ---- bristle ----

const bristle = (id, name, shape, fields = {}) => makeBrush({ id, name, type: 'bristle', shape, ...fields });

const BRISTLE = [
  bristle('lib.bristle.soft-round', 'Soft Round', 'roundPoint', { size: 4, density: 45, thickness: 40, opacity: 70, stiffness: 30 }),
  bristle('lib.bristle.blunt-round', 'Blunt Round', 'roundBlunt', { size: 5, density: 60, thickness: 55, opacity: 85, stiffness: 60 }),
  bristle('lib.bristle.stiff-flat', 'Stiff Flat', 'flatBlunt', { size: 7, density: 55, thickness: 50, opacity: 80, stiffness: 85 }),
  bristle('lib.bristle.angled-flat', 'Angled Flat', 'flatAngle', { size: 6, density: 50, thickness: 45, opacity: 75, stiffness: 60 }),
  bristle('lib.bristle.dry-fan', 'Dry Fan', 'fan', { size: 8, length: 140, density: 25, thickness: 25, opacity: 55, stiffness: 40 }),
  bristle('lib.bristle.fine-point', 'Fine Point', 'roundPoint', { size: 2, length: 160, density: 30, thickness: 35, opacity: 85, stiffness: 70 }),
  bristle('lib.bristle.wet-curve', 'Wet Curve', 'roundCurve', { size: 6, length: 80, density: 80, thickness: 70, opacity: 45, stiffness: 20 }),
];

export const BRUSH_LIBRARIES = [
  { id: 'calligraphic-pens', name: 'Calligraphic Pens', brushes: CALLIGRAPHIC },
  { id: 'ink-charcoal', name: 'Ink and Charcoal', brushes: ART },
  { id: 'arrows', name: 'Arrows', brushes: ARROWS },
  { id: 'decorative-scatter', name: 'Decorative Scatter', brushes: SCATTER },
  { id: 'borders', name: 'Borders', brushes: PATTERN },
  { id: 'bristle-paint', name: 'Bristle Paint', brushes: BRISTLE },
];

/** The brushes a new document starts with. */
export const DEFAULT_BRUSHES = [
  cal('def.basic', 'Basic', 0, 100, 1),
  cal('def.chisel', 'Chisel Pen', 30, 22, 6),
  artBrush('def.ink-taper', 'Ink Taper', ART[0].art, { colorize: tints }),
  artBrush('def.charcoal', 'Charcoal', ART[3].art, { colorize: tints }),
  scatterBrush('def.dots', 'Dot Trail', SCATTER[0].art, { spacing: R(160), colorize: tints }),
  patternBrush('def.stitch', 'Stitch', PATTERN[0].tiles, { spacing: 60, colorize: tints }),
  bristle('def.soft-round', 'Soft Round', 'roundPoint', { size: 4, density: 45, thickness: 40, opacity: 70, stiffness: 30 }),
];

setBrushSource(() => ({ defaults: DEFAULT_BRUSHES, libraries: BRUSH_LIBRARIES }));
