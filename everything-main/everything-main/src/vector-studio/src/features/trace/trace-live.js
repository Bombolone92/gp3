/**
 * Trace objects: live artwork made from a placed image.
 *
 * A trace object is a group whose only child is the source image:
 *   { type: 'group', children: [imageId],
 *     live: { kind: 'trace', preset, options, view, result } }
 * `result` is the stored vector result ({ key, w, h, shapes, stats } from
 * trace-core.js, in the image's pixel grid), so drawing never waits for a
 * trace: generate() only maps the stored shapes through the image's
 * transform. `result.key` identifies the image and options it was traced
 * from; when they no longer match (options changed), the trace service
 * traces again in the background and writes the new result in place
 * (amendNode), without adding an undo step of its own.
 *
 * View modes (result, outlines, source, ...) only change what is drawn.
 */
import { registerLive, liveArtwork, virtualId, expandLive } from '../../model/live.js';
import { DEFAULT_STYLE, createGroup } from '../../model/nodes.js';
import { transformAnchors } from '../../model/bezier.js';
import { multiply, scale as scaleM, scaleFactor } from '../../lib/matrix.js';
import { parsePathData } from './trace-core.js';
import { normalizeOptions, hashString } from './presets.js';

export const VIEWS = [
  { value: 'result', label: 'Result' },
  { value: 'resultOutlines', label: 'Result with Outlines' },
  { value: 'outlines', label: 'Outlines' },
  { value: 'outlinesSource', label: 'Outlines with Source Image' },
  { value: 'source', label: 'Source Image' },
];

const OUTLINE_COLOR = '#2f6fed';

export function isTrace(node) {
  return Boolean(node && node.type === 'group' && node.live?.kind === 'trace');
}

/** The source image node of a trace object. */
export function traceImageNode(doc, node) {
  const img = node?.children?.length ? doc.get(node.children[0]) : null;
  return img && img.type === 'image' ? img : null;
}

