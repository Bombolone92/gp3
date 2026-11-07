/**
 * Minimal ZIP writer (PKWARE APPNOTE 6.3): stored or deflated entries,
 * UTF-8 names, CRC-32, local headers, central directory and end record.
 * Deflate uses CompressionStream('deflate-raw') when available and falls
 * back to storing.
 */

let CRC_TABLE = null;

export function crc32(bytes) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

async function deflateRaw(bytes) {
  if (typeof CompressionStream === 'undefined') return null;
  try {
    const cs = new CompressionStream('deflate-raw');
    const writer = cs.writable.getWriter();
    writer.write(bytes);
    writer.close();
    return new Uint8Array(await new Response(cs.readable).arrayBuffer());
  } catch {
    return null;
  }
}

function dosDateTime(d) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

/** Make names unique inside the archive ("a.png", "a-2.png"). */
function uniqueName(name, used) {
  let n = name.replace(/^\/+/, '').replace(/\\/g, '/') || 'file';
  if (!used.has(n)) return used.add(n), n;
  const dot = n.lastIndexOf('.');
  const stem = dot > 0 ? n.slice(0, dot) : n;
  const ext = dot > 0 ? n.slice(dot) : '';
  let i = 2;
  while (used.has(`${stem}-${i}${ext}`)) i++;
  n = `${stem}-${i}${ext}`;
  used.add(n);
  return n;
}

/**
 * Build a zip. entries: [{ name, data: Uint8Array | Blob | string, date? }].
 * Options: { compress: true } deflates entries that shrink (already
 * compressed formats like PNG/JPEG are stored).
 */
export async function createZip(entries, { compress = true } = {}) {
  const enc = new TextEncoder();
  const local = [];
  const central = [];
  let offset = 0;
  const used = new Set();
  for (const e of entries) {
    let data = e.data;
    if (typeof data === 'string') data = enc.encode(data);
    else if (data instanceof Blob) data = new Uint8Array(await data.arrayBuffer());
    const name = enc.encode(uniqueName(e.name, used));
    const crc = crc32(data);
    let method = 0;
    let body = data;
    if (compress && !/\.(png|jpe?g|webp|gif|zip)$/i.test(e.name) && data.length > 128) {
      const z = await deflateRaw(data);
      if (z && z.length < data.length) {
        method = 8;
        body = z;
      }
    }
    const { time, date } = dosDateTime(e.date || new Date());
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true);
    lh.setUint16(4, 20, true);
    lh.setUint16(6, 0x0800, true); // UTF-8 names
    lh.setUint16(8, method, true);
    lh.setUint16(10, time, true);
    lh.setUint16(12, date, true);
    lh.setUint32(14, crc, true);
    lh.setUint32(18, body.length, true);
    lh.setUint32(22, data.length, true);
    lh.setUint16(26, name.length, true);
    lh.setUint16(28, 0, true);
    local.push(new Uint8Array(lh.buffer), name, body);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true);
    ch.setUint16(4, 20, true);
    ch.setUint16(6, 20, true);
    ch.setUint16(8, 0x0800, true);
    ch.setUint16(10, method, true);
    ch.setUint16(12, time, true);
    ch.setUint16(14, date, true);
    ch.setUint32(16, crc, true);
    ch.setUint32(20, body.length, true);
    ch.setUint32(24, data.length, true);
    ch.setUint16(28, name.length, true);
    ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), name);
    offset += 30 + name.length + body.length;
  }
  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...local, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
}
