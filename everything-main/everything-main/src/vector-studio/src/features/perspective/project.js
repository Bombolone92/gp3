/**
 * Objects in perspective as live artwork: the group's flat children are
 * projected through their plane, so drawing, bounds, hit testing, export
 * and Expand all see the artwork in perspective.
 *
 * Paths and compound paths project anchor by anchor (geometry effects are
 * applied in flat space first); strokes, dashes and gradient end points
 * scale with the depth at the object. Type projects as glyph outlines once
 * its font outlines are loaded and as the best matching affine copy until
 * then; images use the affine copy. Symbol instances and other live
 * artwork project their generated result.
 *
 * Generated nodes name the perspective object as their `source`, so a click
 * anywhere on the projected artwork picks the object itself.
 */
import { registerLive, virtualId, liveDef, liveArtwork } from '../../model/live.js';
import { effectiveSubpaths, subpathsBounds, isGeomEffectType } from '../../model/geom-effects.js';
import { nodeBounds } from '../../model/geometry.js';
import { apply, invert, multiply, translate } from '../../lib/matrix.js';
import { projectAnchors, toDoc, toFlat, localScale, localAffine, jacobian } from './grid-math.js';
import { KIND, gridOf, frameOfObject, flatBounds } from './model.js';

// ---- type outlines (loaded asynchronously, see setOutlineLoader) ----

const outlines = new WeakMap(); // text node -> { state: 'pending'|'ready'|'failed', group?, nodes? }
const readyListeners = new Set();
let loader = null;

/** Install the glyph outline loader: (textNode) => Promise<{ group, descendants }>. */
export function setOutlineLoader(fn) {
  loader = fn;
}

/** Call fn whenever some type finished loading its outlines (to redraw). */
export function onOutlinesReady(fn) {
  readyListeners.add(fn);
  return () => readyListeners.delete(fn);
}

function outlineEntry(text) {
  let e = outlines.get(text);
  if (e) return e;
  if (!loader) return null;
  e = { state: 'pending' };
  outlines.set(text, e);
  Promise.resolve()
    .then(() => loader(text))
    .then(
      (r) => {
        const nodes = new Map();
        for (const n of r.descendants) nodes.set(n.id, n);
        nodes.set(r.group.id, r.group);
        outlines.set(text, { state: 'ready', group: r.group, nodes });
      },
      () => outlines.set(text, { state: 'failed' }),
    )
    .then(() => {
      for (const fn of readyListeners) fn();
    });
  return e;
}

// ---- projection ----

const STRIP_LIVE = (n) => {
  const { live, blend, symbol, transform, ...plain } = n;
  return plain;
};

const rasterEffects = (fx) => (fx || []).filter((e) => !isGeomEffectType(e.type));

function projectPaint(paint, frame, s) {
  if (!paint || (paint.type !== 'linear' && paint.type !== 'radial') || paint.x1 === undefined) return paint;
  const a = toDoc(frame, paint.x1, paint.y1);
  const b = toDoc(frame, paint.x2, paint.y2);
  const out = { ...paint, x1: a.x, y1: a.y, x2: b.x, y2: b.y };
  if (paint.r !== undefined) out.r = paint.r * s;
  return out;
}

function projectStyle(n, frame, center) {
  const s = localScale(frame, center.x, center.y);
  const out = { fill: projectPaint(n.fill, frame, s), stroke: projectPaint(n.stroke, frame, s), effects: rasterEffects(n.effects) };
  if (n.strokeWidth) out.strokeWidth = n.strokeWidth * s;
  if (n.dash?.length) out.dash = n.dash.map((v) => v * s);
  if (n.dashOffset) out.dashOffset = n.dashOffset * s;
  return out;
}

const centerOf = (b) => (b ? { x: b.x + b.w / 2, y: b.y + b.h / 2 } : { x: 0, y: 0 });

/** Project one flat node; returns the id of its virtual copy (or null). */
function projectNode(view, n, frame, ctx) {
  if (!n || n.hidden) return null;
  const reg = (v) => {
    v.id = virtualId(n.id);
    v.source = ctx.source;
    ctx.extra.set(v.id, v);
    return v.id;
  };
  if (liveDef(n)) {
    // Symbol instances, blends and other live artwork: project what they generate.
    const { items, vdoc } = liveArtwork(view, n);
    const kids = items.map((it) => projectNode(vdoc, it, frame, ctx)).filter(Boolean);
    return reg({ ...STRIP_LIVE(n), type: 'group', clip: false, children: kids, effects: rasterEffects(n.effects) });
  }
  switch (n.type) {
    case 'path':
    case 'compound': {
      const subs = effectiveSubpaths(view, n);
      if (!subs.length) return null;
      const style = projectStyle(n, frame, centerOf(subpathsBounds(subs)));
      if (n.type === 'path' && subs.length === 1) {
        return reg({ ...n, ...style, anchors: projectAnchors(frame, subs[0].anchors, subs[0].closed), closed: subs[0].closed, shape: undefined });
      }
      const v = { ...n, ...style, type: 'compound', fillRule: n.fillRule || 'nonzero', anchors: undefined, closed: undefined, shape: undefined, children: [] };
      const id = reg(v);
      for (const sp of subs) {
        const c = { id: virtualId(n.id), type: 'path', parent: id, anchors: projectAnchors(frame, sp.anchors, sp.closed), closed: sp.closed, fill: null, stroke: null, hidden: false, source: ctx.source };
        ctx.extra.set(c.id, c);
        v.children.push(c.id);
      }
      return id;
    }
    case 'group': {
      const kids = n.children.map((c) => projectNode(view, view.get(c), frame, ctx)).filter(Boolean);
      return reg({ ...n, children: kids });
    }
    case 'text': {
      const e = outlineEntry(n);
      if (e?.state === 'ready') {
        const glyphView = { get: (id) => e.nodes.get(id) || view.get(id), has: (id) => e.nodes.has(id) || view.has(id), root: view.root, assets: view.assets, artboards: view.artboards };
        return projectNode(glyphView, e.group, frame, ctx);
      }
      return affineCopy(view, n, frame, reg);
    }
    case 'image':
      return affineCopy(view, n, frame, reg);
    default:
      return null;
  }
}

