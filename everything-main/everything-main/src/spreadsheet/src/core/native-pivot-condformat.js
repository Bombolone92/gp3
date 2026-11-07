import { conditionalRuleGroups, conditionalGroupPieces } from './conditional-groups.js';
import { rebaseConditionalPredicate } from './conditional-scale.js';
import { parseModelXml, modelChildren } from './data-model-metadata.js';
import { readNativePivotArea } from './native-pivot-area.js';

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
// MS-OI29500 2.1.803: unsigned representation of the synthetic data field -2.
const DATA_FIELD = 4294967294;
const children = (node, name) => modelChildren(node, name, MAIN);
const fail = message => { throw new Error(`Invalid pivot conditional format: ${message}`); };
const one = (node, name) => { const list = children(node, name); if (list.length > 1) fail(`duplicate ${name}`); return list[0]; };
const uint = (node, name, fallback = null) => {
  if (!node?.hasAttribute(name)) return fallback;
  const raw = node.getAttribute(name).trim(), value = Number(raw);
  if (!/^\+?\d+$/.test(raw) || !Number.isSafeInteger(value) || value > 4294967295) fail(name);
  return value;
};
const list = (node, name) => {
  const found = children(node, name);
  if (uint(node, 'count', found.length) !== found.length) fail('collection count');
  return found;
};
/** Read the pivot-side bindings; priority links to the owner's worksheet rule.
 * Keep field, selection and data scopes distinct. A data-field reference's x
 * values address dataFields, not the source cache field or displayed column.
 */
export function readNativePivotConditionalFormats(pivot) {
  const root = parseModelXml(pivot.xml);
  if (root.namespaceURI !== MAIN || root.localName !== 'pivotTableDefinition') fail('report root');
  if (root.getElementsByTagNameNS('http://schemas.microsoft.com/office/spreadsheetml/2009/9/main', 'conditionalFormat').length) throw new Error('Extended pivot conditional formats are not implemented');
  const priorities = new Set();
  return list(one(root, 'conditionalFormats'), 'conditionalFormat').map(rule => {
    const priority = uint(rule, 'priority'), scope = rule.getAttribute('scope') || 'selection', type = rule.getAttribute('type') || 'none';
    if (!priority || priorities.has(priority)) fail('missing or duplicate priority');
    if (!['selection', 'data', 'field'].includes(scope) || !['none', 'all', 'row', 'column'].includes(type)) fail('scope or type');
    priorities.add(priority);
    const areas = list(one(rule, 'pivotAreas'), 'pivotArea').map(area => readNativePivotArea(area, { fail }));
    if (!areas.length) fail('missing pivot areas');
    return { priority, scope, type, areas };
  });
}

/** Resolve data-field scopes in axis-linear work, without walking value cells.
 * Data scope includes totals and blank separator slots across the other axis;
 * it is not a field-intersection/selected-cell scope. Those narrower scopes and
 * relative/cache/offset selections need separate semantics before live edits.
 */
