import { decodeModelXml, parseModelXml, modelChildren, modelComparisonProperties } from './data-model-metadata.js';

const IMBI = 'http://schemas.microsoft.com/analysisservices/imbi';
const WIDTHS = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 16, 21, 32]);
const MAX_IDS = 16 * 1048576;
const fail = message => { throw new Error(`Invalid Data Model column: ${message}`); };
const int = (v, min = 0, max = MAX_IDS) => {
  if (!Number.isSafeInteger(v) || v < min || v > max) fail('integer bounds');
  return v;
};
const signed = v => int(v, -2147483648, 2147483647);

/** MS-XLDM 2.3.1.1 and 2.7: persisted segment sizes count 64-bit words.
 * Values never straddle a word. Metadata supplies logical row counts and
 * compression parameters; file lengths alone cannot determine either.
 * Output contains identifiers, not dictionary values or worksheet row order.
 */
function validateSegments(segments, maxIds, mapping) {
  if (!Array.isArray(segments) || !segments.length || segments.length > 65536) fail('input');
  int(maxIds);
  let count = 0;
  for (const segment of segments) {
    count += int(segment.records);
    if (count > maxIds) fail('identifier limit');
    signed(segment.min);
    if (mapping && segment.type !== 'packed') fail('mapping compression');
    if (!['packed', 'hybrid', 'sequence'].includes(segment.type) || segment.type !== 'sequence' && !WIDTHS.has(segment.bits)) fail('compression');
    if (segment.type === 'sequence' && (segment.min < 0 || segment.min + segment.records - 1 > 2000000000)) fail('row number bounds');
  }
  for (let i = 0; !mapping && i < segments.length - 1; i++) {
    const n = segments[i].records;
    if (n < 16384 || (n & (n - 1)) || n !== segments[0].records) fail('nonfinal segment row count');
  }
  return count;
}
function decodeModelIds(bytes, segments, { maxIds = MAX_IDS } = {}, mapping = false) {
  if (!(bytes instanceof Uint8Array) || bytes.length > 256 * 1048576) fail('input');
  const count = validateSegments(segments, maxIds, mapping);
  const output = new Int32Array(count), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 0, written = 0;
  const block = () => {
    if (at + 8 > bytes.length) fail('truncated segment size');
    const units = view.getBigUint64(at, true); at += 8;
    if (units > BigInt(Math.floor((bytes.length - at) / 8))) fail('segment size');
    const size = Number(units) * 8, start = at; at += size;
    return { start, size, end: at };
  };
  const zero = (start, end) => { for (let i = start; i < end; i++) if (bytes[i]) fail('nonzero padding'); };
  for (const segment of segments) {
    const primary = block(), packed = segment.type === 'packed' ? primary : block();
    const perWord = Math.floor(64 / (segment.bits || 1));
    const mask = (1n << BigInt(segment.bits || 1)) - 1n;
    let wordIndex = -1, word = 0n;
    const valueAt = index => {
      if (segment.type === 'sequence') return segment.min + index;
      const indexInWords = Math.floor(index / perWord);
      if ((indexInWords + 1) * 8 > packed.size) fail('truncated packed identifiers');
      if (wordIndex !== indexInWords) { word = view.getBigUint64(packed.start + indexInWords * 8, true); wordIndex = indexInWords; }
      return signed(segment.min + Number((word >> BigInt((index % perWord) * segment.bits)) & mask));
    };
    let packedCount = 0;
    if (segment.type === 'packed') {
      for (; packedCount < segment.records; packedCount++) output[written++] = valueAt(packedCount);
    } else {
      if (segment.allocated != null && int(segment.allocated, 0, bytes.length / 4) * 4 !== primary.size) fail('allocation size');
      let pos = primary.start, rows = 0;
      while (rows < segment.records) {
        if (pos + 8 > primary.end) fail('truncated RLE entries');
        const value = view.getInt32(pos, true), length = view.getUint32(pos + 4, true); pos += 8;
        if (!length || length > segment.records - rows) fail('RLE count');
        if (value < 0) {
          if (-value - 1 !== packedCount) fail('RLE subsegment offset');
          if (segment.type === 'sequence' && (value !== -1 || length !== segment.records)) fail('row number run');
          for (let i = 0; i < length; i++) output[written++] = valueAt(packedCount++);
        } else {
          if (segment.type === 'sequence' || length < 64) fail('RLE repeat count');
          output.fill(value, written, written + length); written += length;
        }
        rows += length;
      }
      if (segment.used != null && (int(segment.used, 0, primary.size / 4) * 4 < pos - primary.start)) fail('used storage size');
      zero(pos, primary.end);
    }
    if (segment.packedRecords != null && int(segment.packedRecords) !== packedCount) fail('subsegment record count');
    if (segment.type === 'sequence') { if (packed.size) fail('row number subsegment'); }
    else zero(packed.start + Math.ceil(packedCount / perWord) * 8, packed.end);
  }
  zero(at, bytes.length); // Optional end-of-file padding is outside segment sizes.
  return output;
}

