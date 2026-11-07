import { decodeModelXml, parseModelXml, modelChildren } from './data-model-metadata.js';

const MAX_BYTES = 256 * 1048576, MAX_ITEMS = 1048576, MAX_CHARS = 16 * 1048576;
const fail = message => { throw new Error(`Invalid Data Model dictionary: ${message}`); };
const bounded = (n, max) => { if (!Number.isSafeInteger(n) || n < 0 || n > max) fail('size limit'); return n; };
const utf16 = new TextDecoder('utf-16le', { fatal: true, ignoreBOM: true });

// MS-XLDM 2.7.4: canonical codes ordered by length then byte value. The
// alphabet packs the even symbol's length in the low nibble. Persisted bits
// are MSB-first within little-endian pairs of bytes, independently of UTF-16.
function huffman(alphabet, buffer, totalBits, charset, maxChars) {
  const symbols = [];
  for (let i = 0; i < 256; i++) {
    const length = (alphabet[i >> 1] >> ((i & 1) * 4)) & 15;
    if (length === 1) fail('Huffman code length');
    if (length) symbols.push({ symbol: i, length });
  }
  symbols.sort((a, b) => a.length - b.length || a.symbol - b.symbol);
  const codes = Array.from({ length: 16 }, () => new Map());
  let code = 0, previous = 0;
  for (const item of symbols) {
    code *= 2 ** (item.length - previous);
    if (code >= 2 ** item.length) fail('oversubscribed Huffman alphabet');
    codes[item.length].set(code++, item.symbol); previous = item.length;
  }
  if (!symbols.length && totalBits) fail('empty Huffman alphabet');
  if (totalBits > buffer.length * 8) fail('Huffman buffer bounds');
  return (start, end, remaining) => {
    if (start > end || end > totalBits) fail('Huffman string bounds');
    const limit = Math.min(maxChars, remaining) * 2;
    const bytes = new Uint8Array(Math.min(limit, Math.floor((end - start) / 2) * (charset === null ? 1 : 2)));
    let word = 0, length = 0, written = 0;
    for (let bit = start; bit < end; bit++) {
      const byte = bit >> 3, paired = byte ^ 1;
      word = word * 2 + ((buffer[paired < buffer.length ? paired : byte] >> (7 - (bit & 7))) & 1);
      if (++length > 15) fail('invalid Huffman code');
      const symbol = codes[length].get(word);
      if (symbol === undefined) continue;
      if (written + (charset === null ? 1 : 2) > bytes.length) fail('string size limit');
      bytes[written++] = symbol; if (charset !== null) bytes[written++] = charset;
      word = 0; length = 0;
    }
    if (length || written % 2) fail('incomplete Huffman string');
    return utf16.decode(bytes.subarray(0, written));
  };
}

/** MS-XLDM 2.3.2.1.2: return string entries in record-handle order. This
 * storage layer preserves whitespace and BOM characters; it does not apply
 * model collation, null identifiers, BLOB conversion, or worksheet row order.
 */
