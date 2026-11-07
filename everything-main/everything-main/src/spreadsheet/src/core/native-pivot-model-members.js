import { parseModelXml, modelChildren, standaloneModelXml } from './data-model-metadata.js';
import { readNativePivotCache, nativePivotItemValue } from './native-pivot-cache.js';
import { readNativePivotLayout, nativePivotModelContext } from './native-pivot-layout.js';
import { nativePivotOlapAttribute, nativePivotOlapFilters } from './native-pivot-olap-filters.js';
import { readNativePivotArea, PIVOT_DATA_FIELD } from './native-pivot-area.js';
import { createDataModelEvaluation } from './data-model-evaluate.js';
import { encodeXlsxAttribute } from './xlsx-string.js';

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const fail = reason => { throw new Error(`Cannot rebuild model pivot members: ${reason}`); };
const children = (node, name) => modelChildren(node, name, MAIN);
const elements = node => Array.from(node?.childNodes || []).filter(n => n.nodeType === 1);
const child = (node, name) => { const found = children(node, name); if (found.length > 1) fail(`duplicate ${name}`); return found[0]; };
const make = (root, name) => root.ownerDocument.createElementNS(MAIN, root.prefix ? `${root.prefix}:${name}` : name);
const uint = (node, name, fallback = null) => {
  if (!node.hasAttribute(name)) return fallback;
  const raw = node.getAttribute(name), n = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(n) || n > 4294967295) fail(`invalid ${name}`);
  return n;
};
function identity(item, type) {
  if (item.type === 'blank') return null;
  if (type === 'integer' && item.type === 'number' && Number.isSafeInteger(item.value)) return BigInt(item.value);
  if (item.type === type && ['string', 'number'].includes(type)) return item.value;
  fail('member type or integer precision');
}
function sharedItems(root, previous, old, values, type) {
  const list = previous ? previous.cloneNode(false) : make(root, 'sharedItems');
  for (const name of ['minValue', 'maxValue', 'minDate', 'maxDate']) list.removeAttribute(name);
  const string = type === 'string', nonnull = values.filter(v => v !== null);
  for (const [name, value] of Object.entries({ count: values.length, containsBlank: values.includes(null),
    containsString: string && nonnull.length > 0, containsNumber: !string && nonnull.length > 0,
    containsInteger: !string && nonnull.length > 0 && nonnull.every(v => typeof v === 'bigint' || Number.isInteger(v)),
    containsDate: false, containsNonDate: nonnull.length > 0, containsMixedTypes: false,
    containsSemiMixedTypes: string || values.includes(null), longText: string && nonnull.some(v => v.length > 255) })) list.setAttribute(name, String(value));
  if (!string && nonnull.length) {
    let min = nonnull[0], max = min;
    for (const value of nonnull) { if (value < min) min = value; if (value > max) max = value; }
    list.setAttribute('minValue', String(min)); list.setAttribute('maxValue', String(max));
  }
  for (const value of values) {
    const existing = old.get(value);
    if (existing) { list.appendChild(existing.cloneNode(true)); continue; }
    if (typeof value === 'bigint' && !Number.isSafeInteger(Number(value))) fail('new integer member precision');
    const node = make(root, value === null ? 'm' : string ? 's' : 'n');
    if (value !== null) node.setAttribute('v', string ? encodeXlsxAttribute(value) : String(value));
    list.appendChild(node);
  }
  return list;
}
function remapAxes(root, layout, maps) {
  for (const [name, axis] of [['row', layout.rows], ['col', layout.columns]]) {
    const list = child(root, `${name}Items`); if (!list) continue;
    let previous = [];
    for (const item of children(list, 'i')) {
      const repeat = uint(item, 'r', 0), xs = children(item, 'x');
      if (repeat > previous.length) fail('axis prefix');
      const values = [...previous.slice(0, repeat), ...xs.map(x => uint(x, 'v', 0))]; previous = values;
      const marker = ['grand', 'blank'].includes(item.getAttribute('t'));
      let removed = false;
      const next = values.map((value, position) => {
        const map = marker ? null : maps.get(axis.fields[position]);
        if (!map) return value;
        if (!map.has(value)) fail('axis item index');
        const mapped = map.get(value); if (mapped === null) removed = true; return mapped;
      });
      if (removed) { list.removeChild(item); continue; }
      item.removeAttribute('r'); for (const x of xs) item.removeChild(x);
      for (const value of next) { const x = make(root, 'x'); if (value) x.setAttribute('v', String(value)); item.appendChild(x); }
    }
    const count = children(list, 'i').length;
    if (count) list.setAttribute('count', String(count)); else root.removeChild(list);
  }
}
function remapReferences(root, layout, sharedMaps, itemMaps) {
  for (const area of Array.from(root.getElementsByTagNameNS(MAIN, 'pivotArea'))) {
    const decoded = readNativePivotArea(area), nodes = children(child(area, 'references'), 'reference');
    decoded.references.forEach((reference, at) => {
      if (reference.field === PIVOT_DATA_FIELD) return;
      const map = (decoded.cacheIndex ? sharedMaps : itemMaps).get(reference.field);
      if (!map) return;
      if (reference.byPosition || reference.relative) fail('positional area references need regeneration');
      children(nodes[at], 'x').forEach((node, i) => {
        const next = map.get(reference.items[i]);
        if (next == null) fail('area references a removed or invalid member');
        node.setAttribute('v', String(next));
      });
    });
  }
  for (const [index, field] of children(child(root, 'dataFields'), 'dataField').entries()) {
    const { baseField, baseItem: base } = layout.measures[index], map = itemMaps.get(baseField);
    if (!map || base === null || base === 1048828 || base === 1048829) continue; // MS-OI29500 previous/next sentinels
    const next = map.get(base);
    if (next == null) {
      if ((field.getAttribute('showDataAs') || 'normal') !== 'normal') fail('removed base member');
      field.removeAttribute('baseItem'); // ignored metadata in normal calculations
    } else field.setAttribute('baseItem', String(next));
  }
}

