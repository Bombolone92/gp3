/**
 * A PivotCache keeps the values of a field nothing has filtered or grouped by inline in its
 * records, with no list of shared items. A slicer or a timeline chooses members by shared-item
 * index, so when one is added the field is first turned into an indexed one:
 * its distinct values become sharedItems and each record refers to them with <x v="i"/>.
 * Values keep their native spelling (a date stays an ISO date-time) and first-seen order.
 */
import { parseModelXml, modelChildren, standaloneModelXml } from './data-model-metadata.js';
import { readNativePivotCache, nativePivotItemValue } from './native-pivot-cache.js';

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const elements = node => Array.from(node?.childNodes || []).filter(n => n.nodeType === 1);
const fail = message => { throw new Error(`Cannot index pivot field: ${message}`); };

/** The cache with field `index` indexed; the same object when it already has shared items. */
export function indexNativePivotCacheField(cache, index) {
  const data = readNativePivotCache(cache, { includeRecords: false });
  const field = data.fields[index];
  if (!field) fail('missing field');
  if (field.items.length || !field.databaseField) return cache;
  if (!cache.records) fail('the cache has no saved records');
  const column = data.recordFields.indexOf(index);
  const root = parseModelXml(cache.xml), records = parseModelXml(cache.records);
  const doc = records.ownerDocument;
  const name = local => (records.prefix ? `${records.prefix}:${local}` : local);
  const seen = new Map(), order = [];
  let blank = false;
  for (const row of modelChildren(records, 'r', MAIN)) {
    const value = elements(row)[column];
    if (!value) fail('record width');
    if (value.localName === 'x') fail('mixed indexed and inline values');
    const item = nativePivotItemValue(value);
    const key = `${item.type}:${item.value}`;
    if (!seen.has(key)) { seen.set(key, order.length); order.push(value.cloneNode(true)); }
    if (item.type === 'blank') blank = true;
    const x = doc.createElementNS(MAIN, name('x'));
    x.setAttribute('v', String(seen.get(key)));
    row.replaceChild(x, value);
  }
  const cacheField = modelChildren(modelChildren(root, 'cacheFields', MAIN)[0], 'cacheField', MAIN)[index];
  const shared = modelChildren(cacheField, 'sharedItems', MAIN)[0];
  if (!shared) fail('missing sharedItems');
  for (const node of order) {
    const copy = root.ownerDocument.importNode(node, true);
    shared.appendChild(copy);
  }
  shared.setAttribute('count', String(order.length));
  if (blank) shared.setAttribute('containsBlank', '1');
  return { ...cache, xml: standaloneModelXml(root), records: standaloneModelXml(records) };
}

/** The native pivots with that field of a cache indexed. */
export function indexNativePivotField(pivots, cacheKey, index) {
  const cache = pivots.caches.find(c => c.key === cacheKey);
  const next = indexNativePivotCacheField(cache, index);
  return next === cache ? pivots : { ...pivots, caches: pivots.caches.map(c => (c === cache ? next : c)) };
}

/**
 * Excel binds a PivotTable slicer to its field through the report's pivotField items (the slicer's
 * choice is those items' hidden flags), so a field that sits outside the layout, a value field say,
 * gets its item list as Excel writes one: every shared item in cache order, then the default subtotal.
 */
export function withFieldItems(xml, index, count) {
  const root = parseModelXml(xml);
  const fields = modelChildren(modelChildren(root, 'pivotFields', MAIN)[0], 'pivotField', MAIN);
  const field = fields[index];
  if (!field || modelChildren(field, 'items', MAIN).length) return xml;
  const make = name => root.ownerDocument.createElementNS(MAIN, root.prefix ? `${root.prefix}:${name}` : name);
  const items = make('items');
  for (let i = 0; i < count; i++) { const item = make('item'); item.setAttribute('x', String(i)); items.appendChild(item); }
  if (!['0', 'false'].includes(field.getAttribute('defaultSubtotal'))) { const item = make('item'); item.setAttribute('t', 'default'); items.appendChild(item); }
  items.setAttribute('count', String(items.childNodes.length));
  field.insertBefore(items, field.firstChild);
  return standaloneModelXml(root);
}
