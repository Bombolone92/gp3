import { decompressXpressChunks } from './xpress.js';
import { xlsxElements as elements, xlsxText } from './xlsx-styles.js';

// MS-XLDM §2.1: the header and virtual directory are page-aligned UTF-16LE.
// Offsets are absolute, not relative to the first streamed file.
const PAGE = 4096, SIGNATURE = 'STREAM_STORAGE_SIGNATURE_)!@#$%^&*(';
const MAX_FILE = 256 * 1024 * 1024, MAX_TOTAL = 512 * 1024 * 1024;
const utf16 = new TextDecoder('utf-16le', { fatal: true });
function invalid(message) { throw new Error(`Invalid Data Model archive: ${message}`); }
function field(xml, name) {
  const matches = elements(xml, name);
  if (matches.length !== 1) invalid(`missing or duplicate ${name}`);
  const value = matches[0].replace(/^<[^>]+>|<\/[^>]+>$/g, '');
  if (value.includes('<')) invalid(`nested ${name}`);
  return xlsxText(value);
}
function integer(xml, name) {
  const value = field(xml, name).trim();
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) invalid(name);
  return Number(value);
}
function boolean(xml, name) {
  const value = field(xml, name).trim();
  if (!['true', 'false', '0', '1'].includes(value)) invalid(name);
  return value === 'true' || value === '1';
}
function xmlDocument(bytes, root) {
  if (bytes.length % 2) invalid('odd UTF-16 size');
  let xml;
  try { xml = utf16.decode(bytes); } catch { invalid('invalid UTF-16'); }
  xml = xml.replace(/\0+$/, '').replace(/<!--[\s\S]*?-->/g, '').trim().replace(/^<\?xml\s[^?]*\?>\s*/, '');
  // Archive control XML has no DTD, entities or CDATA. Do not interpret any
  // external resources or recover a partial document from malformed input.
  if (/<!|\0/.test(xml) || !new RegExp(`^<${root}(?:\\s[^>]*)?>[\\s\\S]*<\\/${root}>$`).test(xml)) invalid(root);
  return xml;
}

// MS-XLDM §2.1.2.2.1.1 uses the non-reflected polynomial, with the final
// complement stored little-endian (unlike ZIP's reflected CRC-32).
const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index << 24;
  for (let i = 0; i < 8; i++) value = value << 1 ^ (value & 0x80000000 ? 0x04c11db7 : 0);
  return value >>> 0;
});
function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = value << 8 ^ crcTable[(value >>> 24) ^ byte];
  return ~value >>> 0;
}

/** Read the MS-XLDM container without materializing every column dictionary.
 * Returned file readers decompress independently, with cumulative declared
 * sizes checked first. Paths are opaque model identifiers, never filesystem
 * destinations. This storage layer does not evaluate measures or pivots.
 */
