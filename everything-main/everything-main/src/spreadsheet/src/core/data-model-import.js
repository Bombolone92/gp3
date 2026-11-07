import { linkedModelBindings, modelConnectionId } from './data-model-bindings.js';
import { normalizeDataModel } from './data-model.js';
import { resolveLinkedModelSource } from './data-model-source.js';
import { parseModelXml, modelChildren, standaloneModelXml } from './data-model-metadata.js';
import { decodeXlsxString, encodeXlsxAttribute } from './xlsx-string.js';
import { refToText, sheetKey } from './refs.js';
const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const X15 = 'http://schemas.microsoft.com/office/spreadsheetml/2010/11/main';
const fail = reason => { throw new Error(`Cannot import Data Model: ${reason}`); };
const deleted = connection => ['1', 'true'].includes(connection.getAttribute('deleted')) && !connection.hasAttribute('id');

/** Adopt an incoming model and rebase its workbook dependencies. The archive
 * remains intact; combining two independent storage graphs is a separate
 * operation. Prepare everything before mutating either workbook. */
export function prepareDataModelImport(destination, source) {
  if (!source.dataModel) return null;
  if (destination.dataModel) fail('merging two Data Models is not implemented');
  const { binding, connections, connectionIds, linked } = linkedModelBindings(source.dataModel);
  const base = parseModelXml(destination.nativePivots?.connections || `<connections xmlns="${MAIN}"/>`);
  if (base.localName !== 'connections' || base.namespaceURI !== MAIN) fail('invalid destination connections');
  const ids = new Set(), names = new Set(), sourceIds = new Set(), sourceNames = new Set();
  for (const connection of modelChildren(base, 'connection', MAIN)) {
    const id = modelConnectionId(connection.getAttribute('id')), name = sheetKey(decodeXlsxString(connection.getAttribute('name')));
    if (id == null && !deleted(connection) || id != null && ids.has(id) || !name || names.has(name)) fail('ambiguous destination connection');
    if (id != null) ids.add(id);
    names.add(name);
  }
  // Reserve nonconflicting source identities too, so reallocating one cannot
  // needlessly displace another incoming connection.
  for (const connection of connections) {
    const id = modelConnectionId(connection.getAttribute('id')), name = sheetKey(decodeXlsxString(connection.getAttribute('name')));
    if (id == null && !deleted(connection) || id != null && sourceIds.has(id) || !name || sourceNames.has(name)) fail('ambiguous source connection');
    if (id != null) sourceIds.add(id);
    sourceNames.add(name);
  }
  const mapping = new Map(), renamed = new Map(); let nextId = 1;
  for (const connection of connections) {
    const old = modelConnectionId(connection.getAttribute('id'));
    let id = old;
    if (ids.has(id)) {
      while (ids.has(nextId) || sourceIds.has(nextId)) nextId++;
      if (nextId > 4294967295) fail('connection identity limit');
      id = nextId++;
    }
    if (id != null) { ids.add(id); mapping.set(old, id); connection.setAttribute('id', String(id)); }
    const original = decodeXlsxString(connection.getAttribute('name')); let name = original, n = 2;
    while (names.has(sheetKey(name))) {
      do { name = `${original}_${n++}`; } while (sourceNames.has(sheetKey(name)));
    }
    names.add(sheetKey(name)); renamed.set(sheetKey(original), name);
    connection.setAttribute('name', encodeXlsxAttribute(name));
  }
  const used = new Set([...destination.names, ...source.names].map(n => sheetKey(n.name)));
  for (const name of [...destination.tableNames(), ...source.tableNames()]) used.add(sheetKey(name));
  const entries = []; let serial = 1;
  for (const range of linked.values()) {
    const src = resolveLinkedModelSource(source, decodeXlsxString(range.getAttribute('sourceName')));
    if (src.r1 < 1) fail('source has no header row');
    let name; do { name = `_ModelSource${serial++}`; } while (used.has(sheetKey(name)));
    used.add(sheetKey(name));
    // Independent global aliases bypass the ordinary importer's localization
    // of conflicting names. Table references stay dynamic as rows are added.
    const ref = src.tableName ? `${src.tableName}[]` : refToText({ kind: 'range', sheet: src.sheet.name,
      r1: src.r1 - 1, r2: Math.max(src.r1 - 1, src.r2), c1: src.c1, c2: src.c1 + src.headers.length - 1,
      absR1: true, absR2: true, absC1: true, absC2: true });
    entries.push({ name, ref, hidden: true }); range.setAttribute('sourceName', encodeXlsxAttribute(name));
  }
  for (const table of Array.from(binding.getElementsByTagNameNS(X15, 'modelTable'))) {
    const name = renamed.get(sheetKey(decodeXlsxString(table.getAttribute('connection'))));
    if (!name) fail('missing model source connection');
    table.setAttribute('connection', encodeXlsxAttribute(name));
  }
  // Preserve inherited namespace declarations on each imported connection.
  for (const connection of connections) base.appendChild(base.ownerDocument.importNode(parseModelXml(standaloneModelXml(connection)), true));
  const connectionsXml = standaloneModelXml(base);
  const dataModel = normalizeDataModel({ ...source.dataModel, modelXml: standaloneModelXml(binding), connectionsXml });
  if (!dataModel) fail('merged metadata exceeds storage limits');
  // Separate valid inputs can exceed the parser's combined node/size budget.
  parseModelXml(connectionsXml);
  return { entries, connectionIds: new Map([...connectionIds].map(id => [id, mapping.get(id)])), dataModel };
}
