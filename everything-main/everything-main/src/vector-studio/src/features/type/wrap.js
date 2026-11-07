/**
 * Text wrap: Object > Text Wrap > Make / Release / Text Wrap Options.
 *
 * Any object can carry `textWrap: { offset, invert }`. Area type below it
 * in the stacking order lays its lines out around the object's shape
 * (expanded by the offset), or only inside it when inverted. The layout
 * hook (textHooks.wraps) hands each area type node the outlines of the
 * wrap objects above it, in the node's local space; layouts re-flow when
 * a wrap object or the text changes.
 */
import { textHooks, layoutText } from '../../model/text-layout.js';
import { flattenPath } from '../../model/bezier.js';
import { nodeBounds } from '../../model/geometry.js';
import { invert as invertM } from '../../lib/matrix.js';
import { docForNode } from './threads.js';
import { session } from './type-ops.js';

export const DEFAULT_WRAP = Object.freeze({ offset: 6, invert: false });

const indexCache = new WeakMap(); // doc -> { version, list: [{ id, order, node, leaves }] }
const polyCache = new WeakMap(); // leaf node -> polygons in document space
const resultCache = new WeakMap(); // text node -> { deps, result }

function leavesOf(doc, node, out = []) {
  if (!node || node.hidden) return out;
  if (node.type === 'group' || node.type === 'layer') {
    for (const c of node.children) leavesOf(doc, doc.get(c), out);
  } else out.push(node);
  return out;
}

/** Wrap objects of a document in paint order (cached until the document changes). */
function wrapIndex(doc) {
  const version = doc.nodes.version;
  const c = indexCache.get(doc);
  if (c && c.version === version) return c.list;
  const list = [];
  const order = doc.paintOrder();
  doc.walk((n) => {
    if (n.hidden) return false;
    if (n.textWrap && n.type !== 'root' && n.type !== 'layer') {
      list.push({ id: n.id, order: order.get(n.id) ?? 0, node: n, leaves: leavesOf(doc, n) });
      return false;
    }
    return true;
  });
  indexCache.set(doc, { version, list });
  return list;
}

/** Outline polygons of a leaf in document space. */
function docPolys(doc, leaf) {
  let polys = polyCache.get(leaf);
  if (polys) return polys;
  polys = [];
  const rectOf = (b, m) => {
    const pts = [
      [b.x, b.y],
      [b.x + b.w, b.y],
      [b.x + b.w, b.y + b.h],
      [b.x, b.y + b.h],
    ];
    return pts.map(([x, y]) => (m ? { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] } : { x, y }));
  };
  if (leaf.type === 'path' && leaf.anchors.length > 1) polys.push(flattenPath(leaf.anchors, true, 0.5));
  else if (leaf.type === 'compound') {
    for (const c of leaf.children) {
      const p = doc.get(c);
      if (p?.anchors?.length > 1) polys.push(flattenPath(p.anchors, true, 0.5));
    }
  } else if (leaf.type === 'text') polys.push(rectOf(layoutText(leaf).bounds, leaf.transform));
  else if (leaf.type === 'image') polys.push(rectOf({ x: 0, y: 0, w: leaf.width, h: leaf.height }, leaf.transform));
  else {
    const b = nodeBounds(doc, leaf);
    if (b) polys.push(rectOf(b, null));
  }
  polyCache.set(leaf, polys);
  return polys;
}

/** The layout hook: wrap obstacles above an area type node, in its local space. */
export function wrapsFor(doc, node) {
  if (!doc) return null;
  const list = wrapIndex(doc);
  if (!list.length) return null;
  const own = doc.paintOrder().get(node.id);
  if (own == null) return null;
  const above = list.filter((w) => w.order > own && w.id !== node.id && !doc.isAncestor(w.id, node.id));
  if (!above.length) return null;
  const deps = [node.transform];
  for (const w of above) deps.push(w.node, ...w.leaves);
  const c = resultCache.get(node);
  if (c && c.deps.length === deps.length && c.deps.every((d, i) => d === deps[i])) return c.result;
  const inv = invertM(node.transform || [1, 0, 0, 1, 0, 0]);
  const toLocal = (p) => ({ x: inv[0] * p.x + inv[2] * p.y + inv[4], y: inv[1] * p.x + inv[3] * p.y + inv[5] });
  const result = {
    deps,
    list: above.map((w) => ({
      offset: Number.isFinite(w.node.textWrap.offset) ? w.node.textWrap.offset : DEFAULT_WRAP.offset,
      invert: Boolean(w.node.textWrap.invert),
      polys: w.leaves.flatMap((leaf) => docPolys(doc, leaf)).map((poly) => poly.map(toLocal)),
    })),
  };
  resultCache.set(node, { deps, result });
  return result;
}

