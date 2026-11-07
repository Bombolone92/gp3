import { FontFormatError, requireBytes, viewOf } from "./binary.ts";
import {
  decompressMtxStreams,
  type MtxDecompressionOptions,
} from "./mtx-lzcomp.ts";
import { reconstructMtxGlyphs } from "./mtx-glyphs.ts";
import {
  reconstructMtxCvt,
  reconstructMtxHdmx,
  reconstructMtxVdmx,
} from "./mtx-metrics.ts";
import { checkMtxSize, mtxInteger } from "./mtx-reader.ts";

function tablesOf(bytes: Uint8Array): {
  signature: number;
  tables: Map<string, Uint8Array>;
} {
  requireBytes(bytes, 0, 12, "CTF SFNT header");
  const view = viewOf(bytes),
    signature = view.getUint32(0),
    count = view.getUint16(4),
    end = 12 + count * 16;
  if (![0x00010000, 0x74727565].includes(signature))
    throw new FontFormatError("MTX requires TrueType outlines");
  if (!count || count > 4095)
    throw new FontFormatError("invalid CTF font table count");
  requireBytes(bytes, 0, end, "CTF font directory");
  const tables = new Map<string, Uint8Array>(),
    spans: Array<{ start: number; end: number }> = [];
  for (let i = 0; i < count; i++) {
    const at = 12 + i * 16,
      tag = String.fromCharCode(...bytes.subarray(at, at + 4)),
      offset = view.getUint32(at + 8),
      length = view.getUint32(at + 12);
    if (tables.has(tag))
      throw new FontFormatError(`duplicate CTF font table ${tag}`);
    if (tag === "loca" && (offset || length))
      throw new FontFormatError("CTF loca must be an empty placeholder");
    requireBytes(bytes, offset, length, `CTF font table ${tag}`);
    if (length) {
      if (offset < end || offset % 4)
        throw new FontFormatError(`invalid CTF table offset for ${tag}`);
      spans.push({ start: offset, end: offset + length });
    }
    tables.set(tag, bytes.subarray(offset, offset + length));
  }
  spans.sort((a, b) => a.start - b.start);
  for (let i = 1; i < spans.length; i++)
    if (spans[i]!.start < spans[i - 1]!.end)
      throw new FontFormatError("overlapping CTF font tables");
  return { signature, tables };
}

function table(
  tables: ReadonlyMap<string, Uint8Array>,
  tag: string,
  size: number,
): Uint8Array {
  const bytes = tables.get(tag);
  if (!bytes) throw new FontFormatError(`missing CTF font table ${tag}`);
  requireBytes(bytes, 0, size, `CTF font table ${tag}`);
  return bytes;
}

const checksum = (bytes: Uint8Array): number => {
  let sum = 0;
  for (let at = 0; at < bytes.length; at += 4)
    sum =
      (sum +
        (bytes[at]! * 16777216 +
          (bytes[at + 1] ?? 0) * 65536 +
          (bytes[at + 2] ?? 0) * 256 +
          (bytes[at + 3] ?? 0))) >>>
      0;
  return sum;
};

function sfnt(
  signature: number,
  tables: ReadonlyMap<string, Uint8Array>,
  limit: number,
): Uint8Array {
  const entries = [...tables].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  let length = 12 + entries.length * 16;
  for (const [, bytes] of entries) length += Math.ceil(bytes.length / 4) * 4;
  checkMtxSize(length, limit);
  const result = new Uint8Array(length),
    view = viewOf(result),
    power = 2 ** Math.floor(Math.log2(entries.length));
  view.setUint32(0, signature);
  view.setUint16(4, entries.length);
  view.setUint16(6, power * 16);
  view.setUint16(8, Math.log2(power));
  view.setUint16(10, entries.length * 16 - power * 16);
  let offset = 12 + entries.length * 16,
    headAt = 0;
  entries.forEach(([tag, bytes], i) => {
    const at = 12 + i * 16;
    result.set(
      Uint8Array.from(tag, (c) => c.charCodeAt(0)),
      at,
    );
    view.setUint32(at + 4, checksum(bytes));
    view.setUint32(at + 8, offset);
    view.setUint32(at + 12, bytes.length);
    result.set(bytes, offset);
    if (tag === "head") headAt = offset;
    offset += Math.ceil(bytes.length / 4) * 4;
  });
  view.setUint32(headAt + 8, (0xb1b0afba - checksum(result)) >>> 0);
  return result;
}

