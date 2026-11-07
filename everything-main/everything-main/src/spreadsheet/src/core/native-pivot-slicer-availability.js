import { readNativePivotSlicerState } from './native-pivot-slicer-state.js';
import { resolveNativePivotSlicers } from './native-pivot-slicer.js';
import { readNativePivotLayout } from './native-pivot-layout.js';
import { readNativePivotCache } from './native-pivot-cache.js';
import { nativePivotFilters } from './native-pivot-filters.js';
import { NativePivotQuery } from './native-pivot-query.js';
import { decodeXlsxString } from './xlsx-string.js';
import { sheetKey } from './refs.js';

/** Cross-filter availability for each declared report connection. The field's
 * own selection is excluded so unselected buttons remain available when another
 * field does not exclude their records. Other fields' saved manual/page choices
 * include the selections synchronized by connected slicers (MS-XLSX 2.3.2.1.7).
 *
 * Results preserve native item order and selection, with saved visibility
 * options applied independently of no-data paint. Keep report contexts separate:
 * this does not guess a shared nd flag when their availability differs.
 */
export function nativePivotSlicerAvailability(slicers, pivots, sheets, { maxWork = 1048576 } = {}) {
  if (!Array.isArray(slicers) || !Number.isSafeInteger(maxWork) || maxWork < 0) throw new Error('Invalid slicer availability options');
  const states = slicers.map(readNativePivotSlicerState);
  const bindings = resolveNativePivotSlicers(states, pivots, sheets);
  const queries = new Map(), layouts = new Map(), contexts = new Map(), result = new Map();
  let work = 0;
  for (const [index, state] of states.entries()) {
    const binding = bindings.get(state), cache = pivots.caches.find(cache => cache.key === binding.cacheKey);
    const reports = new Map();
    for (const reference of binding.reports) {
      work += state.items.length;
      if (work > maxWork) throw new Error('Slicer availability work limit exceeded');
      if (reference.sheet == null) throw new Error('Non-worksheet slicer availability is not implemented');
      const owner = sheets.find(sheet => sheet.name === reference.sheet);
      const pivot = pivots.tables.find(pivot => pivot.owner === owner.id && sheetKey(decodeXlsxString(pivot.name)) === sheetKey(reference.name));
      if (!layouts.has(pivot)) layouts.set(pivot, readNativePivotLayout(pivot, cache));
      const layout = layouts.get(pivot);
      if (layout.sourceType !== 'worksheet' || layout.hasCalculatedItems) throw new Error('External or calculated-item slicer availability is not implemented');
      const filters = nativePivotFilters(layout).filter(filter => filter.field !== binding.field.index);
      if (!queries.has(cache)) queries.set(cache, new NativePivotQuery(readNativePivotCache(cache)));
      const query = queries.get(cache);
      // Equivalent filter contexts share one record scan, even across reports.
      const clauses = filters.map(filter => [filter.field, [...new Set(filter.items)].sort((a, b) => a - b)]);
      clauses.sort((a, b) => a[0] - b[0] || JSON.stringify(a[1]).localeCompare(JSON.stringify(b[1])));
      const key = JSON.stringify([cache.key, binding.field.index, clauses]);
      if (!contexts.has(key)) {
        work += query.cache.records.length + binding.field.items.length;
        if (work > maxWork) throw new Error('Slicer availability work limit exceeded');
        contexts.set(key, query.memberCounts(binding.field.index, filters));
      }
      const counts = contexts.get(key);
      reports.set(pivot, state.items.map(item => ({ ...item, records: counts[item.index],
        // showMissing hides retained, explicitly unused cache members, not all
        // members temporarily excluded by another field's filter (2.6.83).
        hidden: !state.showMissing && binding.field.unused[item.index] || state.hideItemsWithNoData && counts[item.index] === 0,
        noData: state.crossFilter !== 'none' && counts[item.index] === 0, available: state.crossFilter === 'none' || counts[item.index] > 0 })));
    }
    result.set(slicers[index], reports);
  }
  return result;
}
