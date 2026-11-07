const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const MAIN = 'main:/word/document.xml';
const key = (blockId, instruction) => JSON.stringify([blockId, instruction.trim()]);

/** Read actual cached-result ownership, including nested and multi-paragraph fields. */
export function fieldPictureOwners(document) {
  const stack = [], groups = [], owners = new Map();
  if (!document.getElementsByTagNameNS(W, 'fldSimple').length && !document.getElementsByTagNameNS(W, 'fldChar').length) return owners;
  let serial = 0;
  const frame = (paragraph, instruction, simple) => ({ blockId: paragraph?.getAttributeNS(W14, 'paraId'), instruction,
    simple, result: simple, complete: false, groups: new Map(), id: serial++ });
  const visit = (node, paragraph, elementLink = false) => {
    if (node.namespaceURI === W) {
      const name = node.localName;
      if (name === 'txbxContent') return; // A text box has its own story.
      if (name === 'p') paragraph = node;
      if (name === 'hyperlink') elementLink = true;
      if (name === 'fldSimple') {
        const owner = frame(paragraph, node.getAttributeNS(W, 'instr') || '', true), depth = stack.length;
        stack.push(owner);
        for (const child of node.children) visit(child, paragraph, elementLink);
        owner.complete = true; stack.length = depth;
        return;
      }
      if (name === 'fldChar') {
        const type = node.getAttributeNS(W, 'fldCharType');
        if (type === 'begin') stack.push(frame(paragraph, '', false));
        else if (type === 'separate' && stack.at(-1) && !stack.at(-1).simple) stack.at(-1).result = true;
        else if (type === 'end' && stack.at(-1) && !stack.at(-1).simple) stack.pop().complete = true;
        return;
      }
      if (name === 'instrText') {
        if (stack.at(-1) && !stack.at(-1).result) stack.at(-1).instruction += node.textContent;
        return;
      }
      const owner = !elementLink && stack.every(item => item.result)
        ? stack.findLast(item => /^\s*HYPERLINK(?:\s|$)/i.test(item.instruction)) : null;
      if (owner && ['drawing', 't', 'br', 'cr', 'tab', 'ptab', 'sym', 'noBreakHyphen', 'softHyphen', 'footnoteReference', 'endnoteReference', 'pict', 'object'].includes(name)) {
        const blockId = paragraph?.getAttributeNS(W14, 'paraId');
        if (!owner.groups.has(blockId)) {
          const group = { owner, blockId, drawings: [], text: [], other: false };
          owner.groups.set(blockId, group); groups.push(group);
        }
        const group = owner.groups.get(blockId);
        if (name === 'drawing' && node.getElementsByTagNameNS(PIC, 'pic').length) group.drawings.push(node);
        else if (name !== 't' || node.textContent.length) {
          group.other = true;
          if (name === 't') group.text.push(node);
        }
      }
      if (['drawing', 'pict', 'object'].includes(name)) return;
    }
    for (const child of node.children) visit(child, paragraph, elementLink);
  };
  visit(document.documentElement, null);
  for (const group of groups) {
    if (!group.owner.complete || !group.blockId || !group.owner.blockId) continue;
    for (const drawing of group.drawings) owners.set(drawing, {
      key: key(group.owner.blockId, group.owner.instruction), group: `field:${group.owner.id}:${group.blockId}`, empty: !group.other,
      textBefore: group.text.some(node => node.compareDocumentPosition(drawing) & 4),
      textAfter: group.text.some(node => node.compareDocumentPosition(drawing) & 2),
    });
  }
  return owners;
}

/** Resolve instructions with engine-parsed targets; never match by labels or shifted ordinals. */
export async function bindFieldPictures(api, images, sources, listFields = query => api.fields.list(query)) {
  if (!images.some(image => image.field) || !api.fields?.list) return;
  const targets = new Map();
  let offset = 0;
  while (true) {
    const result = await listFields({ limit: 1000, offset });
    const items = result.items || [];
    for (const field of items) {
      if (field.fieldType !== 'HYPERLINK' || field.address?.storyId !== MAIN) continue;
      // Native field hyperlink discovery namespaces the session-stable field ID.
      const source = sources.get(`hl-field:${field.address.fieldId || field.id}`);
      if (!source) continue;
      const identity = key(field.address.blockId, field.instruction);
      const target = { href: source.externalTarget, anchor: source.anchor, sourceIds: new Set([source.hyperlinkNodeId]) };
      if (!targets.has(identity)) targets.set(identity, target);
      else if (targets.get(identity)?.href !== target.href || targets.get(identity)?.anchor !== target.anchor) targets.set(identity, null);
      else targets.get(identity)?.sourceIds.add(source.hyperlinkNodeId);
    }
    offset += items.length;
    if (!items.length || offset >= result.total) break;
  }
  for (const image of images) {
    const target = image.field && targets.get(image.field.key);
    if (target && !image.hyperlink) image.hyperlink = { ...image.field, ...target };
  }
}
