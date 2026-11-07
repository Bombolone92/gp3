/**
 * Pattern editing mode.
 *
 * Making or editing a pattern puts its art on a temporary top layer that
 * carries the pattern options (`layer.pattern`), and isolates that layer:
 * the rest of the document is hidden, the art is edited with the ordinary
 * tools, and copies of it repeat around the tile as a live preview. Since
 * the mode is just document state, undo and redo move in and out of it and
 * the Pattern Options panel edits are undoable. Done writes the art back to
 * the pattern definition (every object painted with it updates); Cancel
 * discards the edits (and a pattern made in this session).
 *
 * layer.pattern = {
 *   id, swatchId, isNew,               the definition and swatch being edited
 *   ...pattern options (model.js),     name, tileType, width, height, ...
 *   cx, cy                             tile center while the tile stays put
 *   offset { x, y }                    tile center relative to the art's center
 *                                      while the tile moves with the art
 *   copies, dimCopies, dim, showTileEdge, showSwatchBounds   preview settings
 * }
 */
import { visualBounds, nodeBounds, unionRect, transformPatches, transformNodes } from '../../model/geometry.js';
import { translate } from '../../lib/matrix.js';
import { addSwatch, removeSwatches, swatchesOf, updateSwatch } from '../paint/swatch-model.js';
import { PATTERN_DEFAULTS, OPTION_KEYS, findPattern, addPattern, updatePattern, removePattern, patternsOf, patternView, newPatternId, patternPaint } from './model.js';

export const PREVIEW_DEFAULTS = Object.freeze({ copies: '5x5', dimCopies: true, dim: 70, showTileEdge: true, showSwatchBounds: false });

/** The layer holding the art in pattern editing mode, or null. */
export function editLayer(doc) {
  for (const id of doc.root.children) {
    const l = doc.get(id);
    if (l?.pattern) return l;
  }
  return null;
}

export function isEditing(editor) {
  return Boolean(editor && editLayer(editor.doc));
}

/** Visual bounds of the art on the editing layer (document space), or null. */
export function layerArtBounds(doc, layer) {
  let b = null;
  for (const id of layer.children) {
    const n = doc.get(id);
    if (n && !n.hidden) b = unionRect(b, visualBounds(doc, n) || nodeBounds(doc, n));
  }
  return b;
}

