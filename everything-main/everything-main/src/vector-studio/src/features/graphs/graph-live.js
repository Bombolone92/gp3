/**
 * Graphs as live artwork.
 *
 * A graph is a group with live = { kind: 'graph', type, data, options,
 * frame: { w, h }, matrix }. Its children are one "series key" path per
 * series (named after the series): the key's paint (fill, stroke, stroke
 * weight, opacity) is the series style, so selecting a series with the
 * Group Selection tool (every generated mark names its key as `source`)
 * and recoloring it changes every column, wedge, line and marker of that
 * series. Keys sit where the legend swatches are drawn.
 *
 * The scene from graph-math.js is laid out in the graph's frame and mapped
 * into the document by `matrix`, which transforms follow (moving, scaling,
 * rotating a graph keeps it live). Column and marker designs come from the
 * document's graph designs (root.graphDesigns).
 */
import { registerLive, virtualId } from '../../model/live.js';
import { transformAnchors } from '../../model/bezier.js';
import { multiply, apply } from '../../lib/matrix.js';
import { DEFAULT_CHAR, DEFAULT_PARA, DEFAULT_STYLE, pickStyle } from '../../model/nodes.js';
import { layoutText } from '../../model/text-layout.js';
import { layoutGraph, graphOptions, rectAnchors, SERIES_PALETTE } from './graph-math.js';

export const isGraph = (n) => n?.type === 'group' && n.live?.kind === 'graph';

const AXIS = { type: 'solid', color: '#000000' };
const GRID = { type: 'solid', color: '#a6a6a6' };

/** Width of a label in the graph's type (measured with the text engine). */
export function measureLabel(text, size) {
  const lay = layoutText({ type: 'text', kind: 'point', text: String(text), x: 0, y: 0, width: 0, height: 0, transform: [1, 0, 0, 1, 0, 0], char: { ...DEFAULT_CHAR, fontSize: size }, para: { ...DEFAULT_PARA } });
  return lay.bounds?.w || String(text).length * size * 0.55;
}

/** The scene of a graph node (cached per node object). */
const sceneCache = new WeakMap();
export function graphScene(node) {
  let s = sceneCache.get(node);
  if (!s) {
    s = layoutGraph(node.live, measureLabel);
    sceneCache.set(node, s);
  }
  return s;
}

function shapeNode(id, anchors, closed, style, extra = {}) {
  return { id, type: 'path', name: '', anchors, closed, hidden: false, locked: false, ...DEFAULT_STYLE, ...style, ...extra };
}

function textNode(id, t, M, fontSize) {
  return {
    id,
    type: 'text',
    name: '',
    kind: 'point',
    text: t.text,
    x: t.x,
    y: t.y,
    width: 0,
    height: 0,
    transform: M,
    char: { ...DEFAULT_CHAR, fontSize },
    para: { ...DEFAULT_PARA, align: t.align || 'left' },
    hidden: false,
    locked: false,
    ...DEFAULT_STYLE,
    fill: { type: 'solid', color: '#000000' },
    stroke: null,
    strokeWidth: 0,
  };
}

/** The style a series key gives its marks. */
function seriesStyle(key, fallback) {
  if (!key) return { fill: { type: 'solid', color: fallback }, stroke: null, strokeWidth: 0 };
  const st = pickStyle(key);
  return { ...st, effects: st.effects || [] };
}

function lineStyle(key, fallback, opt) {
  const st = seriesStyle(key, fallback);
  const stroked = st.stroke && st.strokeWidth > 0;
  const paint = stroked ? st.stroke : st.fill?.type === 'solid' ? st.fill : { type: 'solid', color: fallback };
  return { ...st, fill: null, stroke: paint, strokeWidth: stroked ? st.strokeWidth : Math.max(1, opt.lineWidth / 2), strokeJoin: 'round', strokeCap: 'round' };
}

// ---- designs ----

/** Graph designs stored in the document. */
export function graphDesigns(doc) {
  return doc.root?.graphDesigns || [];
}

/**
 * Virtual copies of a design's artwork with every point mapped by `map`
 * (x, y) -> {x, y}; type and images use the affine `M`.
 */
function placeDesign(design, map, M, extra, source) {
  const byId = new Map(design.nodes.map((n) => [n.id, n]));
  const mapA = (anchors) =>
    anchors.map((a) => {
      const p = map(a.x, a.y);
      const i = map(a.ix, a.iy);
      const o = map(a.ox, a.oy);
      return { ...a, x: p.x, y: p.y, ix: i.x, iy: i.y, ox: o.x, oy: o.y };
    });
  const copy = (id) => {
    const n = byId.get(id);
    if (!n) return null;
    const vid = virtualId('gd');
    let v;
    if (n.type === 'path') v = { ...n, id: vid, anchors: mapA(n.anchors), shape: undefined };
    else if (n.type === 'compound') v = { ...n, id: vid, children: n.children.map(copy).filter(Boolean) };
    else if (n.type === 'group') v = { ...n, id: vid, children: n.children.map(copy).filter(Boolean), live: undefined, blend: undefined };
    else if (n.type === 'text' || n.type === 'image') v = { ...n, id: vid, transform: multiply(M, n.transform) };
    else return null;
    if (source) v.source = source;
    extra.set(vid, v);
    return vid;
  };
  return copy(design.root);
}

