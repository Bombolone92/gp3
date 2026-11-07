import { documentText, paragraphText } from './model.js';
import { proofingFingerprint } from '../lib/proofing-cache.js';
export { proofingFingerprint, wordsInSavedRanges } from '../lib/proofing-cache.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

export function completedSpelling(settings) {
  const states = [...(settings?.children || [])].filter(n => n.namespaceURI === W && n.localName === 'proofState');
  return states.length === 1 && states[0].getAttributeNS(W, 'spelling') === 'clean';
}

/** §17.13.8.1: each start matches the next end; unmatched anchors are ignored. */
export function bodySpellingCache(paragraphs, paragraphAnchors) {
  let offset = 0, pending = [];
  const ranges = [];
  for (const p of paragraphs) {
    const anchors = paragraphAnchors.get(p.id);
    // Recovered text without verified anchor offsets must be checked afresh.
    if (!anchors && paragraphText(p).length) return null;
    for (const marker of anchors || []) {
      if (marker.type === 'spellStart') pending.push(offset + marker.offset);
      else if (marker.type === 'spellEnd') {
        for (const start of pending) if (start < offset + marker.offset) ranges.push({ start, end: offset + marker.offset });
        pending = [];
      }
    }
    offset += paragraphText(p).length + 1;
  }
  ranges.sort((a, b) => a.start - b.start || a.end - b.end);
  const merged = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else merged.push({ ...range });
  }
  return { text: documentText(paragraphs), fingerprint: proofingFingerprint(paragraphs), ranges: merged };
}
