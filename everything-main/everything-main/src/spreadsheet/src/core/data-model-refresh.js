import { inspectDataModel } from './xlsx-data-model.js';
import { dataModelBytes, encodeDataModelBytes } from './data-model.js';
import { readDataModelArchive } from './data-model-archive.js';
import { parseModelXml, modelChildren, decodeModelXml } from './data-model-metadata.js';
import { resolveModelTableStorage } from './data-model-table.js';
import { readLinkedModelTable } from './data-model-source.js';
import { rewriteModelTables } from './data-model-rewrite.js';
import { publishNativeModelRefresh } from './native-pivot-model-refresh.js';

const IMBI = 'http://schemas.microsoft.com/analysisservices/imbi';
const ENGINE = 'http://schemas.microsoft.com/analysisservices/2003/engine';
const fail = reason => { throw new Error(`Cannot refresh linked Data Model: ${reason}`); };
const key = value => String(value).normalize('NFC').toUpperCase();
const children = (node, name) => modelChildren(node, name, ENGINE);
const one = (nodes, label) => { if (nodes.length !== 1) fail(`missing or ambiguous ${label}`); return nodes[0]; };
const text = (node, name) => children(node, name)[0]?.textContent || '';
function sourceIdentity(node) {
  const type = (node.getAttributeNS('http://www.w3.org/2001/XMLSchema-instance', 'type') || '').trim().split(':');
  if (type.length > 2 || !type.at(-1)) fail('invalid source binding');
  return JSON.stringify([node.lookupNamespaceURI(type.length === 2 ? type[0] : null), type.at(-1), text(node, 'TableID'), text(node, 'ColumnID')]);
}
function checkDependencies(schema) {
  for (const object of schema.objects) {
    const root = parseModelXml(object.xml);
    // Relationship indexes require a joint rebuild of their endpoint tables.
    // They are not ordinary per-column intrinsic hierarchies.
    if (Array.from(root.getElementsByTagName('*')).some(n => n.localName === 'Relationship'
      && n.namespaceURI?.startsWith('http://schemas.microsoft.com/analysisservices/'))) fail('table relationships need rebuilding');
    if (object.type !== 'Dimension') continue;
    if (children(root, 'Source').length || children(children(root, 'Hierarchies')[0], 'Hierarchy').length) fail('derived dimensions and user hierarchies are not implemented');
    const attributes = children(children(root, 'Attributes')[0], 'Attribute'), ids = new Set(attributes.map(a => key(text(a, 'ID'))));
    for (const attribute of attributes) {
      if (children(attribute, 'Source').length || Array.from(attribute.getElementsByTagName('*')).some(n => n.localName === 'Expression'
        && n.namespaceURI?.startsWith('http://schemas.microsoft.com/analysisservices/'))) fail('calculated attribute dependencies are not implemented');
      const keys = children(children(attribute, 'KeyColumns')[0], 'KeyColumn'), keySource = keys.length === 1 && children(keys[0], 'Source')[0];
      for (const source of Array.from(attribute.getElementsByTagNameNS(ENGINE, 'Source'))) {
        if (source.parentNode.localName === 'KeyColumn') continue; // The source reader validates its type and identity.
        if (source.parentNode.localName !== 'NameColumn' || !keySource || sourceIdentity(source) !== sourceIdentity(keySource)) fail('separate name/value sources need rebuilding');
      }
      const relations = children(children(attribute, 'AttributeRelationships')[0], 'AttributeRelationship');
      for (const relation of relations) {
        // The generated row identity remains unchanged in a fixed-size full
        // projection. General attribute relationships need separate indexes.
        if (text(attribute, 'Type') !== 'RowNumber' || text(attribute, 'Usage') !== 'Key'
          || !keySource || sourceIdentity(keySource) !== JSON.stringify(['http://schemas.microsoft.com/analysisservices/2010/engine/200/200', 'RowNumberBinding', '', ''])
          || !ids.has(key(text(relation, 'AttributeID'))) || !['', 'Flexible'].includes(text(relation, 'RelationshipType'))
          || !['', 'Many'].includes(text(relation, 'Cardinality'))) fail('attribute relationships need rebuilding');
      }
    }
  }
}
function checkStorage(archive, files) {
  const mains = new Set(files.map(f => f.path)), groups = new Set(files.map(f => f.group)); let bytes = 0;
  for (const file of archive.files) {
    if (!/\.tbl\.xml$/i.test(file.path)) continue;
    if (file.size > 16 * 1048576 || (bytes += file.size) > 64 * 1048576) fail('table metadata size limit');
    const root = parseModelXml(decodeModelXml(file.read()).xml);
    if (root.namespaceURI !== IMBI || root.localName !== 'XMObject' || root.getAttribute('class') !== 'XMSimpleTable') fail('unsupported table storage');
    const properties = one(modelChildren(root, 'Properties', IMBI), 'table properties');
    const raw = one(modelChildren(properties, 'Settings', IMBI), 'table settings').textContent.trim(), settings = Number(raw);
    if (!/^\+?\d+$/.test(raw) || !Number.isSafeInteger(settings) || settings > 4367) fail('invalid table settings');
    const kind = settings & 15;
    if (kind === 1 ? !mains.has(file.path) : kind !== 4 || !groups.has(file.group)) fail('unresolved dependent table storage');
  }
}