export function decodeModelStringDictionary(bytes, { flags = 0, maxItems = MAX_ITEMS, maxChars = MAX_CHARS } = {}) {
  if (!(bytes instanceof Uint8Array) || bytes.length > MAX_BYTES) fail('input');
  bounded(flags, 263); if (flags & ~263) fail('dictionary flags');
  bounded(maxItems, MAX_ITEMS); bounded(maxChars, MAX_CHARS);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); let at = 0;
  const take = size => { if (size > bytes.length - at) fail('truncated storage'); const start = at; at += size; return start; };
  const u32 = () => view.getUint32(take(4), true);
  const u64 = (max = MAX_BYTES) => { const n = view.getBigUint64(take(8), true); if (n > BigInt(max)) fail('size limit'); return Number(n); };
  const bool = () => { const b = bytes[take(1)]; if (b > 1) fail('boolean'); return !!b; };
  if (u32() !== 2) fail('not a string dictionary');
  if (flags & 1) {
    const algorithm = u32(), entrySize = u32(), binSize = u32(), localCount = u32();
    if (algorithm > 2 || !entrySize || !binSize || localCount * entrySize > binSize || view.getBigInt64(take(8), true) !== -1n) fail('hash header');
  }
  const count = u64(maxItems), storeCompressed = bool(), longest = u64(maxChars), pageCount = u64(524288);
  if (!pageCount && count) fail('page count');
  const pages = []; let expectedStart = 0;
  for (let i = 0; i < pageCount; i++) {
    const mask = u64(1), hasNulls = bool(), start = u64(count), size = u64(count), compressed = bool();
    if (mask !== Number(compressed) || compressed && !storeCompressed || start !== expectedStart || size > count - start) fail('page metadata');
    if (hasNulls) fail('null string page is unsupported');
    if (u32() !== 0xAABBCCDD) fail('page start marker');
    expectedStart += size;
    let page;
    if (compressed) {
      const totalBits = u32(), mode = u32(), allocation = u64();
      if (mode !== 703121 && mode !== 703122) fail('Huffman character set');
      const charset = mode === 703121 ? bytes[take(1)] : null, decodeBits = u32();
      if (decodeBits < 2 || decodeBits > 12) fail('Huffman lookup width');
      const alphabet = bytes.subarray(at, at + 128); take(128);
      const bufferSize = u64(); if (bufferSize !== allocation) fail('Huffman allocation');
      const buffer = bytes.subarray(at, at + bufferSize); take(bufferSize);
      page = { start, size, totalBits, decode: huffman(alphabet, buffer, totalBits, charset, longest) };
    } else {
      u64(); // Remaining capacity is not part of the persisted used strings.
      const used = u64(maxChars + size), allocation = u64();
      if (allocation % 2 || used * 2 > allocation) fail('string allocation');
      const dataAt = take(allocation), entries = new Map(); let begin = 0;
      // _TCHAR is UTF-16. Native record offsets count code units, despite
      // the specification's byteOffset member name (MS-XLDM 2.3.2.1.3.5).
      for (let offset = 0; offset < used; offset++) {
        if (view.getUint16(dataAt + offset * 2, true)) continue;
        if (offset - begin > longest) fail('longest string');
        if (entries.size >= size) fail('page string count');
        entries.set(begin, { start: dataAt + begin * 2, end: dataAt + offset * 2 }); begin = offset + 1;
      }
      if (begin !== used || entries.size !== size) fail('unterminated or missing strings');
      page = { start, size, entries, seen: new Set() };
    }
    if (u32() !== 0xABCDABCD) fail('page end marker');
    pages.push(page);
  }
  if (expectedStart !== count || u64(maxItems) !== count || u32() !== 8) fail('record handle vector');
  const handlesAt = take(count * 8), out = new Array(count); let characters = 0;
  for (let i = 0; i < count; i++) {
    const offset = view.getUint32(handlesAt + i * 8, true), pageId = view.getUint32(handlesAt + i * 8 + 4, true), page = pages[pageId];
    if (!page || i < page.start || i >= page.start + page.size) fail('record page');
    let value;
    if (page.decode) {
      if (i === page.start && offset !== 0) fail('first string offset');
      const end = i + 1 === page.start + page.size ? page.totalBits : view.getUint32(handlesAt + (i + 1) * 8, true);
      value = page.decode(offset, end, maxChars - characters);
    } else {
      const entry = page.entries.get(offset);
      if (!entry || page.seen.has(offset)) fail('record string offset');
      page.seen.add(offset); value = utf16.decode(bytes.subarray(entry.start, entry.end));
    }
    characters += value.length; if (characters > maxChars) fail('decoded character limit');
    out[i] = value;
  }
  for (; at < bytes.length; at++) if (bytes[at]) fail('nonzero file padding');
  return out;
}

function hashHeader(header, string) {
  if (!header || !Number.isInteger(header.algorithm) || (string ? header.algorithm < 0 || header.algorithm > 2 : header.algorithm !== -1)) fail('hash algorithm');
  const { entrySize, binSize, localCount } = header;
  if (!Number.isInteger(entrySize) || entrySize <= 0 || entrySize > MAX_BYTES || ![64, 128].includes(binSize)
      || localCount !== Math.floor((binSize - 12) / entrySize)) fail('hash geometry');
  return header;
}
function writeHashHeader(view, at, header) {
  view.setInt32(at, header.algorithm, true); view.setUint32(at + 4, header.entrySize, true);
  view.setUint32(at + 8, header.binSize, true); view.setUint32(at + 12, header.localCount, true);
  view.setBigInt64(at + 16, -1n, true);
}
function storedHashHeader(bytes, present) {
  if (!present) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { algorithm: view.getInt32(4, true), entrySize: view.getUint32(8, true), binSize: view.getUint32(12, true), localCount: view.getUint32(16, true) };
}

