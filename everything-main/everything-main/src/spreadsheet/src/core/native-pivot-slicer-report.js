import { resolveNativePivotSlicers } from './native-pivot-slicer.js';
import { writeNativePivotSlicerSelection } from './native-pivot-slicer-state.js';
import { planNativePivotReport } from './native-pivot-report.js';
import { decodeXlsxString } from './xlsx-string.js';
import { sheetKey } from './refs.js';
import { nativePivotSlicerAvailability } from './native-pivot-slicer-availability.js';

/** Prepare a shared selection and all its declared worksheet reports together.
 * MS-XLSX 2.3.2.1.4 applies slicer choices to the connected field's manual filter;
 * replacing that filter lets a later choice restore previously hidden members.
 * Other fields retain their filters. This is pure preparation: callers still
 * materialize formatting/page captions, resolve the returned per-report
 * availability into shared cache/view state, and commit one transaction.
 */
export function planNativePivotSlicerSelection(slicer, pivots, sheets, selection, { reportOptions = new Map(), maxCells = 1048576, slicerCaches = [slicer], maxAvailabilityWork = 1048576 } = {}) {
  if (!(reportOptions instanceof Map) || !Number.isSafeInteger(maxCells) || maxCells < 0) throw new Error('Invalid slicer report options');
  if (!Array.isArray(slicerCaches) || !slicerCaches.includes(slicer) || new Set(slicerCaches).size !== slicerCaches.length) throw new Error('Invalid connected slicer caches');
  const next = writeNativePivotSlicerSelection(slicer, selection);
  const binding = resolveNativePivotSlicers([next], pivots, sheets).get(next);
  const cache = pivots.caches.find(cache => cache.key === binding.cacheKey);
  const items = selection === null ? null : next.items.filter(item => item.selected).map(item => item.index);
  let remaining = maxCells;
  const reports = binding.reports.map(reference => {
    if (reference.sheet == null) throw new Error('Non-worksheet slicer report rebuilding is not implemented');
    const owner = sheets.find(sheet => sheet.name === reference.sheet);
    const pivot = pivots.tables.find(pivot => pivot.owner === owner.id && sheetKey(decodeXlsxString(pivot.name)) === sheetKey(reference.name));
    const plan = planNativePivotReport(pivot, cache, { ...reportOptions.get(pivot), nativePivots: pivots,
      maxCells: remaining, selections: [{ field: binding.field.index, items }] });
    const range = plan.layout.range;
    remaining -= (range.r2 - range.r1 + 1) * (range.c2 - range.c1 + 1);
    if (remaining < 0) throw new Error('Slicer report cell limit exceeded');
    return { pivot, cache, plan };
  });
  const replacements = new Map(reports.map(report => [report.pivot, report.plan.pivot]));
  const prepared = { ...pivots, tables: pivots.tables.map(pivot => replacements.get(pivot) || pivot) };
  const availability = nativePivotSlicerAvailability(slicerCaches.map(cache => cache === slicer ? next : cache), prepared, sheets, { maxWork: maxAvailabilityWork });
  return { slicer: next, reports, availability };
}