/** Prepare every linked table from one workbook state. Source rows are a full
 * projection, not an inferred correspondence with stored physical row ordinals.
 * Dictionary/segment/intrinsic-index rewriting remains in the storage writer.
 * No workbook mutation occurs here, including on failure in a later table.
 *
 * stringSortKeys maps exact model table IDs to per-column key maps accepted by
 * rewriteModelTableRows. Callers must resolve the model's collation/version;
 * browser or host-locale ordering is never substituted. The current writer
 * requires unchanged row counts. Dependent calculated columns, user hierarchies
 * and table relationships must be supported before this profile can admit them.
 */
export function prepareLinkedDataModelRefresh(wb, { maxValues = 4 * 1048576, stringSortKeys = null } = {}) {
  if (!Number.isSafeInteger(maxValues) || maxValues < 0 || maxValues > 16 * 1048576 || stringSortKeys !== null && !(stringSortKeys instanceof Map)) fail('invalid preparation options');
  const previous = wb.dataModel, schema = inspectDataModel(previous);
  if (!schema.tables.length || new Set(schema.tables.map(t => key(t.id))).size !== schema.tables.length) fail('missing or ambiguous model tables');
  const tableIds = new Set(schema.tables.map(t => t.id)); let keyBytes = 0, keyCount = 0;
  for (const [table, columns] of stringSortKeys || []) {
    if (!tableIds.has(table) || !(columns instanceof Map)) fail('invalid collation table');
    for (const keys of columns.values()) {
      if (!(keys instanceof Map)) fail('invalid collation column');
      for (const bytes of keys.values()) {
        if (!(bytes instanceof Uint8Array) || ++keyCount > 2 * 1048576 || (keyBytes += bytes.length) > 16 * 1048576) fail('collation key limit or type');
      }
    }
  }
  checkDependencies(schema);
  const input = dataModelBytes(previous);
  const archive = readDataModelArchive(input), files = schema.tables.map(t => resolveModelTableStorage(archive, t));
  checkStorage(archive, files);
  let remaining = maxValues;
  const tables = new Map(), keys = new Map();
  for (const [i, table] of schema.tables.entries()) {
    const projection = readLinkedModelTable(wb, schema, table.id, { maxValues: remaining });
    const used = projection.rowCount * projection.columns.length;
    tables.set(files[i].path, new Map(projection.columns.map(c => [c.id, c.values])));
    if (stringSortKeys?.has(table.id)) keys.set(files[i].path, stringSortKeys.get(table.id));
    remaining -= used;
  }
  const updated = rewriteModelTables(input, tables, { maxValues, stringSortKeys: keys });
  return { previous, next: { ...previous, archive: encodeDataModelBytes(updated) } };
}

/** Refresh linked model tables and all connected native reports in one commit.
 * Computation, member rebuilding, formatting and commit preflight all finish
 * before the first write. Explicit sort keys are still needed for new strings.
 */
export function refreshLinkedModelReports(wb, options = {}) {
  const prepared = prepareLinkedDataModelRefresh(wb, options);
  return publishNativeModelRefresh(wb, prepared, options);
}
