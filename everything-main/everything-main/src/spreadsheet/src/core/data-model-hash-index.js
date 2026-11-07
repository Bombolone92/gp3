import { readModelIntrinsicHierarchy } from './data-model-hierarchies.js';

const MAX_BYTES = 256 * 1048576, MAX_ENTRIES = 1048576, MAX_BINS = 1048576;
const fail = message => { throw new Error(`Invalid Data Model hierarchy hash: ${message}`); };
const bound = (n, max) => { if (!Number.isSafeInteger(n) || n < 0 || n > max) fail('size limit'); return n; };
const signed = n => { if (!Number.isInteger(n) || n < -2147483648 || n > 2147483647) fail('signed entry'); return n; };
function geometry(bins, binSize) {
  if (!Number.isInteger(bins) || bins < 16 || bins > MAX_BINS || (bins & (bins - 1)) || ![64, 128].includes(binSize)) fail('bin geometry');
  return { local: Math.floor((binSize - 12) / 8), shift: 32 - Math.log2(bins) };
}
// MS-XLDM 2.3.3.1.3: multiply modulo 2^32, then retain the high log2(bins)
// bits. Math.imul preserves low product bits even beyond Number precision.
const bucketFor = (key, shift) => (Math.imul(key, 0x12B9B6A5) >>> 0) >>> shift;

/** Read the compact Int32 identifier/position profile of hierarchy HIDX files.
 * Other HashEntry policies are not inferred from arbitrary payload bytes.
 * Bin prefixes occupy 12 bytes on both 32-bit (pointer + padding + count)
 * and 64-bit (pointer + count) hosts; persisted chain pointers must be zero.
 */
export function decodeModelHierarchyHash(bytes, { maxEntries = MAX_ENTRIES } = {}) {
  if (!(bytes instanceof Uint8Array) || bytes.length > MAX_BYTES) fail('input');
  bound(maxEntries, MAX_ENTRIES);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); let at = 0;
  const take = size => { if (size > bytes.length - at) fail('truncated storage'); const start = at; at += size; return start; };
  const u32 = () => view.getUint32(take(4), true);
  const u64 = max => { const n = view.getBigUint64(take(8), true); if (n > BigInt(max)) fail('size limit'); return Number(n); };
  if (view.getInt32(take(4), true) !== -1) fail('hash algorithm');
  if (u32() !== 8) fail('unsupported entry policy');
  const binSize = u32(), local = u32(), bins = u64(MAX_BINS), format = geometry(bins, binSize);
  if (local !== format.local) fail('local capacity');
  const records = u64(maxEntries), mask = u64(MAX_BINS);
  if (mask !== bins - 1) fail('hash mask');
  const hasStats = bytes[take(1)]; if (hasStats > 1) fail('statistics flag');
  let stats = null;
  if (hasStats) {
    stats = { records: u64(maxEntries), bins: u64(MAX_BINS), used: u64(MAX_BINS), fast: u64(maxEntries), local: u64(MAX_ENTRIES), maximum: u64(maxEntries) };
    const count = u64(MAX_ENTRIES), width = u32();
    if (width !== 8) fail('histogram width');
    // Histogram indexes differ between published and native implementations;
    // they are profiling data, not entry offsets. Consume them with bounds.
    for (let i = 0; i < count; i++) u64(bins);
  }
  const start = take(bins * binSize), counts = new Uint32Array(bins), entries = new Map();
  let total = 0, overflow = 0, used = 0, fast = 0, maximum = 0;
  const entry = (offset, bin) => {
    const key = view.getInt32(offset, true), value = view.getInt32(offset + 4, true);
    if (bucketFor(key, format.shift) !== bin) fail('entry in wrong bin');
    if (entries.has(key)) fail('duplicate identifier');
    entries.set(key, value);
  };
  for (let bin = 0; bin < bins; bin++) {
    const offset = start + bin * binSize;
    if (view.getBigUint64(offset, true) !== 0n) fail('persisted chain pointer');
    const count = view.getUint32(offset + 8, true); counts[bin] = count;
    if (count > records - total) fail('bin record count');
    total += count; if (count) used++; maximum = Math.max(maximum, count);
    const inBin = Math.min(count, local); fast += inBin; overflow += count - inBin;
    for (let i = 0; i < inBin; i++) entry(offset + 12 + i * 8, bin);
  }
  if (total !== records || u64(maxEntries) !== overflow) fail('overflow record count');
  const overflowAt = take(overflow * 8); let cursor = overflowAt;
  for (let bin = 0; bin < bins; bin++) for (let i = local; i < counts[bin]; i++, cursor += 8) entry(cursor, bin);
  if (stats && (stats.records !== records || stats.bins !== bins || stats.used !== used || stats.fast !== fast || stats.local !== local || stats.maximum !== maximum)) fail('inconsistent hash statistics');
  for (; at < bytes.length; at++) if (bytes[at]) fail('nonzero file padding');
  return entries;
}

