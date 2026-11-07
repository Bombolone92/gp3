const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const reference = node => node.namespaceURI === W && ['headerReference', 'footerReference'].includes(node.localName);
const key = node => node.localName + ':' + node.getAttributeNS(W, 'type');

// An omitted reference inherits from the preceding section. Removing that
// section must not silently change the surviving section's effective story.
// Materialize only references whose inherited meaning would otherwise change.
export function retainSectionStoryReferences(source, target, indices) {
  if (indices.length !== target.length || indices.some(index => !Number.isInteger(index) || index < 0 || index >= source.length)) throw new Error('Invalid surviving section identity.');
  let inherited = new Map();
  const original = source.map(section => {
    inherited = new Map(inherited);
    for (const node of section.children) if (reference(node)) inherited.set(key(node), node);
    return inherited;
  });
  inherited = new Map();
  for (const [i, section] of target.entries()) {
    const explicit = new Map([...section.children].filter(reference).map(node => [key(node), node]));
    for (const [name, desired] of original[indices[i]]) {
      if (explicit.has(name) || inherited.get(name)?.getAttributeNS(R, 'id') === desired.getAttributeNS(R, 'id')) continue;
      const node = section.ownerDocument.importNode(desired, true);
      const before = [...section.children].find(child => node.localName === 'headerReference' ? child.namespaceURI !== W || child.localName !== 'headerReference' : !reference(child));
      section.insertBefore(node, before || null); explicit.set(name, node);
    }
    for (const [name, node] of explicit) inherited.set(name, node);
  }
}