export function decodeModelColumnIds(bytes, segments, options = {}) {
  return decodeModelIds(bytes, segments, options);
}

// MS-XLDM 2.4.1/2.4.2 mappings use no-split packing, but their segment map
// supplies sizes independently of the ordinary data-column row-size rules.
export function decodeModelMappingIds(bytes, segments, options = {}) {
  return decodeModelIds(bytes, segments, options, true);
}

/** Encode storage-order identifiers and return the matching segment metadata.
 * The caller supplies segment boundaries and compression minima/widths, and
 * must persist the returned counts and allocation sizes with the bytes. Values
 * are never truncated to fit a width. Dictionaries and row ordering are separate.
 */
function encodeModelIds(ids, segments, { maxIds = MAX_IDS } = {}, mapping = false) {
  if (!(ids instanceof Int32Array) && !Array.isArray(ids)) fail('identifier input');
  const count = validateSegments(segments, maxIds, mapping);
  if (ids.length !== count) fail('identifier count');
  if (Array.isArray(ids)) for (const value of ids) signed(value);
  const plans = []; let from = 0, size = 0;
  for (const segment of segments) {
    const end = from + segment.records, runs = [], packed = new Int32Array(segment.type === 'sequence' ? 0 : segment.records);
    let packedCount = 0;
    if (segment.type === 'packed') {
      for (let i = from; i < end; i++) packed[packedCount++] = ids[i];
    } else if (segment.type === 'sequence') {
      for (let i = from; i < end; i++) if (ids[i] !== segment.min + i - from) fail('row number sequence');
      if (segment.records) runs.push(-1, segment.records);
      packedCount = segment.records; // Logical subsegment rows; no packed bytes.
    } else {
      for (let at = from; at < end;) {
        let next = at + 1;
        while (next < end && ids[next] === ids[at]) next++;
        const length = next - at, value = ids[at];
        if (value >= 0 && length >= 64) runs.push(value, length);
        else {
          // Adjacent short runs share a single subsegment reference. Negative
          // identifiers cannot be literal RLE values because that sign denotes
          // a subsegment offset, so they are always packed.
          if (runs.length && runs[runs.length - 2] < 0) runs[runs.length - 1] += length;
          else runs.push(-packedCount - 1, length);
          packed.fill(value, packedCount, packedCount + length); packedCount += length;
        }
        at = next;
      }
    }
    const metadata = { ...segment }, perWord = Math.floor(64 / (segment.bits || 1));
    let primaryBytes = 0;
    if (segment.type !== 'packed') {
      const previousAllocated = int(segment.allocated ?? 0, 0, 64 * 1048576), previousUsed = int(segment.used ?? 0, 0, previousAllocated);
      metadata.used = Math.max(previousUsed, runs.length);
      metadata.allocated = Math.max(previousAllocated, Math.ceil(metadata.used / 2) * 2);
      // Persisted block lengths count uint64 words, even though XML allocation
      // sizes count uint32 units. Round an odd prior allocation up to a word.
      metadata.allocated = Math.ceil(metadata.allocated / 2) * 2;
      metadata.packedRecords = packedCount; primaryBytes = metadata.allocated * 4;
    } else if (segment.packedRecords != null) metadata.packedRecords = packedCount;
    const packedBytes = segment.type === 'sequence' ? 0 : Math.ceil(packedCount / perWord) * 8;
    if (segment.type !== 'sequence') for (let i = 0; i < packedCount; i++) {
      const delta = packed[i] - segment.min;
      if (delta < 0 || delta >= 2 ** segment.bits) fail('identifier does not fit compression');
    }
    size += 8 + packedBytes + (segment.type === 'packed' ? 0 : 8 + primaryBytes);
    if (size > 256 * 1048576) fail('encoded size limit');
    plans.push({ metadata, runs, packed, packedCount, packedBytes, primaryBytes, perWord }); from = end;
  }
  const bytes = new Uint8Array(size), view = new DataView(bytes.buffer); let at = 0;
  for (const plan of plans) {
    const { metadata, runs, packed, packedCount, packedBytes, primaryBytes, perWord } = plan;
    if (metadata.type !== 'packed') {
      view.setBigUint64(at, BigInt(primaryBytes / 8), true); at += 8;
      for (let i = 0; i < runs.length; i += 2) {
        view.setInt32(at + i * 4, runs[i], true); view.setUint32(at + i * 4 + 4, runs[i + 1], true);
      }
      at += primaryBytes;
    }
    view.setBigUint64(at, BigInt(packedBytes / 8), true); at += 8;
    if (metadata.type !== 'sequence') for (let i = 0; i < packedCount;) {
      let word = 0n;
      for (let slot = 0; slot < perWord && i < packedCount; slot++, i++) word |= BigInt(packed[i] - metadata.min) << BigInt(slot * metadata.bits);
      view.setBigUint64(at, word, true); at += 8;
    }
  }
  return { bytes, segments: plans.map(p => p.metadata) };
}

