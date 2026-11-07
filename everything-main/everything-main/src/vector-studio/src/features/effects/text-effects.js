/**
 * Geometry effects on type. A text object with Warp, Roughen, Outline
 * Object, ... draws as live artwork: its glyph outlines (from the type
 * module, in the very fonts it displays with) become shapes painted like
 * the characters, and the text's effects apply to them across the bounds of
 * all the glyphs, so a Warp bends a whole line of type as one. The text
 * stays editable; Expand Appearance turns it into the outlined, effected
 * shapes.
 *
 * Fonts load asynchronously: until a text's outline fonts are ready it
 * draws as plain type and redraws with the effect once they arrive.
 */
import { registerLive, virtualId } from '../../model/live.js';
import { geomEffectsOf, geomEffectsToken, geomEffectsChanged, subpathsBounds } from '../../model/geom-effects.js';
import { layoutText } from '../../model/text-layout.js';
import { styledRuns } from '../../model/text-runs.js';
import { nodeBounds, gradientEnds } from '../../model/geometry.js';
import { isGradient } from '../../model/gradients.js';
import { normalizeTextOutlines } from '../io/outlines.js';
import { textToPathDataSync } from '../type/outlines.js';
import { otFontFor } from '../type/fonts.js';
import { shapeHooks } from '../../model/live-effects.js';

const loading = new Set();

/** Make sure the outline fonts of a text are loading; redraw effects when they are in. */
function loadFonts(node) {
  const waits = [];
  for (const r of styledRuns(node)) {
    const st = r.style;
    const key = `${st.fontFamily}|${st.fontWeight}|${st.fontStyle}`;
    if (loading.has(key)) continue;
    loading.add(key);
    waits.push(otFontFor(st).catch(() => null));
  }
  if (waits.length) Promise.all(waits).then(() => geomEffectsChanged());
}

/**
 * A text object's outlines as paint runs [{ style, subpaths }] in document
 * space, or undefined while its fonts are loading, or null when a font has
 * no outlines.
 */
export function textShapes(node) {
  let data;
  try {
    data = textToPathDataSync(node);
  } catch {
    return null;
  }
  if (data === undefined) {
    loadFonts(node);
    return undefined;
  }
  if (!data) return null;
  // A gradient spans the whole text object, as it does on the characters.
  const box = nodeBounds(null, node);
  const span = (p) => (isGradient(p) && p.x1 === undefined && box ? gradientEnds(p, box) : p);
  return normalizeTextOutlines(data, node).map((run) => ({
    style: {
      fill: span(run.fill),
      stroke: span(run.stroke),
      strokeWidth: run.strokeWidth || 0,
      strokeJoin: node.strokeJoin || 'miter',
      strokeCap: node.strokeCap || 'butt',
      miterLimit: node.miterLimit ?? 10,
      strokeAlign: 'center',
      dash: node.dash || [],
      dashOffset: node.dashOffset || 0,
      arrowStart: null,
      arrowEnd: null,
      opacity: 1,
      blendMode: 'normal',
      effects: [],
    },
    fillRule: 'nonzero',
    subpaths: run.subpaths,
    source: node.source || node.id,
  }));
}

registerLive('textEffects', {
  test: (n) => n.type === 'text' && Boolean(geomEffectsOf(n)),
  // Regenerates once outline fonts (or engine results) arrive.
  deps: () => [geomEffectsToken()],
  generate(doc, t) {
    layoutText(t);
    const runs = textShapes(t);
    const extra = new Map();
    if (!runs) {
      // Fonts still loading (or without outlines): plain type in the meantime.
      // The text object itself still applies its opacity, blending and raster effects.
      const plain = { ...t, id: virtualId(t.id), source: t.source || t.id, effects: [], opacity: 1, blendMode: 'normal' };
      extra.set(plain.id, plain);
      return { items: [plain.id], extra };
    }
    const frame = subpathsBounds(runs.flatMap((r) => r.subpaths)) || nodeBounds(doc, t);
    const fx = geomEffectsOf(t).map((e) => ({ ...e, frame: e.frame || frame }));
    const items = [];
    for (const run of runs) {
      const children = run.subpaths.map((s) => {
        const id = virtualId(t.id);
        extra.set(id, { id, type: 'path', name: '', anchors: s.anchors, closed: s.closed, hidden: false, locked: false });
        return id;
      });
      const id = virtualId(t.id);
      extra.set(id, { ...run.style, id, type: 'compound', name: '', children, fillRule: 'nonzero', hidden: false, locked: false, effects: fx, source: run.source });
      items.push(id);
    }
    return { items, extra };
  },
});

// Pathfinder effects on groups combine type as its outlines.
shapeHooks.text = (doc, node) => textShapes(node) || null;