/** Rebuild a compact hierarchy index from complete identifier/position pairs.
 * Optional profiling statistics are omitted (MS-XLDM HashStats=false).
 * Unused slots, bin padding and persisted pointers are initialized to zero.
 */
export function encodeModelHierarchyHash(entries, { binSize = 64, binCount } = {}) {
  if (!(entries instanceof Map) || entries.size > MAX_ENTRIES) fail('entries');
  if (![64, 128].includes(binSize)) fail('bin geometry');
  const local = Math.floor((binSize - 12) / 8);
  let bins = binCount;
  if (bins == null) { bins = 16; while (entries.size > bins * local) bins *= 2; }
  const { shift } = geometry(bins, binSize), counts = new Uint32Array(bins);
  for (const [key, value] of entries) { signed(key); signed(value); counts[bucketFor(key, shift)]++; }
  const starts = new Uint32Array(bins + 1); let overflow = 0;
  for (let i = 0; i < bins; i++) { starts[i + 1] = starts[i] + counts[i]; overflow += Math.max(0, counts[i] - local); }
  const cursors = starts.slice(), keys = new Int32Array(entries.size), values = new Int32Array(entries.size);
  for (const [key, value] of entries) { const at = cursors[bucketFor(key, shift)]++; keys[at] = key; values[at] = value; }
  const bytes = new Uint8Array(41 + bins * binSize + 8 + overflow * 8), view = new DataView(bytes.buffer);
  view.setInt32(0, -1, true); view.setUint32(4, 8, true); view.setUint32(8, binSize, true); view.setUint32(12, local, true);
  view.setBigUint64(16, BigInt(bins), true); view.setBigUint64(24, BigInt(entries.size), true); view.setBigUint64(32, BigInt(bins - 1), true);
  let overflowAt = 41 + bins * binSize; view.setBigUint64(overflowAt, BigInt(overflow), true); overflowAt += 8;
  const writeEntry = (at, index) => { view.setInt32(at, keys[index], true); view.setInt32(at + 4, values[index], true); };
  for (let bin = 0; bin < bins; bin++) {
    const at = 41 + bin * binSize; view.setUint32(at + 8, counts[bin], true);
    for (let i = 0; i < counts[bin]; i++) {
      if (i < local) writeEntry(at + 12 + i * 8, starts[bin] + i);
      else { writeEntry(overflowAt, starts[bin] + i); overflowAt += 8; }
    }
  }
  return bytes;
}

/** Read the declared inverse hash and verify its complete relationship with
 * the forward member array. Array-backed/unmaterialized hierarchies have no
 * hash payload and return null; no substitute index is fabricated.
 */
export function readModelHierarchyHash(archive, tableFile, columnName, options = {}) {
  const hierarchy = readModelIntrinsicHierarchy(archive, tableFile, columnName, options);
  if (!hierarchy.hashIndex) return null;
  const matches = archive.files.filter(f => f.path === hierarchy.hashIndex.path);
  if (matches.length !== 1 || matches[0].size > MAX_BYTES) fail('hash file');
  const entries = decodeModelHierarchyHash(matches[0].read(), options);
  if (entries.size !== hierarchy.distinctDataIds) fail('distinct identifier count');
  for (let i = 0; i < hierarchy.distinctDataIds; i++) if (entries.get(hierarchy.positionToId[i]) !== i) fail('inverse mapping mismatch');
  return entries;
}
