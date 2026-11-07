import { standaloneModelXml } from './data-model-metadata.js';
import { linkedModelBindings } from './data-model-bindings.js';
import { resolveLinkedModelSource } from './data-model-source.js';
import { decodeXlsxString, encodeXlsxAttribute } from './xlsx-string.js';
import { refToText, sheetKey } from './refs.js';

/** Carry the model as a unit: relationships, measures and stored columns remain
 * authoritative. Linked sources on omitted sheets become named external ranges
 * through the ordinary sheet-copy dependency mapper. Their header row belongs
 * to the connection, even when the original name referred to table data only. */
export function dataModelSheetCopy(wb, sheet) {
  if (!wb.dataModel) return { dataModel: null, entries: [], formulas: [], connectionIds: new Set() };
  const model = wb.dataModel, { root, connectionIds, linked } = linkedModelBindings(model);
  const used = new Set([...wb.names.map(n => n.name), ...wb.tableNames()].map(sheetKey));
  const entries = [], formulas = []; let serial = 1;
  for (const range of linked.values()) {
    const sourceName = decodeXlsxString(range.getAttribute('sourceName'));
    const source = resolveLinkedModelSource(wb, sourceName);
    if (source.sheet.id === sheet.id) { formulas.push(sourceName); continue; }
    if (source.r1 < 1) throw new Error('Cannot copy Data Model: source has no header row');
    // Do not rewrite a source name shared by ordinary formulas: a model range
    // includes its header whereas a table's [] expression excludes that row.
    let alias;
    do { alias = `_ModelSource${serial++}`; } while (used.has(sheetKey(alias)));
    used.add(sheetKey(alias));
    entries.push({ name: alias, hidden: true, ref: refToText({ kind: 'range', sheet: source.sheet.name,
      r1: source.r1 - 1, r2: Math.max(source.r1 - 1, source.r2), c1: source.c1, c2: source.c1 + source.headers.length - 1,
      absR1: true, absR2: true, absC1: true, absC2: true }) });
    formulas.push(alias); range.setAttribute('sourceName', encodeXlsxAttribute(alias));
  }
  return { dataModel: { ...model, connectionsXml: standaloneModelXml(root) }, entries, formulas, connectionIds };
}