export function encodeModelColumnIds(ids, segments, options = {}) {
  return encodeModelIds(ids, segments, options);
}

export function encodeModelMappingIds(ids, segments, options = {}) {
  return encodeModelIds(ids, segments, options, true);
}

const children = (n, name) => modelChildren(n, name, IMBI);
const only = (nodes, label) => { if (nodes.length !== 1) fail(`missing or duplicate ${label}`); return nodes[0]; };
const child = (n, name) => only(children(n, name), name);
const properties = n => child(n, 'Properties');
const number = (n, name, min = 0, max = MAX_IDS) => {
  const text = child(properties(n), name).textContent.trim();
  if (!/^[+-]?\d+$/.test(text)) fail(`invalid ${name}`);
  return int(Number(text), min, max);
};
const named = (n, container, entry, name) => only(children(child(n, container), entry).filter(x => child(x, 'Name').textContent === name), name);
const member = (n, name) => child(named(n, 'Members', 'Member', name), 'XMObject');
const collection = (n, name) => children(named(n, 'Collections', 'Collection', name), 'XMObject');
function compression(n) {
  const type = n.getAttribute('class'), match = /^XMRENoSplitCompressionInfo<(\d+)>$/.exec(type);
  if (!match && type !== 'XM123CompressionInfo') fail(`unsupported compression ${type}`);
  const bits = match ? Number(match[1]) : null;
  if (match && !WIDTHS.has(bits)) fail('unsupported bit width');
  return { bits, min: number(n, 'Min', -2147483648, 2147483647) };
}

