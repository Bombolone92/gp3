/**
 * Brush strokes and variable-width strokes as live paths.
 *
 * A path or compound path with a brush (node.brush) or a width profile
 * (node.widthProfile) is live artwork: it draws its fill (a copy without
 * the stroke) and then the generated stroke artwork, while the selection
 * box, anchors and editing stay on the path itself. Clicking the artwork
 * selects the path. Expand (Object > Expand, Expand Appearance) replaces
 * the path by real objects: the fill and the stroke artwork grouped, or the
 * artwork alone when the path has no fill.
 */
import { registerLive, virtualId, liveExpansion } from '../../model/live.js';
import { effectiveSubpaths, isGeomEffectType, geomEffectsOf } from '../../model/geom-effects.js';
import { DEFAULT_STYLE } from '../../model/nodes.js';
import { brushById, resolveBrush } from './brush-model.js';
import { brushShapes, variableWidthShapes, hashString } from './generate.js';
import { isUniformProfile } from './width-profile.js';
import { nodeArrowheads, arrowTrim, trimAnchors } from '../paint/stroke-geometry.js';
// The built-in brushes (paths may name a library brush the document does not hold).
import './libraries.js';

const isShape = (n) => n.type === 'path' || n.type === 'compound';

/** Whether a node draws a variable-width stroke. */
export function hasWidthProfile(node) {
  return Boolean(node && isShape(node) && !node.brush?.id && node.widthProfile && !isUniformProfile(node.widthProfile) && node.stroke && node.strokeWidth > 0);
}

/** The outline a stroke follows, with open paths trimmed where arrowheads attach. */
export function strokeGeometry(doc, node) {
  const subpaths = effectiveSubpaths(doc, node);
  let arrows = [];
  if (node.type === 'path' && !node.closed && (node.arrowStart || node.arrowEnd) && subpaths.length === 1 && !geomEffectsOf(node)) {
    const t = arrowTrim(node);
    if (t.start || t.end) subpaths[0] = { anchors: trimAnchors(node.anchors, t.start, t.end), closed: false };
    arrows = nodeArrowheads(node);
  }
  return { subpaths, arrows };
}

const BASE = {
  ...DEFAULT_STYLE,
  name: '',
  hidden: false,
  locked: false,
  dash: [],
  effects: [],
  arrowStart: null,
  arrowEnd: null,
};

/** The path's fill drawn on its own (no stroke), or null without a fill. */
function fillCopy(node) {
  if (!node.fill) return null;
  const effects = (node.effects || []).filter((e) => isGeomEffectType(e.type));
  const { brush, widthProfile, brushPressure, ...rest } = node;
  return { ...rest, id: virtualId(node.id), source: node.id, stroke: null, strokeWidth: 0, opacity: 1, blendMode: 'normal', effects, arrowStart: null, arrowEnd: null };
}

/** Virtual nodes for generated shapes (a path, or a compound for several subpaths). */
function shapeNodes(shapes, node, extra) {
  const ids = [];
  for (const sh of shapes) {
    const { subpaths, ...style } = sh;
    const own = { ...BASE, ...style, source: node.id };
    let v;
    if (subpaths.length === 1) {
      v = { ...own, id: virtualId(node.id), type: 'path', anchors: subpaths[0].anchors, closed: subpaths[0].closed };
    } else {
      const id = virtualId(node.id);
      const kids = subpaths.map((s) => {
        const k = { id: virtualId(node.id), type: 'path', parent: id, name: '', anchors: s.anchors, closed: s.closed, hidden: false, locked: false, source: node.id };
        extra.set(k.id, k);
        return k.id;
      });
      v = { ...own, id, type: 'compound', fillRule: style.fillRule || 'nonzero', children: kids };
    }
    extra.set(v.id, v);
    ids.push(v.id);
  }
  return ids;
}

function strokeStyle(node) {
  return {
    stroke: node.stroke,
    strokeWidth: node.strokeWidth,
    strokeCap: node.strokeCap,
    strokeJoin: node.strokeJoin,
    miterLimit: node.miterLimit,
    strokeAlign: node.strokeAlign,
    dashOffset: node.dashOffset,
    widthProfile: node.widthProfile,
  };
}

/** Stroke artwork of a brushed path as shapes (also used for previews). */
export function brushArtworkShapes(doc, node, brush = resolveBrush(doc, node)) {
  if (!brush || !node.stroke) return [];
  const { subpaths } = strokeGeometry(doc, node);
  const seed = (node.brush?.seed ?? hashString(node.id || 'brush')) >>> 0;
  return brushShapes(subpaths, strokeStyle(node), brush, { seed, pressure: node.brushPressure });
}

/** Stroke artwork of a variable-width path as shapes. */
export function widthArtworkShapes(doc, node) {
  const { subpaths, arrows } = strokeGeometry(doc, node);
  const dash = node.dash?.length ? node.dash : null;
  return variableWidthShapes(subpaths, strokeStyle(node), { arrows, dash });
}

/** Expand a live stroke: fill + artwork in a group, or the artwork alone. */
function expandStroke(doc, node) {
  const sub = liveExpansion(doc, node);
  const root = sub.nodes.find((n) => n.id === sub.root);
  const parent = doc.get(node.parent);
  const index = parent ? parent.children.indexOf(node.id) : Infinity;
  doc.remove(node.id);
  if (root.children.length === 1) {
    // A single result replaces the path directly, keeping its name, opacity, blending and effects.
    const only = sub.nodes.find((n) => n.id === root.children[0]);
    const lifted = {
      ...only,
      name: node.name || '',
      opacity: (node.opacity ?? 1) * (only.opacity ?? 1),
      blendMode: node.blendMode || 'normal',
      effects: [...(root.effects || []), ...(only.effects || [])],
    };
    const rest = sub.nodes.filter((n) => n !== root && n !== only);
    return doc.importSubtree({ root: lifted.id, nodes: [lifted, ...rest] }, node.parent, index);
  }
  return doc.importSubtree(sub, node.parent, index);
}

registerLive('brush', {
  bounds: 'source',
  test: (n) => isShape(n) && Boolean(n.brush?.id),
  deps: (doc, n) => [brushById(doc, n.brush.id)],
  generate(doc, node) {
    const extra = new Map();
    const items = [];
    const fc = fillCopy(node);
    if (fc) {
      extra.set(fc.id, fc);
      items.push(fc.id);
    }
    const brush = resolveBrush(doc, node);
    if (!brush) {
      // A brush this document does not know: the plain stroke still shows.
      const { brush: _b, ...plain } = node;
      const v = { ...plain, id: virtualId(node.id), source: node.id, fill: null, opacity: 1, blendMode: 'normal', effects: (node.effects || []).filter((e) => isGeomEffectType(e.type)) };
      extra.set(v.id, v);
      items.push(v.id);
      return { items, extra };
    }
    items.push(...shapeNodes(brushArtworkShapes(doc, node, brush), node, extra));
    return { items, extra };
  },
  expand: expandStroke,
});

registerLive('variableWidth', {
  bounds: 'source',
  test: hasWidthProfile,
  generate(doc, node) {
    const extra = new Map();
    const items = [];
    const fc = fillCopy(node);
    if (fc) {
      extra.set(fc.id, fc);
      items.push(fc.id);
    }
    items.push(...shapeNodes(widthArtworkShapes(doc, node), node, extra));
    return { items, extra };
  },
  expand: expandStroke,
});
