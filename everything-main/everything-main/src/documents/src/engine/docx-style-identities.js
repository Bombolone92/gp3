const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const styleNodes = doc => [...doc.documentElement.children].filter(n => n.namespaceURI === W && n.localName === 'style');

/** A private XML view for read-only recovery; source package bytes stay intact. */
export function recoverStyleIdentities(doc, part, onError, excluded = new Set()) {
  if (!doc || doc.documentElement.namespaceURI !== W || doc.documentElement.localName !== 'styles') return doc;
  const counts = new Map();
  let missing = false;
  for (const node of styleNodes(doc)) {
    const id = node.getAttributeNS(W, 'styleId');
    if (!id) missing = true;
    else counts.set(id, (counts.get(id) || 0) + 1);
  }
  if (missing) onError(new Error(`${part}: style without an ID is omitted from the read-only preview; unrelated styles and document defaults are retained.`));
  for (const [id, count] of counts) if (count > 1) {
    excluded.add(id);
    onError(new Error(`${part}: duplicate style ID ${id}; all declarations of this identity are omitted from the read-only preview.`));
  }
  if (!missing && ![...counts.keys()].some(id => excluded.has(id))) return doc;
  const view = doc.cloneNode(true);
  for (const node of styleNodes(view)) {
    const id = node.getAttributeNS(W, 'styleId');
    if (!id || excluded.has(id)) node.remove();
  }
  return view;
}

/** Break only edges inside cycles; descendants and own declarations survive. */
export function recoverStyleInheritance(doc, part, onError) {
  if (!doc || doc.documentElement.namespaceURI !== W || doc.documentElement.localName !== 'styles') return doc;
  const nodes = new Map(styleNodes(doc).map(node => [node.getAttributeNS(W, 'styleId'), node]));
  const type = node => node.getAttributeNS(W, 'type') || 'paragraph';
  const parent = node => [...node.children].find(n => n.namespaceURI === W && n.localName === 'basedOn');
  const edges = new Map();
  for (const [id, node] of nodes) {
    const base = parent(node)?.getAttributeNS(W, 'val');
    // Existing resolvers stop at missing or differently typed bases.
    // Numbering styles do not inherit through basedOn (§17.7.4.3).
    if (['paragraph', 'character', 'table'].includes(type(node)) && nodes.has(base) && type(nodes.get(base)) === type(node)) edges.set(id, base);
  }
  const visited = new Set(), cyclic = new Set();
  for (const start of nodes.keys()) {
    if (visited.has(start)) continue;
    const path = [], positions = new Map();
    let id = start;
    while (id !== undefined && !visited.has(id) && !positions.has(id)) {
      positions.set(id, path.length); path.push(id); id = edges.get(id);
    }
    if (positions.has(id)) {
      const cycle = path.slice(positions.get(id));
      cycle.forEach(key => cyclic.add(key));
      onError(new Error(`${part}: cyclic style inheritance (${cycle.join(', ')}); cyclic basedOn links are ignored in the read-only preview; own formatting and unrelated styles are retained.`));
    }
    path.forEach(key => visited.add(key));
  }
  if (!cyclic.size) return doc;
  const view = doc.cloneNode(true);
  for (const node of styleNodes(view)) {
    if (cyclic.has(node.getAttributeNS(W, 'styleId'))) parent(node)?.remove();
  }
  return view;
}
