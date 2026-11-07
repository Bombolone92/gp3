import { parseModelXml, modelChildren, standaloneModelXml } from './data-model-metadata.js';
import { MAX_FORMAT_CODE_LENGTH } from './numfmt.js';

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const MAX_RECORD_XML = 1048576;
const fail = () => { throw new Error('Invalid native Normal style'); };

/** Normal is a named style, not necessarily cell XF zero. Its non-font records
 * also determine whether a cell's formatting overrides a table/PivotTable look.
 * Keep native records, including theme colors, patterns and protection, rather
 * than broadcasting a flattened Normal format to every worksheet cell.
 */
export function readNativeNormalStyle(records, namespaces = '') {
  if (!records.xf || !records.fill || !records.border) return null;
  if (namespaces.length > MAX_RECORD_XML || ['xf', 'fill', 'border'].some(name =>
    typeof records[name] !== 'string' || records[name].length > MAX_RECORD_XML)) fail();
  // Parse only three small records, never the entire potentially huge styles
  // part. Carry the parent's namespaces into records with extension content.
  if (!/\bxmlns\s*=/.test(namespaces)) namespaces += ` xmlns="${MAIN}"`;
  const parse = name => modelChildren(parseModelXml(`<styles ${namespaces}>${records[name]}</styles>`), name, MAIN)[0];
  const xf = parse('xf'), fill = parse('fill'), border = parse('border');
  if (!xf || !fill || !border) fail();
  const code = records.numberFormat;
  const elements = node => Array.from(node.childNodes).filter(child => child.nodeType === 1);
  const patterns = elements(fill);
  const plainFill = !patterns.length || patterns.length === 1 && patterns[0].namespaceURI === MAIN
    && patterns[0].localName === 'patternFill' && ['none', ''].includes(patterns[0].getAttribute('patternType')) && !elements(patterns[0]).length;
  const plainBorder = !border.attributes.length && elements(border).every(edge => edge.namespaceURI === MAIN
    && ['left', 'right', 'top', 'bottom', 'diagonal'].includes(edge.localName) && !edge.attributes.length && !elements(edge).length);
  const plainXf = !elements(xf).length && Array.from(xf.attributes).every(attribute =>
    ['fontId', 'fillId', 'borderId', 'numFmtId'].includes(attribute.name) || attribute.namespaceURI === 'http://www.w3.org/2000/xmlns/');
  if ((code === 0 || code === 'General') && plainFill && plainBorder && plainXf) return null;
  return normalizeNativeNormalStyle({ xf: standaloneModelXml(xf), fill: standaloneModelXml(fill), border: standaloneModelXml(border), numberFormat: code });
}

export function normalizeNativeNormalStyle(value) {
  if (value == null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) fail();
  const out = {};
  for (const name of ['xf', 'fill', 'border']) {
    const xml = value[name];
    if (typeof xml !== 'string' || xml.length > MAX_RECORD_XML) fail();
    const root = parseModelXml(xml);
    if (root.namespaceURI !== MAIN || root.localName !== name) fail();
    out[name] = xml;
  }
  // Built-in IDs include locale-dependent formats. A resolved SSF date string
  // must not become an explicit custom format with fixed punctuation/order.
  if (!(Number.isInteger(value.numberFormat) && value.numberFormat >= 0 && value.numberFormat < 164)
    && !(typeof value.numberFormat === 'string' && value.numberFormat.length <= MAX_FORMAT_CODE_LENGTH)) fail();
  out.numberFormat = value.numberFormat;
  return out;
}

/** Rebind resource indexes to this output archive, keeping the Normal font's
 * existing independent representation authoritative for font edits. */
export function writeNativeNormalStyle(value, { fillId, borderId, numFmtId }) {
  const root = parseModelXml(value.xf);
  for (const [name, id] of Object.entries({ fontId: 0, fillId, borderId, numFmtId })) root.setAttribute(name, String(id));
  return standaloneModelXml(root);
}
