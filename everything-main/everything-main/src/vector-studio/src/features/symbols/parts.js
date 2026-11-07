/**
 * Recoloring parts of dynamic symbol instances. Clicking an instance with
 * Direct Selection picks the master part under the pointer (Shift adds
 * parts); fill, stroke, stroke weight and opacity changes then go into the
 * instance's `overrides` for those parts instead of changing the symbol.
 * Static symbols always select whole.
 *
 * Also draws the canvas feedback for instances: selected parts, the
 * registration point of selected instances and the 9-slice guides while
 * a symbol with guides is being edited.
 */
import { hitNode } from '../../render/hit.js';
import { shapePathOf } from '../../render/draw.js';
import { liveArtwork } from '../../model/live.js';
import { directSelectHooks } from '../../tools/direct-selection.js';
import { paintHooks } from '../../ops/paint-ops.js';
import { overlayHooks, layerColor } from '../../render/overlay.js';
import { tol } from '../../tools/tool.js';
import { getDef, isInstance, instancePartAt, instancePartNodes, instanceRegPoint } from './model.js';
import { editingSymbol } from './editing.js';

const PART_KEYS = ['fill', 'stroke', 'strokeWidth', 'opacity'];

/** The editor's selected instance parts { instance, parts: [master ids] }, or null when not applicable. */
export function selectedParts(editor) {
  const sp = editor?.symbolParts;
  if (!sp || !sp.parts.size) return null;
  const inst = editor.doc.get(sp.instance);
  if (!isInstance(inst) || !editor.selection.has(inst.id) || editor.selection.size !== 1) return null;
  const def = getDef(editor.doc, inst.symbol);
  if (!def || def.symbolDef.kind === 'static') return null;
  return { inst, def, parts: [...sp.parts].filter((id) => editor.doc.has(id)) };
}

export function clearParts(editor) {
  if (!editor?.symbolParts) return;
  editor.symbolParts = null;
  editor.emit('overlay');
}

/** A master part as this instance shows it (its overrides applied). */
function effectivePart(doc, inst, id) {
  const n = doc.get(id);
  const o = inst.overrides?.[id];
  return o ? { ...n, ...o } : n;
}

/** Paintable master parts under the given ids (groups contribute their leaves). */
function paintableParts(doc, ids) {
  const out = [];
  const visit = (n) => {
    if (!n) return;
    if (n.type === 'group') for (const c of n.children) visit(doc.get(c));
    else if (n.type === 'path' || n.type === 'compound' || n.type === 'text' || n.type === 'image') {
      // A path inside a compound paints through the compound.
      const p = doc.get(n.parent);
      out.push(n.type === 'path' && p?.type === 'compound' ? p : n);
    }
  };
  for (const id of ids) visit(doc.get(id));
  return [...new Map(out.map((n) => [n.id, n])).values()];
}

/** Write a style patch into an instance's overrides for some master parts (inside a transaction). */
export function overrideParts(doc, inst, partIds, patch) {
  const keys = Object.keys(patch).filter((k) => PART_KEYS.includes(k));
  if (!keys.length) return false;
  const overrides = { ...(inst.overrides || {}) };
  for (const n of paintableParts(doc, partIds)) {
    const o = { ...(overrides[n.id] || {}) };
    for (const k of keys) {
      if (n.type === 'image' && k !== 'opacity') continue;
      // A value equal to the master's own drops the override.
      if (JSON.stringify(n[k] ?? null) === JSON.stringify(patch[k] ?? null)) delete o[k];
      else o[k] = patch[k];
    }
    if (Object.keys(o).length) overrides[n.id] = o;
    else delete overrides[n.id];
  }
  doc.update(inst.id, { overrides: Object.keys(overrides).length ? overrides : undefined });
  return true;
}

export function installParts(app) {
  directSelectHooks.instance = (tool, hit, e) => {
    if (!isInstance(hit)) return false;
    const editor = tool.editor;
    const doc = editor.doc;
    const def = getDef(doc, hit.symbol);
    if (!def || def.symbolDef.kind === 'static') return false;
    const part = instancePartAt(doc, hit, e.x, e.y, tol(editor, 3), (vdoc, n, x, y, t) => hitNode(vdoc, n, x, y, t, { outline: editor.viewOptions.mode === 'outline' }));
    if (!part?.masterId) return false;
    const prev = editor.symbolParts?.instance === hit.id && editor.selection.has(hit.id) ? editor.symbolParts.parts : null;
    editor.select([hit.id]);
    const parts = new Set(e.shift && prev ? prev : []);
    if (e.shift && parts.has(part.masterId)) parts.delete(part.masterId);
    else parts.add(part.masterId);
    editor.symbolParts = { instance: hit.id, parts };
    editor.emit('selection');
    tool.drag = null;
    tool.overlay();
    return true;
  };

  const editors = new WeakSet();
  const watch = (editor) => {
    if (!editor || editors.has(editor)) return;
    editors.add(editor);
    editor.on('selection', () => {
      const sp = editor.symbolParts;
      if (sp && !(editor.selection.size === 1 && editor.selection.has(sp.instance))) editor.symbolParts = null;
    });
  };
  app.on('active-editor', watch);
  app.on('tool', (id) => {
    if (id !== 'direct-selection' && id !== 'group-selection') clearParts(app.editor);
  });

  // Paint changes go to the selected parts.
  const prevApply = paintHooks.applyStyle;
  paintHooks.applyStyle = (editor, patch, label, coalesce) => {
    const sel = selectedParts(editor);
    if (sel && Object.keys(patch).some((k) => PART_KEYS.includes(k))) {
      editor.setStyle(patch);
      editor.doc.transact(label || 'Recolor Symbol Part', () => overrideParts(editor.doc, editor.doc.get(sel.inst.id), sel.parts, patch), { coalesce });
      return true;
    }
    return prevApply ? prevApply(editor, patch, label, coalesce) : false;
  };
  const prevCommon = paintHooks.commonStyle;
  paintHooks.commonStyle = (editor, key) => {
    const sel = selectedParts(editor);
    if (sel && PART_KEYS.includes(key)) {
      const doc = editor.doc;
      const values = paintableParts(doc, sel.parts).map((n) => effectivePart(doc, sel.inst, n.id)[key] ?? null);
      if (!values.length) return undefined;
      const first = JSON.stringify(values[0]);
      return values.some((v) => JSON.stringify(v) !== first) ? 'mixed' : values[0];
    }
    return prevCommon ? prevCommon(editor, key) : undefined;
  };

  overlayHooks.add(drawSymbolOverlay);
}

