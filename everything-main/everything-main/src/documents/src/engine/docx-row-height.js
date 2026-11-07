import { UnsupportedDocumentError } from './errors.js';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const fail = reason => { throw new UnsupportedDocumentError('table row heights with ' + reason); };

export function readRowHeight(node) {
  if (!node) return null;
  if ([...node.attributes].some(a => a.namespaceURI === W && !['val', 'hRule'].includes(a.localName)) || [...node.childNodes].some(n => n.nodeType === 1 || [3, 4].includes(n.nodeType) && n.textContent.trim())) fail('malformed declarations');
  // [MS-OI29500] §2.1.180: an omitted hRule is treated as atLeast,
  // unlike ECMA's auto default. An explicit auto still ignores val.
  const rule = node.getAttributeNS(W, 'hRule') ?? 'atLeast';
  if (!['auto', 'atLeast', 'exact'].includes(rule)) fail('an unknown height rule');
  const raw = (node.getAttributeNS(W, 'val') ?? '0').trim();
  const units = /^(\d+(?:\.\d+)?)(mm|cm|in|pt|pc|pi)$/.exec(raw);
  let value;
  if (units) value = Math.round(Number(units[1]) * { mm: 1440 / 25.4, cm: 1440 / 2.54, in: 1440, pt: 20, pc: 240, pi: 240 }[units[2]]);
  else {
    if (!/^\+?\d+$/.test(raw) || BigInt(raw) > 18446744073709551615n) fail('invalid measurements');
    value = Number(raw);
  }
  if (!Number.isFinite(value)) fail('invalid measurements');
  if (rule === 'auto') return { heightRule: rule, minHeight: 0 };
  if (!Number.isInteger(value) || value > 31680) fail('heights beyond 22 inches');
  if (rule === 'exact' && value === 0) fail('zero exact heights, which DOCX consumers do not support');
  return { heightRule: rule, minHeight: value };
}
