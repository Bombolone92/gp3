import { readFontMetadata } from './font-metadata.js';
import { normalizeFontBuffer } from './font-container.js';

// Build a private, memory-only face with the synthetic-bold advance. The
// browser still performs glyph substitution, positioning, hinting and fallback.
// Outlines, zero-advance marks and shaping tables remain unchanged.
export function syntheticAdvanceFont(buffer) {
  buffer = normalizeFontBuffer(buffer);
  const metadata = readFontMetadata(buffer);
  if (!metadata || metadata.variable || metadata.bold || metadata.weight >= 700) return null;
  try {
    const source = new DataView(buffer), tables = new Map();
    for (let i = 0; i < source.getUint16(4); i++) {
      const p = 12 + i * 16, tag = String.fromCharCode(...[0, 1, 2, 3].map(j => source.getUint8(p + j)));
      const offset = source.getUint32(p + 8), length = source.getUint32(p + 12);
      tables.set(tag, new Uint8Array(buffer.slice(offset, offset + length)));
    }
    const head = tables.get('head'), hhea = tables.get('hhea'), hmtx = tables.get('hmtx'), maxp = tables.get('maxp');
    if (!hhea || hhea.length < 36 || !hmtx || !maxp || maxp.length < 6) return null;
    const header = new DataView(hhea.buffer), metrics = new DataView(hmtx.buffer);
    const count = header.getUint16(34), glyphs = new DataView(maxp.buffer).getUint16(4);
    if (!count || count > glyphs || hmtx.length < count * 4 + (glyphs - count) * 2) return null;
    let maximum = 0;
    for (let i = 0; i < count; i++) {
      const width = metrics.getUint16(i * 4);
      if (width === 65535) return null;
      const adjusted = width ? width + 1 : 0;
      metrics.setUint16(i * 4, adjusted); maximum = Math.max(maximum, adjusted);
    }
    header.setUint16(10, maximum);
    new DataView(head.buffer).setUint32(8, 0);
    // A derived face cannot retain the original signature or cached horizontal
    // device advances. Neither is needed for browser outline-font rendering.
    tables.delete('DSIG'); tables.delete('hdmx');
    const entries = [...tables].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    const directory = 12 + entries.length * 16;
    const result = new ArrayBuffer(directory + entries.reduce((n, [, bytes]) => n + Math.ceil(bytes.length / 4) * 4, 0));
    const view = new DataView(result), bytes = new Uint8Array(result);
    view.setUint32(0, source.getUint32(0)); view.setUint16(4, entries.length);
    const selector = Math.floor(Math.log2(entries.length)), searchRange = 16 * 2 ** selector;
    view.setUint16(6, searchRange); view.setUint16(8, selector); view.setUint16(10, entries.length * 16 - searchRange);
    const checksum = (offset, length) => {
      let sum = 0;
      for (let i = 0; i < Math.ceil(length / 4) * 4; i += 4) sum = (sum + view.getUint32(offset + i)) >>> 0;
      return sum;
    };
    let offset = directory, headOffset;
    entries.forEach(([tag, data], i) => {
      const record = 12 + i * 16;
      [...tag].forEach((c, j) => view.setUint8(record + j, c.charCodeAt(0)));
      bytes.set(data, offset); view.setUint32(record + 4, checksum(offset, data.length));
      view.setUint32(record + 8, offset); view.setUint32(record + 12, data.length);
      if (tag === 'head') headOffset = offset;
      offset += Math.ceil(data.length / 4) * 4;
    });
    view.setUint32(headOffset + 8, (0xb1b0afba - checksum(0, result.byteLength)) >>> 0);
    return result;
  } catch { return null; }
}
