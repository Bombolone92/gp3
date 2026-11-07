// Synthetic MS-XLDM container; no corpus workbook or producer-specific IDs.
export const modelEngine = 'http://schemas.microsoft.com/analysisservices/2003/engine';
export const escapeXml = s => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
export function modelLoad(kind, body, parent = '<DatabaseID>db</DatabaseID>', prefix = '') {
  const xml = `<Load xmlns="${modelEngine}"><ParentObject>${parent}</ParentObject><ObjectDefinition><${kind}>${body}</${kind}></ObjectDefinition></Load>`;
  return prefix ? xml.replace(/<(\/?)([A-Za-z][A-Za-z0-9]*)(?=[\s/>])/g, `<$1${prefix}:$2`).replace(`xmlns="${modelEngine}"`, `xmlns:${prefix}="${modelEngine}"`) : xml;
}
export function modelArchive(records) {
  const utf16 = s => Buffer.from(s, 'utf16le'), tag = (name, value) => `<${name}>${escapeXml(value)}</${name}>`;
  const files = records.map((record, i) => ({ name: `file${i}`, path: record.path, bytes: Buffer.from(record.xml, record.utf16 ? 'utf16le' : 'utf8') }));
  for (const [i, file] of files.entries()) if (records[i].utf16) file.bytes = Buffer.concat([Buffer.from([255, 254]), file.bytes]);
  const defaultGroup = { id: 'db', name: 'Database', class: 1, persistPath: 'C:\\Database' }, groups = new Map();
  for (const [i, file] of files.entries()) { const group = records[i].group || defaultGroup; if (!groups.has(group)) groups.set(group, []); groups.get(group).push(file); }
  const log = `<BackupLog><FileGroups>${[...groups].map(([group, members]) => `<FileGroup>${tag('ID', group.id)}${tag('Name', group.name)}${tag('Class', group.class)}${tag('PersistLocationPath', group.persistPath)}<FileList>${members.map(f => `<BackupFile>${tag('Path', f.path)}${tag('StoragePath', f.name)}${tag('Size', f.bytes.length)}</BackupFile>`).join('')}</FileList></FileGroup>`).join('')}</FileGroups></BackupLog>`;
  files.push({ name: 'LOG', bytes: utf16('\ufeff' + log) });
  let offset = 4096;
  for (const file of files) { file.offset = offset; offset += file.bytes.length; }
  const directoryOffset = Math.ceil(offset / 4096) * 4096;
  const directory = utf16(`<VirtualDirectory>${files.map(f => `<BackupFile>${tag('Path', f.name)}${tag('Size', f.bytes.length)}${tag('m_cbOffsetHeader', f.offset)}${tag('Delete', false)}</BackupFile>`).join('')}</VirtualDirectory>`);
  const header = utf16('\ufeffSTREAM_STORAGE_SIGNATURE_)!@#$%^&*(' + `<BackupLog>${tag('BackupRestoreSyncVersion', 140)}${tag('Fault', false)}${tag('ErrorCode', false)}${tag('EncryptionFlag', false)}${tag('ApplyCompression', false)}${tag('m_cbOffsetHeader', directoryOffset)}${tag('DataSize', directory.length)}${tag('Files', files.length)}${tag('m_cbOffsetData', 4096)}</BackupLog>`);
  const out = Buffer.alloc(Math.ceil((directoryOffset + directory.length) / 4096) * 4096);
  header.copy(out); directory.copy(out, directoryOffset); for (const file of files) file.bytes.copy(out, file.offset);
  return new Uint8Array(out);
}
export function simpleModel() {
  return modelArchive([
    { path: 'db.0.db.xml', xml: modelLoad('Database', '<ID>db</ID><Name>Budget model</Name>', '') },
    { path: 'orders.7.dim.xml', xml: modelLoad('Dimension', '<ID>Orders</ID><Name>Orders</Name><Attributes><Attribute><ID>Net</ID><Name>Net</Name><Usage>Regular</Usage><KeyColumns><KeyColumn><DataType>Currency</DataType><NullProcessing>Preserve</NullProcessing></KeyColumn></KeyColumns></Attribute></Attributes>') },
    { path: 'measure.3.scr.xml', xml: modelLoad('MdxScript', '<ID>Script</ID><Name>Script</Name><Commands><Command><Text>CREATE MEASURE [Model].Orders[Margin] = SUM(Orders[Net]);</Text></Command></Commands>', '<DatabaseID>db</DatabaseID><CubeID>Model</CubeID>') },
  ]);
}
