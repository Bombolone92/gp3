/**
 * The place in the document under a point on the screen, read from the
 * painted page. The engine's layout marks each run with its position range
 * (`data-pm-start`, `data-pm-end`) and each paragraph fragment with the id
 * of its block, so the browser's caret-from-point lookup inside a run plus
 * those attributes gives the block and text offset the selection API wants.
 *
 * A right-click does not move the caret in the engine; the app uses this to
 * put it where the pointer is before the context menu opens, the way word
 * processors do.
 */

const RUN = '.document-text-run';
const FRAGMENT = '[data-source-node-id]';

/** `{ node, offset }` at a point, via caretPositionFromPoint or caretRangeFromPoint. */
export function caretAtPoint(x, y, doc = document) {
  if (typeof doc.caretPositionFromPoint === 'function') {
    const p = doc.caretPositionFromPoint(x, y);
    if (p?.offsetNode) return { node: p.offsetNode, offset: p.offset };
  }
  if (typeof doc.caretRangeFromPoint === 'function') {
    const r = doc.caretRangeFromPoint(x, y);
    if (r?.startContainer) return { node: r.startContainer, offset: r.startOffset };
  }
  return null;
}

/** Characters before a browser caret inside any text or element descendant of `run`. */
export function offsetInRun(run, node, offset) {
  if (!run.contains(node)) return run.textContent.length;
  const range = run.ownerDocument.createRange();
  range.setStart(run, 0);
  const limit = node.nodeType === 3 ? node.textContent.length : node.childNodes.length;
  range.setEnd(node, Math.max(0, Math.min(offset, limit)));
  return range.toString().length;
}

/**
 * The position a paragraph's text starts at, taking the smallest run start
 * among every painted fragment of the block: a paragraph split across pages
 * paints as several fragments, and only the first begins at the start.
 */
export function blockStart(host, blockRef, fallback) {
  let start = Number.POSITIVE_INFINITY;
  if (blockRef) {
    for (const f of host.querySelectorAll(`[data-layout-block-ref="${cssEscape(blockRef)}"]`)) {
      const n = Number(f.dataset.pmStart);
      if (Number.isFinite(n) && n < start) start = n;
    }
  }
  return Number.isFinite(start) ? start : fallback;
}

function cssEscape(s) {
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&');
}

/**
 * `{ blockId, offset, story }` for the text under (x, y) inside `host`, or
 * null when the point is not on body text. `caret` can replace the
 * browser's lookup (tests).
 */
export function blockOffsetAtPoint(host, x, y, { caret = (px, py) => caretAtPoint(px, py) } = {}) {
  const hit = caret(x, y);
  if (!hit?.node) return null;
  const elementAt = hit.node.nodeType === 1 ? hit.node : hit.node.parentElement;
  const run = elementAt?.closest?.(RUN);
  if (!run || !host.contains(run)) return null;
  const fragment = run.closest(FRAGMENT);
  const blockId = fragment?.dataset.sourceNodeId;
  if (!blockId) return null;
  const story = fragment.dataset.layoutStory || 'body';
  if (story !== 'body') return null;
  const runStart = Number(run.dataset.pmStart);
  const fragmentStart = Number(fragment.dataset.pmStart);
  if (!Number.isFinite(runStart)) return null;
  const start = blockStart(host, fragment.dataset.layoutBlockRef, Number.isFinite(fragmentStart) ? fragmentStart : runStart);
  const offset = Math.max(0, runStart - start + offsetInRun(run, hit.node, hit.offset));
  return { blockId, offset, story };
}

/** The selection target that puts a collapsed caret at a point from blockOffsetAtPoint. */
export function caretSelection({ blockId, offset }) {
  const story = { kind: 'story', storyType: 'body' };
  const pt = { kind: 'text', blockId, offset, story };
  return { kind: 'selection', start: pt, end: pt, story };
}

/** Whether a `{ blockId, offset }` falls within the selection's text segments (`[{ blockId, range }]`). */
export function pointInSegments(segments, at) {
  if (!at) return false;
  return (segments || []).some((s) => s?.blockId === at.blockId && s.range && s.range.start <= at.offset && at.offset <= s.range.end);
}

/** Whether (x, y) lies inside one of the selection's painted rectangles. */
export function pointInRects(rects, x, y) {
  return (rects || []).some((r) => r && r.width > 0 && x >= r.left && x <= r.left + r.width && y >= r.top && y <= r.top + r.height);
}
