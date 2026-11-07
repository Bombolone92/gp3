import { nativePivotOlapFilters } from './native-pivot-olap-filters.js';

/** Resolve cached report filters once for both layout and values.
 * Page-field item indexes address pivotField/items, not cache sharedItems
 * (MS-OE376 2.1.806). An omitted item means all or the field's multi-selection.
 */
export function nativePivotFilters(layout, filters = []) {
  if (!Array.isArray(filters)) throw new Error('Invalid pivot filters');
  if (layout.hasAdvancedFilters || layout.fields.some(field => field.autoShow)) throw new Error('Advanced pivot filters are not implemented');
  // External ODBC/database caches can still be non-OLAP; only OLAP caches
  // declare cacheHierarchies and use the hierarchy manual-selection policy.
  if (layout.sourceType === 'external' && layout.hierarchies?.length) return [...filters, ...nativePivotOlapFilters(layout)];
  const result = [...filters];
  for (const [field, definition] of layout.fields.entries()) {
    const items = definition.items.filter(item => item.type === 'data');
    if (items.some(item => item.hidden)) result.push({ field, items: items.filter(item => !item.hidden).map(item => item.index) });
  }
  for (const page of layout.pageFields || []) {
    const field = layout.fields[page.field];
    if (!field) throw new Error('Invalid pivot page field');
    if (page.item == null) continue;
    const item = field.items[page.item];
    if (field.multipleItemSelectionAllowed || !item || item.type !== 'data' || item.index == null) throw new Error('Invalid pivot page selection');
    result.push({ field: page.field, items: [item.index] });
  }
  return result;
}