/** The tile in document space while editing: { x, y, w, h }. */
export function editTile(doc, layer) {
  const p = layer.pattern;
  const art = layerArtBounds(doc, layer);
  let w = p.width;
  let h = p.height;
  if (p.sizeToArt && art) {
    w = art.w + (p.hSpacing || 0);
    h = art.h + (p.vSpacing || 0);
  }
  w = Math.max(0.01, w || 1);
  h = Math.max(0.01, h || 1);
  let cx = p.cx ?? 0;
  let cy = p.cy ?? 0;
  if ((p.moveWithArt || p.sizeToArt) && art) {
    const o = p.sizeToArt ? { x: 0, y: 0 } : p.offset || { x: 0, y: 0 };
    cx = art.x + art.w / 2 + o.x;
    cy = art.y + art.h / 2 + o.y;
  }
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

/** Options as a definition-like object sized to the current tile (for lattice math). */
export function editDef(doc, layer) {
  const t = editTile(doc, layer);
  return { ...layer.pattern, width: t.w, height: t.h };
}

/**
 * Patch to the layer's pattern options. Switching Move Tile with Art keeps
 * the tile where it is (the stored center or offset follows the switch).
 */
export function optionsPatch(doc, layer, patch) {
  const p = layer.pattern;
  const t = editTile(doc, layer);
  const art = layerArtBounds(doc, layer);
  const next = { ...p, ...patch };
  const center = { x: t.x + t.w / 2, y: t.y + t.h / 2 };
  next.cx = center.x;
  next.cy = center.y;
  next.offset = art ? { x: center.x - (art.x + art.w / 2), y: center.y - (art.y + art.h / 2) } : { x: 0, y: 0 };
  // Turning Size Tile to Art off keeps the size it had.
  if (p.sizeToArt && patch.sizeToArt === false) {
    next.width = t.w;
    next.height = t.h;
  }
  return next;
}

/** Set pattern options while editing (one undo step per gesture). */
export function setOptions(editor, patch, label = 'Pattern Options') {
  const doc = editor.doc;
  const layer = editLayer(doc);
  if (!layer) return;
  doc.transact(label, () => doc.update(layer.id, { pattern: optionsPatch(doc, layer, patch), ...(patch.name ? { name: patch.name } : {}) }), { coalesce: `pattern-options:${Object.keys(patch).join(',')}` });
}

/** A definition (pattern units, tile at 0,0) from the editing layer. */
export function defFromLayer(doc, layer, extra = {}) {
  const tile = editTile(doc, layer);
  const m = translate(-tile.x, -tile.y);
  const patches = new Map();
  for (const id of layer.children) transformPatches(doc, doc.get(id), m, { transformPatterns: true }, patches);
  const nodes = [];
  const roots = [];
  const collect = (id, parent) => {
    const n = doc.get(id);
    if (!n) return;
    const out = { ...n, ...patches.get(id), parent };
    for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
    nodes.push(out);
    if (n.children) for (const c of n.children) collect(c, id);
  };
  for (const id of layer.children) {
    if (!doc.has(id)) continue;
    roots.push(id);
    collect(id, null);
  }
  const opts = {};
  for (const k of OPTION_KEYS) if (layer.pattern[k] !== undefined) opts[k] = layer.pattern[k];
  return { ...opts, id: layer.pattern.id, width: tile.w, height: tile.h, art: { roots, nodes }, ...extra };
}

/** A unique "New Pattern" name for a document. */
export function nextPatternName(doc, base = 'New Pattern') {
  const names = new Set([...swatchesOf(doc).map((s) => s.name), ...patternsOf(doc).map((p) => p.name)]);
  if (!names.has(base)) return base;
  let i = 2;
  while (names.has(`${base} ${i}`)) i++;
  return `${base} ${i}`;
}

function viewCenter(editor) {
  const v = editor.view;
  return v.width > 1 ? v.toDoc(v.width / 2, v.height / 2) : (() => {
    const a = editor.artboard();
    return a ? { x: a.x + a.w / 2, y: a.y + a.h / 2 } : { x: 0, y: 0 };
  })();
}

function startEditing(app, editor, layerId, select = []) {
  editor.isolation = layerId;
  editor.patternLayerId = layerId;
  editor.select(select.filter((id) => editor.doc.has(id)));
  editor.emit('isolation');
  editor.invalidate();
  app.refreshChrome?.();
}

/**
 * Object > Pattern > Make: a new pattern swatch from the selected artwork
 * (copies of it; the originals stay in the document), or an empty tile.
 */
export function makePattern(app, editor) {
  const doc = editor.doc;
  if (editLayer(doc)) return null;
  const ids = editor.topSelection().filter((id) => doc.get(id)?.type !== 'layer');
  let layerId = null;
  let artIds = [];
  doc.transact('Make Pattern', () => {
    const name = nextPatternName(doc);
    const def = addPattern(doc, { ...PATTERN_DEFAULTS, name, id: newPatternId(), art: { roots: [], nodes: [] } });
    const swatchId = addSwatch(doc, { name, paint: patternPaint(def.id) });
    const layer = doc.addLayer(name);
    layerId = layer.id;
    for (const id of ids) {
      const { node, descendants } = doc.cloneSubtree(id);
      artIds.push(doc.insert({ ...node, hidden: false, locked: false }, layer.id, Infinity, descendants).id);
    }
    const art = layerArtBounds(doc, doc.get(layer.id));
    const c = art ? { x: art.x + art.w / 2, y: art.y + art.h / 2 } : viewCenter(editor);
    doc.update(layer.id, {
      pattern: {
        ...PATTERN_DEFAULTS,
        ...PREVIEW_DEFAULTS,
        name,
        id: def.id,
        swatchId,
        isNew: true,
        width: art ? Math.max(1, art.w) : PATTERN_DEFAULTS.width,
        height: art ? Math.max(1, art.h) : PATTERN_DEFAULTS.height,
        cx: c.x,
        cy: c.y,
        offset: { x: 0, y: 0 },
      },
    });
  });
  startEditing(app, editor, layerId, artIds);
  app.notify(ids.length ? 'New pattern added to Swatches. Edits apply when you choose Done.' : 'New empty pattern added to Swatches. Draw its art, then choose Done.', { polite: true });
  return layerId;
}

/** Subtree node lists for each art root of a definition (for importSubtree). */
function artSubtrees(def) {
  const pv = patternView(null, def);
  return pv.roots.map((root) => {
    const nodes = [];
    pv.walk((n) => {
      nodes.push(n);
    }, root);
    return { root, nodes };
  });
}

/** Edit an existing pattern: its art goes onto the editing layer, tile centered in the view. */
export function editPattern(app, editor, patternId) {
  const doc = editor.doc;
  const def = findPattern(doc, patternId);
  if (!def || editLayer(doc)) return null;
  const swatch = swatchesOf(doc).find((s) => s.paint?.type === 'pattern' && s.paint.id === patternId);
  const c = viewCenter(editor);
  let layerId = null;
  const artIds = [];
  doc.transact('Edit Pattern', () => {
    const layer = doc.addLayer(def.name || 'Pattern');
    layerId = layer.id;
    const dx = c.x - def.width / 2;
    const dy = c.y - def.height / 2;
    for (const sub of artSubtrees(def)) artIds.push(doc.importSubtree(sub, layer.id).id);
    if (artIds.length) transformNodes(doc, artIds, translate(dx, dy), { transformPatterns: true });
    const art = layerArtBounds(doc, doc.get(layer.id));
    const opts = {};
    for (const k of OPTION_KEYS) opts[k] = def[k] ?? PATTERN_DEFAULTS[k];
    doc.update(layer.id, {
      pattern: {
        ...PREVIEW_DEFAULTS,
        ...(def.preview || {}),
        ...opts,
        id: def.id,
        swatchId: swatch?.id || null,
        isNew: false,
        cx: c.x,
        cy: c.y,
        offset: art ? { x: c.x - (art.x + art.w / 2), y: c.y - (art.y + art.h / 2) } : { x: 0, y: 0 },
      },
    });
  });
  startEditing(app, editor, layerId, []);
  return layerId;
}

function stopEditing(app, editor) {
  editor.isolation = null;
  editor.patternLayerId = null;
  editor.clearSelection();
  editor.emit('isolation');
  editor.invalidate();
  app.refreshChrome?.();
}

const PREVIEW_KEYS = Object.keys(PREVIEW_DEFAULTS);

/** Done: write the art and options to the pattern and leave the mode. */
export function finishEditing(app, editor) {
  const doc = editor.doc;
  const layer = editLayer(doc);
  if (!layer) return false;
  const p = layer.pattern;
  const preview = {};
  for (const k of PREVIEW_KEYS) preview[k] = p[k];
  doc.transact('Edit Pattern', () => {
    const def = defFromLayer(doc, layer, { preview });
    if (findPattern(doc, p.id)) updatePattern(doc, p.id, def);
    else addPattern(doc, def);
    if (p.swatchId && swatchesOf(doc).some((s) => s.id === p.swatchId)) updateSwatch(doc, p.swatchId, { name: p.name });
    else if (!swatchesOf(doc).some((s) => s.paint?.type === 'pattern' && s.paint.id === p.id)) addSwatch(doc, { name: p.name, paint: patternPaint(p.id) });
    doc.remove(layer.id);
  });
  stopEditing(app, editor);
  return true;
}

/** Cancel: drop the edits; a pattern made in this session is removed with its swatch. */
export function cancelEditing(app, editor) {
  const doc = editor.doc;
  const layer = editLayer(doc);
  if (!layer) return false;
  const p = layer.pattern;
  doc.transact('Cancel Pattern Editing', () => {
    doc.remove(layer.id);
    if (p.isNew) {
      if (p.swatchId) removeSwatches(doc, [p.swatchId]);
      removePattern(doc, p.id);
    }
  });
  stopEditing(app, editor);
  return true;
}

/** Save a Copy: a new pattern swatch from the current state; editing continues. */
export function savePatternCopy(app, editor, name) {
  const doc = editor.doc;
  const layer = editLayer(doc);
  if (!layer) return null;
  let id = null;
  doc.transact('Save Pattern Copy', () => {
    const def = defFromLayer(doc, layer, { id: newPatternId(), name: name || nextPatternName(doc, `${layer.pattern.name} copy`) });
    addPattern(doc, def);
    addSwatch(doc, { name: def.name, paint: patternPaint(def.id) });
    id = def.id;
  });
  return id;
}

/**
 * Keep the editor in step with the document: entering (redo, opening a file
 * saved mid-edit) isolates the editing layer, leaving (undo) ends isolation.
 */
export function syncEditing(app, editor) {
  const doc = editor.doc;
  const layer = editLayer(doc);
  if (layer) {
    const inside = editor.isolation && (editor.isolation === layer.id || doc.isAncestor(layer.id, editor.isolation));
    if (!inside || editor.patternLayerId !== layer.id) {
      editor.patternLayerId = layer.id;
      if (!inside) editor.isolation = layer.id;
      editor.emit('isolation');
      return true;
    }
  } else if (editor.patternLayerId) {
    if (editor.isolation && !doc.has(editor.isolation)) editor.isolation = null;
    if (editor.isolation === editor.patternLayerId) editor.isolation = null;
    editor.patternLayerId = null;
    editor.emit('isolation');
    return true;
  }
  return false;
}