const wrapTargets = (ed) => (ed ? ed.topSelection().map((id) => ed.doc.get(id)).filter((n) => n && n.type !== 'layer') : []);

async function wrapOptions(app) {
  const ed = app.editor;
  const targets = wrapTargets(ed);
  if (!targets.length) return;
  const doc = ed.doc;
  const cur = targets.find((n) => n.textWrap)?.textWrap || DEFAULT_WRAP;
  const originals = new Map(targets.map((n) => [n.id, n.textWrap]));
  const tx = doc.begin('Text Wrap Options');
  const apply = (v) => {
    for (const [id, orig] of originals) doc.update(id, { textWrap: v ? { offset: v.offset, invert: v.invert } : orig });
  };
  let res = null;
  try {
    res = await app.dialogs.form({
      title: 'Text Wrap Options',
      fields: [
        { key: 'offset', type: 'length', label: 'Offset', value: cur.offset ?? DEFAULT_WRAP.offset, min: -1000, max: 1000, help: 'Distance between the object and the text that flows around it.' },
        { key: 'invert', type: 'checkbox', label: 'Flow Text Inside the Object', value: Boolean(cur.invert) },
        { key: 'preview', type: 'checkbox', label: 'Preview', value: true },
      ],
      previewToggle: true,
      onChange: (v) => apply(v.preview ? v : null),
    });
  } catch (err) {
    tx.cancel();
    throw err;
  }
  if (!res) {
    tx.cancel();
    return;
  }
  apply(res);
  tx.commit();
}

/** Selected wrap objects show the area their offset keeps clear. */
export function wrapOverlay(ctx, editor) {
  const { doc, view } = editor;
  for (const id of editor.selection) {
    const n = doc.get(id);
    if (!n?.textWrap || doc.isHidden(id)) continue;
    const off = Math.abs(n.textWrap.offset ?? DEFAULT_WRAP.offset);
    const polys = leavesOf(doc, n).flatMap((leaf) => docPolys(doc, leaf));
    const m = view.matrix;
    const dpr = view.dpr;
    ctx.save();
    ctx.setTransform(dpr * m[0], dpr * m[1], dpr * m[2], dpr * m[3], dpr * m[4], dpr * m[5]);
    ctx.beginPath();
    for (const poly of polys) {
      poly.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
    }
    ctx.strokeStyle = 'rgba(79, 128, 255, 0.16)';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(off * 2, 0.0001);
    if (off > 0) ctx.stroke();
    ctx.strokeStyle = 'rgba(79, 128, 255, 0.8)';
    ctx.setLineDash([3 / view.zoom, 3 / view.zoom]);
    ctx.lineWidth = 1 / view.zoom;
    ctx.stroke();
    ctx.restore();
  }
}

export function installTextWrap(app) {
  textHooks.wraps = (node) => wrapsFor(docForNode(app, node), node);
  const has = (a) => Boolean(a.editor) && !session(a) && wrapTargets(a.editor).length > 0;
  app.commands.register([
    {
      id: 'textWrap.make',
      label: 'Make',
      enabled: has,
      run: (a) => {
        const ed = a.editor;
        ed.doc.transact('Make Text Wrap', () => {
          for (const n of wrapTargets(ed)) if (!n.textWrap) ed.doc.update(n.id, { textWrap: { ...DEFAULT_WRAP } });
        });
      },
    },
    {
      id: 'textWrap.release',
      label: 'Release',
      enabled: (a) => has(a) && wrapTargets(a.editor).some((n) => n.textWrap),
      run: (a) => {
        const ed = a.editor;
        ed.doc.transact('Release Text Wrap', () => {
          for (const n of wrapTargets(ed)) if (n.textWrap) ed.doc.update(n.id, { textWrap: undefined });
        });
      },
    },
    { id: 'textWrap.options', label: 'Text Wrap Options...', enabled: has, run: wrapOptions },
  ]);
}