function parseSegmentMap(map) {
  const type = map.getAttribute('class');
  if (type === 'XMSegment1Map') return { segments: 1, records: number(map, 'Records'), perSegment: null };
  if (/^XMSegmentEqualMapEx<XMSegmentEqualMap_(?:Fast|Complex)Instantiation>$/.test(type)) return {
    segments: number(map, 'Segments', 1, 65536), records: number(map, 'Records'), perSegment: number(map, 'RecordsPerSegment'),
  };
  fail('unsupported segment map');
}
function tablePartitionMaps(root, partitions, columns) {
  const members = children(root, 'Members');
  if (members.length > 1) fail('duplicate Members');
  const maps = children(members[0], 'Member').filter(m => child(m, 'Name').textContent === 'SegmentMap');
  // This column-storage parser also accepts partial metadata. Writers require
  // the complete table map before changing any persisted column.
  if (!maps.length) return null;
  const map = child(only(maps, 'SegmentMap'), 'XMObject');
  const entries = map.getAttribute('class') === 'XMMultiPartSegmentMap'
    ? collection(map, 'Partitions').map(parseSegmentMap) : [parseSegmentMap(map)];
  if (entries.length !== partitions.length || entries.reduce((n, m) => n + m.records, 0) > MAX_IDS) fail('table partition map counts');
  for (const column of columns) {
    if (column.files.length !== entries.length) fail('partition file count');
    const files = new Map(column.files.map(file => [file.partition, file])); let at = 0;
    for (let i = 0; i < entries.length; i++) {
      const file = files.get(partitions[i]), map = entries[i];
      if (!file) fail('missing partition file');
      const segments = column.segments.slice(at, at + file.segments); at += file.segments;
      if (file.segments !== map.segments || segments.length !== map.segments || segments.reduce((n, s) => n + s.records, 0) !== map.records
        || map.perSegment !== null && segments.slice(0, -1).some(s => s.records !== map.perSegment)) fail('partition segment map mismatch');
    }
    if (at !== column.segments.length) fail('unassigned partition segments');
  }
  return entries.map((map, i) => ({ partition: partitions[i], ...map }));
}

/** Read storage identities and segment parameters from namespace-checked IMBI
 * metadata. No data-file path is synthesized from a table/column caption.
 */
export function readModelColumnStorage(xml, { hierarchy = false } = {}) {
  const root = parseModelXml(xml);
  if (root.namespaceURI !== IMBI || root.localName !== 'XMObject' || root.getAttribute('class') !== 'XMSimpleTable') fail('storage metadata root');
  let segmentMap;
  if (hierarchy) {
    // The low table-kind nibble distinguishes intrinsic (4) from user (5)
    // hierarchies; upper bits independently describe processing/unknown rows.
    if ((number(root, 'Settings', 0, 4367) & 15) !== 4) fail('not an intrinsic hierarchy table');
    segmentMap = parseSegmentMap(member(root, 'SegmentMap'));
  }
  const partitions = collection(root, 'Partitions').map(p => number(p, 'Partition', 0, 2147483647));
  if (new Set(partitions).size !== partitions.length) fail('duplicate partition');
  const columns = collection(root, 'Columns').map(column => {
    if (column.getAttribute('class') !== 'XMRawColumn') fail('unsupported column class');
    const segments = collection(column, 'Segments').map(segment => {
      if (segment.getAttribute('class') !== 'XMColumnSegment') fail('segment class');
      const info = member(segment, 'CompressionInfo'), name = info.getAttribute('class'), hybrid = /^XMHybridRLECompressionInfo<class (.*)>$/.exec(name);
      const records = number(segment, 'Records');
      if (!hybrid) {
        const decoded = compression(info);
        if (decoded.bits == null) fail('standalone row number compression');
        return { ...decoded, records, type: 'packed' };
      }
      const subInfo = member(info, 'SubCompression'), decoded = compression(subInfo), sub = member(segment, 'SubSegment');
      if (subInfo.getAttribute('class') !== hybrid[1] || sub.getAttribute('class') !== 'XMColumnSegment') fail('subsegment compression');
      const subDecoded = compression(member(sub, 'CompressionInfo'));
      if (subDecoded.bits !== decoded.bits || subDecoded.min !== decoded.min) fail('conflicting subsegment parameters');
      const rle = member(info, 'RLECompression');
      if (rle.getAttribute('class') !== 'XMRLECompressionInfo') fail('RLE class');
      const allocated = number(rle, 'StorageAllocSize', 0, 128 * 1048576), used = number(rle, 'StorageUsedSize', 0, allocated);
      if (!['false', '0'].includes(child(properties(rle), 'SegmentNeedsResizing').textContent.trim())) fail('unsettled segment');
      return { ...decoded, records, packedRecords: number(sub, 'Records'), type: decoded.bits == null ? 'sequence' : 'hybrid', allocated, used };
    });
    const data = children(child(column, 'DataObjects'), 'DataObject').map(d => child(d, 'XMObject'));
    const files = data.filter(d => d.getAttribute('class') === 'XMRawColumnPartitionDataObject').map(d => ({
      name: d.getAttribute('name'), partition: number(d, 'Partition', 0, 2147483647), segments: number(d, 'SegmentCount', 1, 65536),
    }));
    if (files.some(f => !f.name) || new Set(files.map(f => f.partition)).size !== files.length) fail('column files');
    const declared = children(column, 'Properties');
    if (declared.length > 1) fail('duplicate column Properties');
    return { name: column.getAttribute('name'), ...modelComparisonProperties(declared[0], { namespace: IMBI, localeName: 'Locale' }), segments, files };
  });
  if (columns.some(c => !c.name) || new Set(columns.map(c => c.name)).size !== columns.length) fail('column names');
  return { name: root.getAttribute('name'), partitions, columns, ...(hierarchy ? { segmentMap } : { partitionMaps: tablePartitionMaps(root, partitions, columns) }) };
}

