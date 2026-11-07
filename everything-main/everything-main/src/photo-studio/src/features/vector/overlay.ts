import type { Editor } from '../../editor';
import type { VectorMask } from '../../model/vector';
import { anchor, hasIn, hasOut, maskToSvg, type KnotRef } from './geometry';
import { activeKey, targetPath, vstate, type PathTarget } from './state';

// While a tool drags, the overlay shows its uncommitted geometry.
export const draft: { key?: string; mask?: VectorMask } = {};
export function setDraft(t: PathTarget | undefined, mask: VectorMask | undefined) {
  draft.key = t ? activeKey(t) : undefined;
  draft.mask = mask;
}
export const pathTools = new Set(['pen', 'freeform-pen', 'curvature-pen', 'add-anchor', 'delete-anchor', 'convert-point', 'path-select', 'direct-select']);
const anchorTools = new Set(['pen', 'curvature-pen', 'add-anchor', 'delete-anchor', 'convert-point', 'direct-select', 'freeform-pen']);

/** Displayed geometry of the target (a tool's draft or the stored knots). */
export function shownMask(t: PathTarget) {
  return draft.mask && draft.key === activeKey(t) ? draft.mask : t.mask;
}
const n = (v: number) => Math.round(v * 100) / 100;
/** Anchor squares and handles at constant screen size. */
export function anchorMarkup(e: Editor, mask: VectorMask, selected: KnotRef[], opts: { paths?: Set<number>; handlesFor?: 'selected' | 'all'; filledPaths?: Set<number> } = {}) {
  const z = e.zoom, s = 7 / z, hs = 3.2 / z;
  const sel = new Set(selected.map((r) => `${r.path}:${r.knot}`));
  // Handles show on selected anchors and on the neighbours of selected anchors' segments.
  const handleKnots = new Set<string>();
  if (opts.handlesFor === 'all') mask.paths.forEach((p, pi) => p.knots.forEach((_, ki) => handleKnots.add(`${pi}:${ki}`)));
  else
    for (const r of selected) {
      const p = mask.paths[r.path];
      if (!p) continue;
      handleKnots.add(`${r.path}:${r.knot}`);
      const len = p.knots.length;
      if (!p.open || r.knot > 0) handleKnots.add(`${r.path}:${(r.knot - 1 + len) % len}`);
      if (!p.open || r.knot < len - 1) handleKnots.add(`${r.path}:${(r.knot + 1) % len}`);
    }
  let lines = '', dots = '', squares = '';
  mask.paths.forEach((p, pi) => {
    if (opts.paths && !opts.paths.has(pi)) return;
    const filled = opts.filledPaths?.has(pi);
    p.knots.forEach((k, ki) => {
      const [x, y] = anchor(k);
      const key = `${pi}:${ki}`;
      if (handleKnots.has(key)) {
        if (hasIn(k)) {
          lines += `M${n(x)} ${n(y)}L${n(k.points[0])} ${n(k.points[1])}`;
          dots += `<circle cx="${n(k.points[0])}" cy="${n(k.points[1])}" r="${hs}" class="vec-handle"/>`;
        }
        if (hasOut(k)) {
          lines += `M${n(x)} ${n(y)}L${n(k.points[4])} ${n(k.points[5])}`;
          dots += `<circle cx="${n(k.points[4])}" cy="${n(k.points[5])}" r="${hs}" class="vec-handle"/>`;
        }
      }
      squares += `<rect x="${n(x - s / 2)}" y="${n(y - s / 2)}" width="${n(s)}" height="${n(s)}" class="vec-anchor ${sel.has(key) || filled ? 'selected' : ''}"/>`;
    });
  });
  return `<path d="${lines}" class="vec-handle-line" stroke-width="${1 / z}"/>${dots.replaceAll('class="vec-handle"', `class="vec-handle" stroke-width="${1 / z}"`)}<g stroke-width="${1 / z}">${squares}</g>`;
}
export function pathOverlay(e: Editor): string {
  if (!e.hasDocument || e.settings.hideTargetPath) return '';
  const t = targetPath(e);
  if (!t) return '';
  const mask = shownMask(t);
  const z = e.zoom;
  const tool = e.tool;
  const st = vstate(e);
  if (st.selectionKey !== activeKey(t)) {
    st.selectionKey = activeKey(t);
    st.paths = new Set();
    st.knots = [];
  }
  let out = `<path d="${maskToSvg(mask)}" class="vec-path" stroke-width="${1 / z}" fill="none"/>`;
  if (anchorTools.has(tool)) {
    const handles = tool === 'convert-point' ? 'all' : 'selected';
    out += anchorMarkup(e, mask, st.knots, { handlesFor: handles });
  } else if (tool === 'path-select' && st.paths.size) out += anchorMarkup(e, mask, [], { paths: st.paths, filledPaths: st.paths });
  return `<g class="vec-overlay">${out}</g>`;
}
