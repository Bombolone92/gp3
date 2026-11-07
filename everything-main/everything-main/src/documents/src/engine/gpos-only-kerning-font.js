import { readFontMetadata } from './font-metadata.js';
import { normalizeFontBuffer } from './font-container.js';

// The legacy text path cannot use GPOS-only kerning. Disable that feature
// in a private face, retaining the browser's other shaping and fallback fonts.
export function withoutGposOnlyKerning(buffer) {
  buffer = normalizeFontBuffer(buffer);
  const metadata = readFontMetadata(buffer);
  if (!metadata || metadata.variable || metadata.legacyKerning || !metadata.glyphPositioning) return null;
  try {
    const source = new DataView(buffer), tables = new Map();
    for (let i = 0; i < source.getUint16(4); i++) {
      const p = 12 + i * 16, tag = String.fromCharCode(...[0, 1, 2, 3].map(j => source.getUint8(p + j)));
      const offset = source.getUint32(p + 8), length = source.getUint32(p + 12);
      tables.set(tag, new Uint8Array(buffer.slice(offset, offset + length)));
    }
    const head = tables.get('head'), gpos = tables.get('GPOS');
    if (!gpos) return null;
    const positioning = new DataView(gpos.buffer);
    const version = positioning.getUint32(0), header = version === 0x10000 ? 10 : version === 0x10001 ? 14 : 0;
    if (!header || gpos.length < header || header === 14 && positioning.getUint32(10)) return null;
    const features = positioning.getUint16(6), lookups = positioning.getUint16(8);
    if (features < header || features + 2 > gpos.length || lookups < header || lookups + 2 > gpos.length) return null;
    const count = positioning.getUint16(features), lookupCount = positioning.getUint16(lookups), end = features + 2 + count * 6;
    if (end > gpos.length || lookups + 2 + lookupCount * 2 > gpos.length) return null;
    const targets = [], other = new Set();
    for (let i = 0; i < count; i++) {
      const at = features + 2 + i * 6, target = features + positioning.getUint16(at + 4);
      if (target < end || target + 4 > gpos.length) return null;
      const n = positioning.getUint16(target + 2);
      if (target + 4 + n * 2 > gpos.length) return null;
      for (let j = 0; j < n; j++) if (positioning.getUint16(target + 4 + j * 2) >= lookupCount) return null;
      if (positioning.getUint32(at) === 0x6b65726e) {
        if (positioning.getUint16(target)) return null;
        if (n) targets.push(target);
      } else other.add(target);
    }
    if (!targets.length || targets.some(target => other.has(target))) return null;
    // Empty only the optional kern feature. Mark, cursive, language and script
    // positioning and all lookup bodies remain intact, including shared lookups.
    targets.forEach(target => positioning.setUint16(target + 2, 0));
    new DataView(head.buffer).setUint32(8, 0);
    // A derived face cannot retain the original digital signature.
    tables.delete('DSIG');
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
