import { nativePivotAxisReferences, writeNativePivotArea } from './native-pivot-area-write.js';
import { nativePivotRowLabels } from './native-pivot-row-labels.js';
import { nativePivotAreaRanges, readNativePivotArea, PIVOT_DATA_FIELD } from './native-pivot-area.js';
import { parseModelXml } from './data-model-metadata.js';
import { removeRangeRecords } from './range-records.js';

const fail = reason => { throw new Error(`Cannot select native pivot ranges: ${reason}`); };
const inside = (g, r, c) => r >= g.r1 && r <= g.r2 && c >= g.c1 && c <= g.c2;

/** Convert finite worksheet selections into an exact union of semantic areas.
 * Merge only one reference's item set at a time while every other condition is
 * identical. This preserves tuple correlations, including combinations absent
 * from today's cache that could appear after refresh. Rows and columns are
 * grouped independently before crossing them; no dense data body is allocated.
 *
 * The final bidirectional rectangle-coverage check rejects both gaps and wider
 * selections. Repeated labels may be selected together, but not partially. This
 * describes membership, not the perimeter/inside-border intent of a UI gesture.
 */
export function nativePivotSelectionAreas(layout, selections, { maxAreas = 1048576, maxWork = 4 * 1048576,
  maxXmlLength = 16 * 1024 * 1024, workBudget = null } = {}) {
  if (![maxAreas, maxWork, maxXmlLength].every(n => Number.isSafeInteger(n) && n >= 0) || !Array.isArray(selections)) fail('limits');
  const budget = workBudget || { remaining: maxWork };
  if (!Number.isSafeInteger(budget.remaining) || budget.remaining < 0) fail('work limit');
  let remaining = Math.min(maxWork, budget.remaining), xmlLength = 0;
  const charge = n => { remaining -= n; budget.remaining -= n; if (remaining < 0 || budget.remaining < 0) fail('work limit'); };
  charge(selections.length);
  if (!selections.length) return [];
  const g = layout.range, top = g.r1 + layout.firstDataRow, left = g.c1 + layout.firstDataCol;
  if (![g.r1, g.c1, g.r2, g.c2, top, left].every(Number.isSafeInteger) || g.r1 < 0 || g.c1 < 0
    || g.r2 >= 1048576 || g.c2 >= 16384 || top < g.r1 || left < g.c1) fail('report bounds');
  for (const range of selections) if (!range || !['r1', 'c1', 'r2', 'c2'].every(key => Number.isSafeInteger(range[key]))
    || range.r1 > range.r2 || range.c1 > range.c2 || range.r1 < top || range.r2 > g.r2 || range.c1 < g.c1 || range.c2 > g.c2) fail('selection outside report body');
  const rowMeasure = layout.rows.fields.includes(-2), colMeasure = layout.columns.fields.includes(-2);
  if (rowMeasure && colMeasure || !rowMeasure && !colMeasure && layout.measures.length !== 1) fail('measure axis');
  const measureRef = index => {
    if (!Number.isSafeInteger(index) || index < 0 || !layout.measures[index]) fail('measure index');
    return { field: PIVOT_DATA_FIELD, items: [index], subtotals: [] };
  };
  const cost = refs => refs.reduce((n, ref) => n + ref.items.length + 1, 1);
  const merge = contexts => {
    const shapes = new Map();
    for (const refs of contexts) {
      charge(cost(refs));
      const shape = JSON.stringify(refs.map(ref => [ref.field, ref.subtotals]));
      if (!shapes.has(shape)) shapes.set(shape, new Map());
      shapes.get(shape).set(JSON.stringify(refs), refs);
    }
    const result = [];
    for (const entries of shapes.values()) {
      let groups = [...entries.values()];
      for (let at = (groups[0]?.length || 0) - 1; at >= 0; at--) {
        const merged = new Map();
        for (const refs of groups) {
          charge(cost(refs));
          const key = JSON.stringify(refs.map((ref, i) => i === at ? null : ref.items));
          let group = merged.get(key);
          if (!group) { group = { refs, items: new Set() }; merged.set(key, group); }
          for (const item of refs[at].items) group.items.add(item);
        }
        groups = [...merged.values()].map(({ refs, items }) => refs.map((ref, i) => i === at ? { ...ref, items: [...items].sort((a, b) => a - b) } : ref));
      }
      for (const refs of groups) result.push(refs);
    }
    return result;
  };
  const axisGroups = (axis, from, to, withMeasure) => {
    if (from < 0 || to >= axis.items.length) fail('selection outside saved axis');
    const contexts = [];
    for (let i = from; i <= to; i++) {
      charge(1);
      const entry = axis.items[i];
      if (entry.header && entry.aggregate === false) fail('nonaggregate header');
      const refs = nativePivotAxisReferences(layout, axis, entry, { charge });
      if (withMeasure) refs.push(measureRef(entry.measure));
      contexts.push(refs);
    }
    return merge(contexts);
  };
  let labels = null;
  if (selections.some(range => range.c1 < left)) {
    charge(layout.rows.items.length * (layout.rows.fields.length + 1) + layout.rows.fields.length);
    labels = nativePivotRowLabels(layout, { maxCells: maxWork });
  }
  const areas = new Set();
  const add = (refs, attrs = {}) => {
    charge(cost(refs));
    const xml = writeNativePivotArea(refs, attrs);
    if (areas.has(xml)) return;
    if (areas.size >= maxAreas) fail('area limit');
    xmlLength += xml.length;
    if (xmlLength > maxXmlLength) fail('XML size limit');
    areas.add(xml);
  };
  for (const range of selections) {
    if (range.c2 >= left) {
      const rows = axisGroups(layout.rows, range.r1 - top, range.r2 - top, rowMeasure);
      const columns = axisGroups(layout.columns, Math.max(range.c1, left) - left, range.c2 - left, colMeasure);
      if (rows.length * columns.length > remaining) fail('work limit');
      for (const row of rows) for (const column of columns) {
        const refs = [...row, ...column];
        if (!rowMeasure && !colMeasure) refs.push(measureRef(0));
        add(refs);
      }
    }
    if (range.c1 < left) {
      const part = { ...range, c2: Math.min(range.c2, left - 1) }, byField = new Map();
      let count = 0;
      for (const cell of labels) {
        charge(1);
        if (!inside(part, cell.r, cell.c)) continue;
        count++;
        if (cell.role === 'grand') fail('grand-total selection is not implemented');
        const position = layout.rows.fields.indexOf(cell.field);
        if (position < 0) fail('label field');
        if (!byField.has(position)) byField.set(position, []);
        byField.get(position).push(nativePivotAxisReferences(layout, layout.rows, layout.rows.items[cell.r - top], { lastField: cell.field, charge }));
      }
      if (count !== (part.r2 - part.r1 + 1) * (part.c2 - part.c1 + 1)) fail('selection contains cells without row-label identity');
      for (const [position, contexts] of byField) for (const refs of merge(contexts)) add(refs, { dataOnly: 0, labelOnly: 1, axis: 'axisRow', fieldPosition: position });
    }
  }
  const resolved = [];
  for (const xml of areas) {
    const before = budget.remaining;
    const ranges = nativePivotAreaRanges(layout, readNativePivotArea(parseModelXml(xml)), { maxRanges: maxAreas - resolved.length, maxWork: remaining, workBudget: budget });
    remaining -= before - budget.remaining;
    for (const range of ranges) resolved.push(range);
  }
  const covered = (range, cuts) => {
    let pieces = [{ range }];
    for (const cut of cuts) {
      charge(pieces.length);
      pieces = removeRangeRecords(pieces, cut);
      if (!pieces.length) return true;
    }
    return false;
  };
  for (const range of selections) if (!covered(range, resolved)) fail('semantic selection leaves gaps');
  for (const range of resolved) if (!covered(range, selections)) fail('semantic selection would paint unselected cells');
  return [...areas];
}
