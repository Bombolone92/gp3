/**
 * Paint operations shared by the toolbar's fill/stroke controls, the
 * Properties, Color, Swatches, Gradient and Stroke panels: apply a style
 * patch to the selection (descending into groups) and to the current
 * style used for new objects.
 */
import { DEFAULT_STYLE } from '../model/nodes.js';
import { applyStyleDeep } from '../tools/navigation.js';
import { normalizeRuns } from '../model/text-runs.js';

/**
 * Hooks for feature modules: applyStyle(editor, patch, label, coalesce)
 * returns true when it handled the change (e.g. coloring selected
 * characters while editing type); commonStyle(editor, key) returns a value
 * or undefined to fall through.
 */
export const paintHooks = { applyStyle: null, commonStyle: null };

/** Paintable nodes under the selection (groups contribute their leaves). */
export function paintTargets(editor) {
  return (editor.memo ? editor.memo('paintTargets', () => collectPaintTargets(editor)) : collectPaintTargets(editor)).slice();
}

function collectPaintTargets(editor) {
  const out = [];
  const { doc } = editor;
  const visit = (n) => {
    if (!n) return;
    if (n.type === 'group' || n.type === 'layer') {
      const kids = n.clip ? n.children.slice(0, -1) : n.children;
      for (const c of kids) visit(doc.get(c));
    } else if (n.type === 'path' || n.type === 'compound' || n.type === 'text') out.push(n);
  };
  for (const id of editor.topSelection()) {
    const n = doc.get(id);
    // A path inside a compound paints through the compound.
    if (n?.type === 'path' && doc.get(n.parent)?.type === 'compound') visit(doc.get(n.parent));
    else visit(n);
  }
  return [...new Map(out.map((n) => [n.id, n])).values()];
}

/**
 * Apply a style patch. With a selection it changes the selected objects
 * (one undo step, merged while `live` drags call it repeatedly) and the
 * current style; without one it only sets the current style.
 */
export function applyStyle(editor, patch, label = 'Change Appearance', coalesce = null) {
  if (paintHooks.applyStyle?.(editor, patch, label, coalesce)) return;
  editor.setStyle(patch);
  // Objects that already look like this need no change (and no empty undo step).
  const same = (n) => !(n.type === 'text' && n.runs) && Object.keys(patch).every((k) => JSON.stringify(n[k] ?? null) === JSON.stringify(patch[k] ?? null));
  const targets = paintTargets(editor).filter((n) => !same(n));
  if (!targets.length) return;
  const { doc } = editor;
  doc.transact(
    label,
    () => {
      for (const t of targets) applyStyleDeep(doc, doc.get(t.id), patch);
    },
    { coalesce },
  );
}

/** Representative value of a style key across the selection: value, 'mixed', or undefined. */
export function commonStyle(editor, key) {
  const hooked = paintHooks.commonStyle?.(editor, key);
  if (hooked !== undefined) return hooked;
  const targets = paintTargets(editor);
  if (!targets.length) return editor.style[key];
  const compute = () => {
    const first = JSON.stringify(targets[0][key] ?? null);
    for (const t of targets) if (JSON.stringify(t[key] ?? null) !== first) return 'mixed';
    return targets[0][key] ?? null;
  };
  return editor.memo ? editor.memo(`common:${key}`, compute) : compute();
}

export function swapFillStroke(editor) {
  const targets = paintTargets(editor);
  if (!targets.length) {
    editor.setStyle({ fill: editor.style.stroke, stroke: editor.style.fill });
    return;
  }
  editor.doc.transact('Swap Fill and Stroke', () => {
    for (const t of targets) {
      const patch = { fill: t.stroke ?? null, stroke: t.fill ?? null };
      // Character runs swap their own fill and stroke overrides too.
      if (t.type === 'text' && t.runs) patch.runs = normalizeRuns(t.runs.map(swapRun), { ...t, ...patch, runs: undefined });
      editor.doc.update(t.id, patch);
    }
  });
  editor.setStyle({ fill: targets[0].stroke ?? null, stroke: targets[0].fill ?? null });
}

function swapRun(r) {
  if (!('fill' in r) && !('stroke' in r)) return r;
  const out = { ...r };
  delete out.fill;
  delete out.stroke;
  if ('stroke' in r) out.fill = r.stroke;
  if ('fill' in r) out.stroke = r.fill;
  return out;
}

export function defaultFillStroke(editor) {
  applyStyle(editor, { fill: { type: 'solid', color: '#ffffff' }, stroke: { type: 'solid', color: '#000000' }, strokeWidth: 1, dash: [], opacity: 1, blendMode: 'normal' }, 'Default Fill and Stroke');
}

/** Set the focused paint (fill or stroke) to a solid color, gradient or none. */
export function setFocusedPaint(editor, kind) {
  const key = editor.focusPaint;
  const cur = commonStyle(editor, key);
  let paint = null;
  if (kind === 'color') {
    const last = editor.lastSolid?.[key] || (key === 'fill' ? '#ffffff' : '#000000');
    paint = cur && cur !== 'mixed' && cur.type === 'solid' ? cur : { type: 'solid', color: last };
  } else if (kind === 'gradient') {
    paint = cur && cur !== 'mixed' && (cur.type === 'linear' || cur.type === 'radial') ? cur : editor.lastGradient || DEFAULT_GRADIENT;
  }
  if (cur && cur !== 'mixed' && cur.type === 'solid') editor.lastSolid = { ...(editor.lastSolid || {}), [key]: cur.color };
  applyStyle(editor, { [key]: paint });
}

export const DEFAULT_GRADIENT = Object.freeze({
  type: 'linear',
  angle: 0,
  stops: [
    { offset: 0, color: '#ffffff', opacity: 1 },
    { offset: 1, color: '#000000', opacity: 1 },
  ],
});

export { DEFAULT_STYLE };
