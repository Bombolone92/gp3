/**
 * Geometry effects: live effects that change an object's outline at render
 * time (Round Corners, Roughen, Zig Zag, Warp, ...). The stored anchors never
 * change; the renderer, hit testing, visual bounds and the exporters all use
 * effectiveSubpaths(), and Expand Appearance bakes the result.
 *
 * Effects live in node.effects ([{ type, hidden?, ...params }], stacking
 * order) next to the raster effects. A feature module registers a type:
 *
 *   registerGeomEffect('roughen', {
 *     apply(subpaths, fx, info) -> subpaths    pure; subpaths are
 *                                             [{ anchors, closed, paint? }] in document space
 *     outset?(fx, info) -> number             extra reach beyond the result (rare)
 *     combine?(items, fx, info) -> items|null on a group: act on all of its
 *                                             artwork at once (Pathfinder), see
 *                                             live-effects.js
 *   })
 *
 * `info` is { bounds, node, doc, pending }: bounds are the geometric bounds
 * of the object before any geometry effect, or the bounds of the group the
 * effect was applied to (fx.frame), so a Warp on a group bends all of it as
 * one. An effect whose result is computed in the background (by the
 * geometry engine, or from font outlines still loading) returns a stand-in
 * and calls info.pending(): the result is then not cached, and once the
 * real one is ready the effect calls geomEffectsChanged() so everything
 * redraws with it.
 *
 * Painting: a result subpath may carry `paint`, a style patch that replaces
 * the object's own paint for that outline. Values of `fill` and `stroke` are
 * paints or null, or the strings 'fill' / 'stroke' for the object's own fill
 * or stroke paint. Scribble draws its hatching as lines stroked with the
 * object's fill ({ fill: null, stroke: 'fill', strokeWidth }) and keeps the
 * outline for the stroke only ({ fill: null }). paintParts() groups the
 * outlines by paint for the renderer, the exporters and Expand Appearance.
 * Effects that rebuild outlines keep `paint` by spreading the input subpath.
 */
import { pathBounds } from './bezier.js';
import { roundCornerAnchors } from './round-corners.js';
import { applyCorners, hasCorners } from './corners.js';

const TYPES = new Map();

export function registerGeomEffect(type, def) {
  TYPES.set(type, def);
}

export function isGeomEffectType(type) {
  return TYPES.has(type);
}

/** Live corners (model/corners.js) act as an implicit first geometry effect. */
const CORNERS_FX = Object.freeze({ type: 'liveCorners' });
const cornered = new WeakMap();
function pathHasCorners(node) {
  if (node?.type !== 'path' || !node.anchors) return false;
  let v = cornered.get(node);
  if (v === undefined) cornered.set(node, (v = hasCorners(node.anchors)));
  return v;
}

/** Visible geometry effects of a node, in stacking order. */
export function geomEffectsOf(node) {
  const fx = node?.effects;
  let out = pathHasCorners(node) ? [CORNERS_FX] : null;
  if (!fx || !fx.length) return out;
  for (const e of fx) {
    if (e && !e.hidden && TYPES.has(e.type)) (out ||= []).push(e);
  }
  return out;
}

export function hasGeomEffects(node) {
  return Boolean(geomEffectsOf(node));
}

/** A node's own subpaths [{ anchors, closed }] (path or compound). */
export function baseSubpaths(doc, node) {
  if (node.type === 'path') return [{ anchors: node.anchors, closed: node.closed }];
  if (node.type === 'compound') {
    const out = [];
    for (const c of node.children) {
      const k = doc.get(c);
      if (k?.anchors) out.push({ anchors: k.anchors, closed: k.closed });
    }
    return out;
  }
  return [];
}

