import { writeNativePivotSelections } from './native-pivot-selections.js';
import { readNativePivotFormats, nativePivotFormatLayers } from './native-pivot-formats.js';
import { nativePivotPaintLayers, nativePivotCellNumberFormat } from './native-pivot-paint.js';
import { readNativePivotLayout } from './native-pivot-layout.js';
import { readNativePivotCache } from './native-pivot-cache.js';
import { NativePivotQuery } from './native-pivot-query.js';
import { NativeModelPivotQuery } from './native-pivot-model-query.js';
import { rebuildNativePivotAxis } from './native-pivot-axis.js';
import { writeNativePivotAxes } from './native-pivot-axis-xml.js';
import { nativePivotHeaders } from './native-pivot-headers.js';
import { nativePivotRowLabels } from './native-pivot-row-labels.js';
import { calculateNativePivotValues } from './native-pivot-values.js';
import { readNativePivotStyle, nativePivotBodyStyleLayers } from './native-pivot-style.js';
import { readNativePivotConditionalFormats, nativePivotConditionalRanges, planNativePivotConditionalRules } from './native-pivot-condformat.js';
import { parseRefText } from './refs.js';
import { formatValue } from './format.js';

/** Plan the body from a saved worksheet cache or workbook model snapshot.
 * No workbook mutation or source refresh occurs here. The eventual transaction
 * must preflight the old/new areas, apply styles, clear vacated cells and persist
 * filter selections together with this metadata and these cell values. Page
 * filter controls lie outside the body and are not rewritten by this operation.
 * paintContext.numberFormats supplies this workbook's decoded format-code table;
 * returned cell.numberFormat overrides old cell formats during layout refresh.
 * selections replaces persisted manual field choices; filters adds transient
 * query restrictions without changing those saved choices.
 */
export function planNativePivotReport(pivot, cache, { filters = [], maxCells = 1048576, labels = {}, nativePivots = null, conditionalRules = null, sheetName = '', paintContext = null, selections = null, dataModel = null, maxValues = 4 * 1048576 } = {}) {
  if (!Number.isSafeInteger(maxCells) || maxCells < 0) throw new Error('Invalid pivot report cell limit');
  if (pivot.cache !== cache.key) throw new Error('Mismatched pivot report cache');
  if (selections != null) pivot = writeNativePivotSelections(pivot, cache, selections);
  const original = readNativePivotLayout(pivot, cache);
  if (original.sourceType !== 'worksheet' && !(original.sourceType === 'external' && dataModel)) throw new Error('Rebuilding external pivot reports requires the workbook Data Model');
  if (!original.measures.length) throw new Error('Reports without measures are not implemented');
  if (original.hasCalculatedItems || original.subtotalHiddenItems) throw new Error('Calculated items and hidden-item subtotals are not implemented');
  if (original.sourceType === 'external') {
    if (!original.visualTotals) throw new Error('Nonvisual model totals are not implemented');
    if (original.hierarchies.some(h => h.attribute && h.defaultMember != null && h.defaultMember !== h.allMember)) throw new Error('Non-All model default members are not implemented');
    if (original.cacheFields.filter(f => !original.hierarchies[f.hierarchy]?.measure).length > 1) throw new Error('Multi-attribute model report domains are not implemented');
  }
  const query = original.sourceType === 'worksheet' ? new NativePivotQuery(readNativePivotCache(cache)) : new NativeModelPivotQuery(original, dataModel, { maxValues });
  const layout = { ...original,
    rows: rebuildNativePivotAxis(original, query, 'rows', { filters, maxItems: maxCells }),
    columns: rebuildNativePivotAxis(original, query, 'columns', { filters, maxItems: maxCells }) };
  const updated = writeNativePivotAxes(pivot, layout, { maxItems: maxCells });
  layout.range = parseRefText(updated.ref);
  const cells = nativePivotHeaders(layout, { ...labels, maxCells });
  const formatMember = paintContext == null ? {} : { formatMember: member => member.type === 'blank' ? labels.blankCaption ?? '(blank)' : formatValue(member.value,
    nativePivotCellNumberFormat(layout, { role: 'member', field: member.field }, paintContext.numberFormats)) };
  for (const cell of nativePivotRowLabels(layout, { ...formatMember, ...labels, maxCells: maxCells - cells.length })) cells.push(cell);
  const values = calculateNativePivotValues(layout, query, { filters, maxCells: maxCells - cells.length });
  // Avoid spread calls on large reports: the cell budget can exceed the engine's
  // argument-count limit even though the plan is within its memory budget.
  for (const cell of values) cells.push({ ...cell, role: 'value' });
  let conditionalFormats = nativePivotConditionalRanges(layout, readNativePivotConditionalFormats(updated));
  if (conditionalRules != null) conditionalFormats = planNativePivotConditionalRules(conditionalFormats, conditionalRules, { sheetName, bindings: updated.conditionalRules });
  const styleLayers = nativePivots == null ? null : nativePivotBodyStyleLayers(layout, readNativePivotStyle(updated, nativePivots));
  if (paintContext != null && styleLayers == null) throw new Error('Native pivot styles are required for paint planning');
  const paintLayers = paintContext == null ? null : nativePivotPaintLayers(styleLayers || [], paintContext.themes, paintContext);
  const formatPaintLayers = paintContext == null ? null : nativePivotPaintLayers(
    nativePivotFormatLayers(layout, readNativePivotFormats(updated, nativePivots)), paintContext.themes, paintContext);
  if (paintContext != null) for (const cell of cells) {
    const numberFormat = nativePivotCellNumberFormat(layout, cell, paintContext.numberFormats);
    if (numberFormat != null) cell.numberFormat = numberFormat;
  }
  return { ...(paintLayers == null ? {} : { paintLayers }), ...(formatPaintLayers?.length ? { formatPaintLayers } : {}), pivot: updated, layout, previousRange: original.range, cells, conditionalFormats, ...(styleLayers == null ? {} : { styleLayers }) };
}
