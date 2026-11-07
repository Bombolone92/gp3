import { normalizeDataModel, dataModelBytes, encodeDataModelBytes } from './data-model.js';
import { parseModelXml, modelChildren, readDataModelMetadata, standaloneModelXml as serialize } from './data-model-metadata.js';
import { xmlTag } from './xlsx-export-styles.js';
import { decodeXlsxString } from './xlsx-string.js';

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const X15 = 'http://schemas.microsoft.com/office/spreadsheetml/2010/11/main';
const PACKAGE = 'http://schemas.openxmlformats.org/package/2006/relationships';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
const MODEL_EXT = '{FCE2AD5D-F65C-4FA6-A056-5C36A1767C68}';
const decoder = new TextDecoder();
function resolve(owner, target) {
  if (!target || /[?#]|^[a-z][\w+.-]*:|^\/\//i.test(target)) return null;
  const parts = target.startsWith('/') ? [] : owner.split('/').slice(0, -1);
  for (const part of target.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') { if (!parts.length) return null; parts.pop(); } else parts.push(part);
  }
  return parts.join('/');
}
function relations(book, owner) {
  const slash = owner.lastIndexOf('/'), path = `${owner.slice(0, slash + 1)}_rels/${owner.slice(slash + 1)}.rels`;
  const bytes = book.files?.[path]?.content;
  return bytes ? modelChildren(parseModelXml(decoder.decode(bytes)), 'Relationship', PACKAGE) : [];
}
function related(book, owner, kind) {
  const rel = relations(book, owner).find(r => r.getAttribute('Type') === REL + kind && r.getAttribute('TargetMode') !== 'External');
  return rel ? resolve(owner, rel.getAttribute('Target')) : null;
}
export function readXlsxDataModel(book) {
  const workbookPath = book.Directory?.workbooks?.[0]?.replace(/^\//, '') || 'xl/workbook.xml';
  const bytes = book.files?.[workbookPath]?.content;
  if (!bytes) return null;
  const archivePath = related(book, workbookPath, 'powerPivotData');
  if (!archivePath) return null;
  const archive = book.files?.[archivePath]?.content;
  if (!archive) throw new Error('Missing embedded Data Model part');
  const root = parseModelXml(decoder.decode(bytes));
  const models = Array.from(root.getElementsByTagNameNS(X15, 'dataModel'));
  if (models.length > 1) throw new Error('Duplicate workbook Data Models');
  const connectionPath = related(book, workbookPath, 'connections');
  const connections = connectionPath && book.files?.[connectionPath]?.content;
  const model = normalizeDataModel({ version: 1, archive: encodeDataModelBytes(archive), modelXml: serialize(models[0]),
    connectionsXml: connections ? decoder.decode(connections) : '' });
  if (!model) throw new Error('Embedded Data Model exceeds storage limit');
  return model;
}

/** Resolve model IDs through explicit connection metadata, without inferring
 * table names or aggregation functions from captions. Expressions remain DAX.
 */
export function inspectDataModel(model) {
  const schema = readDataModelMetadata(dataModelBytes(model));
  const tableRoot = model.modelXml ? parseModelXml(model.modelXml) : null;
  const connectionRoot = model.connectionsXml ? parseModelXml(model.connectionsXml) : null;
  const connections = modelChildren(connectionRoot, 'connection', MAIN).map(node => {
    const extensions = Array.from(node.getElementsByTagNameNS(X15, 'connection'));
    const extension = extensions[0], range = modelChildren(extension, 'rangePr', X15)[0];
    // These workbook attributes are ST_Xstring, unlike the ASSL identities
    // inside the model archive. Decode once after XML normalization and leave
    // the preserved XML untouched for native export.
    return { id: node.getAttribute('id'), name: decodeXlsxString(node.getAttribute('name')), type: node.getAttribute('type'),
      sourceId: decodeXlsxString(extension?.getAttribute('id') || ''), model: ['1', 'true'].includes(extension?.getAttribute('model')),
      sourceName: decodeXlsxString(range?.getAttribute('sourceName') || '') };
  });
  const tables = Array.from(tableRoot?.getElementsByTagNameNS(X15, 'modelTable') || []).map(node => ({
    id: decodeXlsxString(node.getAttribute('id')), name: decodeXlsxString(node.getAttribute('name')), connection: decodeXlsxString(node.getAttribute('connection')),
  }));
  return { ...schema, bindings: { tables, connections } };
}

/** Preserve native model storage and bindings independently of app metadata.
 * The pivot layer must separately preserve definitions/caches and implement
 * refresh. This layer does not substitute worksheet formulas for measures.
 */
export function writeXlsxDataModel(model, workbook, { get, set, binary, contentType }) {
  if (!normalizeDataModel(model)) return workbook;
  const path = '/xl/model/item.data';
  binary(path, dataModelBytes(model));
  contentType(path, 'application/vnd.openxmlformats-officedocument.model+data');
  let rels = get('/xl/_rels/workbook.xml.rels');
  const ids = new Set(Array.from(parseModelXml(rels).getElementsByTagNameNS(PACKAGE, 'Relationship'), r => r.getAttribute('Id')));
  const add = (base, type, target) => {
    let id = base, suffix = 1; while (ids.has(id)) id = base + suffix++;
    ids.add(id);
    rels = rels.replace('</Relationships>', xmlTag('Relationship', { Id: id, Type: REL + type, Target: target }) + '</Relationships>');
  };
  add('puterDataModel', 'powerPivotData', 'model/item.data');
  if (model.connectionsXml) {
    set('/xl/connections.xml', model.connectionsXml);
    contentType('/xl/connections.xml', 'application/vnd.openxmlformats-officedocument.spreadsheetml.connections+xml');
    add('puterModelConnections', 'connections', 'connections.xml');
  }
  set('/xl/_rels/workbook.xml.rels', rels);
  if (model.modelXml) {
    const root = parseModelXml(model.modelXml);
    if (root.localName !== 'dataModel' || root.namespaceURI !== X15) throw new Error('Invalid Data Model bindings');
    const ext = xmlTag('ext', { uri: MODEL_EXT }, serialize(root));
    workbook = workbook.includes('</extLst>') ? workbook.replace('</extLst>', ext + '</extLst>')
      : workbook.replace('</workbook>', `<extLst>${ext}</extLst></workbook>`);
  }
  return workbook;
}
