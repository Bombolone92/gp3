import { strToU8 } from 'fflate';
import { parseXml } from './docx-xml.js';
import { UnsupportedDocumentError } from './errors.js';
import { checkedHyperlinkTarget, hyperlinkId } from './hyperlinks.js';
import { relationshipPartPath } from './package-part-paths.js';

const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const XMLNS = 'http://www.w3.org/2000/xmlns/';
const fail = why => { throw new UnsupportedDocumentError(`drawing hyperlink with ${why}`); };

export function readDrawingHyperlink(node, relationships, { inactive = false } = {}) {
  const allowed = ['tooltip', 'tgtFrame', 'history', 'highlightClick', 'endSnd', 'action', 'invalidUrl'];
  for (const a of node.attributes) {
    if (a.namespaceURI === XMLNS || a.namespaceURI === R && a.localName === 'id') continue;
    if (a.namespaceURI || !allowed.includes(a.localName)) fail('unsupported attributes');
  }
  if (node.children.length || node.textContent.trim()) fail('unsupported child content');
  const value = name => node.getAttribute(name)?.trim();
  for (const name of ['history', 'highlightClick', 'endSnd']) if (node.hasAttribute(name) && !['true','false','1','0'].includes(value(name))) fail('invalid boolean attributes');
  if (node.getAttribute('action') || node.getAttribute('invalidUrl') || ['true','1'].includes(value('endSnd'))) fail('unsupported actions');
  // Inner PIC links are retained metadata; their target frame is never
  // used by our opener. Active wp:docPr links still require supported behavior.
  if (!inactive && node.getAttribute('tgtFrame') && node.getAttribute('tgtFrame') !== '_blank') fail('unsupported target frames');
  const sourceId = node.getAttributeNS(R, 'id');
  const matches = [...(relationships?.documentElement?.children || [])].filter(r => r.getAttribute('Id') === sourceId);
  const rel = matches[0];
  if (!sourceId || matches.length !== 1 || rel.namespaceURI !== REL || rel.localName !== 'Relationship' || rel.getAttribute('Type') !== `${R}/hyperlink` || rel.getAttribute('TargetMode') !== 'External') fail('missing, duplicate or unsupported relationships');
  // As for text links, a destination the editor cannot open is kept verbatim.
  const target = rel.getAttribute('Target');
  let retainedTarget = false;
  try { checkedHyperlinkTarget(target); } catch { retainedTarget = true; }
  return { id: hyperlinkId(), sourceId, target, tooltip: node.getAttribute('tooltip') || '', history: !['false','0'].includes(value('history')), ...(retainedTarget ? { retainedTarget } : {}) };
}

// Allocate edited destinations before the text hyperlink writer reads this part.
// Shared source relationships and inactive inner-picture metadata stay untouched.
export function drawingHyperlinkWriter(parts, images, sourcePart = 'word/document.xml') {
  const path = relationshipPartPath(sourcePart);
  const changed = images.filter(image => image.hyperlinkChanged), ids = new Map();
  let rels;
  for (const image of changed) {
    if (!image.hyperlink) continue;
    const target = image.hyperlink.retainedTarget ? image.hyperlink.target : checkedHyperlinkTarget(image.hyperlink.target);
    if (typeof target !== 'string' || !target) throw new Error('Missing hyperlink target.');
    rels ||= parts[path] ? parseXml(parts[path]) : parseXml(`<Relationships xmlns="${REL}"/>`);
    const entries = [...rels.documentElement.children];
    let rel = entries.find(r => r.getAttribute('Type') === `${R}/hyperlink` && r.getAttribute('TargetMode') === 'External' && r.getAttribute('Target') === target);
    if (!rel) {
      const used = new Set(entries.map(r => r.getAttribute('Id'))); let i = 1;
      while (used.has(`rDrawingLink${i}`)) i++;
      rel = rels.createElementNS(REL, 'Relationship');
      for (const [key, value] of Object.entries({ Id: `rDrawingLink${i}`, Type: `${R}/hyperlink`, TargetMode: 'External', Target: target })) rel.setAttribute(key, value);
      rels.documentElement.append(rel);
    }
    ids.set(image, rel.getAttribute('Id'));
  }
  if (rels) parts[path] = strToU8(new XMLSerializer().serializeToString(rels));
  return (drawing, image) => {
    if (!image.hyperlinkChanged) return drawing;
    const properties = drawing.getElementsByTagNameNS(WP, 'docPr')[0];
    if (!properties) throw new Error('The drawing hyperlink has no properties.');
    const old = [...properties.children].find(n => n.namespaceURI === A && n.localName === 'hlinkClick');
    if (!image.hyperlink) { old?.remove(); return drawing; }
    const link = old || drawing.ownerDocument.createElementNS(A, 'a:hlinkClick');
    if (!old) properties.insertBefore(link, properties.firstChild);
    link.setAttributeNS(XMLNS, 'xmlns:r', R);
    link.setAttributeNS(R, 'r:id', ids.get(image));
    return drawing;
  };
}
