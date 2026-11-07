// The original storage and source-binding XML remain authoritative until the
// corresponding model objects are edited. Derived schema is read lazily, so
// ordinary workbook edits do not repeatedly decompress model dictionaries.
const MAX_ARCHIVE_BASE64 = Math.ceil(256 * 1024 * 1024 / 3) * 4;
const MAX_XML = 16 * 1024 * 1024;
export function normalizeDataModel(value) {
  if (!value || value.version !== 1 || typeof value.archive !== 'string' || !value.archive.length
      || value.archive.length > MAX_ARCHIVE_BASE64 || value.archive.length % 4
      || !/^[A-Za-z0-9+/]*={0,2}$/.test(value.archive)) return null;
  if (typeof value.modelXml !== 'string' || value.modelXml.length > MAX_XML
      || typeof value.connectionsXml !== 'string' || value.connectionsXml.length > MAX_XML) return null;
  return { version: 1, archive: value.archive, modelXml: value.modelXml, connectionsXml: value.connectionsXml };
}
export function dataModelBytes(model) {
  const value = normalizeDataModel(model);
  if (!value) throw new Error('Invalid Data Model storage');
  if (typeof Uint8Array.fromBase64 === 'function') return Uint8Array.fromBase64(value.archive);
  const padding = value.archive.endsWith('==') ? 2 : value.archive.endsWith('=') ? 1 : 0;
  const result = new Uint8Array(value.archive.length / 4 * 3 - padding);
  // Older browsers need only a small temporary binary string, not a second
  // full-size copy of a potentially large model archive.
  for (let i = 0, dest = 0; i < value.archive.length; i += 32768) {
    const chunk = atob(value.archive.slice(i, i + 32768));
    for (let j = 0; j < chunk.length; j++) result[dest++] = chunk.charCodeAt(j);
  }
  return result;
}
export function encodeDataModelBytes(bytes) {
  if (typeof bytes.toBase64 === 'function') return bytes.toBase64();
  const chunks = [];
  // A multiple of three prevents padding between independently encoded blocks.
  for (let i = 0; i < bytes.length; i += 24576) chunks.push(btoa(String.fromCharCode(...bytes.subarray(i, i + 24576))));
  return chunks.join('');
}