/** Write exact string values in handle order using uncompressed UTF-16 pages.
 * Collation, ID allocation, null IDs and BLOB encoding remain caller concerns.
 * Hash geometry is explicit because native producers use different policies.
 */
export function encodeModelStringDictionary(values, { flags = 0, hashHeader: header = null, pageChars = 65536, maxItems = MAX_ITEMS, maxChars = MAX_CHARS } = {}) {
  bounded(flags, 263); if (flags & ~263) fail('dictionary flags');
  bounded(maxItems, MAX_ITEMS); bounded(maxChars, MAX_CHARS); bounded(pageChars, MAX_CHARS);
  if (!pageChars || !Array.isArray(values) || values.length > maxItems) fail('string input');
  if (flags & 1) hashHeader(header, true); else if (header !== null) fail('unexpected hash header');
  const pages = [], seen = flags & 1 ? null : new Set(); let chars = 0, longest = 0, page = null;
  for (let i = 0; i < values.length; i++) {
    const value = values[i]; if (typeof value !== 'string') fail('string entry');
    chars += value.length; if (chars > maxChars) fail('decoded character limit');
    if (seen) { if (seen.has(value)) fail('duplicate unhashed string'); seen.add(value); }
    for (let j = 0; j < value.length; j++) {
      const unit = value.charCodeAt(j);
      if (!unit) fail('embedded string terminator');
      if (unit >= 0xD800 && unit <= 0xDBFF) {
        const low = value.charCodeAt(++j); if (!(low >= 0xDC00 && low <= 0xDFFF)) fail('invalid UTF-16');
      } else if (unit >= 0xDC00 && unit <= 0xDFFF) fail('invalid UTF-16');
    }
    longest = Math.max(longest, value.length);
    // pageChars is a target capacity; an indivisible longer string gets its own
    // page. Page offsets count UTF-16 code units, including terminators.
    if (!page || page.units + value.length + 1 > pageChars) {
      if (pages.length >= 524288) fail('page count');
      page = { start: i, count: 0, units: 0 }; pages.push(page);
    }
    page.count++; page.units += value.length + 1;
  }
  const prefix = flags & 1 ? 28 : 4;
  const size = prefix + 25 + pages.length * 58 + (chars + values.length) * 2 + 12 + values.length * 8;
  if (size > MAX_BYTES) fail('encoded size limit');
  const bytes = new Uint8Array(size), view = new DataView(bytes.buffer); let at = 0;
  const u32 = value => { view.setUint32(at, value, true); at += 4; };
  const u64 = value => { view.setBigUint64(at, BigInt(value), true); at += 8; };
  u32(2); if (flags & 1) { writeHashHeader(view, at, header); at += 24; }
  u64(values.length); at++; u64(longest); u64(pages.length);
  const offsets = new Uint32Array(values.length), pageIds = new Uint32Array(values.length);
  pages.forEach((p, pageId) => {
    u64(0); at++; u64(p.start); u64(p.count); at++; u32(0xAABBCCDD);
    u64(0); u64(p.units); u64(p.units * 2); let offset = 0;
    for (let i = p.start; i < p.start + p.count; i++) {
      offsets[i] = offset; pageIds[i] = pageId;
      for (let j = 0; j < values[i].length; j++) { view.setUint16(at, values[i].charCodeAt(j), true); at += 2; }
      at += 2; offset += values[i].length + 1;
    }
    u32(0xABCDABCD);
  });
  u64(values.length); u32(8);
  for (let i = 0; i < values.length; i++) { u32(offsets[i]); u32(pageIds[i]); }
  return bytes;
}

/** Numeric entries retain their declared width and type; BigInt is required
 * for integers so already-rounded Numbers cannot silently lose precision.
 */
