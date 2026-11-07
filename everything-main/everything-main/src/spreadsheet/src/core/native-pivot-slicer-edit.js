import { readNativePivotSlicerState } from './native-pivot-slicer-state.js';
import { planNativePivotSlicerSelection } from './native-pivot-slicer-report.js';
import { prepareNativePivotReportUpdates } from './native-pivot-refresh-plan.js';
import { commitNativePivotReports } from './native-pivot-commit.js';
import { effectiveColorPalette } from './font-color.js';
import { nativePivotSlicerNoDataUpdates } from './native-pivot-slicer-sync.js';

const fail = reason => { throw new Error(`Cannot edit native pivot slicer: ${reason}`); };
const identity = p => JSON.stringify([p.owner, p.name]);

/** Coordinate one shared selection using the workbook's authoritative cells,
 * rules, formats and palette. Preparation never changes the workbook; the final
 * commit preflights all connected reports and records one undo transaction.
 *
 * This is the edit boundary for the currently implemented report semantics.
 * Page captions, dormant rules and availability changes requiring shared-cache
 * ordering remain explicit preparation failures, never partially applied edits.
 */
export function setNativePivotSlicerSelection(wb, slicer, selection, { maxCells = 1048576, maxAvailabilityWork = 1048576 } = {}) {
  const pivots = wb.nativePivots;
  if (!pivots?.slicers?.includes(slicer)) fail('stale shared cache');
  if (!Number.isSafeInteger(maxCells) || maxCells < 0) fail('invalid cell limit');
  const affected = new Set(slicer.connections.map(identity));
  const connected = pivots.tables.filter(p => affected.has(identity(p)));
  // Only caches sharing an affected report can acquire changed availability.
  // An unrelated unsupported report must not prevent an otherwise valid edit.
  const slicerCaches = pivots.slicers.filter(s => s === slicer || s.connections.some(p => affected.has(identity(p))));
  const palette = effectiveColorPalette(wb.colorPalette);
  const paintContext = {
    themes: { fontTheme: wb.fontTheme, themeElements: { clrScheme: palette.theme.map(rgb => ({ rgb: rgb?.slice(1) })) }, indexedColors: palette.indexed.map(rgb => rgb?.slice(1)) },
    numberFormats: pivots.formats,
  };
  const reportOptions = new Map(connected.map(pivot => {
    const sheet = wb.sheet(pivot.owner);
    if (!sheet || sheet.kind === 'chart') fail('non-worksheet report');
    return [pivot, { paintContext, conditionalRules: sheet.rules, sheetName: sheet.name }];
  }));
  const result = planNativePivotSlicerSelection(slicer, pivots, wb.sheets, selection,
    { reportOptions, slicerCaches, maxCells, maxAvailabilityWork });
  // The choice changes which members of the other connected slicers still have records: their
  // saved no-data flags follow (an item is flagged when no connected report has data for it).
  const noData = nativePivotSlicerNoDataUpdates(result.availability);
  for (const [cache, contexts] of result.availability) {
    const state = readNativePivotSlicerState(cache);
    if (state.crossFilter === 'none' && state.hideItemsWithNoData) {
      const first = contexts.values().next().value;
      for (const items of contexts.values()) if (items.some((item, i) => item.hidden !== first[i].hidden)) fail('shared slicer visibility across different report contexts is not implemented');
    }
  }
  const { updates, rules } = prepareNativePivotReportUpdates(wb, result.reports, { maxCells });
  const slicerUpdates = new Map([[slicer, noData.get(result.slicer) || result.slicer]]);
  for (const [cache, updated] of noData) if (cache !== result.slicer) slicerUpdates.set(cache, updated);
  return commitNativePivotReports(wb, updates, { maxCells, rules, slicerUpdates });
}