/** Rebuild native TrueType tables without changing the encoded MTX payload.
 * MTX 1.0 sections 4..7, https://www.w3.org/submissions/MTX/.
 * Outlines, component records, hint stack and remaining instructions survive;
 * SFNT packing, checksums and initial PUSH opcodes need not be byte-identical.
 */
export function decodeMtxFont(
  bytes: Uint8Array,
  options: MtxDecompressionOptions = {},
): Uint8Array {
  return reconstructMtxFontTables(
    ...decompressMtxStreams(bytes, options),
    options,
  );
}

/** Reconstruct independently decoded CTF streams under the same font budget. */
export function reconstructMtxFontTables(
  rest: Uint8Array,
  pushes: Uint8Array,
  instructions: Uint8Array,
  options: MtxDecompressionOptions = {},
): Uint8Array {
  const limit = mtxInteger(
      options.maxDecodedBytes ?? 64 * 1024 * 1024,
      0,
      0x7fffffff,
      "font output limit",
    ),
    { signature, tables } = tablesOf(rest),
    head = Uint8Array.from(table(tables, "head", 54)),
    maxp = Uint8Array.from(table(tables, "maxp", 32)),
    h = viewOf(head),
    m = viewOf(maxp);
  if (h.getUint32(0) !== 0x00010000 || m.getUint32(0) !== 0x00010000)
    throw new FontFormatError("unsupported CTF head/maxp version");
  const numGlyphs = m.getUint16(4),
    originalFormat = h.getInt16(50);
  if (!numGlyphs || ![0, 1].includes(originalFormat))
    throw new FontFormatError("invalid CTF glyph count/location format");
  const transformed = new Set(["glyf", "loca", "cvt ", "hdmx", "VDMX"]);
  let budget = limit - (12 + tables.size * 16);
  for (const [tag, data] of tables)
    if (!transformed.has(tag)) budget -= Math.ceil(data.length / 4) * 4;
  checkMtxSize(0, budget);
  table(tables, "loca", 0);
  const glyphs = reconstructMtxGlyphs(
      table(tables, "glyf", 0),
      pushes,
      instructions,
      numGlyphs,
      budget - Math.ceil(((numGlyphs + 1) * (originalFormat ? 4 : 2)) / 4) * 4,
    ),
    format = originalFormat === 0 && glyphs.glyf.length <= 131070 ? 0 : 1,
    loca = new Uint8Array(glyphs.offsets.length * (format ? 4 : 2)),
    l = viewOf(loca);
  glyphs.offsets.forEach((offset, i) =>
    format ? l.setUint32(i * 4, offset) : l.setUint16(i * 2, offset / 2),
  );
  h.setInt16(50, format);
  h.setUint32(8, 0);
  m.setUint16(26, Math.max(m.getUint16(26), glyphs.maxInstructions));
  tables.set("head", head);
  tables.set("maxp", maxp);
  tables.set("glyf", glyphs.glyf);
  tables.set("loca", loca);
  budget -=
    Math.ceil(glyphs.glyf.length / 4) * 4 + Math.ceil(loca.length / 4) * 4;
  checkMtxSize(0, budget);
  const replace = (tag: string, data: Uint8Array) => {
    budget -= Math.ceil(data.length / 4) * 4;
    checkMtxSize(0, budget);
    tables.set(tag, data);
  };
  if (tables.has("cvt "))
    replace("cvt ", reconstructMtxCvt(tables.get("cvt ")!, budget));
  if (tables.has("hdmx")) {
    const count = viewOf(table(tables, "hhea", 36)).getUint16(34);
    if (!count || count > numGlyphs)
      throw new FontFormatError("invalid CTF horizontal metric count");
    const metrics = viewOf(
        table(tables, "hmtx", 4 * count + 2 * (numGlyphs - count)),
      ),
      advances = new Uint16Array(numGlyphs);
    for (let i = 0; i < numGlyphs; i++)
      advances[i] = metrics.getUint16(Math.min(i, count - 1) * 4);
    replace(
      "hdmx",
      reconstructMtxHdmx(
        tables.get("hdmx")!,
        advances,
        h.getUint16(18),
        budget,
      ),
    );
  }
  if (tables.has("VDMX"))
    replace("VDMX", reconstructMtxVdmx(tables.get("VDMX")!, budget));
  return sfnt(signature, tables, limit);
}
