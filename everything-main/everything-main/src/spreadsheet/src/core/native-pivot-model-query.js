import { NativePivotQuery } from './native-pivot-query.js';
import { nativePivotModelContext } from './native-pivot-layout.js';
import { nativePivotOlapAttribute } from './native-pivot-olap-filters.js';
import { createDataModelEvaluation } from './data-model-evaluate.js';

const fail = reason => { throw new Error(`Cannot query model pivot: ${reason}`); };
function memberKey(item, type) {
  if (item.type === 'blank') return null;
  if (type === 'integer' && item.type === 'number' && Number.isSafeInteger(item.value)) return BigInt(item.value);
  if (item.type === type && ['string', 'number'].includes(type)) return item.value;
  fail('shared member type or integer precision');
}

/** Query the saved model, without fabricating worksheet-cache data on export.
 * Flat attributes from the measure's own table share stored partition ordinals.
 * Canonical saved dictionary values match exactly; worksheet text folding must
 * not substitute for model collation. Missing/ambiguous mappings fail explicitly.
 * Relationships and cross-table measure contexts need their own propagation.
 */
export class NativeModelPivotQuery extends NativePivotQuery {
  constructor(layout, dataModel, { maxValues = 4 * 1048576 } = {}) {
    const session = createDataModelEvaluation({ dataModel }, { source: 'stored', maxValues });
    const measures = new Map(); let table;
    for (const measure of layout.measures) {
      const bound = nativePivotModelContext(layout, { measure, members: [] }, session.schema);
      if (table != null && table !== bound.table) fail('cross-table measures are not implemented');
      table = bound.table; measures.set(measure.field, bound);
    }
    if (table == null) fail('missing measure');
    const count = session.storedRowCount(table), columns = [];
    for (const [field, definition] of layout.cacheFields.entries()) {
      if (layout.hierarchies[definition.hierarchy]?.measure) continue;
      nativePivotOlapAttribute(layout, field);
      const bound = nativePivotModelContext(layout, { measure: layout.measures[0], members: [{ field, type: 'blank', value: null }] }, session.schema).filters[0];
      if (!bound || bound.table !== table) fail('cross-table attributes are not implemented');
      if (count * (columns.length + 1) > maxValues) fail('record allocation exceeds value limit');
      const { type, values } = session.storedColumn(table, bound.column), members = new Map();
      for (const [index, item] of definition.items.entries()) {
        const key = memberKey(item, type);
        if (members.has(key)) fail('ambiguous shared member');
        members.set(key, { ...item, index });
      }
      columns.push({ field, values, members });
    }
    const records = Array.from({ length: count }, (_unused, row) => columns.map(column => {
      const member = column.members.get(column.values[row]);
      if (!member) fail('stored value has no exact shared member');
      return member;
    }));
    for (const column of columns) if (new Set(column.values).size !== column.members.size) fail('shared member domain differs from the stored model');
    super({ fields: layout.cacheFields, recordFields: columns.map(column => column.field), records });
    this.session = session; this.measures = measures; this.table = table; this.layout = layout;
    this.remainingQueries = maxValues;
  }

  aggregateRows(field, summary = 'sum', rows = [], { withPresence = false } = {}) {
    const bound = this.measures.get(field);
    if (!bound) fail('missing measure field');
    if (summary !== 'sum') fail('custom model subtotal functions are not implemented');
    if (!Array.isArray(rows)) fail('record selection');
    let previous = -1;
    for (const row of rows) {
      if (!Number.isInteger(row) || row <= previous || row >= this.cache.records.length) fail('record selection');
      previous = row;
    }
    if (--this.remainingQueries < 0) fail('measure query limit exceeded');
    const value = this.session.evaluate(bound.table, bound.measure, { selectRows: table => {
      if (table !== this.table) fail('cross-table measure dependencies are not implemented');
      return rows;
    } });
    // A constant measure can be nonblank even with no source records. OLAP
    // presence is the evaluated measure, not the count of input column values.
    return { value, records: rows.length, ...(withPresence ? { nonEmpty: value == null ? 0 : 1 } : {}) };
  }

  memberVisible(rows, axisName) {
    if (axisName === 'rows' ? this.layout.showEmptyRow : this.layout.showEmptyCol) return true;
    for (const field of this.measures.keys()) if (this.aggregateRows(field, 'sum', rows).value != null) return true;
    return false;
  }
}
