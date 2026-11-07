import { parseModelXml, modelChildren, standaloneModelXml } from './data-model-metadata.js';
import { readNativePivotLayout } from './native-pivot-layout.js';
import { readNativePivotCache } from './native-pivot-cache.js';
import { nativePivotOlapAttribute, nativePivotOlapFilters } from './native-pivot-olap-filters.js';
const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const children = (node, name) => modelChildren(node, name, MAIN);
const fail = message => { throw new Error(`Cannot write pivot selections: ${message}`); };

/** Replace manual selections by cache-member identity. This is report state,
 * separate from the shared slicer-cache XML. A slicer change must synchronize
 * this field state in each connected report. Rebuild the cached axes/values and
 * any page-field captions before committing the returned definition.
 * null shows all members; [] selects none. Existing member order, captions,
 * drill flags, subtotal markers and future-item inclusion policy are retained.
 * Flat OLAP attributes use item@s instead of item@h. Empty inclusion lists,
 * page/unique-name filters and hierarchy expansion require additional metadata.
 */
export function writeNativePivotSelections(pivot, cache, selections, { maxItems = 1048576 } = {}) {
  if (!Array.isArray(selections) || !Number.isSafeInteger(maxItems) || maxItems < 0) fail('invalid selection options');
  if (pivot.cache !== cache.key) fail('mismatched cache');
  const layout = readNativePivotLayout(pivot, cache);
  const olap = layout.sourceType === 'external' && layout.hierarchies.length > 0;
  if (layout.sourceType !== 'worksheet' && !olap) fail('external selections are not implemented');
  if (olap) nativePivotOlapFilters(layout);
  const source = readNativePivotCache(cache, { includeRecords: false, maxCells: maxItems });
  const root = parseModelXml(pivot.xml), fields = children(children(root, 'pivotFields')[0], 'pivotField');
  const pages = children(children(root, 'pageFields')[0], 'pageField');
  const make = name => root.ownerDocument.createElementNS(MAIN, root.prefix ? `${root.prefix}:${name}` : name);
  const seen = new Set(); let count = 0;
  for (const selection of selections) {
    const index = selection?.field, items = selection?.items;
    if (!Number.isInteger(index) || !fields[index] || seen.has(index)) fail('missing or duplicate field');
    seen.add(index);
    const definition = source.fields[index];
    if (!definition.databaseField || definition.serverField) fail('calculated/grouped or server selections are not implemented');
    // Without shared members there is no item on which to persist a hidden
    // flag. In particular, [] must not silently round-trip as show-all.
    if (items !== null && !definition.items.length) fail('field has no shared members');
    if (items !== null && (!Array.isArray(items) || items.some(i => !Number.isInteger(i) || i < 0 || i >= definition.items.length))) fail('invalid member index');
    const selected = items === null ? null : new Set(items), field = fields[index];
    const attribute = olap ? nativePivotOlapAttribute(layout, index) : null;
    // An empty inclusion list is indistinguishable from an unrestricted field
    // in item@s metadata. Do not flip the authored future-member policy merely
    // to encode an empty current selection. Exclusion mode can exclude all.
    if (attribute && !attribute.includeNewItems && selected?.size === 0) fail('empty OLAP inclusion filters require unique-name member state');
    const lists = children(field, 'items');
    if (lists.length > 1) fail('duplicate item collection');
    let list = lists[0];
    if (!list) {
      list = make('items');
      // items is the first CT_PivotField child, before autoSortScope/extLst.
      field.insertBefore(list, field.firstChild);
    }
    const byIndex = new Map(), all = children(list, 'item');
    if ((count += all.length) > maxItems) fail('item limit');
    for (const [position, item] of all.entries()) {
      if ((item.getAttribute('t') || 'data') !== 'data') continue;
      const member = layout.fields[index].items[position].index;
      if (!Number.isInteger(member) || member < 0 || member >= definition.items.length || byIndex.has(member)) fail('invalid or duplicate stored member');
      byIndex.set(member, { node: item, position });
    }
    const hasSubtotalItems = olap && all.some(item => (item.getAttribute('t') || 'data') !== 'data');
    // Append missing members so existing pivot-item positions remain stable,
    // including page-field indexes and cached axis references until rebuilding.
    for (let member = 0; member < definition.items.length; member++) {
      if (!byIndex.has(member)) {
        if (hasSubtotalItems) fail('adding OLAP members before subtotal items requires axis remapping');
        if (++count > maxItems) fail('item limit');
        const item = make('item'); item.setAttribute('x', String(member));
        list.appendChild(item); byIndex.set(member, { node: item, position: all.length }); all.push(item);
      }
      const item = byIndex.get(member).node;
      if (attribute) {
        if (selected !== null && (attribute.includeNewItems ? !selected.has(member) : selected.has(member))) item.setAttribute('s', '1');
        else item.removeAttribute('s');
      } else {
        if (selected === null || selected.has(member)) item.removeAttribute('h');
        else item.setAttribute('h', '1');
      }
    }
    list.setAttribute('count', String(all.length));
    const pageFields = pages.filter(page => Number(page.getAttribute('fld')) === index);
    if (pageFields.length > 1) fail('duplicate page field');
    if (pageFields.length) {
      const page = pageFields[0]; page.removeAttribute('item');
      if (selected?.size === 1) {
        field.setAttribute('multipleItemSelectionAllowed', '0');
        page.setAttribute('item', String(byIndex.get([...selected][0]).position));
      } else field.setAttribute('multipleItemSelectionAllowed', selected === null ? '0' : '1');
    }
  }
  return { ...pivot, xml: standaloneModelXml(root) };
}
