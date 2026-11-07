/**
 * Scribble: fills a shape with a back-and-forth hand-drawn stroke in the
 * shape's fill paint. Passes run at `angle` degrees, `spacing` apart, from
 * edge to edge of the filled area (reaching `overlap` past it; negative
 * stays inside), turning with loops whose roundness is `curviness`. Each
 * amount has a variation drawn from the effect's seed, so the scribble is
 * stable between redraws.
 *
 * The result paints differently from a normal outline (see geom-effects.js):
 * the passes are lines stroked with the object's fill at `lineWidth`, and
 * the object's outline remains for its stroke only.
 */
import { flattenPath } from '../../../model/bezier.js';
import { noise } from './distort.js';

export const SCRIBBLE_LINE = (lineWidth) => ({
  fill: null,
  stroke: 'fill',
  strokeWidth: lineWidth,
  strokeCap: 'round',
  strokeJoin: 'round',
  strokeAlign: 'center',
  dash: [],
  arrowStart: null,
  arrowEnd: null,
});

export const SCRIBBLE_OUTLINE = Object.freeze({ fill: null });

/** Preset settings (lengths in points, curviness as a fraction of a pass). */
export const SCRIBBLE_PRESETS = Object.freeze([
  { id: 'default', label: 'Default', angle: 30, overlap: 0, overlapVar: 5, lineWidth: 3, curviness: 0.05, curvinessVar: 0.01, spacing: 5, spacingVar: 0.5 },
  { id: 'fineHatch', label: 'Fine Hatch', angle: 45, overlap: -1, overlapVar: 1, lineWidth: 0.75, curviness: 0, curvinessVar: 0, spacing: 3, spacingVar: 0 },
  { id: 'pencil', label: 'Pencil Shading', angle: 60, overlap: 0, overlapVar: 2, lineWidth: 1, curviness: 0.02, curvinessVar: 0.02, spacing: 2, spacingVar: 0.5 },
  { id: 'crayon', label: 'Crayon', angle: 35, overlap: 3, overlapVar: 4, lineWidth: 4, curviness: 0.08, curvinessVar: 0.06, spacing: 3.5, spacingVar: 1.5 },
  { id: 'marker', label: 'Loose Marker', angle: 20, overlap: 4, overlapVar: 6, lineWidth: 6, curviness: 0.15, curvinessVar: 0.05, spacing: 8, spacingVar: 2 },
  { id: 'wide', label: 'Wide Strokes', angle: 15, overlap: 2, overlapVar: 3, lineWidth: 10, curviness: 0.1, curvinessVar: 0.05, spacing: 12, spacingVar: 3 },
  { id: 'zigzag', label: 'Tight Zigzag', angle: 90, overlap: 0, overlapVar: 0, lineWidth: 1.5, curviness: 0, curvinessVar: 0, spacing: 2.5, spacingVar: 0 },
  { id: 'swirl', label: 'Swirl', angle: 0, overlap: 8, overlapVar: 8, lineWidth: 2, curviness: 0.45, curvinessVar: 0.15, spacing: 6, spacingVar: 1.5 },
]);

const MAX_PASSES = 3000;

/**
 * Edges of the outlines rotated by -angle about (cx, cy) so passes run
 * horizontally: [{ x0, y0, x1, y1 }]. Every outline counts as closed.
 */
function edgesOf(subs, cos, sin, cx, cy, tol) {
  const edges = [];
  const rot = (p) => ({ x: (p.x - cx) * cos + (p.y - cy) * sin, y: -(p.x - cx) * sin + (p.y - cy) * cos });
  for (const s of subs) {
    if (s.anchors.length < 2) continue;
    const pts = flattenPath(s.anchors, true, tol).map(rot);
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      if (a.y !== b.y) edges.push({ x0: a.x, y0: a.y, x1: b.x, y1: b.y });
    }
  }
  return edges;
}

/** Filled spans [x0, x1] of a horizontal line through the edges (nonzero or even-odd). */
function spansAt(edges, y, evenodd) {
  const hits = [];
  for (const e of edges) {
    const up = e.y1 > e.y0;
    const lo = up ? e.y0 : e.y1;
    const hi = up ? e.y1 : e.y0;
    if (y < lo || y >= hi) continue;
    hits.push({ x: e.x0 + ((y - e.y0) * (e.x1 - e.x0)) / (e.y1 - e.y0), d: up ? 1 : -1 });
  }
  hits.sort((a, b) => a.x - b.x);
  const spans = [];
  let wind = 0;
  let start = 0;
  for (const h of hits) {
    const was = evenodd ? wind % 2 !== 0 : wind !== 0;
    wind += evenodd ? 1 : h.d;
    const now = evenodd ? wind % 2 !== 0 : wind !== 0;
    if (!was && now) start = h.x;
    else if (was && !now && h.x > start) spans.push([start, h.x]);
  }
  return spans;
}

