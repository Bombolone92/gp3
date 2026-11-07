import { materializeNativePivotReport } from './native-pivot-materialize.js';

const fail = reason => { throw new Error(`Cannot prepare native pivot refresh: ${reason}`); };

/** Materialize a batch before mutation, keeping one cell budget and merging
 * conditional-rule replacements in their original per-sheet priority order.
 * Reports may be a lazy iterable so planners need not retain every cell plan.
 */
export function prepareNativePivotReportUpdates(wb, reports, { maxCells = 1048576 } = {}) {
  if (!Number.isSafeInteger(maxCells) || maxCells < 0) fail('invalid cell limit');
  const rules = new Map(), replacements = new Map();
  let remaining = maxCells;
  const updates = [];
  for (const { pivot, cache, plan, nextCache = null } of reports) {
    if (plan.layout.pageFields.length) fail('page-caption refresh is not implemented');
    if (plan.conditionalFormats.some(format => format.sourceRules?.length && !format.rules.length)) fail('dormant conditional rule persistence is not implemented');
    const cells = materializeNativePivotReport(wb, pivot, plan, { maxCells: remaining, nextCache });
    remaining -= cells.length;
    if (!replacements.has(pivot.owner)) replacements.set(pivot.owner, new Map());
    const byId = replacements.get(pivot.owner);
    for (const format of plan.conditionalFormats) {
      const id = pivot.conditionalRules?.find(binding => binding.priority === format.priority)?.id;
      if (!id) fail('missing conditional rule identity');
      if (byId.has(id)) fail('conditional rule shared by multiple report bindings');
      byId.set(id, format.rules);
    }
    updates.push({ pivot, cache, next: plan.pivot, cells });
  }
  for (const [owner, byId] of replacements) {
    const next = [], emitted = new Set();
    // Insert replacements at the original priority position, retaining unrelated
    // rules and their order. One rule split over disjoint ranges is emitted once.
    for (const rule of wb.sheet(owner).rules) {
      const ids = (rule.pivotRuleIds || []).filter(id => byId.has(id));
      if (!ids.length) { next.push(rule); continue; }
      if (ids.length !== 1 || rule.pivotRuleIds.length !== 1) fail('conditional rule shared with another report');
      const id = ids[0];
      if (!emitted.has(id)) { emitted.add(id); for (const replacement of byId.get(id)) next.push(replacement); }
    }
    rules.set(owner, next);
  }
  return { updates, rules };
}