export function nativePivotConditionalRanges(layout, bindings, { maxRanges = 1048576 } = {}) {
  if (!Number.isSafeInteger(maxRanges) || maxRanges < 0) fail('range limit');
  const { r1, c1, r2, c2 } = layout.range, rows = layout.rows, cols = layout.columns;
  const onRows = rows.fields.includes(-2), onColumns = cols.fields.includes(-2);
  if (onRows && onColumns || layout.measures.length > 1 && !onRows && !onColumns) fail('ambiguous measure axis');
  if (![r1, c1, r2, c2, layout.firstDataRow, layout.firstDataCol].every(Number.isSafeInteger)
    || r1 < 0 || c1 < 0 || r2 < r1 || c2 < c1 || r2 >= 1048576 || c2 >= 16384
    || layout.firstDataRow < 0 || layout.firstDataCol < 0) fail('report location');
  const top = r1 + layout.firstDataRow, left = c1 + layout.firstDataCol;
  if (top + rows.items.length > r2 + 1 || left + cols.items.length > c2 + 1) fail('axis exceeds report');
  let count = 0;
  return bindings.map(binding => {
    if (binding.scope !== 'data' || binding.type !== 'none') throw new Error('Pivot conditional field/selection scopes are not implemented');
    const measures = new Set();
    for (const area of binding.areas) {
      if (!['normal', 'data'].includes(area.type) || !area.dataOnly || area.labelOnly || area.cacheIndex || area.offset || area.field != null) throw new Error('Pivot conditional area selection is not implemented');
      if (area.references.length > 1) throw new Error('Pivot conditional member intersections are not implemented');
      const reference = area.references[0];
      if (reference && (reference.field !== DATA_FIELD || reference.byPosition || reference.relative || reference.subtotals.length)) throw new Error('Pivot conditional member references are not implemented');
      const items = reference?.items.length ? reference.items : layout.measures.map((_m, i) => i);
      for (const index of items) {
        if (!Number.isSafeInteger(index) || index < 0 || !layout.measures[index]) fail('measure index');
        measures.add(index);
      }
    }
    const ranges = [];
    if (!rows.items.length || !cols.items.length) return { priority: binding.priority, ranges };
    const axis = onRows ? rows : cols;
    let start = null;
    const flush = end => {
      if (start == null) return;
      if (++count > maxRanges) fail('range limit');
      ranges.push(onRows ? { r1: top + start, c1: left, r2: top + end, c2: left + cols.items.length - 1 }
        : { r1: top, c1: left + start, r2: top + rows.items.length - 1, c2: left + end });
      start = null;
    };
    for (const [i, item] of axis.items.entries()) {
      const measure = onRows || onColumns ? item.measure : 0;
      if (item.type !== 'blank' && !layout.measures[measure]) fail('axis measure');
      const selected = item.type !== 'blank' && measures.has(measure);
      if (selected && start == null) start = i;
      else if (!selected) flush(i - 1);
    }
    flush(axis.items.length - 1);
    return { priority: binding.priority, ranges };
  });
}

/** Rebase worksheet rule pieces against resolved pivot targets. Source rules
 * carry native priorities from the importer; keep a snapshot even for an empty
 * target so a later clear can reactivate the rule. Applying/persisting these
 * recipes, including remapping priorities on export, belongs to the transaction.
 */
export function planNativePivotConditionalRules(targets, sourceRules, { sheetName = '', bindings = null, newId = () => crypto.randomUUID() } = {}) {
  const byPriority = new Map(), prioritiesById = new Map();
  for (const binding of bindings || []) {
    if (!prioritiesById.has(binding.id)) prioritiesById.set(binding.id, []);
    prioritiesById.get(binding.id).push(binding.priority);
  }
  for (const rule of sourceRules) for (const priority of bindings == null ? [rule.priority]
    : new Set((rule.pivotRuleIds || []).flatMap(id => prioritiesById.get(id) || []))) {
    if (!byPriority.has(priority)) byPriority.set(priority, []);
    byPriority.get(priority).push(rule);
  }
  return targets.flatMap(target => {
    const originals = byPriority.get(target.priority);
    // A managed binding with no remaining rule was explicitly deleted. Raw
    // priority input still requires a source rule; it has no deletion identity.
    if (!originals?.length && bindings?.some(binding => binding.priority === target.priority)) return [];
    if (!originals?.length) fail('missing worksheet rule');
    if (conditionalRuleGroups(originals).length !== 1) fail('ambiguous worksheet rule pieces');
    const ranges = target.ranges.map(range => ({ ...range })), source = structuredClone(originals);
    if (!ranges.length) return { ...target, ranges, rules: [], sourceRules: source };
    const base = rebaseConditionalPredicate(originals[0], ranges[0].r1 - originals[0].range.r1, ranges[0].c1 - originals[0].range.c1);
    const rules = conditionalGroupPieces(base, originals, ranges, sheetName, newId);
    return { ...target, ranges, rules, sourceRules: source };
  });
}
