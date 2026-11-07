/** Reconcile editable app rules against their last native XLSX projection. */
import { BAR_FORMULAS, SCALE_FORMULAS, scaleThresholdFormula } from './conditional-scale.js';
import { duplicateSourceAreas } from './conditional-duplicates.js';
const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
// Keep even a very large generated predicate out of the sidecar a second time.
export async function conditionalFormatSignature(rule, version = 3) {
  if (version === 1 && [...BAR_FORMULAS, ...SCALE_FORMULAS].some(key => rule[`${key}Type`])) {
    const old = { ...rule };
    const ranges = rule.statisticsRange && duplicateSourceAreas(rule.statisticsRange) || [rule.range];
    for (const key of [...BAR_FORMULAS, ...SCALE_FORMULAS]) if (rule[`${key}Type`]) {
      old[key] = scaleThresholdFormula(rule[`${key}Type`], rule[key], ranges, String); delete old[`${key}Type`];
    }
    delete old.statisticsRange;
    rule = old;
  }
  const { pivotRuleIds, ...fingerprint } = rule;
  rule = fingerprint;
  const { sha256 } = await import('@noble/hashes/sha2.js');
  return Array.from(sha256(new TextEncoder().encode(JSON.stringify(canonical(rule)))), n => n.toString(16).padStart(2, '0')).join('');
}

export async function reconcileConditionalFormats(saved, baseline, native, fingerprintRules = native) {
  if (!Array.isArray(saved)) return native;
  // Unverifiable sidecars cannot supply package-local pivot associations.
  const fallback = native.some(rule => rule.pivot && rule.pivotRuleIds?.length) ? native : saved;
  // Old sidecars otherwise retain their historical ownership.
  if (![1, 2, 3].includes(baseline?.version) || !Array.isArray(baseline.entries)) return fallback;
  const represented = new Set();
  for (const entry of baseline.entries) {
    if (!entry || !Number.isInteger(entry.start) || !Number.isInteger(entry.end)
      || entry.start < 0 || entry.end < entry.start || entry.end >= saved.length
      || !Array.isArray(entry.signatures) || !entry.signatures.length
      || entry.signatures.some(key => typeof key !== 'string' || !/^[a-f0-9]{64}$/.test(key))) return fallback;
    for (let i = entry.start; i <= entry.end; i++) {
      if (represented.has(i)) return fallback;
      represented.add(i);
    }
  }
  // Match whole native projections, including all pieces of a disjoint sqref.
  // A partially deleted/split/reordered projection must stay native, otherwise
  // restoring its old app rule could resurrect removed areas or old priority.
  const candidates = new Map();
  for (const entry of baseline.entries) {
    const keys = entry.signatures, first = keys[0];
    if (!candidates.has(first)) candidates.set(first, { items: [], offset: 0 });
    candidates.get(first).items.push({ entry, keys, used: false });
  }
  const keys = await Promise.all(fingerprintRules.map(rule => conditionalFormatSignature(rule, baseline.version))), output = [], positions = new Map();
  for (let at = 0; at < native.length;) {
    const queue = candidates.get(keys[at]);
    let match;
    if (queue) for (let i = queue.offset; i < queue.items.length; i++) {
      const candidate = queue.items[i];
      if (!candidate.used && candidate.keys.every((key, i) => keys[at + i] === key)) { match = candidate; break; }
    }
    if (!match) { output.push(native[at++]); continue; }
    match.used = true;
    while (queue.items[queue.offset]?.used) queue.offset++;
    const projection = native.slice(at, at + match.keys.length);
    const ids = [...new Set(projection.flatMap(rule => rule.pivotRuleIds || []))], pivot = projection.some(rule => rule.pivot);
    for (let i = match.entry.start; i <= match.entry.end; i++) {
      positions.set(i, output.length);
      let restored = saved[i];
      if (ids.length || pivot || restored.pivot || restored.pivotRuleIds?.length) {
        restored = { ...restored };
        if (ids.length) restored.pivotRuleIds = ids; else delete restored.pivotRuleIds;
        if (pivot) restored.pivot = true; else delete restored.pivot;
      }
      output.push(restored);
    }
    at += match.keys.length;
  }
  // Rules with no native representation still belong to the app. Anchor them
  // to the next unchanged rule, or the previous one when no next rule survives.
  // With no surviving anchor, append them in their original relative order.
  const insertions = new Map();
  const anchors = [...positions.keys()].sort((a, b) => a - b);
  let anchor = 0;
  for (let i = 0; i < saved.length; i++) {
    if (represented.has(i)) continue;
    while (anchor < anchors.length && anchors[anchor] < i) anchor++;
    const next = anchors[anchor], previous = anchors[anchor - 1];
    const at = next != null ? positions.get(next) : previous != null ? positions.get(previous) + 1 : output.length;
    if (!insertions.has(at)) insertions.set(at, []);
    insertions.get(at).push(saved[i]);
  }
  return output.flatMap((rule, at) => [...(insertions.get(at) || []), rule]).concat(insertions.get(output.length) || []);
}
