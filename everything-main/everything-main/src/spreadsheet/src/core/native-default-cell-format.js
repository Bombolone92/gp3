import { parseModelXml, modelChildren, standaloneModelXml } from './data-model-metadata.js';
import { normalizeNativeNormalStyle } from './native-normal-style.js';
import { cloneStyle } from './style-values.js';
import { nativeFillIsNone } from './native-fill.js';

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const LIMIT = 1048576;
const fail = () => { throw new Error('Invalid native default cell format'); };

/** Cell XF zero is the default for unallocated cells. It is independent of
 * the named Normal style, which supplies font metrics and table-style baselines.
 * Keep its native records as well as the supported, sparse model projection. */
export function readNativeDefaultCellFormat(records, namespaces = '', normalFont = records.font, normalFillId = 0) {
  if (['xf', 'font', 'fill', 'border'].some(key => !records[key])) return null;
  if (namespaces.length > LIMIT) fail();
  if (!/\bxmlns\s*=/.test(namespaces)) namespaces += ` xmlns="${MAIN}"`;
  const out = {};
  for (const key of ['xf', 'font', 'fill', 'border']) {
    if (typeof records[key] !== 'string' || records[key].length > LIMIT) fail();
    const root = modelChildren(parseModelXml(`<styles ${namespaces}>${records[key]}</styles>`), key, MAIN)[0];
    if (!root) fail();
    out[key] = standaloneModelXml(root);
  }
  const xf = parseModelXml(out.xf), border = parseModelXml(out.border);
  const children = node => Array.from(node.childNodes).filter(child => child.nodeType === 1);
  const attributes = node => Array.from(node.attributes).filter(a => a.namespaceURI !== 'http://www.w3.org/2000/xmlns/');
  const plainFill = nativeFillIsNone(out.fill);
  const plainBorder = !attributes(border).length && children(border).every(edge => edge.namespaceURI === MAIN
    && ['left', 'right', 'top', 'bottom', 'diagonal'].includes(edge.localName) && !attributes(edge).length && !children(edge).length);
  // Vertical alignment already has a sheet-level representation. Avoid adding
  // an override to ordinary app files or foreign files with a plain default.
  const plainXf = children(xf).every(child => child.namespaceURI === MAIN && child.localName === 'alignment'
    && !children(child).length && attributes(child).every(a => a.name === 'vertical'))
    && Array.from(xf.attributes).every(a => ['fontId', 'fillId', 'borderId', 'numFmtId', 'xfId', 'applyAlignment', 'applyNumberFormat'].includes(a.name)
      || a.namespaceURI === 'http://www.w3.org/2000/xmlns/');
  if (records.font === normalFont && plainFill && Number(xf.getAttribute('fillId') || 0) === normalFillId && plainBorder && plainXf
    && (records.numberFormat === 0 || records.numberFormat === 'General')) return null;
  return normalizeNativeDefaultCellFormat({ ...out, numberFormat: records.numberFormat, style: {} });
}

export function normalizeNativeDefaultCellFormat(value) {
  if (value == null) return null;
  try {
    const records = normalizeNativeNormalStyle(value);
    if (typeof value.font !== 'string' || value.font.length > LIMIT) fail();
    const root = parseModelXml(value.font);
    if (root.namespaceURI !== MAIN || root.localName !== 'font') fail();
    if (!value.style || typeof value.style !== 'object' || Array.isArray(value.style)) fail();
    return { ...records, font: value.font, style: cloneStyle(value.style) };
  } catch { fail(); }
}

export function writeNativeDefaultCellFormat(value, ids, valign) {
  const root = parseModelXml(value.xf);
  for (const [name, id] of Object.entries({ ...ids, xfId: 0 })) root.setAttribute(name, String(id));
  const alignment = modelChildren(root, 'alignment', MAIN)[0];
  const vertical = { top: 'top', middle: 'center', bottom: 'bottom' }[valign];
  if (vertical) {
    const node = alignment || root.ownerDocument.createElementNS(MAIN, 'alignment');
    node.setAttribute('vertical', vertical);
    if (!alignment) root.insertBefore(node, root.firstChild);
  }
  return standaloneModelXml(root);
}

/** Draft comparison uses resource definitions, never archive-local indexes or
 * namespace prefixes. Fill sharing is compared separately by the draft codec. */
export function nativeDefaultCellFormatProjection(value) {
  if (!value) return value;
  const shape = node => node.nodeType === 1 ? [node.namespaceURI, node.localName,
    Array.from(node.attributes).filter(a => a.namespaceURI !== 'http://www.w3.org/2000/xmlns/')
      .map(a => [a.namespaceURI || '', a.localName, a.value]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    Array.from(node.childNodes).filter(n => n.nodeType === 1 || (n.nodeType === 3 || n.nodeType === 4) && n.data.trim()).map(shape)] : ['text', node.data];
  const out = { ...value };
  for (const key of ['xf', 'font', 'fill', 'border']) {
    const root = parseModelXml(value[key]);
    if (key === 'xf') for (const attribute of ['fontId', 'fillId', 'borderId', 'numFmtId', 'xfId']) root.removeAttribute(attribute);
    out[key] = shape(root);
  }
  return out;
}