/** Solid document swatch colors (for the document-swatches palette). */
export function swatchColors(doc) {
  return (doc.root.swatches || [])
    .filter((s) => s.paint?.type === 'solid' && /^#[0-9a-f]{6}$/i.test(s.paint.color))
    .map((s) => s.paint.color.toLowerCase())
    .slice(0, 64);
}

/** The key a result must carry to match an image asset and options. */
export function traceKey(doc, assetId, options) {
  const o = normalizeOptions(options);
  const sw = o.mode === 'color' && o.palette === 'swatches' ? swatchColors(doc) : null;
  return hashString(JSON.stringify([assetId, o, sw]));
}

/** True when a trace object's stored result no longer matches its image and options. */
export function needsTrace(doc, node) {
  if (!isTrace(node)) return false;
  const img = traceImageNode(doc, node);
  if (!img) return false;
  return node.live.result?.key !== traceKey(doc, img.asset, node.live.options);
}

// Parsed shapes per stored result (results are immutable).
const parsedCache = new WeakMap();
function parsedShapes(result) {
  let p = parsedCache.get(result);
  if (!p) {
    p = result.shapes.map((s) => ({ ...s, subs: parsePathData(s.d) }));
    parsedCache.set(result, p);
  }
  return p;
}

/** Matrix from the result's pixel grid to document space. */
export function resultMatrix(img, result) {
  return multiply(img.transform || [1, 0, 0, 1, 0, 0], scaleM(img.width / result.w, img.height / result.h));
}

function virtualShape(node, shape, m, extra, style) {
  const subs = shape.subs.map((s) => ({ anchors: transformAnchors(s.anchors, m), closed: s.closed }));
  const base = { ...DEFAULT_STYLE, name: '', hidden: false, locked: false, parent: node.id, ...style };
  if (subs.length === 1) {
    const id = virtualId(node.id);
    return { ...base, id, type: 'path', anchors: subs[0].anchors, closed: subs[0].closed };
  }
  const cid = virtualId(node.id);
  const children = subs.map((s) => {
    const id = virtualId(node.id);
    extra.set(id, { ...DEFAULT_STYLE, id, type: 'path', name: '', anchors: s.anchors, closed: s.closed, hidden: false, locked: false, parent: cid });
    return id;
  });
  return { ...base, id: cid, type: 'compound', children, fillRule: 'evenodd' };
}

function generate(doc, node) {
  const img = traceImageNode(doc, node);
  if (!img) return { items: [] };
  const view = node.live.view || 'result';
  const result = node.live.result;
  const items = [];
  const extra = new Map();
  if (!result || view === 'source') return { items: [img.id] };
  if (view === 'outlinesSource') {
    const id = virtualId(node.id);
    items.push({ ...img, id, parent: node.id, opacity: (img.opacity ?? 1) * 0.5 });
  }
  const m = resultMatrix(img, result);
  const k = scaleFactor(m);
  const shapes = parsedShapes(result);
  if (view === 'result' || view === 'resultOutlines') {
    for (const s of shapes) {
      const style = s.f
        ? { fill: { type: 'solid', color: s.f }, stroke: null, strokeWidth: 0 }
        : { fill: null, stroke: { type: 'solid', color: s.s }, strokeWidth: s.sw * k, strokeCap: 'round', strokeJoin: 'round' };
      const v = virtualShape(node, s, m, extra, style);
      if (v.type === 'compound') extra.set(v.id, v);
      items.push(v);
    }
  }
  if (view !== 'result') {
    // Outlines: hairlines sized to the image so they read at any zoom of a normal view.
    const w = Math.max(0.1, (Math.max(img.width, img.height) * Math.abs(scaleFactor(img.transform || [1, 0, 0, 1, 0, 0]))) / 600);
    for (const s of shapes) {
      const v = virtualShape(node, s, m, extra, { fill: null, stroke: { type: 'solid', color: OUTLINE_COLOR }, strokeWidth: w });
      if (v.type === 'compound') extra.set(v.id, v);
      items.push(v);
    }
  }
  return { items, extra };
}

registerLive('trace', {
  label: '<Traced Image>',
  bounds: 'source',
  highlight: 'bounds',
  generate,
  // Expanding keeps the traced result whatever is being displayed.
  expandNode: (node) => ({ ...node, live: { ...node.live, view: 'result' } }),
});

/** Number of paths, anchors and colors of a stored result. */
export function resultStats(result) {
  return result?.stats || { paths: 0, anchors: 0, colors: 0 };
}

/**
 * Turn an image into a trace object (inside a transaction). Returns the
 * new group. `result` must already be traced for these options.
 */
export function makeTrace(doc, imageId, { options, preset = null, view = 'result', result = null }) {
  const img = doc.get(imageId);
  if (!img || img.type !== 'image') return null;
  const parent = doc.get(img.parent);
  const index = parent.children.indexOf(imageId);
  const g = createGroup([], { name: '', live: { kind: 'trace', preset, options: normalizeOptions(options), view, result } });
  const node = doc.insert(g, parent.id, index);
  doc.move(imageId, node.id);
  return doc.get(node.id);
}

/** Release a trace object: its image goes back where the object was (inside a transaction). */
export function releaseTrace(doc, id) {
  const node = doc.get(id);
  if (!isTrace(node)) return null;
  const img = traceImageNode(doc, node);
  const parent = doc.get(node.parent);
  const index = parent.children.indexOf(id);
  if (img) doc.move(img.id, parent.id, index);
  doc.remove(id);
  return img ? img.id : null;
}

/** Expand a trace object into a plain group of paths (inside a transaction). */
export function expandTrace(doc, id) {
  const node = doc.get(id);
  if (!isTrace(node) || !node.live.result) return null;
  return expandLive(doc, id);
}

/** Update the live parameters of trace objects (inside a transaction). */
export function updateTrace(doc, id, patch) {
  const node = doc.get(id);
  if (!isTrace(node)) return null;
  const live = { ...node.live, ...patch };
  if (patch.options) live.options = normalizeOptions({ ...node.live.options, ...patch.options });
  return doc.update(id, { live });
}

/**
 * Replace a node outside the undo history: the new object also replaces
 * the current one wherever undo and redo records hold it, so stepping
 * through history keeps the amended version. Used to store trace results
 * that finish after the change that asked for them. Returns false while
 * a transaction is open (try again later).
 */
export function amendNode(doc, id, patch) {
  if (doc.tx) return false;
  const cur = doc.get(id);
  if (!cur) return false;
  const next = { ...cur, ...patch };
  doc.nodes.set(id, next);
  for (const rec of [...doc.undoStack, ...doc.redoStack]) {
    for (const map of [rec.before, rec.after]) if (map?.get(id) === cur) map.set(id, next);
  }
  doc.emit('change', { ids: new Set([id]), structural: false, commit: true, amend: true });
  return true;
}

/** Store a result on a trace object when it still matches its options. */
export function applyResult(doc, id, result) {
  const node = doc.get(id);
  if (!isTrace(node)) return false;
  const img = traceImageNode(doc, node);
  if (!img || result.key !== traceKey(doc, img.asset, node.live.options)) return false;
  return amendNode(doc, id, { live: { ...node.live, result } });
}

/** Generated artwork of a trace object (for tests and info). */
export function traceArtwork(doc, node) {
  return liveArtwork(doc, node);
}
