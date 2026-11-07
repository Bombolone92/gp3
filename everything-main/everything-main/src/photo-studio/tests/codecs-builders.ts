// Hand-rolled fixture builders for the codec tests. They follow the specs
// directly and share no code with the codecs under test.

export type RawTag = { tag: number; type: number; values: number[] | Uint8Array };
export type RawPage = { tags: RawTag[]; chunks: Uint8Array[]; tiled?: boolean };

const SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 11: 4, 12: 8, 16: 8 };

// Minimal TIFF/BigTIFF writer with a choice of byte order.
export function buildTiff(pages: RawPage[], opts: { le: boolean; big?: boolean }): Uint8Array {
  const { le, big = false } = opts;
  const bytes: number[] = [];
  const u8 = (v: number) => bytes.push(v & 0xff);
  const u16 = (v: number) => (le ? (u8(v), u8(v >> 8)) : (u8(v >> 8), u8(v)));
  const u32 = (v: number) => (le ? (u16(v & 0xffff), u16(v >>> 16)) : (u16(v >>> 16), u16(v & 0xffff)));
  const u64 = (v: number) => (le ? (u32(v % 2 ** 32), u32(Math.floor(v / 2 ** 32))) : (u32(Math.floor(v / 2 ** 32)), u32(v % 2 ** 32)));
  const off = (v: number) => (big ? u64(v) : u32(v));
  const at = (pos: number, v: number, size: number) => {
    const tmp: number[] = [];
    for (let i = 0; i < size; i++) tmp.push(Math.floor(v / 2 ** (8 * i)) & 0xff);
    if (!le) tmp.reverse();
    for (let i = 0; i < size; i++) bytes[pos + i] = tmp[i];
  };
  u8(le ? 0x49 : 0x4d);
  u8(le ? 0x49 : 0x4d);
  if (big) {
    u16(43);
    u16(8);
    u16(0);
  } else u16(42);
  let nextPtr = bytes.length;
  off(0);
  const writeVal = (type: number, v: number) => {
    if (type === 1 || type === 2 || type === 7) u8(v);
    else if (type === 3) u16(v);
    else if (type === 4) u32(v);
    else if (type === 16) u64(v);
    else if (type === 11) {
      const dv = new DataView(new ArrayBuffer(4));
      dv.setFloat32(0, v, le);
      for (let i = 0; i < 4; i++) u8(dv.getUint8(i));
    } else throw new Error('type ' + type);
  };
  for (const page of pages) {
    const offsets: number[] = [];
    for (const c of page.chunks) {
      offsets.push(bytes.length);
      for (const b of c) u8(b);
      if (bytes.length & 1) u8(0);
    }
    const tags = page.tags.filter((t) => ![273, 279, 324, 325].includes(t.tag));
    tags.push(
      { tag: page.tiled ? 324 : 273, type: big ? 16 : 4, values: offsets },
      { tag: page.tiled ? 325 : 279, type: big ? 16 : 4, values: page.chunks.map((c) => c.length) },
    );
    tags.sort((a, b) => a.tag - b.tag);
    const ifdAt = bytes.length;
    at(nextPtr, ifdAt, big ? 8 : 4);
    const entrySize = big ? 20 : 12;
    const inline = big ? 8 : 4;
    const headerSize = (big ? 8 : 2) + tags.length * entrySize + (big ? 8 : 4);
    let extra = ifdAt + headerSize;
    const deferred: RawTag[] = [];
    if (big) u64(tags.length);
    else u16(tags.length);
    for (const t of tags) {
      const count = t.values.length / (t.type === 5 ? 2 : 1);
      const size = SIZE[t.type] * count;
      u16(t.tag);
      u16(t.type);
      if (big) u64(count);
      else u32(count);
      if (size <= inline) {
        const s = bytes.length;
        for (const v of t.values) writeVal(t.type === 5 ? 4 : t.type, v);
        while (bytes.length - s < inline) u8(0);
      } else {
        off(extra);
        deferred.push(t);
        extra += size + (size & 1);
      }
    }
    nextPtr = bytes.length;
    off(0);
    for (const t of deferred) {
      for (const v of t.values) writeVal(t.type === 5 ? 4 : t.type, v);
      if (bytes.length & 1) u8(0);
    }
  }
  return new Uint8Array(bytes);
}

// PackBits (Apple TN1023) encoder used to build compressed fixtures.
export function packBits(src: Uint8Array): Uint8Array {
  const out: number[] = [];
  let i = 0;
  while (i < src.length) {
    let run = 1;
    while (i + run < src.length && run < 128 && src[i + run] === src[i]) run++;
    if (run >= 2) {
      out.push(257 - run, src[i]);
      i += run;
    } else {
      let j = i;
      while (j < src.length && j - i < 128 && !(j + 1 < src.length && src[j + 1] === src[j])) j++;
      if (j === i) j = i + 1;
      out.push(j - i - 1, ...src.subarray(i, j));
      i = j;
    }
  }
  return new Uint8Array(out);
}

// Straightforward LZW decoder (string table of arrays) used as an
// independent reference for the fast codec. TIFF: MSB-first, early change.
export function referenceLzwDecode(src: Uint8Array, variant: 'tiff' | 'gif', minCodeSize = 8): number[] {
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  let width = minCodeSize + 1;
  let table: number[][] = [];
  const reset = () => {
    table = [];
    for (let i = 0; i < clear; i++) table.push([i]);
    table.push([], []);
    width = minCodeSize + 1;
  };
  reset();
  let bitPos = 0;
  const read = () => {
    let v = 0;
    for (let k = 0; k < width; k++, bitPos++) {
      const byte = src[bitPos >> 3];
      if (byte === undefined) return -1;
      if (variant === 'tiff') v = (v << 1) | ((byte >> (7 - (bitPos & 7))) & 1);
      else v |= ((byte >> (bitPos & 7)) & 1) << k;
    }
    return v;
  };
  const out: number[] = [];
  let prev: number[] | null = null;
  for (;;) {
    const code = read();
    if (code < 0 || code === eoi) break;
    if (code === clear) {
      reset();
      prev = null;
      continue;
    }
    let entry: number[];
    if (code < table.length) entry = table[code];
    else if (code === table.length && prev) entry = [...prev, prev[0]];
    else throw new Error('bad code ' + code);
    out.push(...entry);
    if (prev && table.length < 4096) table.push([...prev, entry[0]]);
    prev = entry;
    const limit = variant === 'tiff' ? (1 << width) - 1 : 1 << width;
    if (table.length >= limit && width < 12) width++;
  }
  return out;
}

export function pseudoRandom(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

// Synthetic test image with gradients, flat areas, noise and varying alpha.
export function testImage(width: number, height: number, channels: number, depth: 8 | 16 = 8, seed = 7) {
  const rnd = pseudoRandom(seed);
  const max = depth === 8 ? 255 : 65535;
  const data = depth === 8 ? new Uint8ClampedArray(width * height * channels) : new Uint16Array(width * height * channels);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      for (let c = 0; c < channels; c++) {
        const i = (y * width + x) * channels + c;
        const region = (x * 4) / width < 1 ? 0 : (x * 4) / width < 2 ? 1 : 2;
        let v: number;
        if (region === 0) v = ((x + y * (c + 1)) / (width + height * 4)) * max;
        else if (region === 1) v = c * 0.3 * max;
        else v = rnd() * max;
        data[i] = Math.round(v);
      }
  return data;
}
