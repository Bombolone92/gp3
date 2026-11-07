// Minimal store-only (uncompressed) ZIP writer for image sequences.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array, crc = 0): number {
  let c = (crc ^ 0xffffffff) >>> 0;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

interface Entry {
  name: Uint8Array;
  crc: number;
  size: number;
  offset: number;
  time: number;
  date: number;
}

function dosDateTime(d: Date) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

export class ZipWriter {
  private parts: Uint8Array[] = [];
  private entries: Entry[] = [];
  private offset = 0;

  add(name: string, data: Uint8Array, when = new Date()) {
    const nameBytes = new TextEncoder().encode(name);
    const { time, date } = dosDateTime(when);
    const crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true);
    h.setUint16(4, 20, true); // version needed
    h.setUint16(6, 0x0800, true); // UTF-8 names
    h.setUint16(8, 0, true); // stored
    h.setUint16(10, time, true);
    h.setUint16(12, date, true);
    h.setUint32(14, crc, true);
    h.setUint32(18, data.length, true);
    h.setUint32(22, data.length, true);
    h.setUint16(26, nameBytes.length, true);
    h.setUint16(28, 0, true);
    this.entries.push({ name: nameBytes, crc, size: data.length, offset: this.offset, time, date });
    this.push(new Uint8Array(h.buffer), nameBytes, data);
  }

  private push(...parts: Uint8Array[]) {
    for (const p of parts) {
      this.parts.push(p);
      this.offset += p.length;
    }
  }

  /** Finish the archive and return its bytes as parts (suitable for `new Blob(parts)`). */
  finish(): Uint8Array[] {
    const start = this.offset;
    for (const e of this.entries) {
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true);
      c.setUint16(4, 20, true); // version made by
      c.setUint16(6, 20, true);
      c.setUint16(8, 0x0800, true);
      c.setUint16(10, 0, true);
      c.setUint16(12, e.time, true);
      c.setUint16(14, e.date, true);
      c.setUint32(16, e.crc, true);
      c.setUint32(20, e.size, true);
      c.setUint32(24, e.size, true);
      c.setUint16(28, e.name.length, true);
      c.setUint16(30, 0, true);
      c.setUint16(32, 0, true);
      c.setUint16(34, 0, true);
      c.setUint16(36, 0, true);
      c.setUint32(38, 0, true);
      c.setUint32(42, e.offset, true);
      this.push(new Uint8Array(c.buffer), e.name);
    }
    const size = this.offset - start;
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, this.entries.length, true);
    end.setUint16(10, this.entries.length, true);
    end.setUint32(12, size, true);
    end.setUint32(16, start, true);
    this.push(new Uint8Array(end.buffer));
    return this.parts;
  }

  get count() {
    return this.entries.length;
  }
}

/** Concatenate parts into one array (tests / small archives). */
export function concatBytes(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
