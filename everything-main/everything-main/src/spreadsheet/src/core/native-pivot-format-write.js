import { parseModelXml, modelChildren, standaloneModelXml } from './data-model-metadata.js';
import { readNativePivotFormats, nativePivotFormatLayers } from './native-pivot-formats.js';
import { writeNativePivotPaint } from './native-pivot-paint-xml.js';
import { readNativePivotPaint } from './native-pivot-paint.js';
import { parseRefText } from './refs.js';

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const afterFormats = new Set(['conditionalFormats', 'chartFormats', 'pivotHierarchies', 'pivotTableStyleInfo', 'filters', 'rowHierarchiesUsage', 'colHierarchiesUsage', 'extLst']);
const fail = reason => { throw new Error(`Cannot write native pivot formats: ${reason}`); };

/** Prepare native rule updates from explicit semantic areas and resolved paint
 * deltas. No source-cell XF is inspected or copied. The caller must commit this
 * snapshot with its cell-format edits in one transaction; this is not itself an
 * editing/history entry point. Existing rules and unrelated XML remain intact.
 */
export function appendNativePivotFormats(native, pivot, layout, edits, { palette = null, themes = null,
  maxFormats = 1048576, maxWork = 4 * 1048576, maxXmlLength = 16 * 1024 * 1024, workBudget = null } = {}) {
  if (![maxFormats, maxWork, maxXmlLength].every(n => Number.isSafeInteger(n) && n >= 0)) fail('limit');
  if (!native?.tables?.includes(pivot)) fail('stale report');
  if (!Array.isArray(edits) || edits.length > maxFormats) fail('edit limit');
  const range = parseRefText(pivot.ref || '');
  if (!range || layout?.name !== pivot.name || layout.owner !== pivot.owner
    || ['r1', 'c1', 'r2', 'c2'].some(key => range[key] !== layout.range?.[key])) fail('report layout');
  if (!edits.length) return native;
  const existing = readNativePivotFormats(pivot, native, { maxFormats });
  if (existing.length + edits.length > maxFormats || (native.dxfs?.length || 0) > maxFormats
    || Object.keys(native.formats || {}).length > maxFormats) fail('format limit');
  let textBudget = maxXmlLength;
  const charge = length => { textBudget -= length; if (textBudget < 0) fail('XML size limit'); };
  charge(pivot.xml.length);
  for (const xml of native.dxfs || []) { if (typeof xml !== 'string') fail('differential format'); charge(xml.length); }
  const dxfs = [...(native.dxfs || [])], formats = { ...native.formats }, byDxf = new Map(dxfs.map((xml, id) => [xml, id])), byCode = new Map();
  for (const [key, code] of Object.entries(formats)) {
    const id = Number(key);
    if (!/^(?:0|[1-9]\d*)$/.test(key) || !Number.isSafeInteger(id) || id > 4294967295 || typeof code !== 'string') fail('number format table');
    charge(code.length);
    if (!byCode.has(code)) byCode.set(code, id);
  }
  const root = parseModelXml(pivot.xml), doc = root.ownerDocument;
  if (root.getAttribute('name') !== pivot.name) fail('report name');
  const make = name => doc.createElementNS(MAIN, root.prefix ? `${root.prefix}:${name}` : name);
  let collection = modelChildren(root, 'formats', MAIN)[0];
  if (!collection) {
    collection = make('formats');
    const following = Array.from(root.childNodes).find(n => n.nodeType === 1 && n.namespaceURI === MAIN && afterFormats.has(n.localName));
    root.insertBefore(collection, following || null);
  }
  // Custom number formats start at 164; fill unused IDs without renumbering old rules.
  let nextId = 164, formatCount = Object.keys(formats).length;
  for (const edit of edits) {
    if (typeof edit?.area !== 'string' || edit.area.length > textBudget) fail('area XML size');
    const area = parseModelXml(edit.area);
    if (area.namespaceURI !== MAIN || area.localName !== 'pivotArea') fail('area root');
    let numberFormatId = null;
    if (edit.style && (Object.hasOwn(edit.style, 'fmt') || Object.hasOwn(edit.style, 'code'))) {
      const code = edit.style.code;
      if (typeof code !== 'string') fail('number format code');
      if (byCode.has(code)) numberFormatId = byCode.get(code);
      else {
        if (formatCount >= maxFormats) fail('number format limit');
        while (Object.hasOwn(formats, nextId)) nextId++;
        if (nextId > 4294967295) fail('number format limit');
        charge(code.length);
        numberFormatId = nextId++; formats[numberFormatId] = code; byCode.set(code, numberFormatId); formatCount++;
      }
    }
    const xml = writeNativePivotPaint(edit.style, { palette, numberFormatId });
    readNativePivotPaint(xml, themes, { numberFormats: formats });
    let id = byDxf.get(xml);
    if (id == null) {
      if (dxfs.length >= maxFormats) fail('differential format limit');
      charge(xml.length);
      id = dxfs.length; dxfs.push(xml); byDxf.set(xml, id);
    }
    const rule = make('format'); rule.setAttribute('dxfId', String(id));
    rule.appendChild(doc.importNode(area, true));
    charge(standaloneModelXml(rule).length); collection.appendChild(rule);
  }
  collection.setAttribute('count', String(existing.length + edits.length));
  const next = { ...pivot, xml: standaloneModelXml(root) }, result = { ...native, dxfs, formats, tables: native.tables.map(p => p === pivot ? next : p) };
  if (next.xml.length > maxXmlLength) fail('XML size limit');
  // Validate selectors and their shared work/range budget before exposing any
  // updated state. A late malformed/unsupported edit cannot partially append.
  nativePivotFormatLayers(layout, readNativePivotFormats(next, result, { maxFormats }), { maxRanges: maxFormats, maxWork, workBudget });
  return result;
}
