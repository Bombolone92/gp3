// Store-only ZIP archives for Office Open XML exports. Entries are written
// uncompressed with a fixed timestamp so identical input gives identical bytes.
const encoder = new TextEncoder();
// Escapes markup and drops characters XML 1.0 forbids (controls, lone
// surrogates, U+FFFE/U+FFFF), which would make SVG and Office files invalid.
export const xml = (value) =>
  String(value ?? "")
    .replace(
      /[\0-\x08\x0b\x0c\x0e-\x1f￾￿]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g,
      "",
    )
    .replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&apos;",
        })[c],
    );
let table;
export function crc32(bytes) {
  if (!table) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let n = 0; n < bytes.length; n++)
    crc = table[(crc ^ bytes[n]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
// 1980-01-01 00:00, the earliest DOS date, keeps archives reproducible.
const DOS_TIME = 0,
  DOS_DATE = (0 << 9) | (1 << 5) | 1;
export function createZip(entries) {
  const files = entries.map(({ name, data }) => {
    const bytes = typeof data === "string" ? encoder.encode(data) : data;
    return { name: encoder.encode(name), bytes, crc: crc32(bytes) };
  });
  const size =
    files.reduce((sum, f) => sum + 76 + f.name.length * 2 + f.bytes.length, 0) +
    22;
  if (files.length > 0xffff || size > 0xffffffff)
    throw Error("This export is too large. Export fewer frames at a time.");
  const out = new Uint8Array(size),
    view = new DataView(out.buffer);
  let at = 0;
  const u16 = (n) => {
      view.setUint16(at, n, true);
      at += 2;
    },
    u32 = (n) => {
      view.setUint32(at, n, true);
      at += 4;
    },
    put = (bytes) => {
      out.set(bytes, at);
      at += bytes.length;
    };
  // Bit 11 marks UTF-8 names; method 0 stores data without compression.
  const header = (f) => {
    u16(20);
    u16(0x0800);
    u16(0);
    u16(DOS_TIME);
    u16(DOS_DATE);
    u32(f.crc);
    u32(f.bytes.length);
    u32(f.bytes.length);
    u16(f.name.length);
    u16(0);
  };
  for (const f of files) {
    f.offset = at;
    u32(0x04034b50);
    header(f);
    put(f.name);
    put(f.bytes);
  }
  const directory = at;
  for (const f of files) {
    u32(0x02014b50);
    u16(20);
    header(f);
    u16(0);
    u16(0);
    u16(0);
    u32(0);
    u32(f.offset);
    put(f.name);
  }
  const length = at - directory;
  u32(0x06054b50);
  u16(0);
  u16(0);
  u16(files.length);
  u16(files.length);
  u32(length);
  u32(directory);
  u16(0);
  return out;
}
