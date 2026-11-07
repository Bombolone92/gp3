import { bookmarkEntries } from './bookmarks.js';
import { contentControlRanges } from './content-controls.js';
import { blockControlGroups } from './block-controls.js';

// Glossary ranges belong to a separate story until the prompt is restored.
// Restoring a shared name moves the document bookmark to the last restored
// control. Copy affected paragraphs so an undo snapshot keeps the old ranges.
export function restorePlaceholderBookmarks(paragraphs, controls) {
  const requested = controls.filter(c => c?.placeholder && c.placeholderBookmarks);
  if (!requested.length) return paragraphs;
  const ranges = new Map([...contentControlRanges(paragraphs), ...blockControlGroups(paragraphs)].map(r => [r.control.id, r]));
  requested.sort((a, b) => (ranges.get(a.id)?.start ?? 0) - (ranges.get(b.id)?.start ?? 0));
  const next = [...paragraphs], copied = new Set();
  const mutable = index => {
    if (!copied.has(index)) {
      next[index] = { ...next[index], bookmarks: [...(next[index].bookmarks || [])] };
      copied.add(index);
    }
    return next[index];
  };
  for (const control of requested) {
    const range = ranges.get(control.id); if (!range) continue;
    const names = new Set(control.placeholderBookmarks.flat().filter(m => m.edge === 'start').map(m => m.name));
    const entries = bookmarkEntries(next), removed = new Set(entries.filter(e => names.has(e.name)).map(e => e.id));
    const used = new Set(entries.map(e => e.id));
    let id = 0, order = next.reduce((n, p) => (p.bookmarks || []).reduce((n, m) => Math.max(n, m.order), n), -1) + 1;
    const ids = new Map();
    for (let i = 0; i < next.length; i++) if (next[i].bookmarks?.some(m => removed.has(m.id))) mutable(i).bookmarks = next[i].bookmarks.filter(m => !removed.has(m.id));
    const first = next.findIndex(p => p.id === (range.paragraph || range.paragraphs[0]).id);
    for (const [paragraphIndex, markers] of control.placeholderBookmarks.entries()) for (const marker of markers) {
      if (!ids.has(marker.id)) { while (used.has(String(id))) id++; ids.set(marker.id, String(id)); used.add(String(id++)); }
      const restored = { ...marker, id: ids.get(marker.id), order: order++, offset: marker.offset + (range.paragraph ? range.localStart : 0) };
      if (range.paragraph) restored.contentControlId = control.id;
      mutable(first + paragraphIndex).bookmarks.push(restored);
    }
    if (range.paragraph) control.hasBookmarks = true;
  }
  bookmarkEntries(next);
  return next;
}
