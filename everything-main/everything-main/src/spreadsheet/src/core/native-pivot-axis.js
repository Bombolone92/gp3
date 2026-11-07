import { nativePivotFilters } from './native-pivot-filters.js';
import { nativePivotValueSort } from './native-pivot-sort.js';

/** Regenerate a member axis from saved query rows and field definitions.
 * Cached rowItems/colItems never determine membership: clearing a filter must
 * restore members which disappeared from the previous rendered report. For
 * equal automatic-sort keys only, retain their currently displayed order.
 * A model query can decide presence from measures instead of source row count.
 * The returned entries are semantic layout rows/columns, before cell styling
 * and native XML compression. Subtotal members retain their group identity.
 */
export function rebuildNativePivotAxis(layout, query, axisName, { filters = [], grandTotal, maxItems = 1048576 } = {}) {
  const fail = message => { throw new Error(`Cannot rebuild pivot axis: ${message}`); };
  if (!['rows', 'columns'].includes(axisName) || !Number.isSafeInteger(maxItems) || maxItems < 0) fail('invalid axis or limit');
  grandTotal ??= axisName === 'rows' ? layout.colGrandTotals !== false : layout.rowGrandTotals !== false;
  const axis = layout[axisName], indexes = axis.fields, dimensions = indexes.filter(field => field !== -2);
  if (new Set(indexes).size !== indexes.length || dimensions.length > 128) fail('invalid field hierarchy');
  const measures = indexes.includes(-2);
  if (measures && indexes.at(-1) !== -2) fail('outer measure layout is not implemented');
  const prepared = new Map();
  const restrictions = nativePivotFilters(layout, filters);
  const selected = new Map();
  for (const filter of restrictions) if (filter.items !== null) {
    const values = new Set(filter.items);
    selected.set(filter.field, selected.has(filter.field) ? new Set([...selected.get(filter.field)].filter(value => values.has(value))) : values);
  }
  for (const field of dimensions) {
    query.column(field);
    const definition = layout.fields[field];
    if (!definition) fail('missing field');
    const sort = nativePivotValueSort(layout, query, field);
    const members = new Map();
    for (const [item, member] of definition.items.entries()) if (member.type === 'data') {
      if (!Number.isInteger(member.index) || !query.cache.fields[field].items[member.index] || members.has(member.index)) fail('invalid field member');
      members.set(member.index, { ...member, item });
    }
    prepared.set(field, { definition, members, sort });
  }
  const previousOrders = new Map();
  const hasSorting = [...prepared.values()].some(p => p.sort);
  for (const entry of hasSorting ? axis.items || [] : []) {
    let prefix = '';
    for (const member of entry.members || []) {
      if (!Number.isInteger(member.index)) break;
      if (prepared.get(member.field)?.sort) {
        const key = `${member.field}:${prefix}`;
        if (!previousOrders.has(key)) previousOrders.set(key, new Map());
        const order = previousOrders.get(key);
        if (!order.has(member.index)) order.set(member.index, order.size);
      }
      prefix += `${member.field},${member.index};`;
    }
  }
  const rows = query.rows(restrictions), result = [];
  const emit = (type, members, extra = {}) => {
    const count = type === 'blank' || !measures ? 1 : layout.measures.length;
    if (result.length + count > maxItems) fail('item limit exceeded');
    for (let measure = 0; measure < count; measure++) result.push({ type, measure, members: [...members], ...extra });
  };
  const walk = (depth, records, prefix) => {
    if (depth === dimensions.length) { emit('data', prefix); return; }
    const field = dimensions[depth], { definition, members, sort } = prepared.get(field);
    const groups = query.partition(field, records);
    // Every present cache member needs a field-item identity for native export.
    for (const index of groups.keys()) if (!members.has(index)) fail('record member missing from field items');
    const measurePresence = typeof query.memberVisible === 'function';
    let candidates = (definition.showAll === false && !measurePresence ? [...groups.keys()].sort((a, b) => members.get(a).item - members.get(b).item) : [...members.keys()])
      .filter(index => !members.get(index).hidden && (!selected.has(field) || selected.get(field).has(index)));
    if (depth + 1 === dimensions.length && candidates.length * (measures ? layout.measures.length : 1) > maxItems - result.length) fail('item limit exceeded');
    if (measurePresence) candidates = candidates.filter(index => query.memberVisible(groups.get(index) || [], axisName));
    if (sort) {
      const previous = previousOrders.get(`${field}:${prefix.map(m => `${m.field},${m.index};`).join('')}`);
      // Stable value sorting uses the visible order for ties, then the saved
      // field-item order for members absent from the previous filtered axis.
      if (previous) candidates.sort((a, b) => (previous.get(a) ?? previous.size) - (previous.get(b) ?? previous.size));
      sort(candidates, groups);
    }
    for (const index of candidates) {
      const item = members.get(index);
      const own = [...prefix, { field, item: item.item, index, ...query.cache.fields[field].items[index] }];
      const nested = depth + 1 < dimensions.length && item.details !== false;
      const subtotals = definition.defaultSubtotal !== false ? ['default'] : definition.subtotals || [];
      const outline = axisName === 'rows' && definition.outline !== false;
      const atTop = outline && definition.subtotalTop !== false && subtotals.length === 1 && subtotals[0] === 'default';
      if (!nested && depth + 1 < dimensions.length && subtotals.some(type => type !== 'default')) fail('collapsed custom subtotals are not implemented');
      if (!nested) emit('data', own);
      else {
        if (outline) emit('data', own, { header: true, aggregate: atTop });
        walk(depth + 1, groups.get(index) || [], own);
        if (!atTop) for (const type of subtotals) emit(type, own, { subtotalField: field });
      }
      // InsertBlankRow separates outer groups; innermost items have no nested
      // group to separate, even when the attribute is set on that field.
      if (axisName === 'rows' && depth + 1 < dimensions.length && definition.insertBlankRow) emit('blank', []);
    }
  };
  if (dimensions.length) {
    walk(0, rows, []);
    if (grandTotal) emit('grand', []);
  } else emit('data', []);
  return { fields: [...indexes], items: result };
}
