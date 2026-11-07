import { parseModelXml, modelChildren } from './data-model-metadata.js';
import { modelConnectionId } from './data-model-bindings.js';

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
// MS-OI29500: the unsigned representation of the synthetic data field -2.
const DATA_FIELD = 4294967294;
const fail = reason => { throw new Error(`Cannot apply pivot automatic sorting: ${reason}`); };
const children = (node, name) => modelChildren(node, name, MAIN);
const one = (node, name) => { const found = children(node, name); if (found.length !== 1) fail(`missing or duplicate ${name}`); return found[0]; };
const flag = (node, name, fallback = false) => {
  if (!node.hasAttribute(name)) return fallback;
  const value = node.getAttribute(name).trim();
  if (!['0', '1', 'false', 'true'].includes(value)) fail(name);
  return value === '1' || value === 'true';
};
const uint = (node, name) => { const value = modelConnectionId(node.getAttribute(name)); if (value === null) fail(name); return value; };
const list = (node, name) => {
  const found = children(node, name);
  if (node.hasAttribute('count') && uint(node, 'count') !== found.length) fail('collection count');
  return found;
};

/** Compile the explicit data-field/member intersection used for value sorting.
 * selected is selection-state metadata, not an inverted member filter. Scope
 * item offsets address pivotField.items unless cacheIndex is explicitly true.
 * Label/property sorting and relative selections need separate semantics.
 */
export function nativePivotValueSort(layout, query, field) {
  const definition = layout.fields[field], direction = definition.sortType || 'manual';
  if (direction === 'manual') return null;
  if (!['ascending', 'descending'].includes(direction)) fail('sort direction');
  if (!definition.autoSort || !definition.sortScope) fail('label/property sorting is not implemented');
  const root = parseModelXml(definition.sortScope);
  if (root.namespaceURI !== MAIN || root.localName !== 'autoSortScope') fail('scope root');
  const area = one(root, 'pivotArea'), references = list(one(area, 'references'), 'reference');
  if (!['normal', 'data'].includes(area.getAttribute('type') || 'normal') || area.hasAttribute('field') || area.hasAttribute('offset')
    || flag(area, 'labelOnly') || flag(area, 'grandRow') || flag(area, 'grandCol') || flag(area, 'collapsedLevelsAreSubtotals')) fail('area selection is not implemented');
  const cacheIndex = flag(area, 'cacheIndex'), seen = new Set(), filters = []; let measure;
  for (const reference of references) {
    const owner = uint(reference, 'field');
    if (seen.has(owner)) fail('duplicate field reference'); seen.add(owner);
    flag(reference, 'selected', true);
    if (flag(reference, 'byPosition') || flag(reference, 'relative') || ['defaultSubtotal', 'sumSubtotal', 'countASubtotal', 'avgSubtotal', 'maxSubtotal', 'minSubtotal', 'productSubtotal', 'countSubtotal', 'stdDevSubtotal', 'stdDevPSubtotal', 'varSubtotal', 'varPSubtotal'].some(name => flag(reference, name))) fail('relative/subtotal reference is not implemented');
    const items = list(reference, 'x').map(item => uint(item, 'v'));
    if (owner === DATA_FIELD) {
      if (items.length !== 1 || !layout.measures[items[0]]) fail('measure index');
      measure = layout.measures[items[0]];
    } else {
      if (!layout.fields[owner]) fail('field index');
      query.column(owner);
      filters.push({ field: owner, items: items.length ? items.map(index => {
        const item = layout.fields[owner].items[index], shared = cacheIndex ? index : item?.type === 'data' ? item.index : null;
        if (shared == null || !query.cache.fields[owner].items[shared]) fail('member index');
        return shared;
      }) : null });
    }
  }
  if (!measure || measure.showDataAs && measure.showDataAs !== 'normal') fail('missing or derived measure');
  const selected = filters.length ? new Set(query.rows(filters)) : null;
  return (candidates, groups) => {
    // Aggregate each disjoint group once. Comparator calls never rescan records.
    const values = new Map();
    for (const index of candidates) {
      const rows = groups.get(index) || [], result = query.aggregateRows(measure.field, measure.subtotal || 'sum', selected ? rows.filter(row => selected.has(row)) : rows, { withPresence: true });
      const value = result.nonEmpty ? result.value : null;
      if (value !== null && typeof value !== 'bigint' && (typeof value !== 'number' || !Number.isFinite(value))) fail('nonnumeric sort result');
      values.set(index, value);
    }
    return candidates.sort((a, b) => {
      const x = values.get(a), y = values.get(b);
      if (x === y) return 0; // Retain persisted member order for equal keys.
      if (x === null || y === null) return x === null ? 1 : -1;
      return (x < y ? -1 : x > y ? 1 : 0) * (direction === 'ascending' ? 1 : -1);
    });
  };
}