/** Type and images draw through the affine map that matches the plane at their center. */
function affineCopy(view, n, frame, reg) {
  const c = centerOf(nodeBounds(view, n));
  const A = localAffine(frame, c.x, c.y);
  const v = { ...n, transform: multiply(A, n.transform || [1, 0, 0, 1, 0, 0]) };
  // Strokes of type are drawn inside its transform, which scales them already.
  const s = localScale(frame, c.x, c.y);
  if (n.type === 'text') Object.assign(v, { fill: projectPaint(n.fill, frame, s), stroke: projectPaint(n.stroke, frame, s) });
  v.effects = rasterEffects(n.effects);
  return reg(v);
}

/** Nodes whose replacement must regenerate a perspective object besides its own subtree. */
function extraDeps(doc, node, out) {
  for (const c of node.children || []) {
    const n = doc.get(c);
    if (!n) continue;
    if (n.type === 'text') {
      const e = outlineEntry(n);
      if (e) out.push(e);
    }
    const def = liveDef(n);
    if (def?.deps) {
      try {
        for (const d of def.deps(doc, n) || []) if (d) out.push(d);
      } catch {
        // The nested object reports its own failure.
      }
    }
    if (n.children) extraDeps(doc, n, out);
  }
  return out;
}

/**
 * A document transform applied to a perspective object, in its own plane:
 * the object's center follows the transform on the page, and the linear
 * part is carried into flat space through the plane's local scale.
 */
export function flatMatrixFor(doc, node, m) {
  const frame = frameOfObject(doc, node);
  const fb = flatBounds(doc, node);
  if (!fb) return null;
  const c = centerOf(fb);
  const cd = toDoc(frame, c.x, c.y);
  const nd = apply(m, cd.x, cd.y);
  const nf = toFlat(frame, nd.x, nd.y) || c;
  const pure = Math.abs(m[0] - 1) < 1e-12 && Math.abs(m[3] - 1) < 1e-12 && Math.abs(m[1]) < 1e-12 && Math.abs(m[2]) < 1e-12;
  let L = [1, 0, 0, 1, 0, 0];
  if (!pure) {
    const J = jacobian(frame.H, c.x, c.y);
    if (J) {
      const Jm = [J[0], J[1], J[2], J[3], 0, 0];
      L = multiply(invert(Jm), multiply([m[0], m[1], m[2], m[3], 0, 0], Jm));
    }
  }
  return multiply(translate(nf.x, nf.y), multiply(L, translate(-c.x, -c.y)));
}

registerLive(KIND, {
  label: '<Perspective>',
  // Children are stored flat, in their plane: outlines, snapping and
  // marquee selection use the projected artwork.
  ownSpace: true,
  deps: (doc, node) => extraDeps(doc, node, [gridOf(doc)]),
  generate(doc, node) {
    const frame = frameOfObject(doc, node);
    const ctx = { extra: new Map(), source: node.id };
    const items = [];
    for (const c of node.children) {
      const id = projectNode(doc, doc.get(c), frame, ctx);
      if (id) items.push(id);
    }
    return { items, extra: ctx.extra };
  },
  transform(doc, node, m) {
    const matrix = flatMatrixFor(doc, node, m);
    return matrix ? { patch: null, matrix } : null;
  },
});

/** Projected document outline anchors of every path under a node (for overlays): [{ anchors, closed }]. */
export function projectedOutlines(doc, node) {
  const { items, vdoc } = liveArtwork(doc, node);
  const out = [];
  const visit = (n) => {
    if (!n || n.hidden) return;
    if (n.type === 'path') out.push({ anchors: n.anchors, closed: n.closed });
    else if (n.children) for (const c of n.children) visit(vdoc.get(c));
    else if ((n.type === 'text' || n.type === 'image') && n.transform) {
      const b = n.type === 'image' ? { x: 0, y: 0, w: n.width, h: n.height } : null;
      if (b) out.push({ anchors: rectAnchors(b, n.transform), closed: true });
      else {
        const nb = nodeBounds(vdoc, { ...n, transform: [1, 0, 0, 1, 0, 0] });
        if (nb) out.push({ anchors: rectAnchors(nb, n.transform), closed: true });
      }
    }
  };
  for (const it of items) visit(it);
  return out;
}

function rectAnchors(b, m) {
  return [
    [b.x, b.y],
    [b.x + b.w, b.y],
    [b.x + b.w, b.y + b.h],
    [b.x, b.y + b.h],
  ].map(([x, y]) => {
    const p = apply(m, x, y);
    return { x: p.x, y: p.y, ix: p.x, iy: p.y, ox: p.x, oy: p.y };
  });
}
