/**
 * Paint Regions: a live group whose paths divide the plane into regions
 * (faces) and edges that are painted independently of the paths.
 *
 *   node.live = {
 *     kind: 'paintRegions',
 *     faces: [{ fill, pts: [[x, y], ...] }],
 *     edges: [{ stroke, strokeWidth, pts: [[x, y], ...] }],
 *     gaps: { on, size: 'small'|'medium'|'large'|'custom', custom, color },
 *   }
 *
 * Paint is not tied to face or edge numbers (they change whenever a path
 * is edited) but to sample points: a painted face stores a few points
 * spread inside it, a painted edge a few points along it. After any edit
 * the map is rebuilt and every face takes the paint of the latest entry
 * with a point inside it, so a face split by a new path keeps its color
 * on both sides, and moving a path keeps the colors of the regions it
 * leaves alone. Edges without an entry take the stroke of the path they
 * come from; faces without one are unpainted.
 *
 * The children are ordinary paths (and compound paths or groups of them),
 * editable in isolation mode or with Direct Selection; they do not draw
 * themselves.
 */
import { registerLive, virtualId } from '../../model/live.js';
import { createGroup, createPath, DEFAULT_STYLE } from '../../model/nodes.js';
import { segmentCount, segmentPoints, flattenPath, pointAt } from '../../model/bezier.js';
import { apply } from '../../lib/matrix.js';
import { buildPlanarMap, faceAt, edgeAt, faceSubpaths, interiorPoints, cubicsToAnchors, pointInPolys, windingNumber, reverseCubic } from './planar.js';

export const GAP_SIZES = Object.freeze({ small: 3, medium: 6, large: 12 });
export const DEFAULT_GAPS = Object.freeze({ on: true, size: 'small', custom: 3, color: '#ff4f6d' });
const EDGE_TOL = 0.25;
const STROKE_KEYS = ['strokeCap', 'strokeJoin', 'miterLimit', 'dash', 'dashOffset'];

export const isRegions = (n) => n?.type === 'group' && n.live?.kind === 'paintRegions';

/** Gap closing distance of a group (0 when gap detection is off). */
export function gapSize(live) {
  const g = { ...DEFAULT_GAPS, ...(live?.gaps || {}) };
  if (!g.on) return 0;
  return g.size === 'custom' ? Math.max(0, Number(g.custom) || 0) : GAP_SIZES[g.size] || GAP_SIZES.small;
}

/** Path-like leaves of a group's contents, back to front: paths and compound paths. */
export function regionLeaves(doc, node) {
  const out = [];
  const visit = (n) => {
    if (!n || n.hidden) return;
    if (n.type === 'path' || n.type === 'compound') out.push(n);
    else if (n.type === 'group') for (const c of n.children) visit(doc.get(c));
  };
  for (const c of node.children) visit(doc.get(c));
  return out;
}

/** Subpaths of a leaf: a path is one, a compound path its children. */
function leafSubpaths(doc, n) {
  if (n.type === 'path') return [{ anchors: n.anchors, closed: n.closed }];
  return n.children.map((c) => doc.get(c)).filter(Boolean).map((p) => ({ anchors: p.anchors, closed: p.closed }));
}

const mapCache = new WeakMap();

/** The planar map of a regions group (cached until its paths or gap setting change). */
export function regionMap(doc, node) {
  const leaves = regionLeaves(doc, node);
  const snap = [];
  for (const l of leaves) {
    snap.push(l);
    if (l.type === 'compound') for (const c of l.children) snap.push(doc.get(c));
  }
  const gap = gapSize(node.live);
  const key = node.children;
  const hit = mapCache.get(key);
  if (hit && hit.gap === gap && hit.snap.length === snap.length && hit.snap.every((n, i) => n === snap[i])) return hit.map;
  const curves = [];
  for (const l of leaves) {
    for (const sp of leafSubpaths(doc, l)) {
      for (let i = 0; i < segmentCount(sp.anchors, sp.closed); i++) curves.push({ c: segmentPoints(sp.anchors, i), owner: l.id });
    }
  }
  const map = buildPlanarMap(curves, { gap });
  mapCache.set(key, { gap, snap, map });
  return map;
}

/** Sample points (rounded) spread inside a face, deepest first; `count` limits them. */
export function facePoints(face, count = Infinity) {
  return interiorPoints(face.polys, face.bounds, 5, 3).slice(0, count).map(([x, y]) => [round3(x), round3(y)]);
}

/** Sample points along an edge. */
export function edgePoints(edge) {
  return [0.3, 0.5, 0.7].map((t) => {
    const p = pointAt(edge.c, t);
    return [round3(p.x), round3(p.y)];
  });
}

