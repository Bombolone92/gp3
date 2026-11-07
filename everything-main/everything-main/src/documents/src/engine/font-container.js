import {Unzlib} from 'fflate';

const decoded = new WeakMap();
const LIMIT = 32 * 1024 * 1024;
const aligned = n => Math.ceil(n / 4) * 4;
const fail = () => { throw new Error('Invalid or excessive WOFF font container.'); };

function checksum(bytes, head = false) {
  let sum = 0;
  for (let i = 0; i < bytes.length; i += 4) {
    if (head && i === 8) continue;
    sum = (sum + ((bytes[i] << 24 | bytes[i + 1] << 16 | bytes[i + 2] << 8 | bytes[i + 3]) >>> 0)) >>> 0;
  }
  return sum;
}

function inflate(bytes, length) {
  const result = new Uint8Array(length);
  let written = 0;
  // Bound expansion before retaining chunks. Small input increments also bound
  // transient inflater allocations when an untrusted declared size is false.
  const stream = new Unzlib(chunk => {
    if (written + chunk.length > length) fail();
    result.set(chunk, written); written += chunk.length;
  });
  for (let at = 0; at < bytes.length; at += 1024) stream.push(bytes.subarray(at, at + 1024), at + 1024 >= bytes.length);
  if (written !== length || bytes.length < 6) fail();
  let a = 1, b = 0;
  for (let i = 0; i < result.length; i++) { a = (a + result[i]) % 65521; b = (b + a) % 65521; }
  const trailer = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(bytes.length - 4);
  if (((b << 16 | a) >>> 0) !== trailer) fail();
  return result;
}

function unpack(view) {
  if (view.byteLength < 44 || view.byteLength > LIMIT || view.getUint32(8) !== view.byteLength || view.getUint16(14)) fail();
  const count = view.getUint16(12), total = view.getUint32(16), directory = 44 + count * 20;
  if (!count || count > 4095 || directory > view.byteLength || total > LIMIT || total % 4) fail();
  const bytes = new Uint8Array(view.buffer), tables = [];
  let previous = -1, computed = 12 + count * 16;
  for (let i = 0; i < count; i++) {
    const at = 44 + i * 20, tag = view.getUint32(at), offset = view.getUint32(at + 4);
    const compressed = view.getUint32(at + 8), length = view.getUint32(at + 12);
    if (tag <= previous || offset % 4 || offset < directory || compressed > length || offset + compressed > view.byteLength) fail();
    previous = tag; computed += aligned(length);
    if (computed > LIMIT) fail();
    tables.push({tag, offset, compressed, length, checksum: view.getUint32(at + 16), index: i});
  }
  if (computed !== total) fail();
  const padding = (start, end) => {
    if (end > view.byteLength) fail();
    for (let i = start; i < end; i++) if (bytes[i]) fail();
  };
  let cursor = directory;
  // Table directory order is by tag; font-table storage order is independent.
  const ordered = [...tables].sort((a, b) => a.offset - b.offset || a.index - b.index);
  for (const table of ordered) {
    if (table.offset !== cursor) fail();
    cursor += table.compressed;
    padding(cursor, aligned(cursor)); cursor = aligned(cursor);
  }
  const metadata = view.getUint32(24), metadataLength = view.getUint32(28), metadataOriginal = view.getUint32(32);
  const privateOffset = view.getUint32(36), privateLength = view.getUint32(40);
  if (metadata) {
    if (metadata !== cursor || !metadataLength || !metadataOriginal || metadata + metadataLength > view.byteLength) fail();
    cursor += metadataLength;
  } else if (metadataLength || metadataOriginal) fail();
  if (privateOffset) {
    padding(cursor, aligned(cursor)); cursor = aligned(cursor);
    if (privateOffset !== cursor || !privateLength || privateOffset + privateLength > view.byteLength) fail();
    cursor += privateLength;
  } else if (privateLength) fail();
  if (cursor !== view.byteLength) fail();

  const result = new ArrayBuffer(total), out = new DataView(result), target = new Uint8Array(result);
  out.setUint32(0, view.getUint32(4)); out.setUint16(4, count);
  const selector = Math.floor(Math.log2(count)), search = 16 * 2 ** selector;
  out.setUint16(6, search); out.setUint16(8, selector); out.setUint16(10, count * 16 - search);
  let offset = 12 + count * 16, head;
  for (const table of ordered) {
    const packed = bytes.subarray(table.offset, table.offset + table.compressed);
    const data = table.compressed === table.length ? packed : inflate(packed, table.length);
    if (checksum(data, table.tag === 0x68656164) !== table.checksum) fail();
    const record = 12 + table.index * 16;
    out.setUint32(record, table.tag); out.setUint32(record + 4, table.checksum);
    out.setUint32(record + 8, offset); out.setUint32(record + 12, table.length);
    target.set(data, offset);
    if (table.tag === 0x68656164) { if (table.length < 12) fail(); head = offset; }
    offset += aligned(table.length);
  }
  if (head !== undefined) {
    out.setUint32(head + 8, 0);
    out.setUint32(head + 8, (0xb1b0afba - checksum(target)) >>> 0);
  }
  return result;
}

// Font inputs are immutable session-owned buffers. SFNT inputs retain identity
// and take no decompression/cache path; WOFF 1.0 is decoded once for our readers.
// Browser faces and document/font serialization can still retain original bytes.
// Optional metadata/private blocks are framed and retained in the original input,
// but are not exposed as font tables. WOFF2 and font collections are not decoded.
export function normalizeFontBuffer(buffer) {
  try {
    const view = new DataView(buffer);
    if (view.byteLength < 4 || view.getUint32(0) !== 0x774f4646) return buffer;
    if (!decoded.has(buffer)) decoded.set(buffer, unpack(view));
    return decoded.get(buffer);
  } catch { return null; }
}