function strokePath(ctx, view, path, color, width) {
  ctx.save();
  const m = view.matrix;
  const d = view.dpr;
  ctx.setTransform(d * m[0], d * m[1], d * m[2], d * m[3], d * m[4], d * m[5]);
  ctx.strokeStyle = color;
  ctx.lineWidth = width / view.zoom;
  ctx.setLineDash([]);
  ctx.stroke(path);
  ctx.restore();
}

/** Outline an instance's generated paths (hover and selection feedback). */
function outlineInstance(ctx, view, doc, inst, color, width) {
  const { items, vdoc } = liveArtwork(doc, inst);
  const visit = (n) => {
    if (!n || n.hidden) return;
    if (n.type === 'group') for (const c of n.children) visit(vdoc.get(c));
    else if (n.type === 'instance') outlineInstance(ctx, view, vdoc, n, color, width);
    else if (n.type === 'path' || n.type === 'compound') {
      const p = shapePathOf(vdoc, n);
      if (p) strokePath(ctx, view, p, color, width);
    }
  };
  for (const n of items) visit(n);
}

function drawSymbolOverlay(ctx, editor) {
  const { doc, view } = editor;
  // Instances (also inside groups and symbol sets) are outlined like paths when hovered or selected.
  const instancesIn = (n, out = []) => {
    if (isInstance(n)) out.push(n);
    else if (n?.type === 'group' && out.length < 300) for (const c of n.children) instancesIn(doc.get(c), out);
    return out;
  };
  const hover = editor.hover && !editor.selection.has(editor.hover) ? doc.get(editor.hover) : null;
  if (hover && editor.prefs?.get('alignmentGuideHighlight') !== false) for (const n of instancesIn(hover)) outlineInstance(ctx, view, doc, n, layerColor(editor, n.id), 1.5);
  if (editor.viewOptions.edges && !editor.dragPreview && editor.selection.size < 200) {
    for (const id of editor.selection) {
      if (doc.isHidden(id)) continue;
      for (const n of instancesIn(doc.get(id))) outlineInstance(ctx, view, doc, n, layerColor(editor, n.id), 1);
    }
  }
  // Selected parts of an instance.
  const sel = selectedParts(editor);
  if (sel) {
    const color = layerColor(editor, sel.inst.id);
    const { nodes, vdoc } = instancePartNodes(doc, sel.inst, sel.parts);
    const outline = (n) => {
      if (n.type === 'group') for (const c of n.children) outline(vdoc.get(c));
      else if (n.type === 'path' || n.type === 'compound') {
        const p = shapePathOf(vdoc, n);
        if (p) strokePath(ctx, view, p, color, 2);
      }
    };
    for (const n of nodes) outline(n);
  }
  // Registration point of selected instances.
  if (editor.viewOptions.edges && editor.selection.size && editor.selection.size < 200) {
    for (const id of editor.selection) {
      const n = doc.get(id);
      if (!isInstance(n) || doc.isHidden(id)) continue;
      const r = instanceRegPoint(doc, n);
      const p = view.toScreen(r.x, r.y);
      ctx.save();
      ctx.strokeStyle = layerColor(editor, id);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(p.x - 5, p.y);
      ctx.lineTo(p.x + 5, p.y);
      ctx.moveTo(p.x, p.y - 5);
      ctx.lineTo(p.x, p.y + 5);
      ctx.stroke();
      ctx.restore();
    }
  }
  // 9-slice guides of the symbol being edited.
  const sym = editingSymbol(editor);
  const def = sym ? getDef(doc, sym) : null;
  const g = def?.symbolDef.slice9;
  if (g) {
    const vr = view.visibleRect(0);
    const a = view.toScreen(g.x, g.y);
    const b = view.toScreen(g.x + g.w, g.y + g.h);
    const tl = view.toScreen(vr.x, vr.y);
    const br = view.toScreen(vr.x + vr.w, vr.y + vr.h);
    ctx.save();
    ctx.strokeStyle = '#8a4dff';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    for (const x of [a.x, b.x]) {
      ctx.moveTo(Math.round(x) + 0.5, tl.y);
      ctx.lineTo(Math.round(x) + 0.5, br.y);
    }
    for (const y of [a.y, b.y]) {
      ctx.moveTo(tl.x, Math.round(y) + 0.5);
      ctx.lineTo(br.x, Math.round(y) + 0.5);
    }
    ctx.stroke();
    ctx.restore();
  }
}
