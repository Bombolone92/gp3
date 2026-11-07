import { nativePivotRowLabels } from './native-pivot-row-labels.js';
import { readNativePivotArea, nativePivotAreaRanges, PIVOT_DATA_FIELD } from './native-pivot-area.js';
import { parseModelXml } from './data-model-metadata.js';
import { nativePivotAxisReferences, writeNativePivotArea } from './native-pivot-area-write.js';

const fail = reason => { throw new Error(`Cannot select native pivot cell: ${reason}`); };

/** Describe one displayed member-label or value cell by semantic identity.
 * Captions, worksheet values and absolute coordinates are never written into the
 * rule. References use pivot-field item indexes, with ancestor context, measure
 * indexes and subtotal functions kept distinct. Row field positions distinguish
 * labels sharing a compact column.
 *
 * Resolve the candidate against the current layout before returning it: repeated
 * labels/duplicate contexts must not silently widen a one-cell edit. Grand totals,
 * column labels, field buttons and structural blanks need additional selection
 * semantics; neither offsets nor worksheet coordinates are guessed for them.
 */
export function nativePivotCellArea(layout, r, c, { maxWork = 4 * 1048576, workBudget = null } = {}) {
  if (!Number.isSafeInteger(maxWork) || maxWork < 0 || !Number.isSafeInteger(r) || !Number.isSafeInteger(c)) fail('limits or coordinates');
  const g = layout.range, top = g.r1 + layout.firstDataRow, left = g.c1 + layout.firstDataCol;
  if (![g.r1, g.c1, g.r2, g.c2, top, left].every(Number.isSafeInteger)
    || r < g.r1 || r > g.r2 || c < g.c1 || c > g.c2 || r < top) fail('cell outside report body');
  const budget = workBudget || { remaining: maxWork };
  if (!Number.isSafeInteger(budget.remaining) || budget.remaining < 0) fail('work limit');
  let remaining = maxWork;
  const charge = n => { remaining -= n; budget.remaining -= n; if (remaining < 0 || budget.remaining < 0) fail('work limit'); };
  const references = [], attrs = {};
  const addAxis = (axis, entry, lastField = null) => references.push(...nativePivotAxisReferences(layout, axis, entry, { lastField, charge }));
  const row = layout.rows.items[r - top];
  if (c >= left) {
    const column = layout.columns.items[c - left];
    if (row?.header && row.aggregate === false || column?.header && column.aggregate === false) fail('nonaggregate header');
    addAxis(layout.rows, row); addAxis(layout.columns, column);
    const rowMeasure = layout.rows.fields.includes(-2), columnMeasure = layout.columns.fields.includes(-2);
    if (rowMeasure && columnMeasure || !rowMeasure && !columnMeasure && layout.measures.length !== 1) fail('measure axis');
    const measure = rowMeasure ? row.measure : columnMeasure ? column.measure : 0;
    if (!Number.isSafeInteger(measure) || measure < 0 || !layout.measures[measure]) fail('measure index');
    references.push({ field: PIVOT_DATA_FIELD, items: [measure], subtotals: [] });
  } else {
    charge(layout.rows.items.length * (layout.rows.fields.length + 1) + layout.rows.fields.length);
    const labels = nativePivotRowLabels(layout, { maxCells: maxWork });
    let label;
    for (const cell of labels) { charge(1); if (cell.r === r && cell.c === c) label = cell; }
    if (!label) fail('cell is not an emitted row label');
    if (label.role === 'grand') fail('grand-total selection is not implemented');
    const position = layout.rows.fields.indexOf(label.field);
    if (position < 0) fail('label field');
    Object.assign(attrs, { dataOnly: 0, labelOnly: 1, axis: 'axisRow', fieldPosition: position });
    addAxis(layout.rows, row, label.field);
  }
  const xml = writeNativePivotArea(references, attrs);
  const ranges = nativePivotAreaRanges(layout, readNativePivotArea(parseModelXml(xml)), { maxRanges: 2, maxWork: remaining, workBudget: budget });
  if (ranges.length !== 1 || ranges[0].r1 !== r || ranges[0].r2 !== r || ranges[0].c1 !== c || ranges[0].c2 !== c) fail('member rule does not select exactly this cell');
  return xml;
}
