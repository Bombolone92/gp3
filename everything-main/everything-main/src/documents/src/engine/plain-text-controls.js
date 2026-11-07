import { contentControlRanges } from './content-controls.js';
import { blockControlGroups } from './block-controls.js';

export function plainTextControlRanges(paragraphs) {
  return [...contentControlRanges(paragraphs), ...blockControlGroups(paragraphs)].filter(r => r.control.plainText);
}

// Formatting applies to the entire plain-text control even for an interior caret.
// Keep the editing selection unchanged; only formatting's effective range grows.
export function plainTextFormattingRange(paragraphs, range) {
  let [start, end] = range;
  for (const r of plainTextControlRanges(paragraphs)) {
    if (start === end ? start >= r.start && start < r.end : start < r.end && end > r.start) {
      start = Math.min(start, r.start); end = Math.max(end, r.end);
    }
  }
  return [start, end];
}

export function checkPlainTextObjects(paragraphs, [start, end]) {
  if (plainTextControlRanges(paragraphs).some(r => r.control.persistent &&
    (start === end ? start >= r.start && start < r.end : start < r.end && end > r.start)))
    throw new Error('A plain-text content control cannot contain pictures or hyperlinks.');
}

export function formatPlainTextInputs(paragraphs, [start, end], transform) {
  const changed = new Map();
  for (const r of plainTextControlRanges(paragraphs)) {
    // Placeholder appearance is separate from its input properties.
    if (!r.control.placeholder && start < r.end && end > r.start)
      changed.set(r.control.id, { ...r.control, inputRun: transform(structuredClone(r.control.inputRun)), inputChanged: true });
  }
  if (!changed.size) return;
  for (const p of paragraphs) {
    for (const r of p.runs) if (changed.has(r.contentControl?.id)) r.contentControl = changed.get(r.contentControl.id);
    if (p.blockControls) p.blockControls = p.blockControls.map(c => changed.get(c.id) || c);
  }
}