/** Design artwork for one bar: virtual ids in paint order. */
function designBar(design, bar, spec, M, extra, source) {
  const b = design.bounds;
  if (!b || b.w <= 0 || b.h <= 0) return [];
  const r = bar.rect;
  // Frame: base corner, across vector and growth vector in the graph frame.
  let base;
  let across;
  let growth;
  if (bar.horizontal) {
    const len = r.w;
    base = bar.negative ? { x: r.x + r.w, y: r.y + r.h } : { x: r.x, y: r.y + r.h };
    across = { x: 0, y: -r.h };
    growth = { x: bar.negative ? -len : len, y: 0 };
  } else {
    base = bar.negative ? { x: r.x, y: r.y } : { x: r.x, y: r.y + r.h };
    across = { x: r.w, y: 0 };
    growth = { x: 0, y: bar.negative ? r.h : -r.h };
  }
  const L = Math.hypot(growth.x, growth.y);
  if (L < 1e-6) return [];
  const gdir = { x: growth.x / L, y: growth.y / L };
  const A = Math.hypot(across.x, across.y);
  const at = (u, d) => ({ x: base.x + u * across.x + d * gdir.x, y: base.y + u * across.y + d * gdir.y });
  const norm = (x, y) => ({ u: (x - b.x) / b.w, v: (b.y + b.h - y) / b.h });
  const affine = (u0, d0, ux, dy) => {
    // Matrix mapping design coordinates to the graph frame, then the document.
    const sx = ux / b.w;
    const sy = dy / b.h;
    const m = [across.x * sx, across.y * sx, -gdir.x * sy, -gdir.y * sy, 0, 0];
    const o = at(u0, d0);
    m[4] = o.x - (m[0] * b.x + m[2] * (b.y + b.h));
    m[5] = o.y - (m[1] * b.x + m[3] * (b.y + b.h));
    return multiply(M, m);
  };
  const toDoc = (p) => apply(M, p.x, p.y);
  const mode = spec.mode || 'vertical';
  const out = [];
  if (mode === 'uniform') {
    const k = L / b.h;
    const wFrac = (b.w * k) / A;
    const u0 = 0.5 - wFrac / 2;
    const map = (x, y) => {
      const { u, v } = norm(x, y);
      return toDoc(at(u0 + u * wFrac, v * L));
    };
    out.push(placeDesign(design, map, affine(u0, 0, wFrac, L), extra, source));
  } else if (mode === 'repeat') {
    const unit = Math.max(1e-9, Number(spec.unit) || 1);
    const value = Math.abs(bar.value);
    const perLen = (L / value) * unit;
    const count = value / unit;
    const whole = Math.floor(count + 1e-9);
    const frac = count - whole;
    const ids = [];
    for (let i = 0; i < whole + (frac > 1e-6 ? 1 : 0); i++) {
      const last = i === whole;
      const len = last && spec.fraction !== 'chop' ? perLen * frac : perLen;
      const d0 = i * perLen;
      const map = (x, y) => {
        const { u, v } = norm(x, y);
        return toDoc(at(u, d0 + v * len));
      };
      ids.push(placeDesign(design, map, affine(0, d0, 1, len), extra, source));
    }
    if (frac > 1e-6 && spec.fraction === 'chop') {
      // Cut the last design at the end of the column.
      const clipId = virtualId('gd');
      extra.set(clipId, shapeNode(clipId, transformAnchors(rectAnchors(r.x, r.y, r.w, r.h), M), true, { fill: null, stroke: null }));
      const gid = virtualId('gd');
      extra.set(gid, { id: gid, type: 'group', name: '', clip: true, children: [...ids.filter(Boolean), clipId], hidden: false, locked: false, source });
      out.push(gid);
    } else out.push(...ids);
  } else if (mode === 'sliding') {
    const nat = b.h * (A / b.w);
    const slide = spec.slide ?? 0.5;
    const map = (x, y) => {
      const { u, v } = norm(x, y);
      const d = v <= slide ? v * nat : L - (1 - v) * nat;
      return toDoc(at(u, d));
    };
    out.push(placeDesign(design, map, affine(0, 0, 1, L), extra, source));
  } else {
    const map = (x, y) => {
      const { u, v } = norm(x, y);
      return toDoc(at(u, v * L));
    };
    out.push(placeDesign(design, map, affine(0, 0, 1, L), extra, source));
  }
  return out.filter(Boolean);
}

