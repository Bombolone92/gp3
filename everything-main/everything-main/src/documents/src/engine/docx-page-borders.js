import { readParagraphBorders } from './docx-paragraph-borders.js';
import { checkedPageBorders, PAGE_BORDER_SIDES } from './page-borders.js';
import { UnsupportedDocumentError } from './errors.js';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
export function readPageBorders(section, readColor, attempt = read => read()) {
  const nodes = [...(section?.children || [])].filter(n => n.namespaceURI === W && n.localName === 'pgBorders');
  if (!nodes.length) return null;
  const fail = () => { throw new UnsupportedDocumentError('unsupported page borders'); };
  if (nodes.length !== 1) fail();
  const node = nodes[0], values = {};
  for (const attr of [...node.attributes]) {
    if (attr.namespaceURI === 'http://www.w3.org/2000/xmlns/') continue;
    if (attr.namespaceURI !== W || !['offsetFrom', 'display', 'zOrder'].includes(attr.localName)) fail();
    values[attr.localName] = attr.value;
  }
  // Container semantics apply to every side. Do not guess them during recovery.
  try { checkedPageBorders(values); }
  catch (error) { throw new UnsupportedDocumentError(`page borders (${error.message})`); }
  const seen = new Set();
  for (const child of [...node.childNodes]) {
    if (child.nodeType === 1 && (child.namespaceURI !== W || !PAGE_BORDER_SIDES.includes(child.localName))) fail();
    if ([3, 4].includes(child.nodeType) && child.textContent.trim()) fail();
    if (child.nodeType === 1) {
      if (seen.has(child.localName)) fail();
      seen.add(child.localName);
    }
  }
  const parsed = {};
  for (const child of [...node.children]) {
    const side = child.localName;
    const border = attempt(() => {
      try {
        if ([...child.attributes].some(a => a.namespaceURI !== 'http://www.w3.org/2000/xmlns/' && (a.namespaceURI !== W || !['val','sz','space','color','themeColor','themeTint','themeShade','frame','shadow'].includes(a.localName)))) fail();
        const wrapper = node.ownerDocument.createElementNS(W, 'w:pPr'), borders = node.ownerDocument.createElementNS(W, 'w:pBdr');
        wrapper.append(borders); borders.append(child.cloneNode(true));
        const value = readParagraphBorders(wrapper, readColor)[side];
        value.size = Number(child.getAttributeNS(W, 'sz') ?? 0);
        return checkedPageBorders({ ...values, borders: { [side]: value } }).borders[side];
      } catch (error) {
        throw new UnsupportedDocumentError(`page border ${side} omitted from preview (${error.message})`);
      }
    }, null);
    if (border) parsed[side] = border;
  }
  return checkedPageBorders({ ...values, borders: parsed });
}
export function writePageBorders(node, value, make) {
  value = checkedPageBorders(value);
  for (const attr of [...node.attributes]) if (attr.namespaceURI === W) node.removeAttributeNode(attr);
  for (const key of ['offsetFrom', 'display', 'zOrder']) node.setAttributeNS(W, 'w:' + key, value[key]);
  while (node.firstChild) node.removeChild(node.firstChild);
  for (const side of PAGE_BORDER_SIDES) if (value.borders[side]) {
    const border = value.borders[side], child = make(side);
    for (const [key, val] of Object.entries({val:border.style, sz:border.size, space:border.space, color:border.color, frame:border.frame ? '1' : '0', shadow:border.shadow ? '1' : '0'})) child.setAttributeNS(W, 'w:' + key, String(val));
    node.append(child);
  }
}
