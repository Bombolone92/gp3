import { nativePivotValueContexts } from './native-pivot-layout.js';
import { nativePivotFilters } from './native-pivot-filters.js';

const subtotalFunctions = { sum: 'sum', countA: 'count', avg: 'average', max: 'max', min: 'min', product: 'product',
  count: 'countNums', stdDev: 'stdDev', stdDevP: 'stdDevp', var: 'var', varP: 'varp' };
function emptyHeader(layout, axis, item) {
  if (item.header) return item.aggregate === false;
  if (item.type !== 'data' || !item.members.length || item.members.length >= axis.fields.filter(field => field !== -2).length) return false;
  const last = item.members.at(-1), field = layout.fields[last.field];
  if (!field || field.items[last.item]?.details === false) return false;
  return field.defaultSubtotal === false || field.subtotalTop === false;
}

/** Compute unformatted measure cells as a complete plan before worksheet edits.
 * Structural blank rows are omitted; the caller clears the old/new report area.
 * Missing-data captions apply only when no nonblank source values contribute,
 * never to a numeric zero or a structural outline header. Custom error captions
 * affect the displayed cells, not the cache values used to calculate totals.
 */
export function calculateNativePivotValues(layout, query, { filters = [], maxCells = 1048576 } = {}) {
  if (layout.measures.some(measure => measure.showDataAs && measure.showDataAs !== 'normal')) throw new Error('Pivot show-values-as calculation is not implemented');
  const restrictions = nativePivotFilters(layout, filters), cells = [];
  const measureIndexes = new Map(layout.measures.map((measure, i) => [measure, i]));
  for (const context of nativePivotValueContexts(layout, { maxCells })) {
    const row = layout.rows.items[context.r - layout.range.r1 - layout.firstDataRow];
    const column = layout.columns.items[context.c - layout.range.c1 - layout.firstDataCol];
    if ([row.type, column.type].some(type => !['data', 'default', 'grand'].includes(type) && !Object.hasOwn(subtotalFunctions, type))) throw new Error('Invalid pivot value item type');
    let value = null;
    if (!emptyHeader(layout, layout.rows, row) && !(column.header && column.aggregate === false)) {
      const customs = [row.type, column.type].filter(type => Object.hasOwn(subtotalFunctions, type));
      if (new Set(customs).size > 1) throw new Error('Conflicting pivot subtotal functions are not implemented');
      const summary = customs.length ? subtotalFunctions[customs[0]] : context.measure.subtotal;
      const members = context.members.filter(member => member.type !== 'subtotal').map(member => ({ field: member.field, items: [member.index] }));
      const result = query.aggregate(context.measure.field, summary, [...restrictions, ...members], { withPresence: true });
      if (!result.nonEmpty) value = layout.showMissing === false ? 0 : layout.missingCaption || null;
      else if (result.value?.error && layout.showError) value = layout.errorCaption || null;
      else value = result.value;
    }
    cells.push({ r: context.r, c: context.c, value, measure: measureIndexes.get(context.measure) });
  }
  return cells;
}
