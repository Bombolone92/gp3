/**
 * Built-in pattern swatch libraries (original designs). Each library is
 * { id, name, swatches: [{ name, paint, pattern }] } in the swatch-library
 * format, with the pattern definition each swatch needs; adding a swatch to
 * a document adds its definition (see app.patterns.ensureDef).
 */
import { anchor } from '../../model/bezier.js';
import { rectangle, ellipse, polygon, star } from '../../model/shapes.js';
import { DEFAULT_STYLE } from '../../model/nodes.js';
import { rotate, translate, multiply } from '../../lib/matrix.js';
import { transformAnchors } from '../../model/bezier.js';
import { PATTERN_DEFAULTS, patternPaint } from './model.js';

const solid = (color) => ({ type: 'solid', color });

function shape(id, anchors, closed, { fill = null, stroke = null, width = 1, cap = 'butt', join = 'miter' } = {}) {
  return {
    ...DEFAULT_STYLE,
    id,
    type: 'path',
    name: '',
    anchors,
    closed,
    hidden: false,
    locked: false,
    parent: null,
    fill: fill ? solid(fill) : null,
    stroke: stroke ? solid(stroke) : null,
    strokeWidth: stroke ? width : 0,
    strokeCap: cap,
    strokeJoin: join,
  };
}

const pts = (list) => list.map(([x, y]) => anchor(x, y));
const circle = (cx, cy, r) => ellipse(cx - r, cy - r, r * 2, r * 2);

/** A definition from shapes: ids are made unique within the pattern. */
function def(id, name, opts, shapes) {
  const nodes = shapes.map((s, i) => ({ ...s, id: `${id}-${i}` }));
  return { ...PATTERN_DEFAULTS, ...opts, id, name, art: { roots: nodes.map((n) => n.id), nodes } };
}

/** Small deterministic random numbers for scattered designs. */
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function wave(w, h, amp) {
  const y = h / 2;
  const k = w / 4;
  // Two half waves with smooth (collinear) handles; the ends line up across tiles.
  return [
    { x: 0, y, ix: -k * 0.55, iy: y + amp, ox: k * 0.55, oy: y - amp },
    { x: w / 2, y, ix: w / 2 - k * 0.55, iy: y - amp, ox: w / 2 + k * 0.55, oy: y + amp },
    { x: w, y, ix: w - k * 0.55, iy: y + amp, ox: w + k * 0.55, oy: y - amp },
  ];
}

function leaf(cx, cy, len, wid, deg) {
  const a = [
    { x: cx, y: cy - len / 2, ix: cx, iy: cy - len / 2, ox: cx + wid, oy: cy - len / 6 },
    { x: cx, y: cy + len / 2, ix: cx + wid, iy: cy + len / 6, ox: cx - wid, oy: cy + len / 6 },
  ];
  a[0].ix = cx - wid;
  a[0].iy = cy - len / 6;
  return transformAnchors(a, rotate(deg, cx, cy));
}

function geometric() {
  const h3 = Math.sqrt(3);
  const hexW = 24;
  const hexH = (hexW / h3) * 2;
  return [
    def('patlib-dots', 'Polka Dots', { tileType: 'brickRow', brickOffset: '1/2', width: 20, height: 20 }, [shape('', circle(10, 10, 4), true, { fill: '#2f5d8a' })]),
    def('patlib-checks', 'Checkerboard', { width: 20, height: 20 }, [shape('', rectangle(0, 0, 10, 10), true, { fill: '#1f1f1f' }), shape('', rectangle(10, 10, 10, 10), true, { fill: '#1f1f1f' })]),
    def('patlib-stripes', 'Bias Stripes', { width: 16, height: 16 }, [
      shape('', pts([[0, 8], [8, 0], [16, 0], [0, 16]]), true, { fill: '#c0392b' }),
      shape('', pts([[8, 16], [16, 8], [16, 16]]), true, { fill: '#c0392b' }),
    ]),
    def('patlib-triangles', 'Triangle Rows', { tileType: 'brickRow', brickOffset: '1/2', width: 24, height: 12 * h3 }, [shape('', pts([[0, 12 * h3], [12, 0], [24, 12 * h3]]), true, { fill: '#e0a526' })]),
    def('patlib-honeycomb', 'Honeycomb', { tileType: 'hexRow', width: hexW, height: hexH }, [shape('', polygon(hexW / 2, hexH / 2, hexH / 2 - 1, 6), true, { fill: '#f6d365', stroke: '#b07d1a', width: 1.5, join: 'round' })]),
    def('patlib-chevron', 'Chevron', { width: 24, height: 12 }, [shape('', pts([[0, 9], [6, 3], [12, 9], [18, 3], [24, 9]]), false, { stroke: '#2d6a4f', width: 2.5, join: 'miter' })]),
    def('patlib-diamonds', 'Diamonds', { tileType: 'brickRow', brickOffset: '1/2', width: 16, height: 12 }, [shape('', pts([[8, 0], [16, 6], [8, 12], [0, 6]]), true, { fill: '#7b5ea7' })]),
  ];
}