function parseDataModelArchive(input, { maxBytes = MAX_TOTAL } = {}) {
  if (!(input instanceof Uint8Array)) throw new TypeError('Data Model input must be bytes');
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes > MAX_TOTAL) invalid('size limit');
  if (input.length < PAGE || input.length > MAX_TOTAL || input[0] !== 255 || input[1] !== 254) invalid('header');
  const signatureEnd = 2 + SIGNATURE.length * 2;
  if (utf16.decode(input.subarray(2, signatureEnd)) !== SIGNATURE) invalid('signature');
  const header = xmlDocument(input.subarray(signatureEnd, PAGE), 'BackupLog');
  const version = integer(header, 'BackupRestoreSyncVersion');
  if (boolean(header, 'EncryptionFlag')) invalid('encrypted storage is unsupported');
  if (boolean(header, 'Fault')) invalid('faulted backup');
  const checksums = boolean(header, 'ErrorCode'), compressed = boolean(header, 'ApplyCompression');
  const directoryOffset = integer(header, 'm_cbOffsetHeader'), directorySize = integer(header, 'DataSize');
  const dataOffset = integer(header, 'm_cbOffsetData'), count = integer(header, 'Files');
  if (dataOffset !== PAGE || directoryOffset < PAGE || directoryOffset % PAGE || directorySize > MAX_FILE
      || directoryOffset > input.length - directorySize) invalid('directory bounds');
  const directory = xmlDocument(input.subarray(directoryOffset, directoryOffset + directorySize), 'VirtualDirectory');
  const entries = elements(directory, 'BackupFile');
  if (entries.length !== count) invalid('directory file count');
  const stored = new Map(), spans = [];
  for (const entry of entries) {
    const path = field(entry, 'Path'), offset = integer(entry, 'm_cbOffsetHeader'), length = integer(entry, 'Size');
    if (!path || stored.has(path)) invalid('duplicate or empty storage path');
    if (offset < dataOffset || length < (checksums ? 4 : 0) || offset > directoryOffset - length) invalid('file bounds');
    const raw = input.subarray(offset, offset + length - (checksums ? 4 : 0));
    // MS-XLDM 2.1.3.2: Delete is unused and MUST be ignored. It is not a
    // tombstone; the backup log determines which stored files are referenced.
    stored.set(path, { raw, bytes: input.subarray(offset, offset + length), offset, entry });
    // Empty files occupy no extent and may share an offset with another file.
    if (length) spans.push([offset, offset + length]);
  }
  spans.sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < spans.length; i++) if (spans[i][0] < spans[i - 1][1]) invalid('overlapping files');
  // Reject overlap before hashing, so malicious overlapping directory entries
  // cannot make checksum validation repeatedly scan the same large payload.
  if (checksums) for (const [start, end] of spans) {
    const view = new DataView(input.buffer, input.byteOffset + end - 4, 4);
    if (view.getUint32(0, true) !== crc32(input.subarray(start, end - 4))) invalid('file checksum');
  }
  const log = stored.get('LOG');
  if (!log || log.raw.length > MAX_FILE) invalid('backup log');
  // The log and partition inventory are plain XML even when payloads use XPRESS.
  const logXml = xmlDocument(log.raw, 'BackupLog'), files = [], paths = new Set();
  let total = 0;
  for (const groupXml of elements(logXml, 'FileGroup')) {
    const group = { id: field(groupXml, 'ID'), name: field(groupXml, 'Name'),
      class: integer(groupXml, 'Class'), persistPath: field(groupXml, 'PersistLocationPath') };
    for (const entry of elements(groupXml, 'BackupFile')) {
      const path = field(entry, 'Path'), storagePath = field(entry, 'StoragePath'), length = integer(entry, 'Size');
      const source = stored.get(storagePath);
      if (!path || paths.has(path) || !source || storagePath === 'LOG' || storagePath === 'PARTITIONS') invalid('file mapping');
      paths.add(path); total += length;
      if (length > MAX_FILE || total > maxBytes) invalid('unpacked size limit');
      if (!compressed && source.raw.length !== length) invalid('stored size mismatch');
      files.push({ path, storagePath, size: length, group,
        read: () => compressed ? decompressXpressChunks(source.raw, length) : source.raw.slice() });
    }
  }
  return { model: { version, compressed, files, size: total }, stored, checksums, header, directory, logXml };
}

export function readDataModelArchive(input, options) {
  return parseDataModelArchive(input, options).model;
}

function encodeUtf16(value) {
  const bytes = new Uint8Array(value.length * 2), view = new DataView(bytes.buffer);
  for (let i = 0; i < value.length; i++) view.setUint16(i * 2, value.charCodeAt(i), true);
  return bytes;
}
function replaceInteger(xml, name, value) {
  // Require exactly one existing scalar; retain the surrounding control XML.
  integer(xml, name);
  return xml.replace(new RegExp(`(<${name}(?:\\s[^>]*)?>)[^<]*(</${name}>)`), (_, start, end) => start + value + end);
}
function replaceEntries(xml, update) {
  const parts = []; let from = 0;
  for (const entry of elements(xml, 'BackupFile')) {
    const at = xml.indexOf(entry, from);
    parts.push(xml.slice(from, at), update(entry)); from = at + entry.length;
  }
  parts.push(xml.slice(from)); return parts.join('');
}
function storedChunks(bytes) {
  // Equal original/stored uint16 lengths denote raw XPRESS chunks. Untouched
  // files retain their original compression; replacement payloads need no
  // lossy transform or compressor dependency. Zero-length files have no chunks.
  const block = 65535, out = new Uint8Array(bytes.length + Math.ceil(bytes.length / block) * 4), view = new DataView(out.buffer);
  for (let from = 0, to = 0; from < bytes.length;) {
    const count = Math.min(block, bytes.length - from);
    view.setUint16(to, count, true); view.setUint16(to + 2, count, true);
    out.set(bytes.subarray(from, from + count), to + 4); from += count; to += count + 4;
  }
  return out;
}

