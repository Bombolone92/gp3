import { writeBookmark } from './docx-bookmarks.js';
import { sortedBookmarks } from './bookmarks.js';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

export function writeControlPlaceholder(wrapper, control, doc) {
  if (!control.persistent) return;
  const properties = [...wrapper.children].find(n => n.namespaceURI === W && n.localName === 'sdtPr');
  const showing = [...properties.children].find(n => n.namespaceURI === W && n.localName === 'showingPlcHdr');
  if (!control.placeholder) showing?.remove();
  else if (showing) showing.removeAttributeNS(W, 'val');
  else {
    const marker = doc.createElementNS(W, 'w:showingPlcHdr');
    properties.insertBefore(marker, [...properties.children].find(n => n.namespaceURI !== W || !['rPr', 'alias', 'tag', 'id', 'lock', 'placeholder', 'temporary'].includes(n.localName)) || null);
  }
}

// A cell serializes only wrappers introduced inside that cell. Wrappers around
// its containing table are written by the parent block sequence.
export function appendControlledBlocks(parent, entries, write, doc, scope = null, before = null) {
  const active = new Map(entries.flatMap(entry => (entry.blockControls || []).map(c => [c.id, c])));
  const entryParagraphs = entry => entry.type === 'table' ? entry.rows.flatMap(row => row.cells.flatMap(cell => cell.content.flatMap(entryParagraphs))) : [entry.paragraph || entry];
  const events = [];
  for (const entry of entries) {
    const paragraphs = entryParagraphs(entry);
    const markers = paragraphs.flatMap(p => sortedBookmarks(p).filter(m => m.blockScope === scope && (m.blockBoundary === 'before' && m.offset === 0 || m.blockBoundary === 'after' && m.offset === p.runs.reduce((n,r) => n+r.text.length,0)+1)));
    const markerEntry = marker => ({ marker, blockControls: (marker.blockControls || []).filter(c => active.has(c.id)).map(c => active.get(c.id)) });
    events.push(...markers.filter(m => m.blockBoundary === 'before').map(markerEntry), entry, ...markers.filter(m => m.blockBoundary === 'after').map(markerEntry));
  }
  let stack = [];
  for (const entry of events) {
    const controls = (entry.blockControls || []).filter(c => c.scope === scope && c.kind !== 'cell');
    let common = 0;
    while (common < controls.length && common < stack.length && stack[common].id === controls[common].id) common++;
    stack = stack.slice(0, common);
    for (const control of controls.slice(common)) {
      const parsed = new DOMParser().parseFromString(control.shell, 'application/xml');
      const wrapper = doc.importNode(parsed.documentElement, true);
      const content = [...wrapper.children].find(n => n.namespaceURI === W && n.localName === 'sdtContent');
      if (!content) throw new Error('A retained block control has no content container.');
      writeControlPlaceholder(wrapper, control, doc);
      content.replaceChildren();
      if (stack.length) stack.at(-1).content.append(wrapper); else parent.insertBefore(wrapper, before);
      stack.push({ id: control.id, content });
    }
    const node = entry.marker ? writeBookmark(entry.marker, doc) : write(entry);
    if (stack.length) stack.at(-1).content.append(node); else parent.insertBefore(node, before);
  }
}
