import { UnsupportedDocumentError } from './errors.js';

// Recovery is a display-only import policy. The source node stays unchanged.
export function readPreviewProperties(node, parse, onUnsupported = null) {
  try { return parse(node); }
  catch (error) {
    if (!onUnsupported || !(error instanceof UnsupportedDocumentError) || !node) throw error;
    // Probe complete groups so duplicate declarations cannot become valid
    // merely because recovery split them into individual children.
    const copy = node.cloneNode(true), groups = new Map();
    for (const child of copy.children) {
      const key = `${child.namespaceURI}:${child.localName}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(child);
    }
    let removed = false;
    for (const group of groups.values()) {
      const probe = node.cloneNode(false);
      for (const child of group) probe.appendChild(child.cloneNode(true));
      try { parse(probe); }
      catch (failure) {
        if (!(failure instanceof UnsupportedDocumentError)) throw failure;
        onUnsupported(failure);
        for (const child of group) child.remove();
        removed = true;
      }
    }
    if (!removed) throw error;
    return parse(copy);
  }
}