const round3 = (v) => Math.round(v * 1000) / 1000;

/** The stroke an edge has from its path: { stroke, strokeWidth, ... } or null. */
function ownerStroke(doc, edge) {
  if (edge.kind === 'gap') return null;
  const o = doc.get(edge.owner);
  if (!o || !o.stroke || !(o.strokeWidth > 0)) return null;
  const out = { stroke: o.stroke, strokeWidth: o.strokeWidth };
  for (const k of STROKE_KEYS) if (o[k] !== undefined) out[k] = o[k];
  return out;
}

const paintCache = new WeakMap();

/**
 * Resolved paints of a regions group: { map, fills: [paint|null per face],
 * strokes: [style|null per edge] }.
 */
export function regionPaints(doc, node) {
  const map = regionMap(doc, node);
  const hit = paintCache.get(node);
  if (hit && hit.map === map) return hit.result;
  const fills = new Array(map.faces.length).fill(null);
  for (const en of node.live.faces || []) {
    for (const [x, y] of en.pts || []) {
      const f = faceAt(map, x, y);
      if (f) fills[f.id] = en.fill ?? null;
    }
  }
  const strokes = map.edges.map((e) => ownerStroke(doc, e));
  for (const en of node.live.edges || []) {
    for (const [x, y] of en.pts || []) {
      const e = edgeAt(map, x, y, EDGE_TOL);
      if (!e) continue;
      const base = strokes[e.id] || ownerStroke(doc, e) || {};
      strokes[e.id] = en.stroke && en.strokeWidth > 0 ? { ...base, stroke: en.stroke, strokeWidth: en.strokeWidth } : null;
    }
  }
  const result = { map, fills, strokes };
  paintCache.set(node, { map, result });
  return result;
}

function virtualPath(anchors, closed, style, extra = {}) {
  return { id: virtualId('rg'), type: 'path', name: '', hidden: false, locked: false, ...DEFAULT_STYLE, effects: [], anchors, closed, ...style, ...extra };
}

/** Stroked edges joined into longer paths where two edges of the same stroke meet. */
function strokeChains(map, strokes) {
  const groups = new Map();
  map.edges.forEach((e) => {
    const s = strokes[e.id];
    if (!s) return;
    const key = JSON.stringify(s);
    if (!groups.has(key)) groups.set(key, { style: s, edges: [] });
    groups.get(key).edges.push(e);
  });
  const chains = [];
  for (const { style, edges } of groups.values()) {
    const adj = new Map();
    const link = (v, e) => {
      if (!adj.has(v)) adj.set(v, []);
      adj.get(v).push(e);
    };
    for (const e of edges) {
      link(e.a, e);
      if (e.b !== e.a) link(e.b, e);
    }
    const used = new Set();
    // Continue through vertices where exactly two edges of this stroke meet.
    const step = (v, from) => {
      const list = adj.get(v) || [];
      if (list.length !== 2) return null;
      const n = list[0] === from ? list[1] : list[0];
      return used.has(n) ? null : n;
    };
    for (const e of edges) {
      if (used.has(e)) continue;
      used.add(e);
      const seq = [e.c];
      let end = e.b;
      let cur = e;
      for (let n = step(end, cur); n && end !== e.a; n = step(end, cur)) {
        used.add(n);
        const fwd = n.a === end;
        seq.push(fwd ? n.c : reverseCubic(n.c));
        end = fwd ? n.b : n.a;
        cur = n;
      }
      let start = e.a;
      cur = e;
      if (end !== start) {
        for (let n = step(start, cur); n; n = step(start, cur)) {
          used.add(n);
          const fwd = n.b === start;
          seq.unshift(fwd ? n.c : reverseCubic(n.c));
          start = fwd ? n.a : n.b;
          cur = n;
          if (start === end) break;
        }
      }
      chains.push({ style, cubics: seq, closed: start === end && (seq.length > 1 || e.a === e.b), owner: e.owner });
    }
  }
  return chains;
}

