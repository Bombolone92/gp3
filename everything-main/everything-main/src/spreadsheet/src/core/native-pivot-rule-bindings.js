import { modelChildren, parseModelXml, standaloneModelXml } from './data-model-metadata.js';
const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';

/** Worksheet priorities are package-local. Tokens keep the association stable
 * through rule edits, splitting, reordering and report moves within the model. */
export function bindNativePivotRules(pivots, sheets, priorities) {
  if (!pivots) return;
  const used = new Set(), byId = new Map(sheets.map(sheet => [sheet.id, sheet]));
  const available = new Map(sheets.map(sheet => [sheet.id, new Set(sheet.rules.flatMap(rule => rule.pivotRuleIds || []))]));
  for (const pivot of pivots.tables) {
    if (pivot.owner == null) continue;
    const sheet = byId.get(pivot.owner);
    const byPriority = priorities.get(sheet?.name);
    const root = parseModelXml(pivot.xml);
    const collections = modelChildren(root, 'conditionalFormats', MAIN), formats = collections[0];
    const nodes = modelChildren(formats, 'conditionalFormat', MAIN), seen = new Set();
    if (collections.length > 1 || nodes.length > 65536 || formats?.hasAttribute('count') && (!/^\+?\d+$/.test(formats.getAttribute('count').trim()) || Number(formats.getAttribute('count')) !== nodes.length)) throw new Error('Invalid pivot conditional collection');
    pivot.conditionalRules = nodes.map(node => {
      const priority = Number(node.getAttribute('priority')), id = byPriority?.get(priority);
      if (!/^\+?\d+$/.test(node.getAttribute('priority')?.trim() || '') || seen.has(priority) || !Number.isInteger(priority) || priority <= 0 || priority > 4294967295 || !id || !available.get(pivot.owner)?.has(id)) throw new Error('Missing pivot conditional worksheet rule');
      seen.add(priority); used.add(id); return { priority, id };
    });
  }
  for (const sheet of sheets) for (const rule of sheet.rules) {
    const ids = rule.pivotRuleIds?.filter(id => used.has(id));
    if (ids?.length) rule.pivotRuleIds = ids;
    else delete rule.pivotRuleIds;
  }
}

/** Expand or remove native bindings using the actual worksheet export, which
 * can split one app rule into several native rules or rejoin adjacent pieces. */
export function writeNativePivotRuleBindings(root, pivot, priorities) {
  if (!pivot.conditionalRules) return; // Historical snapshots predate token binding.
  const formats = modelChildren(root, 'conditionalFormats', MAIN)[0];
  if (!formats) return;
  const bindings = new Map(pivot.conditionalRules.map(item => [item.priority, item.id]));
  const result = [], seen = new Map();
  for (const node of modelChildren(formats, 'conditionalFormat', MAIN)) {
    const id = bindings.get(Number(node.getAttribute('priority')));
    if (!id) throw new Error('Missing pivot conditional rule identity');
    const exported = [...(priorities?.get(id) || [])];
    if (priorities?.has(id) && !exported.length) throw new Error('Pivot conditional worksheet rule has no native representation');
    for (const priority of exported) {
      const copy = node.cloneNode(true); copy.setAttribute('priority', String(priority));
      const xml = standaloneModelXml(copy);
      if (seen.has(priority)) {
        if (seen.get(priority) !== xml) throw new Error('Ambiguous exported pivot conditional rule');
        continue;
      }
      seen.set(priority, xml); result.push(copy);
    }
    formats.removeChild(node);
  }
  for (const node of result) formats.appendChild(node);
  if (result.length) formats.setAttribute('count', String(result.length));
  else root.removeChild(formats);
}

/** Rule copies become ordinary rules unless their native report is copied too. */
export function copyPivotRuleBindings(rule, mapping) {
  const result = { ...rule };
  delete result.pivotRuleIds; delete result.pivot;
  const ids = [...new Set((rule.pivotRuleIds || []).flatMap(id => mapping?.get(id) || []))];
  if (ids.length) { result.pivotRuleIds = ids; result.pivot = true; }
  return result;
}
export function clonedPivotRuleMap(copies) {
  const mapping = new Map();
  for (const [source, target] of copies) for (let i = 0; i < (source.conditionalRules?.length || 0); i++) {
    const id = source.conditionalRules[i].id;
    if (!mapping.has(id)) mapping.set(id, []);
    mapping.get(id).push(target.conditionalRules[i].id);
  }
  return mapping;
}

/** Removing a report leaves its former conditional rules as ordinary formats.
 * Derive this for export so undo can still restore the original association. */
export function nativePivotRuleOwners(pivots) {
  const owners = new Map();
  for (const pivot of pivots?.tables || []) {
    if (!owners.has(pivot.owner)) owners.set(pivot.owner, new Set());
    for (const binding of pivot.conditionalRules || []) owners.get(pivot.owner).add(binding.id);
  }
  return owners;
}
export function exportPivotRuleSheet(sheet, owners) {
  return { ...sheet, rules: sheet.rules.map(rule => {
    if (!rule.pivotRuleIds?.length) return rule;
    const ids = rule.pivotRuleIds.filter(id => owners.get(sheet.id)?.has(id));
    if (ids.length === rule.pivotRuleIds.length) return rule;
    const copy = { ...rule };
    if (ids.length) copy.pivotRuleIds = ids;
    else { delete copy.pivotRuleIds; delete copy.pivot; }
    return copy;
  }) };
}
