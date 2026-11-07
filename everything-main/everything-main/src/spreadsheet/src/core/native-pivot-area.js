import { modelChildren } from './data-model-metadata.js';
import { nativePivotRowLabels } from './native-pivot-row-labels.js';

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
export const PIVOT_DATA_FIELD = 4294967294;
export const PIVOT_SUBTOTAL_FLAGS = ['defaultSubtotal', 'sumSubtotal', 'countASubtotal', 'avgSubtotal', 'maxSubtotal', 'minSubtotal',
  'productSubtotal', 'countSubtotal', 'stdDevSubtotal', 'stdDevPSubtotal', 'varSubtotal', 'varPSubtotal'];

/** Shared native selection vocabulary for direct and conditional formatting.
 * Parsing retains unsupported selectors so each consumer can reject them rather
 * than accidentally widening a selection. Item identities are resolved later.
 */
export function readNativePivotArea(area, { fail = reason => { throw new Error(`Invalid pivot area: ${reason}`); } } = {}) {
  const children = (node, name) => modelChildren(node, name, MAIN);
  const one = (node, name) => { const found = children(node, name); if (found.length > 1) fail(`duplicate ${name}`); return found[0]; };
  const uint = (node, name, fallback = null) => {
    if (!node?.hasAttribute(name)) return fallback;
    const raw = node.getAttribute(name).trim(), value = Number(raw);
    if (!/^\+?\d+$/.test(raw) || !Number.isSafeInteger(value) || value > 4294967295) fail(name);
    return value;
  };
  const flag = (node, name, fallback = false) => {
    if (!node.hasAttribute(name)) return fallback;
    const raw = node.getAttribute(name).trim();
    if (!['0', '1', 'false', 'true'].includes(raw)) fail(name);
    return raw === '1' || raw === 'true';
  };
  const list = (node, name) => {
    const found = children(node, name);
    if (uint(node, 'count', found.length) !== found.length) fail('collection count');
    return found;
  };
  if (area?.namespaceURI !== MAIN || area.localName !== 'pivotArea') fail('area root');
  return {
    type: area.getAttribute('type') || 'normal', dataOnly: flag(area, 'dataOnly', true), labelOnly: flag(area, 'labelOnly'),
    grandRow: flag(area, 'grandRow'), grandCol: flag(area, 'grandCol'), outline: flag(area, 'outline', true),
    collapsedLevelsAreSubtotals: flag(area, 'collapsedLevelsAreSubtotals'),
    axis: area.getAttribute('axis') || null, fieldPosition: uint(area, 'fieldPosition'),
    cacheIndex: flag(area, 'cacheIndex'), offset: area.getAttribute('offset') || null,
    field: area.hasAttribute('field') ? area.getAttribute('field') : null,
    references: list(one(area, 'references'), 'reference').map(reference => ({ field: uint(reference, 'field'),
      selected: flag(reference, 'selected', true), byPosition: flag(reference, 'byPosition'), relative: flag(reference, 'relative'),
      subtotals: PIVOT_SUBTOTAL_FLAGS.filter(name => flag(reference, name)),
      items: list(reference, 'x').map(item => { const index = uint(item, 'v'); if (index == null) fail('item index'); return index; }) })),
  };
}

/** Data-value selections are intersections of field-member sets, not sheet
 * coordinates. Coalesce each selected axis independently before crossing runs;
 * work is bounded even when a rule selects an enormous rectangular body.
 */
export function nativePivotAreaDataRanges(layout, area, options) {
  if (!area.dataOnly || area.labelOnly) throw new Error('Pivot area label selection is not implemented by the data-only selector');
  return nativePivotAreaRanges(layout, area, options);
}

/** Resolve value areas and member-label areas from rebuilt semantic axes. Row
 * labels use the same placement as the report, including compact columns and
 * omitted repeats. Cross-axis label associations need column-label geometry;
 * they must not be guessed from the rectangular data body.
 */
