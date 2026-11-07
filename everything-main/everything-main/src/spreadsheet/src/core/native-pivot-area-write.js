import { PIVOT_SUBTOTAL_FLAGS } from './native-pivot-area.js';
import { xmlTag } from './xlsx-export-styles.js';
const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const fail = reason => { throw new Error(`Cannot describe native pivot area: ${reason}`); };
const subtotals = new Set(PIVOT_SUBTOTAL_FLAGS.map(flag => flag.slice(0, -8)));

/** Describe a rebuilt axis context using field-item identities, never captions. */
export function nativePivotAxisReferences(layout, axis, entry, { lastField = null, charge = () => {} } = {}) {
  const references = [];
  if (!entry || entry.type === 'blank') fail('structural blank');
  if (entry.type === 'grand') fail('grand-total selection is not implemented');
  if (entry.type !== 'data' && !subtotals.has(entry.type)) fail('item type');
  if (!Array.isArray(entry.members)) fail('missing member identities');
  if (!Array.isArray(axis.fields) || axis.fields.length > 128) fail('axis fields');
  const fields = axis.fields.filter(field => field !== -2);
  if (entry.members.length > fields.length || fields.length && !entry.members.length) fail('missing member identities');
  if (lastField == null && entry.type === 'data' && entry.members.length < fields.length && !entry.header) fail('collapsed data selection is not implemented');
  const subtotal = entry.type !== 'data' ? entry.type : entry.header && entry.aggregate ? 'default' : null;
  const owner = entry.subtotalField ?? entry.members.at(-1)?.field;
  if (subtotal && !entry.members.some(m => m.field === owner)) fail('missing subtotal identity');
  let found = lastField == null;
  for (const [i, member] of entry.members.entries()) {
    charge(1);
    if (member.field !== fields[i] || !Number.isSafeInteger(member.item) || member.item < 0
      || member.type === 'subtotal' || layout.fields[member.field]?.items[member.item]?.type !== 'data'
      || layout.fields[member.field].items[member.item].index !== member.index) fail('member identity');
    references.push({ field: member.field, items: [member.item], subtotals: subtotal && member.field === owner ? [`${subtotal}Subtotal`] : [] });
    if (member.field === lastField) { found = true; break; }
  }
  if (!found) fail('label owner');
  return references;
}

/** Encode generated member sets; consumers validate their resolved selection. */
export function writeNativePivotArea(references, attrs = {}) {
  return xmlTag('pivotArea', { xmlns: MAIN, ...attrs }, xmlTag('references', { count: references.length }, references.map(ref =>
    xmlTag('reference', { field: ref.field, count: ref.items.length, ...Object.fromEntries(ref.subtotals.map(flag => [flag, 1])) },
      ref.items.map(v => xmlTag('x', { v })).join(''))).join('')));
}