function nature() {
  const rnd = seeded(7);
  const confettiColors = ['#e4572e', '#29335c', '#f3a712', '#a8c686', '#669bbc', '#d16ba5'];
  const confetti = [];
  for (let i = 0; i < 14; i++) {
    const x = 4 + rnd() * 52;
    const y = 4 + rnd() * 52;
    const color = confettiColors[i % confettiColors.length];
    if (i % 2) confetti.push(shape('', circle(x, y, 1.6 + rnd() * 1.4), true, { fill: color }));
    else confetti.push(shape('', transformAnchors(rectangle(x - 3, y - 1, 6, 2), rotate(rnd() * 180, x, y)), true, { fill: color }));
  }
  const stars = [];
  const rs = seeded(21);
  for (let i = 0; i < 6; i++) {
    const r = 1.5 + rs() * 3.5;
    stars.push(shape('', star(6 + rs() * 38, 6 + rs() * 38, r, r * 0.45, 5), true, { fill: '#f4d35e' }));
  }
  return [
    def('patlib-scales', 'Fish Scales', { tileType: 'brickRow', brickOffset: '1/2', width: 20, height: 10, overlapV: 'bottom' }, [shape('', circle(10, 10, 10), true, { fill: '#3d9970', stroke: '#245c43', width: 1 })]),
    def('patlib-waves', 'Waves', { width: 40, height: 16 }, [shape('', wave(40, 16, 6), false, { stroke: '#1e6fa8', width: 2, cap: 'round' })]),
    def('patlib-confetti', 'Confetti', { width: 60, height: 60 }, confetti),
    def('patlib-leaves', 'Leaves', { tileType: 'brickRow', brickOffset: '1/2', width: 30, height: 30 }, [shape('', leaf(15, 15, 22, 8, 35), true, { fill: '#6a994e' })]),
    def('patlib-pebbles', 'Pebbles', { tileType: 'hexColumn', width: 24, height: 20 }, [shape('', ellipse(4, 4, 16, 12), true, { fill: '#a8a29e' })]),
    def('patlib-stars', 'Starfield', { width: 50, height: 50 }, stars),
  ];
}

function lines() {
  const grid = [];
  for (const p of [5, 10, 15]) {
    grid.push(shape('', rectangle(p - 0.15, 0, 0.3, 20), true, { fill: '#c6d8ec' }), shape('', rectangle(0, p - 0.15, 20, 0.3), true, { fill: '#c6d8ec' }));
  }
  grid.push(shape('', rectangle(0, 0, 0.6, 20), true, { fill: '#7fa7d1' }), shape('', rectangle(0, 0, 20, 0.6), true, { fill: '#7fa7d1' }));
  const weave = [];
  const bar = (x, y, w, h) => shape('', rectangle(x, y, w, h), true, { fill: '#c8a165', stroke: '#8b6b3d', width: 0.5 });
  for (let i = 0; i < 3; i++) {
    weave.push(bar(0, i * 4, 12, 4), bar(12 + i * 4, 0, 4, 12), bar(i * 4, 12, 4, 12), bar(12, 12 + i * 4, 12, 4));
  }
  const bone = (deg, dx) => shape('', transformAnchors(rectangle(-2, -8, 4, 16), multiply(translate(dx, 8), rotate(deg))), true, { fill: '#9c6644' });
  return [
    def('patlib-pinstripe', 'Pinstripe', { width: 8, height: 8 }, [shape('', rectangle(0, 0, 1, 8), true, { fill: '#555555' })]),
    def('patlib-graph', 'Graph Paper', { width: 20, height: 20 }, grid),
    def('patlib-dotgrid', 'Dot Grid', { width: 12, height: 12 }, [shape('', circle(6, 6, 0.9), true, { fill: '#777777' })]),
    def('patlib-crosshatch', 'Crosshatch', { width: 12, height: 12 }, [shape('', pts([[0, 0], [12, 12]]), false, { stroke: '#444444', width: 0.6 }), shape('', pts([[12, 0], [0, 12]]), false, { stroke: '#444444', width: 0.6 })]),
    def('patlib-herringbone', 'Herringbone', { tileType: 'brickColumn', brickOffset: '1/2', width: 16, height: 16 }, [bone(45, 4), bone(-45, 12)]),
    def('patlib-basketweave', 'Basketweave', { width: 24, height: 24 }, weave),
  ];
}

let cached = null;

/** The pattern libraries (built once). */
export function patternLibraries() {
  if (!cached) {
    const lib = (id, name, defs) => ({ id, name, swatches: defs.map((d) => ({ name: d.name, paint: patternPaint(d.id), pattern: d })) });
    cached = [lib('patterns-geometric', 'Patterns: Geometric', geometric()), lib('patterns-nature', 'Patterns: Nature', nature()), lib('patterns-lines', 'Patterns: Lines and Grids', lines())];
  }
  return cached;
}