export function nativePivotAreaRanges(layout, area, { maxRanges = 1048576, maxWork = 4 * 1048576, workBudget = null } = {}) {
  const fail = reason => { throw new Error(`Invalid pivot area: ${reason}`); };
  if (![maxRanges, maxWork].every(n => Number.isSafeInteger(n) && n >= 0)) fail('limit');
  const rawField = area.field?.trim(), fieldId = rawField == null ? -1 : Number(rawField);
  if (rawField != null && (!/^[+-]?\d+$/.test(rawField) || !Number.isSafeInteger(fieldId) || fieldId < -2147483648 || fieldId > 2147483647)) fail('field index');
  // MS-XLSB PRuleHeaderData: for a non-button rule, references carry the
  // selection. An explicit field may repeat the final reference's field; -2
  // denotes the data field (unsigned 0xfffffffe in a reference). It is not an
  // additional item filter or a worksheet-column index.
  const referencedField = area.references.at(-1)?.field;
  const matchingField = fieldId === -1 || area.references.length > 0
    && (fieldId === -2 ? referencedField === PIVOT_DATA_FIELD : fieldId >= 0 && fieldId === referencedField);
  const labels = !area.dataOnly;
  if (!['normal', 'data'].includes(area.type) || area.dataOnly && area.labelOnly || area.offset
    || !labels && (area.axis != null || area.fieldPosition != null) || !matchingField || area.collapsedLevelsAreSubtotals) {
    throw new Error('Pivot area label/position/extended selection is not implemented');
  }
  if (labels && (area.type !== 'normal' || !area.outline || area.axis != null && area.axis !== 'axisRow'
    || !area.references.length && area.axis !== 'axisRow'
    || area.references.some(ref => !layout.rows.fields.includes(ref.field)))) {
    throw new Error('Pivot area column/unqualified/extended label selection is not implemented');
  }
  const { r1, c1, r2, c2 } = layout.range, top = r1 + layout.firstDataRow, left = c1 + layout.firstDataCol;
  if (![r1, c1, r2, c2, top, left].every(Number.isSafeInteger) || r1 < 0 || c1 < 0 || r2 < r1 || c2 < c1
    || r2 >= 1048576 || c2 >= 16384 || top < r1 || left < c1 || top > r2 + 1 || left > c2 + 1
    || top + layout.rows.items.length > r2 + 1 || left + layout.columns.items.length > c2 + 1) fail('report bounds');
  const budget = workBudget || { remaining: maxWork };
  if (!Number.isSafeInteger(budget.remaining) || budget.remaining < 0) fail('work limit');
  let remaining = maxWork;
  const step = () => { if (--remaining < 0 || --budget.remaining < 0) fail('work limit'); };
  step();
  const axes = [layout.rows, layout.columns], filters = [[], []], seen = new Set();
  if (axes.some(axis => !Array.isArray(axis.fields) || axis.fields.length > 128 || new Set(axis.fields).size !== axis.fields.length
    || axis.fields.some(field => field !== -2 && (!Number.isSafeInteger(field) || field < 0 || !layout.fields[field])))) fail('axis fields');
  if (labels && area.fieldPosition != null && (!Number.isSafeInteger(area.fieldPosition)
    || area.fieldPosition < 0 || area.fieldPosition >= layout.rows.fields.length)) fail('row field position');
  const labelField = labels && area.fieldPosition != null ? layout.rows.fields[area.fieldPosition] : null;
  if (fieldId !== -1 && labelField != null && fieldId !== labelField) fail('conflicting field position');
  const measureAxis = axes.map(axis => axis.fields.includes(-2));
  if (measureAxis.every(Boolean) || !measureAxis.some(Boolean) && layout.measures.length !== 1) fail('measure axis');
  for (const reference of area.references) {
    step();
    const field = reference.field;
    if (field == null || seen.has(field)) fail('missing or duplicate field reference');
    seen.add(field);
    if (reference.relative || reference.byPosition) throw new Error('Pivot area relative/positional references are not implemented');
    if (reference.subtotals.includes('defaultSubtotal') && reference.subtotals.length > 1) fail('conflicting subtotal flags');
    if (field === PIVOT_DATA_FIELD) {
      if (area.cacheIndex || reference.subtotals.length) throw new Error('Pivot area cache/subtotal measure references are not implemented');
      for (const index of reference.items) { step(); if (!layout.measures[index]) fail('measure index'); }
      filters[measureAxis[0] ? 0 : 1].push({ measure: true, items: reference.items.length ? new Set(reference.items) : null });
      continue;
    }
    const owners = axes.map(axis => axis.fields.includes(field));
    if (owners[0] === owners[1] || !layout.fields[field]) throw new Error('Pivot area page/unused field references are not implemented');
    const items = reference.items.length ? new Set(reference.items.map(index => {
      step();
      const item = layout.fields[field].items[index];
      const shared = area.cacheIndex ? index : item?.type === 'data' ? item.index : null;
      if (shared == null || !layout.cacheFields[field]?.items[shared]) fail('member index');
      return shared;
    })) : null;
    filters[owners[0] ? 0 : 1].push({ field, items, selected: reference.selected, subtotals: new Set(reference.subtotals.map(name => name.slice(0, -8))) });
  }
  const labelDepths = labels ? new Map(layout.rows.fields.map((field, depth) => [field, depth])) : null;
  const types = new Set(['data', 'grand', 'blank', ...PIVOT_SUBTOTAL_FLAGS.map(name => name.slice(0, -8))]);
  const matches = (entry, axisIndex, labelField) => {
    if (!types.has(entry.type)) fail('axis item type');
    let selected = entry.type !== 'blank' && (labelField !== undefined || !(entry.header && entry.aggregate === false));
    if (entry.type === 'grand') selected &&= axisIndex === 0 ? area.grandRow : area.grandCol;
    for (const filter of filters[axisIndex]) {
      step();
      if (!selected) break;
      if (filter.measure) {
        const measure = measureAxis[axisIndex] ? entry.measure : 0;
        if (!layout.measures[measure]) fail('axis measure');
        selected &&= filter.items == null || filter.items.has(measure);
        continue;
      }
      if (entry.type === 'grand') { selected &&= filter.items == null && filter.subtotals.has('default'); continue; }
      if (!Array.isArray(entry.members)) fail('unresolved members');
      let member;
      for (const candidate of entry.members) { step(); if (candidate?.field === filter.field) { member = candidate; break; } }
      if (!member) { selected = false; continue; }
      // A tabular parent printed beside a child is not associated with that
      // child's identity. Descendant labels do retain their parent context.
      if (labelField !== undefined && labelDepths.get(filter.field) > labelDepths.get(labelField)) { selected = false; continue; }
      if (labelField === filter.field && !filter.selected && layout.fields[filter.field].outline !== false) { selected = false; continue; }
      if (member.type === 'subtotal' || !Number.isSafeInteger(member.index) || !layout.cacheFields[filter.field]?.items[member.index]) fail('unresolved member');
      selected &&= filter.items == null || filter.items.has(member.index);
      const own = (entry.subtotalField ?? entry.members.at(-1)?.field) === filter.field;
      const subtotal = own ? entry.type !== 'data' ? entry.type : entry.header && entry.aggregate ? 'default' : null : null;
      selected &&= filter.subtotals.size ? subtotal != null && filter.subtotals.has(subtotal) : subtotal == null;
    }
    return selected;
  };
  const runs = area.labelOnly ? [[], []] : axes.map((axis, axisIndex) => {
    const result = []; let start = null;
    // Axis runs are bounded by the visited-item work budget. Only their cross
    // product consumes output ranges: either axis may select no cells.
    const flush = end => { if (start != null) { result.push([start, end]); start = null; } };
    for (const [i, entry] of axis.items.entries()) {
      step();
      const selected = matches(entry, axisIndex);
      if (selected && start == null) start = i;
      else if (!selected) flush(i - 1);
    }
    flush(axis.items.length - 1);
    return result;
  });
  if (runs[0].length * runs[1].length > maxRanges) fail('range limit');
  const ranges = runs[0].flatMap(([a, b]) => runs[1].map(([c, d]) => { step(); return { r1: top + a, r2: top + b, c1: left + c, c2: left + d }; }));
  if (labels) {
    // Preflight label placement before allocating its output. Count its bounded
    // row/field traversal against the same budget used by all formatting rules.
    const placementWork = layout.rows.items.length * (layout.rows.fields.length + 1) + layout.rows.fields.length;
    if (placementWork > remaining || placementWork > budget.remaining) fail('work limit');
    remaining -= placementWork; budget.remaining -= placementWork;
    const columns = new Map();
    for (const cell of nativePivotRowLabels(layout, { maxCells: maxWork })) {
      step();
      // Axis positions address fields, not worksheet columns: compact fields
      // can share a column. The grand label is emitted in the outer field.
      if (labelField != null && (cell.field ?? layout.rows.fields[0]) !== labelField) continue;
      const entry = layout.rows.items[cell.r - top];
      if (!matches(entry, 0, cell.field ?? null)) continue;
      const previous = columns.get(cell.c);
      if (previous && previous.r2 + 1 === cell.r) previous.r2 = cell.r;
      else {
        if (ranges.length >= maxRanges) fail('range limit');
        const range = { r1: cell.r, r2: cell.r, c1: cell.c, c2: cell.c };
        columns.set(cell.c, range); ranges.push(range);
      }
    }
  }
  return ranges;
}
