import { parseModelXml, modelChildren } from './data-model-metadata.js';
import { readNativePivotArea, nativePivotAreaRanges } from './native-pivot-area.js';

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const fail = reason => { throw new Error(`Invalid pivot area format: ${reason}`); };
const one = (node, name) => { const found = modelChildren(node, name, MAIN); if (found.length > 1) fail(`duplicate ${name}`); return found[0]; };
const uint = (node, name, fallback = null) => {
  if (!node?.hasAttribute(name)) return fallback;
  const raw = node.getAttribute(name).trim(), value = Number(raw);
  if (!/^\+?\d+$/.test(raw) || !Number.isSafeInteger(value) || value > 4294967295) fail(name);
  return value;
};
function supportedChildren(node, names) {
  for (const child of Array.from(node?.childNodes || [])) if (child.nodeType === 1 && (child.namespaceURI !== MAIN || !names.includes(child.localName))) {
    throw new Error(`Pivot area-specific ${child.localName} formatting is not implemented`);
  }
}

/** Keep area rules in XML order and resolve their workbook-local DXFs. Clearing,
 * drill/formula actions and future extensions require distinct behavior; none
 * may silently become an ordinary formatting overlay.
 */
export function readNativePivotFormats(pivot, native, { maxFormats = 1048576 } = {}) {
  if (!Number.isSafeInteger(maxFormats) || maxFormats < 0) fail('format limit');
  const root = parseModelXml(pivot.xml);
  if (root.namespaceURI !== MAIN || root.localName !== 'pivotTableDefinition') fail('report root');
  const formats = one(root, 'formats'), entries = modelChildren(formats, 'format', MAIN);
  if (entries.length > maxFormats) fail('format limit');
  if (uint(formats, 'count', entries.length) !== entries.length) fail('format count');
  supportedChildren(formats, ['format']);
  const decoded = new Map();
  return entries.map(entry => {
    supportedChildren(entry, ['pivotArea']);
    const action = entry.getAttribute('action') || 'formatting';
    if (action !== 'formatting') throw new Error(`Pivot area-specific ${action} formatting is not implemented`);
    const node = one(entry, 'pivotArea'); if (!node) fail('missing pivotArea');
    supportedChildren(node, ['references']);
    const references = one(node, 'references'); supportedChildren(references, ['reference']);
    for (const reference of modelChildren(references, 'reference', MAIN)) {
      supportedChildren(reference, ['x']);
      for (const item of modelChildren(reference, 'x', MAIN)) supportedChildren(item, []);
    }
    const area = readNativePivotArea(node, { fail }), id = uint(entry, 'dxfId');
    if (id == null) throw new Error('Pivot area-specific formatting without a differential format is not implemented');
    if (!decoded.has(id)) {
      const xml = native?.dxfs?.[id]; if (!xml) fail('missing differential format');
      const dxf = parseModelXml(xml);
      if (dxf.namespaceURI !== MAIN || dxf.localName !== 'dxf') fail('differential format root');
      decoded.set(id, xml);
    }
    return { area, dxf: decoded.get(id) };
  });
}

export function nativePivotFormatLayers(layout, formats, { maxRanges = 1048576, maxWork = 4 * 1048576, workBudget = null } = {}) {
  if (![maxRanges, maxWork].every(n => Number.isSafeInteger(n) && n >= 0)) fail('limit');
  const layers = [];
  workBudget ||= { remaining: maxWork };
  for (const format of formats) {
    // Bound all rules together, including repeated rules selecting no cells.
    const ranges = nativePivotAreaRanges(layout, format.area, { maxRanges: maxRanges - layers.length, maxWork, workBudget });
    for (const range of ranges) layers.push({ type: 'format', range, dxf: format.dxf });
  }
  return layers;
}
