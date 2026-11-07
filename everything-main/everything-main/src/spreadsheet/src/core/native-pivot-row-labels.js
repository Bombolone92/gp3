const totals = { default: 'Total', sum: 'Sum', countA: 'Count', avg: 'Average', max: 'Max', min: 'Min',
  product: 'Product', count: 'Count', stdDev: 'StdDev', stdDevP: 'StdDevp', var: 'Var', varP: 'Varp' };
const compact = field => field.outline !== false && field.compact !== false;

/** Place member labels from semantic (rebuilt) rows, independently of worksheet
 * text or styling. Compact fields share the next field's column; indentation
 * restarts at each separate column. MS-XLSX 2.6.31 ignores fillDownLabels for
 * compact outline fields. Numeric/date members keep their native types for the
 * eventual cell writer; formatMember supplies formatted text for subtotal names.
 * Headers, page fields, merges and measure-on-rows layout are separate concerns.
 */
export function nativePivotRowLabels(layout, { maxCells = 1048576, blankCaption = '(blank)',
  grandTotalCaption = 'Grand Total', formatMember = member => String(member.value ?? blankCaption),
  subtotalCaption = (caption, type) => `${caption} ${totals[type]}` } = {}) {
  const fail = message => { throw new Error(`Cannot place pivot row labels: ${message}`); };
  if (!Number.isSafeInteger(maxCells) || maxCells < 0) fail('invalid cell limit');
  const fields = layout.rows.fields;
  if (fields.includes(-2)) fail('measure-on-rows labels are not implemented');
  if (layout.mergeItem) fail('merged labels are not implemented');
  if (fields.length > 128 || new Set(fields).size !== fields.length || fields.some(field => !layout.fields[field])) fail('invalid fields');
  const indent = layout.indent ?? 1;
  if (!Number.isSafeInteger(indent) || indent < 0) fail('invalid indentation');
  if (!Number.isSafeInteger(indent * fields.length)) fail('invalid indentation');
  const { r1, c1, r2, c2 } = layout.range;
  if (![r1, c1, r2, c2, layout.firstDataRow, layout.firstDataCol].every(Number.isSafeInteger)
    || r1 < 0 || c1 < 0 || r2 < r1 || c2 < c1 || r2 >= 1048576 || c2 >= 16384
    || layout.firstDataRow < 0 || layout.firstDataCol < 0) fail('invalid report location');
  let column = 0, depth = 0;
  const positions = fields.map((field, i) => {
    if (i) {
      if (compact(layout.fields[fields[i - 1]])) depth++;
      else { column++; depth = 0; }
    }
    return { field, column, indent: depth * indent };
  });
  if (fields.length && column >= layout.firstDataCol) fail('labels overlap data columns');
  const cells = [];
  const emit = (row, position, value, type, role, member) => {
    if (cells.length >= maxCells) fail('cell limit exceeded');
    const r = layout.range.r1 + layout.firstDataRow + row, c = layout.range.c1 + position.column;
    if (!Number.isSafeInteger(r) || !Number.isSafeInteger(c) || r < 0 || c < 0 || r > layout.range.r2 || c > layout.range.c2) fail('invalid report location');
    cells.push({ r, c, value, type, indent: position.indent, role,
      ...(member ? { field: member.field, item: member.item } : {}) });
  };
  let previous = [];
  for (const [row, entry] of layout.rows.items.entries()) {
    if (entry.type === 'blank') { previous = []; continue; }
    if (!fields.length) continue;
    if (entry.type === 'grand') {
      emit(row, { column: 0, indent: 0 }, layout.grandTotalCaption ?? grandTotalCaption, 'string', 'grand');
      previous = []; continue;
    }
    const subtotal = Object.hasOwn(totals, entry.type);
    if (entry.type !== 'data' && !subtotal) fail('invalid row type');
    if (!entry.members.length || entry.members.length > fields.length) fail('missing member identity');
    // Cached subtotal markers do not carry their own group identity. Rebuild the
    // axes first instead of guessing that identity from nearby worksheet text.
    if (entry.members.some((member, i) => member.field !== fields[i] || member.type === 'subtotal'
      || !Number.isInteger(member.item) || layout.fields[member.field].items[member.item]?.type !== 'data'
      || layout.fields[member.field].items[member.item].index !== member.index)) fail('invalid member identity');
    const byColumn = new Map();
    entry.members.forEach((member, i) => byColumn.set(positions[i].column, i));
    let samePrefix = true;
    for (let i = 0; i < entry.members.length; i++) {
      const member = entry.members[i], field = layout.fields[member.field], position = positions[i];
      samePrefix = samePrefix && previous[i]?.field === member.field && previous[i]?.item === member.item;
      if (byColumn.get(position.column) !== i) continue;
      const ownSubtotal = subtotal && i === entry.members.length - 1;
      if (samePrefix && !ownSubtotal && !(field.fillDownLabels && !compact(field))) continue;
      // Report-local captions override the cache caption. Neither changes the
      // typed member value used for grouping, filtering or aggregation.
      const caption = field.items[member.item].caption ?? member.caption;
      let value = caption ?? (member.type === 'blank' ? blankCaption : member.value);
      let type = caption != null || member.type === 'blank' ? 'string' : member.type;
      if (ownSubtotal) {
        value = field.subtotalCaption ?? subtotalCaption(caption ?? formatMember(member, field), entry.type);
        type = 'string';
      }
      emit(row, position, value, type, ownSubtotal ? 'subtotal' : 'member', member);
    }
    previous = entry.members;
  }
  return cells;
}
