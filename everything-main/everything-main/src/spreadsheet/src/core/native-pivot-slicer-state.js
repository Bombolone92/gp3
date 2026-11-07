import { decodeXlsxString } from './xlsx-string.js';
import { parseModelXml, modelChildren, standaloneModelXml } from './data-model-metadata.js';
const X14 = 'http://schemas.microsoft.com/office/spreadsheetml/2009/9/main';
const X15 = 'http://schemas.microsoft.com/office/spreadsheetml/2010/11/main';
const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const kids = (node, name, ns = X14) => modelChildren(node, name, ns);
const fail = message => { throw new Error(`Invalid native slicer: ${message}`); };
const one = (nodes, name) => { if (nodes.length !== 1) fail(`missing or ambiguous ${name}`); return nodes[0]; };
const name = (node, attr) => {
  const value = decodeXlsxString(node.getAttribute(attr));
  if (!value || value.length > 65534 || [...value].length > 32767) fail(attr);
  return value;
};
const uint = (node, attr, fallback, max = 4294967295, min = 0) => {
  if (!node.hasAttribute(attr) && fallback !== undefined) return fallback;
  const value = node.getAttribute(attr)?.trim();
  if (!/^\+?\d+$/.test(value || '') || !Number.isSafeInteger(Number(value)) || Number(value) < min || Number(value) > max) fail(attr);
  return Number(value);
};
const bool = (node, attr, fallback) => {
  if (!node.hasAttribute(attr)) return fallback;
  const value = node.getAttribute(attr).trim();
  if (!['true', 'false', '1', '0'].includes(value)) fail(attr);
  return value === 'true' || value === '1';
};
const choice = (node, attr, values, fallback) => {
  if (!node.hasAttribute(attr)) return fallback;
  const value = node.getAttribute(attr);
  if (!values.includes(value)) fail(attr);
  return value;
};
/** MS-XLSX 2.4.53: presence hides non-OLAP no-data items, even with no levels. */
export function readSlicerHideNoData(node) {
  const found = kids(node, 'extLst').flatMap(list => kids(list, 'ext', MAIN))
    .flatMap(ext => kids(ext, 'slicerCacheHideItemsWithNoData', X15));
  if (!found.length) return false;
  const hide = one(found, 'hide-no-data extension');
  if (uint(hide, 'count', 0) !== kids(hide, 'slicerCacheOlapLevelName', X15).length) fail('hide-no-data level count');
  return true;
}
// MS-XLSX 2.6.73, 2.6.83–85. Member indexes identify cache items;
// neither their order nor report sheet IDs are positional indexes.
export function readNativePivotSlicerBinding(node) {
  const data = kids(node, 'data', X14);
  if (!data.length) return {};
  const source = one(data, 'slicer cache data');
  const tabular = kids(source, 'tabular', X14);
  if (!tabular.length) return {}; // OLAP metadata remains in the original XML.
  if (kids(source, 'olap', X14).length) fail('ambiguous slicer source');
  const binding = one(tabular, 'tabular slicer cache');
  const crossFilter = choice(binding, 'crossFilter', ['showItemsWithDataAtTop', 'showItemsWithNoData', 'none'], 'showItemsWithDataAtTop');
  const lists = kids(binding, 'items', X14);
  let items = null;
  if (lists.length) {
    const list = one(lists, 'tabular slicer items');
    items = kids(list, 'i', X14).map(item => {
      if (crossFilter === 'none' && item.hasAttribute('nd')) fail('no-data flag without cross filtering');
      return { index: uint(item, 'x'), selected: bool(item, 's', false), noData: bool(item, 'nd', false) };
    });
    if (uint(list, 'count', items.length) !== items.length || !items.length) fail('tabular slicer item count');
    if (new Set(items.map(item => item.index)).size !== items.length) fail('duplicate tabular slicer item');
    if (!items.some(item => item.selected)) fail('empty tabular slicer selection');
  }
  const reports = kids(node, 'pivotTables', X14);
  const pivotTables = reports.length ? kids(one(reports, 'slicer pivot tables'), 'pivotTable', X14)
    .map(report => ({ tabId: uint(report, 'tabId'), name: name(report, 'name') })) : [];
  return { pivotCacheId: uint(binding, 'pivotCacheId'), pivotTables, items, hideItemsWithNoData: readSlicerHideNoData(node),
    sortOrder: choice(binding, 'sortOrder', ['ascending', 'descending'], 'ascending'),
    customListSort: bool(binding, 'customListSort', true), showMissing: bool(binding, 'showMissing', true), crossFilter };
}

function storedState(slicer, { requireItems = true } = {}) {
  if (slicer?.kind !== 'pivot' || typeof slicer.xml !== 'string' || slicer.xml.length > 16 * 1024 * 1024) fail('pivot cache storage');
  const root = parseModelXml(slicer.xml);
  if (root.namespaceURI !== X14 || root.localName !== 'slicerCacheDefinition') fail('pivot cache root');
  const binding = readNativePivotSlicerBinding(root);
  if (binding.pivotCacheId == null || requireItems && !binding.items) fail('saved tabular slicer items are unavailable');
  return { root, state: { ...slicer, ...binding,
    ...(Array.isArray(slicer.connections) ? { connections: slicer.connections.map(ref => ({ ...ref })) } : {}),
    name: name(root, 'name'), sourceName: name(root, 'sourceName') } };
}

/** Resolve authoritative saved identities and flags without altering XML. */
export function readNativePivotSlicerState(slicer, options) {
  return storedState(slicer, options).state;
}

/** Change selected flags without changing order, no-data flags or extensions.
 * Rebuild other caches' availability before committing a complete interaction. */
export function writeNativePivotSlicerSelection(slicer, selection) {
  const { root, state: binding } = storedState(slicer);
  const known = new Set(binding.items.map(item => item.index));
  if (selection !== null && (!Array.isArray(selection) || !selection.length || selection.some(index => !Number.isInteger(index) || !known.has(index)))) fail('invalid or empty slicer selection');
  const selected = selection === null ? known : new Set(selection);
  const tabular = kids(kids(root, 'data')[0], 'tabular')[0];
  for (const item of kids(kids(tabular, 'items')[0], 'i')) {
    if (selected.has(uint(item, 'x'))) item.setAttribute('s', '1');
    else item.removeAttribute('s');
  }
  return { ...binding,
    items: binding.items.map(item => ({ ...item, selected: selected.has(item.index) })), xml: standaloneModelXml(root) };
}
