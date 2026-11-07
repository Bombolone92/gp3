/**
 * 3D effects as live artwork. A path, compound path, group or type object
 * with a visible 3D effect record (node.effects, type 'threeD') draws the
 * generated faces instead of itself; the object keeps its own geometry for
 * editing, so changing the outline, the type or the group's contents
 * rebuilds the 3D result. The selection box stays on the source artwork;
 * clicking a face selects the object (in a group: the object the face was
 * made from). Object > Expand / Expand Appearance give a group of the
 * faces; the exporters write them through the live framework.
 *
 * Geometry effects on the object (Roughen, Warp, ...) shape the outline
 * before it is turned into a solid; raster effects (shadows, glows) apply
 * to the finished 3D artwork.
 */
import { registerLive, virtualId, liveExpansion } from '../../model/live.js';
import { effectiveSubpaths, geomEffectsOf, geomEffectDef, geomEffectsToken, subpathsBounds } from '../../model/geom-effects.js';
import { shapeItems, shapeHooks } from '../../model/live-effects.js';
import { pickStyle, DEFAULT_STYLE } from '../../model/nodes.js';
import { layoutText } from '../../model/text-layout.js';
import { threeDOf, EFFECT_TYPE } from './params.js';
import { buildModels, renderModels } from './scene.js';

let draft = false;

/** Lower detail and quick depth sorting while the user drags a 3D control. */
export function setDraft(on) {
  draft = Boolean(on);
}

export function isDraft() {
  return draft;
}

const SHAPE_TYPES = new Set(['path', 'compound', 'group', 'text']);

export function hasThreeD(node) {
  return Boolean(node && SHAPE_TYPES.has(node.type) && threeDOf(node));
}

/** The object's other geometry effects applied to items across their joint bounds. */
function withGeomEffects(doc, node, items) {
  const fx = geomEffectsOf(node);
  if (!fx || !items.length) return items;
  const frame = subpathsBounds(items.flatMap((it) => it.subpaths));
  if (!frame) return items;
  let out = items;
  for (const e of fx) {
    const def = geomEffectDef(e.type);
    const info = { bounds: e.frame || frame, node, doc, pending: () => {} };
    try {
      if (def.combine) {
        const r = def.combine(out, e, info);
        if (!r) break;
        out = r;
      } else {
        out = out.map((it) => {
          const subs = def.apply(it.subpaths, e, info);
          return Array.isArray(subs) ? { ...it, subpaths: subs.filter((s) => s?.anchors?.length) } : it;
        });
      }
    } catch (err) {
      console.warn(`Effect ${e.type} failed`, err);
    }
  }
  return out;
}

/**
 * The shapes a 3D effect is built from: [{ style, subpaths, fillRule,
 * source }] in paint order, or null while type outlines are loading.
 */
export function sourceItems(doc, node) {
  if (node.type === 'path' || node.type === 'compound') {
    const subpaths = effectiveSubpaths(doc, node).filter((s) => s.anchors.length > 1);
    const style = { ...pickStyle(node), effects: [], opacity: 1, blendMode: 'normal' };
    return subpaths.length ? [{ style, subpaths, fillRule: node.fillRule || 'nonzero', source: node.id }] : [];
  }
  if (node.type === 'text') {
    layoutText(node);
    const runs = shapeHooks.text ? shapeHooks.text(doc, node) : null;
    if (!runs) return null;
    return withGeomEffects(doc, node, runs.map((r) => ({ ...r, source: node.id })));
  }
  if (node.type === 'group') return withGeomEffects(doc, node, shapeItems(doc, node));
  return [];
}

const pt = (p) => ({ x: p[0], y: p[1], ix: p[0], iy: p[1], ox: p[0], oy: p[1] });

const BASE = { ...DEFAULT_STYLE, name: '', hidden: false, locked: false, dash: [], effects: [], arrowStart: null, arrowEnd: null };

/** A virtual path or compound path for rings. */
function shapeNode(node, rings, closed, style, extra) {
  if (rings.length === 1) {
    const v = { ...BASE, ...style, id: virtualId(node.id), type: 'path', anchors: rings[0].map(pt), closed: closed[0] };
    extra.set(v.id, v);
    return v.id;
  }
  const id = virtualId(node.id);
  const kids = rings.map((r, i) => {
    const k = { id: virtualId(node.id), type: 'path', parent: id, name: '', anchors: r.map(pt), closed: closed[i], hidden: false, locked: false };
    extra.set(k.id, k);
    return k.id;
  });
  const v = { ...BASE, ...style, id, type: 'compound', fillRule: style.fillRule || 'nonzero', children: kids };
  extra.set(v.id, v);
  return v.id;
}

/** The generated faces as { items, extra } for the live framework. */
export function threeDArtwork(doc, node, opts = {}) {
  const extra = new Map();
  const fx = opts.fx || threeDOf(node)?.fx;
  if (!fx) return { items: [], extra };
  const items = sourceItems(doc, node);
  if (!items) {
    // Type outlines are still loading: show the type itself until they arrive.
    const plain = { ...node, id: virtualId(node.id), source: node.id, effects: [], opacity: 1, blendMode: 'normal' };
    extra.set(plain.id, plain);
    return { items: [plain.id], extra };
  }
  const scene = buildModels(items, fx, { draft: opts.draft ?? draft });
  if (!scene) return { items: [], extra };
  const out = renderModels(scene, fx, { draft: opts.draft ?? draft });
  const ids = [];
  if (out.shadow) {
    const closed = out.shadow.rings.map(() => true);
    ids.push(shapeNode(node, out.shadow.rings, closed, { fill: { type: 'solid', color: '#000000' }, stroke: null, strokeWidth: 0, opacity: out.shadow.opacity, fillRule: 'nonzero', source: node.id }, extra));
  }
  for (const f of out.faces) {
    if (out.flat) {
      ids.push(shapeNode(node, f.rings, f.closed, { ...f.style, fillRule: f.fillRule, source: f.source }, extra));
      continue;
    }
    const style = {
      fill: f.fill,
      stroke: f.stroke,
      strokeWidth: f.strokeWidth,
      strokeJoin: 'round',
      strokeCap: 'round',
      opacity: f.opacity,
      fillRule: 'evenodd',
      source: f.source,
    };
    ids.push(shapeNode(node, f.rings, f.rings.map(() => true), style, extra));
  }
  return { items: ids, extra };
}

/** Expand: a group of the faces; the 3D record does not carry over. */
function expandThreeD(doc, node) {
  const sub = liveExpansion(doc, node);
  const root = sub.nodes.find((n) => n.id === sub.root);
  if (root.effects) {
    root.effects = root.effects.filter((e) => e.type !== EFFECT_TYPE);
    if (!root.effects.length) delete root.effects;
  }
  const parent = doc.get(node.parent);
  const index = parent ? parent.children.indexOf(node.id) : Infinity;
  doc.remove(node.id);
  return doc.importSubtree(sub, node.parent, index);
}

registerLive('threeD', {
  first: true,
  bounds: 'source',
  test: hasThreeD,
  // Regenerates once type outlines (or engine results for other effects) arrive.
  deps: () => [geomEffectsToken()],
  generate: (doc, node) => threeDArtwork(doc, node),
  // Expand always renders at full detail.
  expandArtwork: (doc, node) => threeDArtwork(doc, node, { draft: false }),
  expand: expandThreeD,
});
