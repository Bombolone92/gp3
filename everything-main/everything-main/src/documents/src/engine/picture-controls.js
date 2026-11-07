import { contentControlRanges } from './content-controls.js';

export function selectedPictureControl(paragraphs, [start, end], removedControls) {
  return contentControlRanges(paragraphs).find(r => r.control.picture && !removedControls?.has(r.control.id) &&
    (start === end ? r.start < start && start < r.end : r.start <= start && end <= r.end));
}

export function checkPictureControlEdit(paragraphs, [start, end], hyperlink = false, removedControls) {
  for (const r of contentControlRanges(paragraphs)) {
    if (!r.control.picture || removedControls?.has(r.control.id)) continue;
    const intersects = start === end ? r.start < start && start < r.end : start < r.end && end > r.start;
    // An enclosing selection can remove the wrapper with its contents. Editing
    // only the contents must not leave text or an empty picture-only wrapper.
    const encloses = start <= r.start && end >= r.end && (start < r.start || end > r.end);
    if (intersects && (hyperlink || !encloses)) throw new Error('A picture content control only accepts pictures. Select outside the control to remove its wrapper.');
  }
}
