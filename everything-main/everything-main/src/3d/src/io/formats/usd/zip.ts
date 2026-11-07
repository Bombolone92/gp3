// Minimal ZIP writer (stored entries, 64-byte aligned data as required by USDZ) and reader
// (stored + deflate via fflate). Implemented from the PKWARE APPNOTE layout.
import { unzipSync } from 'three/examples/jsm/libs/fflate.module.js';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Write an uncompressed ZIP whose file data starts on `align`-byte boundaries (USDZ: 64). */
export function writeStoredZip(files: { name: string; data: Uint8Array }[], align = 64): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const headerLen = 30 + name.length;
    // extra field pads so that data begins aligned
    let extraLen = (align - ((offset + headerLen) % align)) % align;
    if (extraLen > 0 && extraLen < 4) extraLen += align;
    const local = new Uint8Array(headerLen + extraLen);
    const dv = new DataView(local.buffer);
    dv.setUint32(0, 0x04034b50, true);
    dv.setUint16(4, 20, true);
    dv.setUint16(6, 0, true);
    dv.setUint16(8, 0, true); // stored
    dv.setUint16(10, 0, true);
    dv.setUint16(12, 0x21, true); // 1980-01-01
    dv.setUint32(14, crc, true);
    dv.setUint32(18, f.data.length, true);
    dv.setUint32(22, f.data.length, true);
    dv.setUint16(26, name.length, true);
    dv.setUint16(28, extraLen, true);
    local.set(name, 30);
    if (extraLen) {
      // padding extra field (id 0x1986, as used by USDZ writers)
      dv.setUint16(30 + name.length, 0x1986, true);
      dv.setUint16(30 + name.length + 2, extraLen - 4, true);
    }
    const c = new Uint8Array(46 + name.length);
    const cv = new DataView(c.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0x21, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, f.data.length, true);
    cv.setUint32(24, f.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    c.set(name, 46);
    central.push(c);
    chunks.push(local, f.data);
    offset += local.length + f.data.length;
  }
  const cdStart = offset;
  let cdLen = 0;
  for (const c of central) cdLen += c.length;
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdLen, true);
  ev.setUint32(16, cdStart, true);
  const out = new Uint8Array(offset + cdLen + 22);
  let o = 0;
  for (const c of [...chunks, ...central, end]) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

/** Read a ZIP (stored or deflated) in entry order. */
export function readZip(bytes: Uint8Array): { name: string; data: Uint8Array }[] {
  const files = unzipSync(bytes);
  // preserve local-header order (the first entry of a USDZ is the root layer)
  const order: string[] = [];
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = 0;
  const td = new TextDecoder();
  while (p + 30 <= bytes.length && dv.getUint32(p, true) === 0x04034b50) {
    const flags = dv.getUint16(p + 6, true);
    const csize = dv.getUint32(p + 18, true);
    const nlen = dv.getUint16(p + 26, true),
      xlen = dv.getUint16(p + 28, true);
    order.push(td.decode(bytes.subarray(p + 30, p + 30 + nlen)));
    if (flags & 8) break; // data descriptor: sizes unknown here, fall back to fflate's order
    p += 30 + nlen + xlen + csize;
  }
  const names = Object.keys(files);
  const ordered = [...order.filter((n) => n in files), ...names.filter((n) => !order.includes(n))];
  return ordered.map((name) => ({ name, data: files[name] }));
}
