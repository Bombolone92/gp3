const fail = reason => { throw new Error(`Cannot resolve OLAP pivot filters: ${reason}`); };

/** An attribute hierarchy has one leaf level (and optionally an All level).
 * Only that shape can map manual selections directly to shared-item indexes.
 * User hierarchies need ancestor/descendant expansion, not independent filters
 * on each level. fieldsUsage is the authoritative level-to-field mapping.
 */
export function nativePivotOlapAttribute(layout, field) {
  const source = layout.cacheFields[field], hierarchy = source && layout.hierarchies[source.hierarchy];
  const state = source && layout.olapHierarchies?.[source.hierarchy];
  if (layout.sourceType !== 'external' || !source || !hierarchy || !state) fail('missing hierarchy binding');
  const usage = hierarchy.fieldsUsage;
  if (!hierarchy.attribute || hierarchy.measure || hierarchy.grouped || !Array.isArray(usage)
    || usage.length < 1 || usage.length > 2 || usage[source.level] !== field
    || usage.filter(index => index >= 0).length !== 1 || usage.some(index => index !== -1 && index !== field)
    || layout.cacheFields.filter(f => f.hierarchy === source.hierarchy).length !== 1) fail('multi-level or non-attribute selections are not implemented');
  if (state.hasMemberFilters) fail('unique-name member filters are not implemented');
  if (layout.pageFields?.some(page => layout.cacheFields[page.field]?.hierarchy === source.hierarchy)) fail('OLAP page selections are not implemented');
  return { hierarchy: source.hierarchy, includeNewItems: state.includeNewItems };
}

/** MS-OI29500 2.1.786: item@s marks manually listed OLAP members.
 * includeNewItemsInFilter=true lists EXCLUDED members; false lists INCLUDED
 * members. With no listed items or members, there is no manual restriction.
 * Worksheet item@h flags must never be interpreted as OLAP filter state.
 */
export function nativePivotOlapFilters(layout) {
  if (layout.sourceType !== 'external' || !layout.hierarchies?.length) fail('missing OLAP cache hierarchies');
  if (layout.pageFields?.length) fail('OLAP page selections are not implemented');
  if (layout.olapHierarchies?.some(h => h.hasMemberFilters)) fail('unique-name member filters are not implemented');
  const result = [];
  for (const [field, definition] of layout.fields.entries()) {
    if (definition.items.some(item => item.hidden)) fail('non-OLAP hidden-item flags');
    const selected = definition.items.filter(item => item.selected);
    if (!selected.length) continue;
    const { includeNewItems } = nativePivotOlapAttribute(layout, field), shared = layout.cacheFields[field].items;
    const indexes = new Set(), all = new Set();
    for (const item of definition.items) {
      if (item.type !== 'data') { if (item.selected) fail('selected subtotal item'); continue; }
      if (!Number.isInteger(item.index) || item.index < 0 || !shared[item.index] || all.has(item.index)) fail('invalid or duplicate shared member');
      all.add(item.index);
      if (item.selected) indexes.add(item.index);
    }
    // Exclusion applies to the entire shared domain, including cached members
    // which disappeared from the previous displayed/filtered field-item list.
    result.push({ field, items: includeNewItems ? shared.flatMap((_item, index) => indexes.has(index) ? [] : [index]) : [...indexes] });
  }
  return result;
}
