const summaries = { sum: 'Sum', count: 'Count', average: 'Average', max: 'Max', min: 'Min', product: 'Product',
  countNums: 'Count', stdDev: 'StdDev', stdDevp: 'StdDevp', var: 'Var', varp: 'Varp' };

/** Header cells for a report whose columns contain measures only. Field headers
 * can be hidden independently of measure captions. Preserve explicit captions,
 * including empty ones, and keep measure identity independent of display order.
 * Column-member hierarchies and mixed compact header groups need their own
 * header geometry; reject them before a caller clears the report body.
 */
export function nativePivotHeaders(layout, { maxCells = 1048576, rowHeaderCaption = 'Row Labels',
  measureCaption = (measure, name) => `${summaries[measure.subtotal] || measure.subtotal} of ${name}` } = {}) {
  const fail = message => { throw new Error(`Cannot place pivot headers: ${message}`); };
  if (!Number.isSafeInteger(maxCells) || maxCells < 0) fail('invalid cell limit');
  if (layout.rows.fields.includes(-2)) fail('measure-on-rows headers are not implemented');
  if (layout.columns.fields.some(field => field !== -2) || layout.columns.fields.length > 1) fail('column-member headers are not implemented');
  const fields = layout.rows.fields.map(index => {
    const field = layout.fields[index]; if (!field) fail('missing field');
    return { index, field, compact: field.compact !== false && field.outline !== false };
  });
  if (new Set(layout.rows.fields).size !== fields.length) fail('duplicate row field');
  const compact = fields.length > 0 && fields.every(f => f.compact);
  if (!compact && fields.some(f => f.compact)) fail('mixed compact headers are not implemented');
  const width = compact ? 1 : fields.length;
  if (width > layout.firstDataCol) fail('row headers overlap measures');
  const { r1, c1, r2, c2 } = layout.range;
  if (![r1, c1, r2, c2, layout.firstDataRow, layout.firstDataCol].every(Number.isSafeInteger)
    || r1 < 0 || c1 < 0 || r2 < r1 || c2 < c1 || r2 >= 1048576 || c2 >= 16384
    || layout.firstDataRow < 0 || layout.firstDataCol < 0) fail('invalid report location');
  const r = r1 + layout.firstDataRow - 1, cells = [];
  const emit = (c, value, role, identity) => {
    if (r < r1 || r > r2 || c < c1 || c > c2) fail('invalid header location');
    if (cells.length >= maxCells) fail('cell limit exceeded');
    cells.push({ r, c, value, type: 'string', role, ...identity });
  };
  if (layout.showHeaders !== false) {
    if (compact) emit(c1, layout.rowHeaderCaption ?? rowHeaderCaption, 'rowHeader', {});
    else for (const [i, { index, field }] of fields.entries()) {
      const name = field.caption ?? layout.cacheFields[index]?.caption ?? layout.cacheFields[index]?.name;
      if (name == null) fail('missing field caption');
      emit(c1 + i, name, 'rowHeader', { field: index });
    }
  }
  if (layout.measures.length > 1 && !layout.columns.fields.includes(-2)) fail('ambiguous measure axis');
  for (const [column, item] of layout.columns.items.entries()) {
    if (!layout.measures.length) break;
    if (item.type !== 'data' || item.members.length) fail('invalid measure column');
    const index = layout.columns.fields.includes(-2) ? item.measure : 0, measure = layout.measures[index];
    if (!measure) fail('invalid measure index');
    const name = layout.cacheFields[measure.field]?.caption ?? layout.cacheFields[measure.field]?.name;
    if (name == null) fail('missing measure field');
    emit(c1 + layout.firstDataCol + column, measure.caption ?? measureCaption(measure, name), 'measureHeader', { measure: index });
  }
  return cells;
}
