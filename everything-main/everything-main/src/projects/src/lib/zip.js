/**
 * Minimal ZIP writer and reader, so a backup can be one file that holds the
 * JSON *and* the attachment blobs — and can still be opened by any unzip
 * tool. Entries are written "stored" (no compression): attachments are
 * usually already-compressed media, and this keeps the writer tiny.
 *
 * Reading accepts stored entries and, where the platform provides
 * DecompressionStream, deflated ones too — so a backup someone re-zipped
 * with a normal tool still imports.
 */

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
const UTF8_FLAG = 0x0800;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** DOS date/time pair used by the format (2-second resolution, 1980 epoch). */
function dosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const day = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, date: day };
}

/**
 * zipFiles([{ name, blob }]) → Blob
 * Names use forward slashes and must stay inside the archive (no "..").
 */
export async function zipFiles(entries, { date = new Date() } = {}) {
  const encoder = new TextEncoder();
  const { time, date: dosDate } = dosDateTime(date);
  const parts = [];
  const central = [];
  let offset = 0;

  for (const entry of entries) {
    const name = normalizeName(entry.name);
    const nameBytes = encoder.encode(name);
    const bytes = new Uint8Array(await toArrayBuffer(entry.blob));
    const crc = crc32(bytes);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, LOCAL_SIG, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, UTF8_FLAG, true);
    local.setUint16(8, 0, true);            // stored
    local.setUint16(10, time, true);
    local.setUint16(12, dosDate, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, bytes.length, true);
    local.setUint32(22, bytes.length, true);
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true);
    parts.push(new Uint8Array(local.buffer), nameBytes, bytes);

    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, CENTRAL_SIG, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(8, UTF8_FLAG, true);
    cd.setUint16(10, 0, true);
    cd.setUint16(12, time, true);
    cd.setUint16(14, dosDate, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, bytes.length, true);
    cd.setUint32(24, bytes.length, true);
    cd.setUint16(28, nameBytes.length, true);
    cd.setUint16(30, 0, true);
    cd.setUint16(32, 0, true);
    cd.setUint16(34, 0, true);
    cd.setUint16(36, 0, true);
    cd.setUint32(38, 0, true);
    cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), nameBytes);

    offset += 30 + nameBytes.length + bytes.length;
  }

  const centralSize = central.reduce((n, part) => n + part.length, 0);
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, EOCD_SIG, true);
  eocd.setUint16(4, 0, true);
  eocd.setUint16(6, 0, true);
  eocd.setUint16(8, entries.length, true);
  eocd.setUint16(10, entries.length, true);
  eocd.setUint32(12, centralSize, true);
  eocd.setUint32(16, offset, true);
  eocd.setUint16(20, 0, true);

  return new Blob([...parts, ...central, new Uint8Array(eocd.buffer)], { type: 'application/zip' });
}

/** unzip(blob) → [{ name, blob }] */
export async function unzip(blob) {
  const buffer = await toArrayBuffer(blob);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  const eocd = findEOCD(view);
  if (eocd < 0) throw new Error('Not a ZIP file');
  const count = view.getUint16(eocd + 10, true);
  let pointer = view.getUint32(eocd + 16, true);

  const decoder = new TextDecoder();
  const out = [];
  for (let i = 0; i < count; i++) {
    if (view.getUint32(pointer, true) !== CENTRAL_SIG) throw new Error('Damaged ZIP directory');
    const method = view.getUint16(pointer + 10, true);
    const compressedSize = view.getUint32(pointer + 20, true);
    const nameLen = view.getUint16(pointer + 28, true);
    const extraLen = view.getUint16(pointer + 30, true);
    const commentLen = view.getUint16(pointer + 32, true);
    const localOffset = view.getUint32(pointer + 42, true);
    const name = decoder.decode(bytes.subarray(pointer + 46, pointer + 46 + nameLen));
    pointer += 46 + nameLen + extraLen + commentLen;

    if (view.getUint32(localOffset, true) !== LOCAL_SIG) throw new Error('Damaged ZIP entry');
    const localNameLen = view.getUint16(localOffset + 26, true);
    const localExtraLen = view.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + localNameLen + localExtraLen;
    const raw = bytes.subarray(start, start + compressedSize);

    // Directory entries carry no data and are not files.
    if (name.endsWith('/')) continue;
    out.push({ name, blob: new Blob([method === 0 ? raw : await inflate(raw)]) });
  }
  return out;
}

async function inflate(raw) {
  if (typeof DecompressionStream !== 'function') {
    throw new Error('This ZIP is compressed and this browser cannot expand it');
  }
  const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(stream).arrayBuffer();
}

function findEOCD(view) {
  // The end record is last, but a trailing comment can push it back a bit.
  const min = Math.max(0, view.byteLength - 22 - 0xffff);
  for (let i = view.byteLength - 22; i >= min; i--) {
    if (view.getUint32(i, true) === EOCD_SIG) return i;
  }
  return -1;
}

function normalizeName(name) {
  const clean = String(name).replace(/\\/g, '/').replace(/^\/+/, '');
  if (clean.split('/').includes('..')) throw new Error(`Unsafe entry name: ${name}`);
  return clean;
}

function toArrayBuffer(blob) {
  if (blob instanceof ArrayBuffer) return Promise.resolve(blob);
  if (blob?.arrayBuffer) return blob.arrayBuffer();
  return new Response(blob).arrayBuffer();
}
