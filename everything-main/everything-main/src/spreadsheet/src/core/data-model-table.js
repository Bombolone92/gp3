import { decodeModelXml, parseModelXml, modelChildren } from './data-model-metadata.js';

const IMBI = 'http://schemas.microsoft.com/analysisservices/imbi';
const fail = message => { throw new Error(`Invalid Data Model table storage: ${message}`); };
const one = (items, label) => { if (items.length !== 1) fail(`missing or ambiguous ${label}`); return items[0]; };

/** Resolve a dimension's main table through its archive object group and
 * DataFileList (MS-XLDM 2.1.2.3.1.3.1, 2.6.1.3). Definition files can live
 * outside the group's persisted directory. Captions and filename prefixes do
 * not establish ownership. Returned paths remain opaque archive identities.
 */
export function resolveModelTableStorage(archive, table) {
  const definition = one(archive.files.filter(f => f.path === table.path), 'dimension definition'), group = definition.group;
  if (!group || group.class !== 100006 || group.id !== table.id || typeof group.persistPath !== 'string' || !group.persistPath) fail('dimension object group');
  if (!Array.isArray(table.dataFiles) || !table.dataFiles.length || new Set(table.dataFiles).size !== table.dataFiles.length
    || table.dataFiles.some(name => typeof name !== 'string' || !name || /[\\/\0]/.test(name) || name === '.' || name === '..')) fail('file inventory');
  const folder = group.persistPath + (/[\\/]$/.test(group.persistPath) ? '' : group.persistPath.includes('\\') ? '\\' : '/');
  const files = new Map();
  for (const file of archive.files) {
    if (files.has(file.path)) fail('duplicate archive path');
    files.set(file.path, file);
  }
  const matches = []; let total = 0;
  for (const name of table.dataFiles) {
    const file = files.get(folder + name);
    if (!file || file.group !== group) fail('declared file ownership');
    if (!name.endsWith('.tbl.xml')) continue;
    if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > 16 * 1048576 || (total += file.size) > 64 * 1048576) fail('metadata size limit');
    const bytes = file.read();
    if (bytes.length !== file.size) fail('metadata size mismatch');
    const root = parseModelXml(decodeModelXml(bytes).xml);
    if (root.namespaceURI !== IMBI || root.localName !== 'XMObject' || root.getAttribute('class') !== 'XMSimpleTable') fail('table root');
    const properties = one(modelChildren(root, 'Properties', IMBI), 'table Properties');
    const settings = one(modelChildren(properties, 'Settings', IMBI), 'table Settings').textContent.trim();
    if (!/^[+]?\d+$/.test(settings) || !Number.isSafeInteger(Number(settings)) || Number(settings) > 4367) fail('table Settings');
    // The low nibble is the table kind: main (1), intrinsic hierarchy (4),
    // user hierarchy (5). Processing/unknown-member flags occupy upper bits.
    if ((Number(settings) & 15) === 1) matches.push(file);
  }
  return one(matches, 'main table');
}