registerLive('paintRegions', {
  label: '<Paint Regions>',
  generate(doc, node) {
    const { map, fills, strokes } = regionPaints(doc, node);
    const extra = new Map();
    const items = [];
    const fillIds = [];
    map.faces.forEach((f) => {
      const fill = fills[f.id];
      if (!fill) return;
      const subs = faceSubpaths(map, f);
      let v;
      if (subs.length === 1) v = virtualPath(subs[0].anchors, true, { fill, stroke: null, strokeWidth: 0 });
      else {
        const kids = subs.map((s) => virtualPath(s.anchors, true, { fill: null, stroke: null }));
        v = { ...virtualPath([], true, { fill, stroke: null, strokeWidth: 0 }), type: 'compound', fillRule: 'evenodd', children: kids.map((k) => k.id) };
        delete v.anchors;
        delete v.closed;
        for (const k of kids) extra.set(k.id, { ...k, parent: v.id });
      }
      extra.set(v.id, v);
      fillIds.push(v.id);
    });
    const strokeIds = [];
    for (const ch of strokeChains(map, strokes)) {
      const v = virtualPath(cubicsToAnchors(ch.cubics, ch.closed), ch.closed, { fill: null, ...ch.style }, { source: ch.owner });
      extra.set(v.id, v);
      strokeIds.push(v.id);
    }
    for (const [ids, name] of [[fillIds, 'Fills'], [strokeIds, 'Strokes']]) {
      if (!ids.length) continue;
      const g = { id: virtualId('rg'), type: 'group', name, children: ids, clip: false, hidden: false, locked: false, opacity: 1, blendMode: 'normal', effects: [] };
      for (const id of ids) extra.set(id, { ...extra.get(id), parent: g.id });
      extra.set(g.id, g);
      items.push(g.id);
    }
    return { items, extra };
  },
  transformParams(node, m, opts = {}) {
    const L = node.live;
    const move = (pts) => (pts || []).map(([x, y]) => {
      const p = apply(m, x, y);
      return [round3(p.x), round3(p.y)];
    });
    const s = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
    return {
      live: {
        ...L,
        faces: (L.faces || []).map((en) => ({ ...en, pts: move(en.pts) })),
        edges: (L.edges || []).map((en) => ({ ...en, pts: move(en.pts), ...(opts.scaleStrokes && en.strokeWidth ? { strokeWidth: en.strokeWidth * s } : {}) })),
      },
    };
  },
});

// ---- painting ----

/**
 * Paint faces (inside a transaction): `faces` are face objects of the
 * group's current map. Older paint on those faces is dropped; `fill` null
 * leaves them unpainted.
 */
export function paintFaces(doc, gid, faces, fill) {
  const g = doc.get(gid);
  if (!isRegions(g) || !faces.length) return;
  const map = regionMap(doc, g);
  const ids = new Set(faces.map((f) => f.id));
  const kept = [];
  for (const en of g.live.faces || []) {
    const pts = (en.pts || []).filter(([x, y]) => {
      const f = faceAt(map, x, y);
      return f && !ids.has(f.id);
    });
    if (pts.length) kept.push({ ...en, pts });
  }
  if (fill) kept.push({ fill, pts: faces.flatMap((f) => facePoints(f)) });
  doc.update(gid, { live: { ...g.live, faces: kept } });
}

/** Paint edges (inside a transaction) with { stroke, strokeWidth }; stroke null removes the stroke. */
export function paintEdges(doc, gid, edges, style) {
  const g = doc.get(gid);
  if (!isRegions(g) || !edges.length) return;
  const map = regionMap(doc, g);
  const ids = new Set(edges.map((e) => e.id));
  const kept = [];
  for (const en of g.live.edges || []) {
    const pts = (en.pts || []).filter(([x, y]) => {
      const e = edgeAt(map, x, y, EDGE_TOL);
      return e && !ids.has(e.id);
    });
    if (pts.length) kept.push({ ...en, pts });
  }
  kept.push({ stroke: style.stroke ?? null, strokeWidth: style.stroke ? style.strokeWidth ?? 1 : 0, pts: edges.flatMap((e) => edgePoints(e)) });
  doc.update(gid, { live: { ...g.live, edges: kept } });
}

/**
 * Faces connected to `face`: through edges without a stroke (unless
 * `acrossStrokes`), and only those with the same fill when `sameFill`.
 * A double-click with the Paint Bucket fills the first kind; one with
 * Region Selection selects the second.
 */
export function connectedFaces(doc, node, face, { acrossStrokes = false, sameFill = false } = {}) {
  const { map, fills, strokes } = regionPaints(doc, node);
  const key = JSON.stringify(fills[face.id] ?? null);
  const seen = new Set([face.id]);
  const queue = [face.id];
  while (queue.length) {
    const f = map.faces[queue.pop()];
    for (const cyc of f.cycles) {
      for (const h of cyc) {
        const e = map.edges[h >> 1];
        if (!acrossStrokes && strokes[e.id]) continue;
        const other = map.faceOfHalf[h ^ 1];
        if (other < 0 || seen.has(other)) continue;
        if (sameFill && JSON.stringify(fills[other] ?? null) !== key) continue;
        seen.add(other);
        queue.push(other);
      }
    }
  }
  return [...seen].map((id) => map.faces[id]);
}

// ---- making, merging, releasing ----