/**
 * Scribble geometry. Returns the passes as open outlines (paint: lines in
 * the fill) followed by the source outlines (paint: stroke only). Outlines
 * that already paint their own way (an earlier Scribble, Crop Marks) are
 * kept as they are.
 */
export function scribble(subs, fx, b, { evenodd = false } = {}) {
  const own = subs.filter((s) => !s.paint);
  const other = subs.filter((s) => s.paint);
  if (!own.length || !(b.w > 0) || !(b.h > 0)) return subs;
  const seed = fx.seed | 0;
  // Angles are counterclockwise on screen (y points down).
  const ang = (-(fx.angle || 0) * Math.PI) / 180;
  const cos = Math.cos(ang);
  const sin = Math.sin(ang);
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const spacing = Math.max(0.1, fx.spacing || 0);
  const edges = edgesOf(own, cos, sin, cx, cy, Math.max(0.05, Math.min(1, spacing / 8)));
  if (!edges.length) return subs;
  let ymin = Infinity;
  let ymax = -Infinity;
  for (const e of edges) {
    ymin = Math.min(ymin, e.y0, e.y1);
    ymax = Math.max(ymax, e.y0, e.y1);
  }
  // Scan lines spaced by `spacing` +- variation.
  const rows = [];
  let y = ymin + Math.min(spacing / 2, (ymax - ymin) / 2);
  for (let k = 0; y < ymax && k < MAX_PASSES; k++) {
    rows.push({ y, spans: spansAt(edges, y, evenodd) });
    y += Math.max(spacing * 0.2, spacing + noise(seed, k, 11) * (fx.spacingVar || 0));
  }
  // Chain spans of consecutive rows into strokes: a span joins the stroke
  // whose last span it overlaps; anything else starts a new stroke.
  const strokes = [];
  let active = [];
  rows.forEach((row, k) => {
    const next = [];
    for (const [x0, x1] of row.spans) {
      let st = active.find((s) => !s.used && s.last[0] < x1 && s.last[1] > x0);
      if (st) st.used = true;
      else {
        st = { rows: [], last: null, used: true };
        strokes.push(st);
      }
      st.rows.push({ y: row.y, x0, x1, k });
      st.last = [x0, x1];
      next.push(st);
    }
    for (const s of next) s.used = false;
    active = next;
  });
  const overlap = fx.overlap || 0;
  const overlapVar = fx.overlapVar || 0;
  const unrot = (x, yy) => ({ x: cx + x * cos - yy * sin, y: cy + x * sin + yy * cos });
  const line = SCRIBBLE_LINE(Math.max(0.01, fx.lineWidth ?? 1));
  const out = [];
  for (const st of strokes) {
    // Zigzag: alternate ends, each pass reaching `overlap` past the edge.
    const pts = st.rows.map((r, i) => {
      const leftSide = i % 2 === 0;
      const ext = overlap + noise(seed, r.k, leftSide ? 21 : 22) * overlapVar;
      return { x: leftSide ? r.x0 - ext : r.x1 + ext, y: r.y, k: r.k };
    });
    if (pts.length === 1) {
      // A single pass: a stroke across its span.
      const r = st.rows[0];
      const e0 = overlap + noise(seed, r.k, 21) * overlapVar;
      const e1 = overlap + noise(seed, r.k, 22) * overlapVar;
      if (r.x1 + e1 - (r.x0 - e0) <= 0) continue;
      pts[0] = { x: r.x0 - e0, y: r.y, k: r.k };
      pts.push({ x: r.x1 + e1, y: r.y, k: r.k });
    }
    const anchors = pts.map((p, i) => {
      const q = unrot(p.x, p.y);
      const a = { x: q.x, y: q.y, ix: q.x, iy: q.y, ox: q.x, oy: q.y };
      const c = Math.max(0, Math.min(1, (fx.curviness || 0) + noise(seed, p.k, 31) * (fx.curvinessVar || 0)));
      const prev = pts[i - 1];
      const next = pts[i + 1];
      if (!c || !prev || !next) return a;
      // The turn's tangent runs across the passes; loops grow with the pass length.
      const len = (Math.abs(p.x - prev.x) + Math.abs(next.x - p.x)) / 2;
      const r = c * len;
      const dy = next.y - prev.y || 1;
      const tx = (-sin * Math.sign(dy)) * r;
      const ty = (cos * Math.sign(dy)) * r;
      a.ix = q.x - tx;
      a.iy = q.y - ty;
      a.ox = q.x + tx;
      a.oy = q.y + ty;
      return a;
    });
    out.push({ anchors, closed: false, paint: line });
  }
  return [...out, ...own.map((s) => ({ ...s, paint: SCRIBBLE_OUTLINE })), ...other];
}
