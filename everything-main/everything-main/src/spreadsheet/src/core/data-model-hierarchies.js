import { decodeModelXml, parseModelXml, modelChildren } from './data-model-metadata.js';
import { readModelColumnStorage, readModelMappingIdentifiers } from './data-model-columns.js';

const IMBI = 'http://schemas.microsoft.com/analysisservices/imbi';
const fail = message => { throw new Error(`Invalid Data Model hierarchy: ${message}`); };
const children = (node, name) => modelChildren(node, name, IMBI);
const only = (nodes, label) => { if (nodes.length !== 1) fail(`missing or duplicate ${label}`); return nodes[0]; };
const child = (node, name) => only(children(node, name), name);
const property = (node, name) => child(child(node, 'Properties'), name).textContent;
const number = (node, name, min = 0, max = 16 * 1048576) => {
  const text = property(node, name).trim(), value = Number(text);
  if (!/^[+-]?\d+$/.test(text) || !Number.isSafeInteger(value) || value < min || value > max) fail(name);
  return value;
};
const folderOf = path => path.slice(0, Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
function readXml(file) {
  if (file.size > 16 * 1048576) fail('metadata size');
  const bytes = file.read();
  return parseModelXml(decodeModelXml(bytes).xml);
}
function tableColumns(root) {
  if (root.namespaceURI !== IMBI || root.localName !== 'XMObject' || root.getAttribute('class') !== 'XMSimpleTable') fail('table metadata root');
  const collection = only(children(child(root, 'Collections'), 'Collection').filter(n => child(n, 'Name').textContent === 'Columns'), 'Columns');
  return children(collection, 'XMObject');
}

/** Read an intrinsic hierarchy through its source column's TableStore and
 * explicit mapping-usage flags. Returned arrays include reserved storage
 * slots; only the first distinctDataIds position entries are member IDs.
 * Sort/collation interpretation and the optional hash-index contents are
 * separate. This function does not infer table identity from file captions.
 */
export function readModelIntrinsicHierarchy(archive, tableFile, columnName, options = {}) {
  if (!archive.files.includes(tableFile)) fail('foreign metadata file');
  const column = only(tableColumns(readXml(tableFile)).filter(n => n.getAttribute('name') === columnName), 'column');
  if (column.getAttribute('class') !== 'XMRawColumn') fail('column class');
  const hierarchy = child(only(children(child(column, 'Members'), 'Member').filter(n => child(n, 'Name').textContent === 'IntrinsicHierarchy'), 'IntrinsicHierarchy'), 'XMObject');
  if (hierarchy.getAttribute('class') !== 'XMHierarchy') fail('hierarchy class');
  const tableStore = property(hierarchy, 'TableStore'), positionColumn = number(hierarchy, 'ColumnPosition2DataID', -1), inverseColumn = number(hierarchy, 'ColumnDataID2Position', -1);
  const distinctDataIds = number(hierarchy, 'DistinctDataIDs'), sortOrder = number(hierarchy, 'SortOrder', 0, 2);
  const materialization = number(hierarchy, 'TypeMaterialization', -1, 3);
  const processed = property(hierarchy, 'IsProcessed').trim();
  if (!['true', 'false', '0', '1'].includes(processed) || ![0, 2].includes(sortOrder)
    || ![-1, 0].includes(positionColumn) || ![-1, 1].includes(inverseColumn)) fail('hierarchy properties');
  const isProcessed = processed === 'true' || processed === '1';
  if (materialization === -1 && isProcessed) fail('processed hierarchy has no materialization type');
  const containers = children(hierarchy, 'DataObjects');
  if (containers.length > 1) fail('duplicate hierarchy DataObjects');
  const hashes = children(containers[0], 'DataObject').map(n => child(n, 'XMObject')).filter(n => n.getAttribute('class') === 'XMHierarchyDataID2PositionHashIndex');
  if (hashes.length > 1) fail('duplicate hierarchy hash index');
  if (materialization === -1 || materialization >= 2) {
    if (positionColumn !== -1 || inverseColumn !== -1 || hashes.length) fail('unmaterialized hierarchy has stored indexes');
    return { tableStore, materialization, storagePath: null, distinctDataIds, sortOrder, isProcessed, positionToId: null, idToPosition: null, hashIndex: null };
  }
  if (!tableStore || positionColumn !== 0 || inverseColumn !== (materialization === 0 ? 1 : -1)
    || hashes.length !== (materialization === 1 ? 1 : 0)) fail('materialization indexes');
  const folder = folderOf(tableFile.path), matches = [];
  for (const file of archive.files) {
    if (folderOf(file.path) !== folder || !file.path.endsWith('.tbl.xml')) continue;
    const root = readXml(file);
    if (root.namespaceURI === IMBI && root.localName === 'XMObject' && root.getAttribute('class') === 'XMSimpleTable' && root.getAttribute('name') === tableStore) matches.push(file);
  }
  const storage = only(matches, 'hierarchy table');
  // Parsing the storage schema enforces the intrinsic table kind and its
  // declared segment map, rather than recognizing a filename or H$ prefix.
  const bytes = storage.read(), xml = decodeModelXml(bytes).xml;
  const schema = readModelColumnStorage(xml, { hierarchy: true });
  const mapping = name => {
    only(schema.columns.filter(c => c.name === name), 'mapping column');
    return readModelMappingIdentifiers(archive, storage, name, options);
  };
  // MS-XLDM 2.5.2.9.1 defines flags 0/-1 and 1/-1, not arbitrary indexes.
  // MS-XLDM 2.4.1/2.4.2 define the mapping column roles by these fixed names.
  const positionToId = mapping('POS_TO_ID'), idToPosition = inverseColumn === 1 ? mapping('ID_TO_POS') : null;
  if (distinctDataIds > positionToId.length) fail('distinct member count');
  let hashIndex = null;
  if (hashes.length) {
    const name = hashes[0].getAttribute('name'); if (!name) fail('hash index name');
    const file = only(archive.files.filter(f => f.path === folder + name), 'hierarchy hash file');
    hashIndex = { path: file.path, size: file.size };
  }
  return { tableStore, materialization, storagePath: storage.path, distinctDataIds, sortOrder, isProcessed, positionToId, idToPosition, hashIndex };
}