/** Stage a model cache's canonical member domain and every connected report.
 * This does not mutate the workbook or refresh cells. Replan/materialize all
 * returned reports and commit the cache, reports and source model together.
 * Existing cache/field order and per-member metadata survive by exact canonical
 * identity; new members append in stored row order, before subtotal markers.
 * Collation belongs to the model dictionary writer, not caption matching here.
 */
export function prepareNativeModelPivotMembers(nativePivots, cacheKey, dataModel, { maxValues = 4 * 1048576 } = {}) {
  if (!Number.isSafeInteger(maxValues) || maxValues < 0 || maxValues > 16 * 1048576) fail('value limit');
  const matches = nativePivots?.caches?.filter(c => c.key === cacheKey) || [];
  if (matches.length !== 1) fail('missing or ambiguous cache');
  const cache = matches[0], reports = nativePivots.tables.filter(p => p.cache === cacheKey);
  if (!reports.length) fail('missing connected reports');
  const parsed = readNativePivotCache(cache, { maxCells: maxValues, includeRecords: false });
  const layouts = reports.map(p => readNativePivotLayout(p, cache)), layout = layouts[0];
  const session = createDataModelEvaluation({ dataModel }, { source: 'stored', maxValues });
  if (!layout.measures.length || layout.sourceType !== 'external' || cache.records) fail('model cache without records required');
  const root = parseModelXml(cache.xml), fields = children(child(root, 'cacheFields'), 'cacheField');
  const sharedMaps = new Map(), domains = new Map(); let work = 0;
  for (const [index, field] of layout.cacheFields.entries()) {
    if (layout.hierarchies[field.hierarchy]?.measure) continue;
    for (const current of layouts) nativePivotOlapAttribute(current, index);
    const bound = nativePivotModelContext(layout, { measure: layout.measures[0], members: [{ field: index, type: 'blank', value: null }] }, session.schema).filters[0];
    const { type, values } = session.storedColumn(bound.table, bound.column);
    if (!['string', 'integer', 'number'].includes(type)) fail('column type');
    if ((work += values.length + field.items.length) > maxValues) fail('value limit');
    const current = new Set(values), old = new Map(), nodes = elements(child(fields[index], 'sharedItems'));
    for (const node of nodes) {
      const key = identity(nativePivotItemValue(node), type);
      if (old.has(key)) fail('ambiguous canonical member'); old.set(key, node);
    }
    const next = [...old.keys()].filter(v => current.has(v));
    for (const value of current) if (!old.has(value)) next.push(value);
    if (next.length === old.size && next.every((v, i) => Object.is(v, identity(field.items[i], type)))) continue;
    if (elements(fields[index]).some(n => n.localName !== 'sharedItems' || n.namespaceURI !== MAIN)
      || !parsed.fields[index].databaseField || parsed.fields[index].serverField || parsed.fields[index].unused.some(Boolean)) fail('grouped, extended or unused member metadata');
    const indexes = new Map(next.map((v, i) => [v, i]));
    sharedMaps.set(index, new Map(field.items.map((item, i) => [i, indexes.get(identity(item, type)) ?? null])));
    domains.set(index, next);
    const previous = child(fields[index], 'sharedItems'), shared = sharedItems(root, previous, old, next, type);
    if (previous) fields[index].replaceChild(shared, previous); else fields[index].insertBefore(shared, fields[index].firstChild);
  }
  if (!sharedMaps.size) return { cache, reports: reports.map(pivot => ({ pivot, next: pivot })) };
  if (nativePivots.slicers?.some(s => s.cache === cacheKey)) fail('connected slicer members need rebuilding');
  if (['tupleCache', 'calculatedItems', 'calculatedMembers'].some(name => child(root, name))) fail('tuple or calculated member dependencies');
  const nextCache = { ...cache, xml: standaloneModelXml(root) };
  parseModelXml(nextCache.xml);
  const prepared = reports.map((pivot, at) => {
    const layout = layouts[at]; nativePivotOlapFilters(layout);
    const root = parseModelXml(pivot.xml), fields = children(child(root, 'pivotFields'), 'pivotField'), itemMaps = new Map();
    if (child(root, 'filters')) fail('dynamic filters need regeneration');
    for (const [index, map] of sharedMaps) {
      const field = fields[index], oldList = child(field, 'items'), oldItems = children(oldList, 'item');
      if (child(field, 'extLst') || elements(oldList).length !== oldItems.length) fail('extended report member metadata');
      const list = make(root, 'items'), positions = new Map(), present = new Set(), totals = [];
      let included = 0, survivingIncluded = 0;
      oldItems.forEach((item, position) => {
        const state = layout.fields[index].items[position];
        if (state.type !== 'data') { totals.push([item, position]); return; }
        if (!map.has(state.index) || present.has(state.index)) fail('invalid or duplicate report member');
        present.add(state.index); if (state.selected) included++;
        const next = map.get(state.index);
        if (next === null) { positions.set(position, null); return; }
        if (state.selected) survivingIncluded++;
        positions.set(position, list.childNodes.length);
        const copy = item.cloneNode(true); copy.setAttribute('x', String(next)); list.appendChild(copy);
      });
      const policy = nativePivotOlapAttribute(layout, index);
      if (!policy.includeNewItems && included && !survivingIncluded) fail('empty inclusion filter needs unique-name member state');
      const represented = new Set([...present].map(i => map.get(i)).filter(i => i !== null));
      for (let i = 0; i < domains.get(index).length; i++) if (!represented.has(i)) {
        const item = make(root, 'item'); item.setAttribute('x', String(i)); list.appendChild(item);
      }
      for (const [item, position] of totals) { positions.set(position, list.childNodes.length); list.appendChild(item.cloneNode(true)); }
      if ((work += list.childNodes.length) > maxValues) fail('value limit');
      list.setAttribute('count', String(list.childNodes.length));
      if (oldList) field.replaceChild(list, oldList); else field.insertBefore(list, field.firstChild);
      itemMaps.set(index, positions);
    }
    remapAxes(root, layout, itemMaps); remapReferences(root, layout, sharedMaps, itemMaps);
    const next = { ...pivot, xml: standaloneModelXml(root) };
    readNativePivotLayout(next, nextCache);
    return { pivot, next };
  });
  return { cache: nextCache, reports: prepared };
}