/** Fill area polygons of a leaf for "which object covers this point". */
function fillTest(doc, leaf) {
  const polys = leafSubpaths(doc, leaf).map((sp) => flattenPath(sp.anchors, true, 0.2).map((p) => [p.x, p.y]));
  const evenodd = leaf.type === 'compound' && leaf.fillRule === 'evenodd';
  return (x, y) => (evenodd ? pointInPolys(polys, x, y) : windingNumber(polys, x, y) !== 0);
}

/** Face entries taking the fill of the topmost of `leaves` covering each face. */
function fillsFromLeaves(doc, map, leaves, faces = map.faces) {
  const tests = leaves.filter((l) => l.fill).map((l) => ({ fill: l.fill, inside: fillTest(doc, l) }));
  const byFill = new Map();
  for (const f of faces) {
    const pts = facePoints(f);
    if (!pts.length) continue;
    const [x, y] = pts[0];
    let fill = null;
    for (let i = tests.length - 1; i >= 0; i--) {
      if (tests[i].inside(x, y)) {
        fill = tests[i].fill;
        break;
      }
    }
    if (!fill) continue;
    const key = JSON.stringify(fill);
    if (!byFill.has(key)) byFill.set(key, { fill, pts: [] });
    byFill.get(key).pts.push(...pts);
  }
  return [...byFill.values()];
}

/** Objects that can join a regions group: paths, compound paths and groups holding them. */
export function regionSource(doc, n) {
  if (!n || n.locked) return false;
  if (n.type === 'path' || n.type === 'compound') return true;
  if (n.type === 'group' && !n.live && !n.blend && !n.clip) return n.children.some((c) => regionSource(doc, doc.get(c)));
  return false;
}

/** Make a regions group (inside a transaction). Returns the group id or null. */
export function makeRegions(doc, ids, gaps = DEFAULT_GAPS) {
  const sorted = doc.sortByPaintOrder(ids).filter((id) => regionSource(doc, doc.get(id)));
  if (!sorted.length) return null;
  const top = doc.get(sorted[sorted.length - 1]);
  const parent = doc.get(top.parent);
  const index = parent.children.indexOf(top.id) + 1;
  const g = createGroup([], { live: { kind: 'paintRegions', faces: [], edges: [], gaps: { ...DEFAULT_GAPS, ...gaps } } });
  doc.insert(g, parent.id, index);
  for (const id of sorted) doc.move(id, g.id);
  const node = doc.get(g.id);
  const map = regionMap(doc, node);
  doc.update(g.id, { live: { ...node.live, faces: fillsFromLeaves(doc, map, regionLeaves(doc, node)) } });
  return g.id;
}

/** Merge objects into a regions group (inside a transaction): they go on top, their fills paint what they cover. */
export function mergeIntoRegions(doc, gid, ids) {
  const g = doc.get(gid);
  if (!isRegions(g)) return [];
  const sorted = doc.sortByPaintOrder(ids).filter((id) => id !== gid && !doc.isAncestor(gid, id) && regionSource(doc, doc.get(id)));
  for (const id of sorted) doc.move(id, gid);
  const node = doc.get(gid);
  const added = new Set(sorted);
  const leaves = regionLeaves(doc, node).filter((l) => {
    let n = l;
    while (n && n.id !== gid) {
      if (added.has(n.id)) return true;
      n = doc.get(n.parent);
    }
    return false;
  });
  const map = regionMap(doc, node);
  const entries = fillsFromLeaves(doc, map, leaves);
  if (entries.length) doc.update(gid, { live: { ...node.live, faces: [...(node.live.faces || []), ...entries] } });
  return sorted;
}

/** Release (inside a transaction): the paths go back to the parent, as they were. */
export function releaseRegions(doc, gid) {
  const g = doc.get(gid);
  if (!isRegions(g)) return [];
  const parent = doc.get(g.parent);
  let index = parent.children.indexOf(gid);
  const kids = g.children.slice();
  for (const c of kids) doc.move(c, parent.id, index++);
  doc.remove(gid);
  return kids;
}

/** Close the group's gaps with real (unpainted) paths (inside a transaction). Returns their ids. */
export function closeGapsWithPaths(doc, gid) {
  const g = doc.get(gid);
  if (!isRegions(g)) return [];
  const map = regionMap(doc, g);
  const out = [];
  for (const gp of map.gaps) {
    const c = gp.c;
    const p = createPath([{ x: c[0], y: c[1], ix: c[0], iy: c[1], ox: c[0], oy: c[1] }, { x: c[6], y: c[7], ix: c[6], iy: c[7], ox: c[6], oy: c[7] }], false, { fill: null, stroke: null, strokeWidth: 0 }, { name: 'Gap' });
    doc.insert(p, gid);
    out.push(p.id);
  }
  return out;
}
