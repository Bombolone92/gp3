import { parseModelXml, modelChildren } from './data-model-metadata.js';
import { readNativePivotArea, PIVOT_DATA_FIELD } from './native-pivot-area.js';

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const children = (node, name) => modelChildren(node, name, MAIN);
const fail = reason => { throw new Error(`Cannot materialize native pivot report: preserved-format ${reason}`); };
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const valueKey = item => {
  if (!item || !['string', 'number', 'boolean', 'date', 'error', 'blank'].includes(item.type)) fail('member identity');
  return [item.type, item.value];
};
function itemKey(layout, field, index, shared = false) {
  const item = layout.fields[field]?.items[index];
  if (!shared && item?.type !== 'data') { if (!item) fail('item reference'); return ['subtotal', item.type]; }
  return valueKey(layout.cacheFields[field]?.items[shared ? index : item?.index]);
}
function structure(pivot, layout) {
  const root = parseModelXml(pivot.xml);
  // Native area selectors use two index spaces. Compare their semantic member
  // identities so a cache compaction is not mistaken for a new formatting rule.
  for (const area of Array.from(root.getElementsByTagNameNS(MAIN, 'pivotArea'))) {
    const decoded = readNativePivotArea(area), refs = children(children(area, 'references')[0], 'reference');
    decoded.references.forEach((ref, i) => {
      if (ref.relative || ref.byPosition || decoded.offset) fail('positional area changes are not implemented');
      if (ref.field === PIVOT_DATA_FIELD) return;
      children(refs[i], 'x').forEach((x, j) => x.setAttribute('v', JSON.stringify(itemKey(layout, ref.field, ref.items[j], decoded.cacheIndex))));
    });
  }
  for (const field of children(children(root, 'dataFields')[0], 'dataField')) {
    if ((field.getAttribute('showDataAs') || 'normal') === 'normal') field.removeAttribute('baseItem');
  }
  const encode = node => {
    if (node.nodeType === 3 || node.nodeType === 4) return node.nodeValue;
    if (node.nodeType !== 1) return null;
    const own = node.namespaceURI === MAIN, parent = node.parentNode;
    if (own && (parent === root && ['rowItems', 'colItems'].includes(node.localName)
      || parent?.namespaceURI === MAIN && parent.localName === 'pivotField' && node.localName === 'items')) return null;
    const attrs = Array.from(node.attributes).filter(a => !(own && node.localName === 'location' && parent === root && a.name === 'ref'))
      .map(a => [a.namespaceURI || '', a.localName, a.value]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    return [node.namespaceURI, node.localName, attrs, Array.from(node.childNodes).map(encode).filter(v => v !== null)];
  };
  return encode(root);
}
function memberSettings(pivot, layout) {
  const root = parseModelXml(pivot.xml), fields = children(children(root, 'pivotFields')[0], 'pivotField');
  return layout.fields.map((field, index) => {
    const result = new Map(), nodes = children(children(fields[index], 'items')[0], 'item');
    for (const [position, item] of field.items.entries()) {
      if (item.type !== 'data') continue;
      const key = JSON.stringify(itemKey(layout, index, position));
      if (result.has(key)) fail('duplicate field member');
      const node = nodes[position].cloneNode(true);
      for (const name of ['x', 'h', 's']) node.removeAttribute(name);
      result.set(key, node.toString());
    }
    return result;
  });
}

function policy(layout) {
  const { range, rows, columns, fields, cacheFields, measures, ...rest } = layout;
  return { ...rest, first: [range.r1, range.c1], rowFields: rows.fields, columnFields: columns.fields,
    fields: fields.map(({ items, ...f }) => f), cacheFields: cacheFields.map(({ items, ...f }) => f),
    measures: measures.map(({ baseItem, ...m }) => m) };
}
function axes(layout, maxCells) {
  if (layout.rows.fields.length !== 1 || layout.rows.fields[0] < 0 || layout.columns.fields.some(f => f !== -2)
    || layout.columns.fields.length > 1 || layout.pageFields.length || layout.mergeItem) fail('changed multi-level or page layouts are not implemented');
  const { range, firstDataRow, firstDataCol } = layout;
  if (layout.rows.items.length + layout.columns.items.length > maxCells
    || range.r2 - range.r1 + 1 !== firstDataRow + layout.rows.items.length
    || range.c2 - range.c1 + 1 !== firstDataCol + layout.columns.items.length) fail('incomplete saved axes or work limit');
  const rows = layout.rows.items.map(row => {
    if (row.type === 'grand' && !row.members.length) return 'grand';
    if (row.type !== 'data' || row.members.length !== 1 || row.members[0].field !== layout.rows.fields[0]) fail('unresolved row identity');
    return JSON.stringify(['data', valueKey(row.members[0])]);
  });
  const columns = layout.columns.items.map(column => {
    if (column.type !== 'data' || column.members.length || !layout.measures[column.measure]) fail('unresolved measure identity');
    return column.measure;
  });
  if (new Set(rows).size !== rows.length || new Set(columns).size !== columns.length) fail('ambiguous axis identity');
  return { rows, columns };
}

/** Existing direct cell formats follow typed member/measure identity, never
 * captions or transient cache indexes. Headers and grand totals have separate
 * identities. New members have no saved direct override and use declared paint.
 * Worksheet row/column styles stay on their lines. Changed hierarchical layouts
 * need ancestor/subtotal provenance and remain explicit errors.
 */
export function preservedPivotCoordinates(pivot, saved, nextPivot, layout, maxCells) {
  if (!equal(policy(saved), policy(layout)) || !equal(structure(pivot, saved), structure(nextPivot, layout))) fail('identity or policy changes are not implemented');
  const oldSettings = memberSettings(pivot, saved), nextSettings = memberSettings(nextPivot, layout);
  for (const [field, members] of oldSettings.entries()) for (const [key, value] of members) {
    if (nextSettings[field].has(key) && !equal(value, nextSettings[field].get(key))) fail('member settings changed');
  }
  const old = axes(saved, maxCells), next = axes(layout, maxCells);
  const oldRows = new Map(old.rows.map((key, i) => [key, i])), oldColumns = new Map(old.columns.map((key, i) => [key, i]));
  const source = (r, c) => {
    const row = r - layout.range.r1, column = c - layout.range.c1;
    const sourceRow = row < layout.firstDataRow ? row : oldRows.has(next.rows[row - layout.firstDataRow])
      ? saved.firstDataRow + oldRows.get(next.rows[row - layout.firstDataRow]) : null;
    const sourceColumn = column < layout.firstDataCol ? column : oldColumns.has(next.columns[column - layout.firstDataCol])
      ? saved.firstDataCol + oldColumns.get(next.columns[column - layout.firstDataCol]) : null;
    return sourceRow === null || sourceColumn === null ? null : { r: saved.range.r1 + sourceRow, c: saved.range.c1 + sourceColumn };
  };
  return { source, changed: !equal(old.rows, next.rows) || !equal(old.columns, next.columns) };
}
