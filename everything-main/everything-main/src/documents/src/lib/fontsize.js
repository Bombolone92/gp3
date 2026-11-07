import { paragraphText, runPieces, paintedAcross } from './textcase.js';

/** The font sizes offered when the engine lists none, and the ladder that stepping climbs. */
export const FALLBACK_SIZES = ['8', '9', '10', '11', '12', '14', '16', '18', '20', '24', '28', '32', '36', '48', '72'];

/** The next font size up or down the ladder from `current` (any number). */
export function stepFontSize(current, dir) {
  const cur = Number.parseFloat(String(current ?? ''));
  const ladder = FALLBACK_SIZES.map(Number);
  if (!Number.isFinite(cur)) return dir > 0 ? 12 : 11;
  if (dir > 0) return ladder.find((s) => s > cur + 0.01) ?? Math.min(400, Math.round(cur + 12));
  return [...ladder].reverse().find((s) => s < cur - 0.01) ?? Math.max(1, Math.round(cur - 1));
}

const BODY = { kind: 'story', storyType: 'body' };
const selectionOf = (blockId, start, end, story) => ({
  kind: 'selection',
  start: { kind: 'text', blockId, offset: start, story },
  end: { kind: 'text', blockId, offset: end, story },
  story,
});

/**
 * Grow or shrink every run in `segments` (the engine's selection segments)
 * by a step from its own size. The engine names no size for a selection that
 * mixes sizes, and one step from a default flattened them all to one size.
 * Each painted run's size comes from the page (its computed size is not
 * scaled by the zoom); neighboring runs of one size step together.
 * Resolves `{ changed, skipped }`: runs resized, and paragraphs left alone
 * because they were not painted or hold more than plain text.
 */
export async function stepMixedSizes(api, segments, dir, { host, story = BODY, onChange = () => {}, beforeWrite = () => {} } = {}) {
  let changed = 0;
  let skipped = 0;
  for (const seg of segments || []) {
    const range = seg?.range;
    if (!seg?.blockId || !range || !(range.end > range.start)) continue;
    let node = null;
    try {
      node = await (story.storyType === 'body'
        ? api.getNodeById({ nodeId: seg.blockId })
        : api.getNode({ kind: 'block', nodeType: 'paragraph', nodeId: seg.blockId, story }));
    } catch { /* leave text alone when its source cannot be read */ }
    const text = paragraphText(node);
    const pieces = text == null ? [] : runPieces(host, seg.blockId, range, text, { withSize: true }).filter((p) => p.size > 0);
    if (!pieces.length) { skipped += 1; continue; }
    if (!paintedAcross(host, seg.blockId, range, text)) skipped += 1;
    const groups = [];
    for (const p of pieces) {
      const last = groups.at(-1);
      if (last && last.end === p.start && last.size === p.size) last.end = p.end; else groups.push({ start: p.start, end: p.end, size: p.size });
    }
    for (const g of groups) {
      beforeWrite();
      const r = await api.format.fontSize({ target: selectionOf(seg.blockId, g.start, g.end, story), value: stepFontSize(g.size, dir) });
      if (r == null || (r.success === false && r.failure?.code !== 'NO_OP')) throw new Error(r?.failure?.message || 'Could not change the font size');
      changed += 1;
      if (r.success !== false) onChange();
    }
  }
  return { changed, skipped };
}