export function encodeModelNumericDictionary(values, { type, operatingOn32 = false, hashHeader: header, maxItems = MAX_ITEMS } = {}) {
  bounded(maxItems, MAX_ITEMS);
  if (!Array.isArray(values) || values.length > maxItems || !['long', 'real'].includes(type) || typeof operatingOn32 !== 'boolean') fail('numeric input');
  hashHeader(header, false);
  const width = type === 'long' && operatingOn32 ? 4 : 8;
  const min = width === 4 ? -2147483648n : -9223372036854775808n, max = width === 4 ? 2147483647n : 9223372036854775807n;
  for (const value of values) {
    if (type === 'real' ? typeof value !== 'number' || !Number.isFinite(value) : typeof value !== 'bigint' || value < min || value > max) fail('numeric entry');
  }
  const bytes = new Uint8Array(40 + values.length * width), view = new DataView(bytes.buffer);
  view.setUint32(0, type === 'long' ? 0 : 1, true); writeHashHeader(view, 4, header);
  view.setBigUint64(28, BigInt(values.length), true); view.setUint32(36, width, true);
  values.forEach((value, i) => {
    const at = 40 + i * width;
    if (type === 'real') view.setFloat64(at, value, true);
    else if (width === 4) view.setInt32(at, Number(value), true);
    else view.setBigInt64(at, value, true);
  });
  return bytes;
}

const IMBI = 'http://schemas.microsoft.com/analysisservices/imbi';
const children = (n, name) => modelChildren(n, name, IMBI);
const only = (nodes, label) => { if (nodes.length !== 1) fail(`missing or duplicate ${label}`); return nodes[0]; };
const child = (n, name) => only(children(n, name), name);

const property = (node, name) => child(child(node, 'Properties'), name).textContent.trim();
const integer = (node, name, min = -2147483648, max = 2147483647) => {
  const text = property(node, name), value = Number(text);
  if (!/^[+-]?\d+$/.test(text) || !Number.isSafeInteger(value) || value < min || value > max) fail(name);
  return value;
};
const boolean = (node, name) => {
  const value = property(node, name);
  if (!['true', 'false', '0', '1'].includes(value)) fail(name);
  return value === 'true' || value === '1';
};

/** MS-XLDM 2.3.2.1.1: numeric vectors are uncompressed. Integer entries stay
 * BigInts even when they would fit in a Number, so callers cannot accidentally
 * lose precision merely because another row has a larger value.
 */
export function decodeModelNumericDictionary(bytes, { type, operatingOn32 = false, maxItems = MAX_ITEMS } = {}) {
  if (!(bytes instanceof Uint8Array) || bytes.length > MAX_BYTES || !['long', 'real'].includes(type) || typeof operatingOn32 !== 'boolean') fail('numeric input');
  bounded(maxItems, MAX_ITEMS);
  if (bytes.length < 40) fail('truncated numeric dictionary');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = type === 'long' && operatingOn32 ? 4 : 8;
  if (view.getUint32(0, true) !== (type === 'long' ? 0 : 1) || view.getInt32(4, true) !== -1 || view.getBigInt64(20, true) !== -1n) fail('numeric header');
  const entry = view.getUint32(8, true), bin = view.getUint32(12, true), local = view.getUint32(16, true);
  if (!entry || !bin || entry * local > bin) fail('numeric hash header');
  const count64 = view.getBigUint64(28, true);
  if (count64 > BigInt(maxItems)) fail('numeric item limit');
  const count = Number(count64), end = 40 + count * width;
  if (view.getUint32(36, true) !== width || end > bytes.length) fail('numeric vector');
  const values = new Array(count);
  for (let i = 0, at = 40; i < count; i++, at += width) {
    values[i] = type === 'real' ? view.getFloat64(at, true) : width === 4 ? BigInt(view.getInt32(at, true)) : view.getBigInt64(at, true);
    if (type === 'real' && !Number.isFinite(values[i])) fail('nonfinite numeric entry');
  }
  for (let at = end; at < bytes.length; at++) if (bytes[at]) fail('nonzero file padding');
  return values;
}

/** Resolve the dictionary and optional column statistics through explicit
 * namespace-checked metadata. Values remain in dictionary/storage types;
 * OLE DB dates, currency and Boolean conversion belong to the typed model.
 */