/** Decode a selected column from an already-open archive, keeping dictionary
 * lookup and original row-order recovery separate from identifier storage.
 */
function readModelIdentifiers(archive, tableFile, columnName, options, mapping) {
  if (!archive.files.includes(tableFile)) fail('foreign metadata file');
  if (tableFile.size > 16 * 1048576) fail('metadata size');
  const bytes = tableFile.read();
  const xml = decodeModelXml(bytes).xml;
  const table = readModelColumnStorage(xml, { hierarchy: mapping }), column = only(table.columns.filter(c => c.name === columnName), 'column');
  const maxIds = options.maxIds ?? MAX_IDS; int(maxIds);
  const count = column.segments.reduce((n, s) => n + s.records, 0);
  if (count > maxIds) fail('identifier limit');
  // An unpartitioned intrinsic table declares its one storage file directly.
  // Multiple files without a partition inventory have no unambiguous order.
  const partitions = !table.partitions.length && mapping && column.files.length === 1 ? [column.files[0].partition] : table.partitions;
  if (column.files.length !== partitions.length) fail('partition file count');
  if (mapping) {
    const map = table.segmentMap;
    if (map.records !== count || map.segments !== column.segments.length) fail('hierarchy segment map counts');
    if (map.perSegment !== null && column.segments.slice(0, -1).some(s => s.records !== map.perSegment)) fail('hierarchy segment map size');
  }
  const folder = tableFile.path.slice(0, Math.max(tableFile.path.lastIndexOf('/'), tableFile.path.lastIndexOf('\\')) + 1);
  const out = new Int32Array(count); let segmentAt = 0, offset = 0;
  for (const partition of partitions) {
    const data = only(column.files.filter(f => f.partition === partition), 'partition file');
    const file = only(archive.files.filter(f => f.path === folder + data.name), 'column data file');
    const segments = column.segments.slice(segmentAt, segmentAt + data.segments);
    if (segments.length !== data.segments) fail('partition segment count');
    const ids = decodeModelIds(file.read(), segments, { maxIds: maxIds - offset }, mapping);
    out.set(ids, offset); offset += ids.length; segmentAt += data.segments;
  }
  if (segmentAt !== column.segments.length || offset !== count) fail('unassigned segments');
  return out;
}

export function readModelColumnIdentifiers(archive, tableFile, columnName, options = {}) {
  return readModelIdentifiers(archive, tableFile, columnName, options, false);
}

export function readModelMappingIdentifiers(archive, tableFile, columnName, options = {}) {
  return readModelIdentifiers(archive, tableFile, columnName, options, true);
}