export function subpathsBounds(subs) {
  let b = null;
  for (const s of subs) {
    const r = s.anchors.length ? pathBounds(s.anchors, s.closed) : null;
    if (!r) continue;
    if (!b) b = { ...r };
    else {
      const x = Math.min(b.x, r.x);
      const y = Math.min(b.y, r.y);
      b = { x, y, w: Math.max(b.x + b.w, r.x + r.w) - x, h: Math.max(b.y + b.h, r.y + r.h) - y };
    }
  }
  return b;
}

let cache = new WeakMap();
let token = {};
const listeners = new Set();

/** The registered definition of a geometry effect type, or null. */
export function geomEffectDef(type) {
  return TYPES.get(type) || null;
}

/**
 * Results computed in the background are ready: forget cached results and
 * tell listeners (the canvas views) to redraw.
 */
export function geomEffectsChanged() {
  cache = new WeakMap();
  token = {};
  for (const fn of listeners) fn();
}

/** Listen for geomEffectsChanged(). Returns an unsubscribe function. */
export function onGeomEffectsChanged(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** An object that is replaced whenever geomEffectsChanged() runs (a live artwork dependency). */
export function geomEffectsToken() {
  return token;
}

/** Subpaths as rendered: the node's geometry with its geometry effects applied (cached). */
export function effectiveSubpaths(doc, node) {
  const base = baseSubpaths(doc, node);
  const fx = geomEffectsOf(node);
  if (!fx) return base;
  const kids = node.type === 'compound' ? node.children.map((c) => doc.get(c)) : null;
  const hit = cache.get(node);
  if (hit && (!kids || (hit.kids.length === kids.length && hit.kids.every((k, i) => k === kids[i])))) return hit.subs;
  const own = subpathsBounds(base);
  let subs = base;
  let provisional = false;
  const pending = () => {
    provisional = true;
  };
  for (const e of fx) {
    const bounds = e.frame || own;
    if (!bounds) break;
    try {
      const r = TYPES.get(e.type).apply(subs, e, { bounds, node, doc, pending });
      if (Array.isArray(r)) subs = r.filter((s) => s && s.anchors && s.anchors.length);
    } catch (err) {
      console.warn(`Effect ${e.type} failed`, err);
    }
  }
  if (!provisional) cache.set(node, { kids: kids || [], subs });
  return subs;
}

/** Extra reach of geometry effects past their result (for visual bounds). */
export function geomEffectsOutset(node, bounds) {
  let d = 0;
  for (const e of geomEffectsOf(node) || []) {
    const o = TYPES.get(e.type).outset?.(e, { bounds, node });
    if (o > d) d = o;
  }
  return d;
}

/**
 * Outlines grouped by how they paint, in paint order: [{ style, subpaths }]
 * where `style` patches the object's own style (resolved paints), or null
 * when every outline paints with the object's own fill and stroke.
 */
export function paintParts(node, subs) {
  if (!subs.some((s) => s.paint)) return null;
  const parts = new Map();
  for (const s of subs) {
    const key = s.paint ? JSON.stringify(s.paint) : '';
    let part = parts.get(key);
    if (!part) parts.set(key, (part = { style: resolvePaint(node, s.paint), subpaths: [] }));
    part.subpaths.push(s);
  }
  return [...parts.values()];
}

function resolvePaint(node, paint) {
  const out = {};
  if (!paint) return out;
  for (const [k, v] of Object.entries(paint)) {
    if ((k === 'fill' || k === 'stroke') && (v === 'fill' || v === 'stroke')) out[k] = node[v] ?? null;
    else out[k] = v;
  }
  return out;
}

registerGeomEffect('roundCorners', {
  apply(subs, fx) {
    const r = Math.max(0, fx.radius || 0);
    if (!r) return subs;
    return subs.map((s) => ({ ...s, anchors: roundCornerAnchors(s.anchors, s.closed, r) }));
  },
});

registerGeomEffect('liveCorners', {
  apply: (subs) => subs.map((s) => ({ ...s, anchors: applyCorners(s.anchors, s.closed) })),
});