export function readModelDictionary(archive, tableFile, columnName, options = {}) {
  if (!archive.files.includes(tableFile) || tableFile.size > 16 * 1048576) fail('metadata file');
  const bytes = tableFile.read(), root = parseModelXml(decodeModelXml(bytes).xml);
  if (root.namespaceURI !== IMBI || root.localName !== 'XMObject' || root.getAttribute('class') !== 'XMSimpleTable') fail('metadata root');
  const columns = only(children(child(root, 'Collections'), 'Collection').filter(n => child(n, 'Name').textContent === 'Columns'), 'Columns');
  const column = only(children(columns, 'XMObject').filter(n => n.getAttribute('name') === columnName), 'column');
  if (column.getAttribute('class') !== 'XMRawColumn') fail('column class');
  const dict = only(children(child(column, 'DataObjects'), 'DataObject').map(n => child(n, 'XMObject')).filter(n => /^XM(?:Hash|Value)DataDictionary</.test(n.getAttribute('class'))), 'dictionary');
  const match = /^XM(Hash|Value)DataDictionary<XM_(String|Long|Real)>$/.exec(dict.getAttribute('class'));
  if (!match || match[1] === 'Value' && match[2] === 'String') fail('unsupported dictionary class');
  const kind = match[1].toLowerCase(), type = match[2].toLowerCase();
  const members = children(column, 'Members');
  if (members.length > 1) fail('duplicate column Members');
  const statsNodes = children(members[0], 'Member').filter(n => child(n, 'Name').textContent === 'ColumnStats');
  let stats = null;
  if (statsNodes.length) {
    const node = child(only(statsNodes, 'ColumnStats'), 'XMObject');
    if (node.getAttribute('class') !== 'XMColumnStats') fail('column statistics class');
    stats = { min: integer(node, 'MinDataID'), max: integer(node, 'MaxDataID'), rows: integer(node, 'RowCount', 0, 16 * 1048576), hasNulls: boolean(node, 'HasNulls'), xmType: integer(node, 'XMType', 0, 2), dbType: integer(node, 'DBType', 0, 65535) };
  }
  if (kind === 'value') {
    const base = property(dict, 'BaseId'), magnitudeText = property(dict, 'Magnitude');
    if (!/^[+-]?\d+$/.test(base)) fail('BaseId');
    const digits = base.replace(/^[+-]?0*/, '') || '0';
    if (digits.length > 19) fail('BaseId bounds');
    const baseId = BigInt((base[0] === '-' ? '-' : '') + digits), magnitude = Number(magnitudeText);
    if (baseId < -9223372036854775808n || baseId > 9223372036854775807n) fail('BaseId bounds');
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(magnitudeText) || !Number.isFinite(magnitude)) fail('Magnitude');
    return { kind, type, baseId, magnitude, stats };
  }
  const name = dict.getAttribute('name'), lastId = integer(dict, 'LastId'), nullable = boolean(dict, 'Nullable');
  if (!name) fail('dictionary file name');
  const flags = type === 'string' ? integer(dict, 'DictionaryFlags', 0, 263) : 0;
  if (flags & ~263) fail('dictionary flags');
  const operatingOn32 = type === 'long' ? boolean(dict, 'OperatingOn32') : false;
  const folder = tableFile.path.slice(0, Math.max(tableFile.path.lastIndexOf('/'), tableFile.path.lastIndexOf('\\')) + 1);
  const file = only(archive.files.filter(f => f.path === folder + name), 'dictionary file');
  if (file.size > MAX_BYTES) fail('file size limit');
  const data = file.read(), values = type === 'string' ? decodeModelStringDictionary(data, { ...options, flags }) : decodeModelNumericDictionary(data, { ...options, type, operatingOn32 });
  return { kind, type, lastId, nullable, values, stats, storage: { path: file.path, flags, operatingOn32, hashHeader: storedHashHeader(data, type !== 'string' || flags & 1) } };
}

export function readModelStringDictionary(archive, tableFile, columnName, options = {}) {
  const dictionary = readModelDictionary(archive, tableFile, columnName, options);
  if (dictionary.kind !== 'hash' || dictionary.type !== 'string') fail('not a string dictionary');
  const { lastId, nullable, values } = dictionary;
  return { lastId, nullable, values };
}