/** Design artwork fitted (aspect kept) into a rect of the graph frame. */
function designInRect(design, rect, M, extra, source) {
  const b = design.bounds;
  if (!b || b.w <= 0 || b.h <= 0) return null;
  const k = Math.min(rect.w / b.w, rect.h / b.h);
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const m = multiply(M, [k, 0, 0, k, cx - (b.x + b.w / 2) * k, cy - (b.y + b.h / 2) * k]);
  return placeDesign(design, (x, y) => apply(m, x, y), m, extra, source);
}

// ---- generation ----

export function generateGraph(doc, node) {
  const live = node.live;
  const opt = graphOptions(live.options);
  const M = live.matrix || [1, 0, 0, 1, 0, 0];
  const scene = graphScene(node);
  const keys = node.children.map((id) => doc.get(id));
  const designs = new Map(graphDesigns(doc).map((d) => [d.id, d]));
  const extra = new Map();
  const items = [];
  const add = (v) => {
    extra.set(v.id, v);
    items.push(v.id);
    return v.id;
  };
  const palette = (i) => SERIES_PALETTE[i % SERIES_PALETTE.length];
  const vid = () => virtualId(node.id);
  // Gridlines first, then shadows and marks, then axes, ticks and labels on top.
  for (const l of scene.lines) if (l.role === 'grid') add(shapeNode(vid(), transformAnchors(l.anchors, M), Boolean(l.closed), { fill: null, stroke: GRID, strokeWidth: 0.5 }));
  for (const s of scene.shadow) add(shapeNode(vid(), transformAnchors(s.anchors.map((a) => ({ ...a, x: a.x + 3, y: a.y + 3, ix: a.ix + 3, iy: a.iy + 3, ox: a.ox + 3, oy: a.oy + 3 })), M), s.closed, { fill: { type: 'solid', color: '#000000' }, stroke: null, strokeWidth: 0 }));
  const barsByMark = new Map(scene.bars.map((b) => [b.rect, b]));
  for (const m of scene.marks) {
    const key = keys[m.series];
    const source = key?.id || null;
    const spec = opt.series[m.series] || {};
    if (m.role === 'fill' && m.rect && spec.column?.design && designs.has(spec.column.design)) {
      const bar = barsByMark.get(m.rect);
      if (bar) {
        for (const id of designBar(designs.get(spec.column.design), bar, spec.column, M, extra, source)) items.push(id);
        continue;
      }
    }
    if (m.role === 'marker' && spec.marker?.design && designs.has(spec.marker.design)) {
      const r = m.rect;
      const big = { x: r.x - r.w * 0.25, y: r.y - r.h * 0.25, w: r.w * 1.5, h: r.h * 1.5 };
      const id = designInRect(designs.get(spec.marker.design), big, M, extra, source);
      if (id) items.push(id);
      continue;
    }
    const style = m.role === 'line' ? lineStyle(key, palette(m.series), opt) : seriesStyle(key, palette(m.series));
    add(shapeNode(vid(), transformAnchors(m.anchors, M), m.closed, style, { source }));
  }
  for (const l of scene.lines) if (l.role !== 'grid') add(shapeNode(vid(), transformAnchors(l.anchors, M), Boolean(l.closed), { fill: null, stroke: AXIS, strokeWidth: l.role === 'axis' ? 0.75 : 0.5 }));
  for (const lg of scene.legend) {
    const key = keys[lg.series];
    const spec = opt.series[lg.series] || {};
    const design = spec.column?.design && designs.get(spec.column.design);
    const marker = spec.marker?.design && designs.get(spec.marker.design);
    if (design || marker) {
      const id = designInRect(design || marker, lg.rect, M, extra, key?.id || null);
      if (id) items.push(id);
    } else add(shapeNode(vid(), transformAnchors(rectAnchors(lg.rect.x, lg.rect.y, lg.rect.w, lg.rect.h), M), true, seriesStyle(key, palette(lg.series)), { source: key?.id || null }));
    add(textNode(vid(), lg.label, M, opt.fontSize));
  }
  for (const t of scene.texts) add(textNode(vid(), t, M, opt.fontSize));
  return { items, extra };
}

registerLive('graph', {
  label: '<Graph>',
  test: isGraph,
  generate: generateGraph,
  deps: (doc, node) => (Object.values(node.live.options?.series || {}).some((s) => s?.column?.design || s?.marker?.design) ? [doc.root] : []),
  transformParams(node, m) {
    return { live: { ...node.live, matrix: multiply(m, node.live.matrix || [1, 0, 0, 1, 0, 0]) } };
  },
});