/** Replace existing logical files atomically, rebuilding the MS-XLDM directory
 * and backup log. This is a container operation: callers must update all model
 * structures affected by an edit together. It does not refresh model semantics.
 * Unknown control metadata and all untouched stored payloads are retained.
 */
export function replaceDataModelArchiveFiles(input, replacements, options) {
  if (!(replacements instanceof Map)) throw new TypeError('Data Model replacements must be a Map');
  const { model, stored, checksums, header, directory, logXml } = parseDataModelArchive(input, options);
  if (!replacements.size) return input.slice();
  const files = new Map(model.files.map(f => [f.path, f])), changed = new Map();
  const storageUses = new Map();
  for (const file of model.files) storageUses.set(file.storagePath, (storageUses.get(file.storagePath) ?? 0) + 1);
  let total = model.size;
  for (const [path, bytes] of replacements) {
    const file = files.get(path);
    if (!file) invalid('unknown replacement path');
    if (!(bytes instanceof Uint8Array) || bytes.length > MAX_FILE) invalid('replacement size');
    if (storageUses.get(file.storagePath) !== 1) invalid('shared replacement storage');
    total += bytes.length - file.size;
  }
  if (total > (options?.maxBytes ?? MAX_TOTAL)) invalid('unpacked size limit');
  const withChecksum = raw => {
    if (!checksums) return raw;
    const bytes = new Uint8Array(raw.length + 4); bytes.set(raw);
    new DataView(bytes.buffer).setUint32(raw.length, crc32(raw), true); return bytes;
  };
  for (const [path, bytes] of replacements) changed.set(files.get(path).storagePath, withChecksum(model.compressed ? storedChunks(bytes) : bytes));
  const log = replaceEntries(logXml, entry => {
    const bytes = replacements.get(field(entry, 'Path'));
    return bytes ? replaceInteger(entry, 'Size', bytes.length) : entry;
  });
  changed.set('LOG', withChecksum(encodeUtf16('\ufeff' + log)));
  let offset = PAGE;
  const directoryEntries = new Map();
  // Keep stream order (including PARTITIONS and unreferenced files),
  // independent of virtual-directory ordering. LOG remains in its original slot.
  const layout = [...stored.entries()].sort((a, b) => a[1].offset - b[1].offset).map(([path, file]) => {
    const bytes = changed.get(path) ?? file.bytes, start = offset; offset += bytes.length;
    if (offset > MAX_TOTAL) invalid('stored size limit');
    const entry = replaceInteger(replaceInteger(file.entry, 'Size', bytes.length), 'm_cbOffsetHeader', start);
    directoryEntries.set(file.entry, entry);
    return { bytes, start };
  });
  const nextDirectory = replaceEntries(directory, entry => directoryEntries.get(entry));
  const directoryOffset = Math.ceil(offset / PAGE) * PAGE, directoryBytes = encodeUtf16(nextDirectory);
  const length = Math.ceil((directoryOffset + directoryBytes.length) / PAGE) * PAGE;
  if (directoryBytes.length > MAX_FILE || length > MAX_TOTAL) invalid('stored size limit');
  const nextHeader = replaceInteger(replaceInteger(header, 'm_cbOffsetHeader', directoryOffset), 'DataSize', directoryBytes.length);
  const headerBytes = encodeUtf16('\ufeff' + SIGNATURE + nextHeader);
  if (headerBytes.length > PAGE) invalid('header size');
  const result = new Uint8Array(length); result.set(headerBytes);
  for (const { bytes, start } of layout) result.set(bytes, start);
  result.set(directoryBytes, directoryOffset);
  return result;
}
