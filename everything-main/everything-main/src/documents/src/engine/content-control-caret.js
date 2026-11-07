import { contentControlRanges } from './content-controls.js';

// A pointer can start or continue a selection without changing its anchor's
// SDT ownership. Focus-side stops describe the old destination only; drop
// them when the pointer moves instead of applying them at another offset.
export function pointerControlSelection(selection, position) {
  const extent = selection.controlSelection;
  if (!extent) {
    const caret = selection.controlCaret;
    return selection.anchor === selection.focus && caret?.side === 'inside' && position !== selection.anchor
      ? { id: caret.id, direction: position < selection.anchor ? -1 : 1 } : undefined;
  }
  return position === selection.focus ? { ...extent }
    : { id: extent.id, direction: extent.direction };
}

// Empty controls have no text interval for ordinary pointer selection to own.
// Preserve an existing owner when adjacent empty wrappers share one offset.
export function emptyControlPointerCaret(paragraphs, position, current) {
  const ranges = contentControlRanges(paragraphs).filter(r => r.start === position && r.end === position &&
    r.control.persistent && !r.control.picture && !r.control.plainText);
  const range = ranges.find(r => r.control.id === current?.id) || ranges[0];
  return range ? { id: range.control.id, side: 'inside' } : undefined;
}

// Document Home enters an empty rich-text wrapper at the document start.
// Its next ordinary arrow leaves the wrapper and restores its prompt.
export function documentStartControlCaret(paragraphs) {
  const range = contentControlRanges(paragraphs)[0];
  if (range?.start !== 0 || range.end !== 0 || !range.control.persistent || range.control.picture || range.control.plainText) return null;
  return { id: range.control.id, side: 'inside' };
}

// Home/End leave an empty owner even when the visible offset is unchanged.
// Keep the pre-restoration destination: a prompt may wrap onto more lines.
export function moveInlineControlHomeEnd(paragraphs, selection, target, direction) {
  if (selection.anchor !== selection.focus || selection.controlCaret?.side !== 'inside') return null;
  const range = inlineControlCaret(paragraphs, selection.focus, selection.controlCaret);
  if (!range || range.start !== range.end) return null;
  return { restoreEmpty: true, destination: target, controlCaret: { id: range.control.id, side: direction < 0 ? 'before' : 'after' } };
}

// A visible text offset cannot distinguish the two sides of an SDT boundary.
// Keep this selection metadata separate from the document's text and runs.
export function inlineControlCaret(paragraphs, position, caret) {
  if (!caret || !['before', 'inside', 'after'].includes(caret.side)) return null;
  const range = contentControlRanges(paragraphs).find(r => r.control.id === caret.id);
  if (!range?.control.persistent || range.control.picture || range.control.plainText) return null;
  const valid = caret.side === 'before' ? position === range.start
    : caret.side === 'after' ? position === range.end : range.start <= position && position <= range.end;
  return valid ? range : null;
}

export function adjacentInlineControl(paragraphs, owner, direction) {
  const ranges = contentControlRanges(paragraphs), index = ranges.findIndex(r => r.control.id === owner.control.id && r.paragraph === owner.paragraph);
  const next = ranges[index + direction];
  return next && next.paragraph === owner.paragraph && next.control.persistent && !next.control.picture && !next.control.plainText &&
    (direction > 0 ? owner.end === next.start : owner.start === next.end) ? next : null;
}

export function splitControlCaretRuns(runs, position, caret) {
  const indices = runs.flatMap((run, index) => run.contentControl?.id === caret.id ? [index] : []);
  const cut = caret.side === 'before' ? indices[0] : indices.at(-1) + 1;
  const before = [], after = [];
  let at = 0;
  for (const [index, run] of runs.entries()) {
    if (!run.text && run.contentControl) {
      (at < position || at === position && index < cut ? before : after).push({ ...run });
    } else {
      const offset = Math.max(0, Math.min(run.text.length, position - at));
      if (offset) before.push({ ...run, text: run.text.slice(0, offset) });
      if (offset < run.text.length) after.push({ ...run, text: run.text.slice(offset) });
    }
    at += run.text.length;
  }
  return { before, after };
}

// Rich-text controls have two caret stops at each visible boundary. An empty
// control requests prompt restoration when the inside caret leaves it.
export function moveInlineControlCaret(paragraphs, selection, target, direction) {
  const ranges = contentControlRanges(paragraphs).filter(r =>
    r.control.persistent && !r.control.picture && !r.control.plainText);
  const { anchor, focus, controlCaret } = selection;
  const point = (r, side, position) => ({ anchor: position, focus: position, controlCaret: { id: r.control.id, side } });
  const enter = r => r.control.placeholder && r.start < r.end
    ? { anchor: direction > 0 ? r.start : r.end, focus: direction > 0 ? r.end : r.start }
    : point(r, 'inside', direction > 0 ? r.start : r.end);
  if (anchor !== focus) {
    const prompt = ranges.find(r => r.control.placeholder && Math.min(anchor, focus) === r.start && Math.max(anchor, focus) === r.end);
    return prompt ? point(prompt, direction > 0 ? 'after' : 'before', direction > 0 ? prompt.end : prompt.start) : null;
  }
  const current = ranges.find(r => r.control.id === controlCaret?.id);
  if (current && controlCaret.side === 'inside') {
    if (current.start === current.end) return { ...point(current, direction > 0 ? 'after' : 'before', focus), restoreEmpty: true };
    if (direction > 0 && focus === current.end) return point(current, 'after', focus);
    if (direction < 0 && focus === current.start) return point(current, 'before', focus);
    if (current.start <= target && target <= current.end) return point(current, 'inside', target);
  }
  const ordered = direction > 0 ? ranges : [...ranges].reverse();
  const currentIndex = ordered.indexOf(current);
  const entry = ordered.find((r, i) => (direction > 0 ? r.start === focus : r.end === focus) &&
    (currentIndex < 0 || i >= currentIndex) &&
    (r !== current || controlCaret.side === (direction > 0 ? 'before' : 'after')));
  if (entry) return enter(entry);
  const interior = ranges.find(r => r.start < focus && focus < r.end && r.start <= target && target <= r.end);
  if (interior) return point(interior, 'inside', target);
  const landing = ordered.find(r => direction > 0 ? r.start === target : r.end === target);
  if (landing) return point(landing, direction > 0 ? 'before' : 'after', target);
  return null;
}
