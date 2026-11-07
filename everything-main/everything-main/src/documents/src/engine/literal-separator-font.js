// Canvas prepares U+2028 as a space before shaping. A private mapping lets the
// same browser shaper use the selected font's actual glyph. U+FFFF cannot occur
// in XML 1.0 document text. This adapter does not alter document/font files.
import { normalizeFontBuffer } from './font-container.js';
export const LITERAL_SEPARATOR_ALIAS = '\uffff';

export function literalSeparatorFont(buffer) {
  try {
    buffer = normalizeFontBuffer(buffer);
    const source = new DataView(buffer), tables = new Map();
    if (source.getUint32(0) !== 0x00010000 && source.getUint32(0) !== 0x4f54544f) return null;
    const count = source.getUint16(4);
    if (!count || 12 + count * 16 > buffer.byteLength) return null;
    for (let i = 0; i < count; i++) {
      const at = 12 + i * 16, tag = String.fromCharCode(...new Uint8Array(buffer, at, 4));
      const offset = source.getUint32(at + 8), length = source.getUint32(at + 12);
      if (tables.has(tag) || offset + length > buffer.byteLength) return null;
      tables.set(tag, new Uint8Array(buffer.slice(offset, offset + length)));
    }
    // Variable font/style matching needs separate native controls.
    if (tables.has('fvar') || !tables.has('cmap') || !tables.has('head') || tables.get('head').length < 12) return null;
    const cmap = new DataView(tables.get('cmap').buffer), records = cmap.getUint16(2);
    if (4 + records * 8 > cmap.byteLength) return null;
    const entries = Array.from({ length: records }, (_, i) => {
      const at = 4 + i * 8;
      return { platform: cmap.getUint16(at), encoding: cmap.getUint16(at + 2), offset: cmap.getUint32(at + 4) };
    });
    const chosen = entries.find(e => e.platform === 3 && e.encoding === 10) || entries.find(e => e.platform === 3 && e.encoding === 1);
    if (!chosen || chosen.offset < 4 + records * 8) return null;
    const start = chosen.offset, format = cmap.getUint16(start), groups = [];
    if (format === 12) {
      const length = cmap.getUint32(start + 4), n = cmap.getUint32(start + 12);
      if (n > 100000 || length < 16 + n * 12 || start + length > cmap.byteLength) return null;
      for (let i = 0; i < n; i++) {
        const at = start + 16 + i * 12;
        const first = cmap.getUint32(at), last = cmap.getUint32(at + 4), glyph = cmap.getUint32(at + 8);
        if (first > last || last > 0x10ffff || groups.length && first <= groups.at(-1)[1]) return null;
        groups.push([first, last, glyph]);
      }
    } else if (format === 4) {
      const length = cmap.getUint16(start + 2), segments = cmap.getUint16(start + 6) / 2;
      if (!Number.isInteger(segments) || !segments || length < 16 + segments * 8 || start + length > cmap.byteLength) return null;
      let previous = -1;
      for (let i = 0; i < segments; i++) {
        const last = cmap.getUint16(start + 14 + i * 2), first = cmap.getUint16(start + 16 + segments * 2 + i * 2);
        const delta = cmap.getInt16(start + 16 + segments * 4 + i * 2), rangeAt = start + 16 + segments * 6 + i * 2;
        const range = cmap.getUint16(rangeAt);
        if (first > last || first <= previous) return null;
        previous = last;
        for (let cp = first; cp <= last; cp++) {
          const at = rangeAt + range + (cp - first) * 2;
          if (range && at + 2 > start + length) return null;
          let glyph = range ? cmap.getUint16(at) : cp;
          glyph = range && !glyph ? 0 : (glyph + delta) & 65535;
          if (!glyph) continue;
          const prior = groups.at(-1);
          if (prior && prior[1] + 1 === cp && prior[2] + cp - prior[0] === glyph) prior[1] = cp;
          else groups.push([cp, cp, glyph]);
        }
      }
    } else return null;
    const glyphAt = cp => { const g = groups.find(([first, last]) => first <= cp && cp <= last); return g ? g[2] + cp - g[0] : 0; };
    const glyph = glyphAt(0x2028);
    if (!glyph || glyphAt(0xffff)) return null;
    // A format-12 map may explicitly map the alias to glyph zero. Remove that
    // empty mapping without introducing overlapping groups.
    const emptyAlias = groups.findIndex(([first, last]) => first <= 0xffff && last >= 0xffff);
    if (emptyAlias >= 0) {
      const [first, last, initial] = groups[emptyAlias], replacements = [];
      if (first < 0xffff) replacements.push([first, 0xfffe, initial]);
      if (last > 0xffff) replacements.push([0x10000, last, initial + 0x10000 - first]);
      groups.splice(emptyAlias, 1, ...replacements);
    }
    groups.push([0xffff, 0xffff, glyph]); groups.sort((a, b) => a[0] - b[0]);
    // Keep legacy/variation subtables intact. Add the full-repertoire Unicode
    // mapping rather than rewriting outlines, metrics, hints or shaping tables.
    const kept = entries.filter(e => !(e.platform === 3 && e.encoding === 10 || e.platform === 0 && e.encoding === 4));
    const header = 4 + (kept.length + 2) * 8, oldLength = cmap.byteLength;
    const resultCmap = new Uint8Array(header + oldLength + 16 + groups.length * 12), cv = new DataView(resultCmap.buffer);
    cv.setUint16(2, kept.length + 2); resultCmap.set(new Uint8Array(cmap.buffer), header);
    [...kept, { platform: 0, encoding: 4, offset: oldLength }, { platform: 3, encoding: 10, offset: oldLength }].forEach((e, i) => {
      const at = 4 + i * 8; cv.setUint16(at, e.platform); cv.setUint16(at + 2, e.encoding); cv.setUint32(at + 4, header + e.offset);
    });
    const subtable = header + oldLength;
    cv.setUint16(subtable, 12); cv.setUint32(subtable + 4, 16 + groups.length * 12); cv.setUint32(subtable + 12, groups.length);
    groups.forEach((g, i) => g.forEach((v, j) => cv.setUint32(subtable + 16 + i * 12 + j * 4, v)));
    tables.set('cmap', resultCmap); tables.delete('DSIG');
    new DataView(tables.get('head').buffer).setUint32(8, 0);
    const sorted = [...tables].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    let offset = 12 + sorted.length * 16, headOffset;
    const result = new ArrayBuffer(offset + sorted.reduce((n, [, b]) => n + Math.ceil(b.length / 4) * 4, 0));
    const view = new DataView(result), bytes = new Uint8Array(result), power = Math.floor(Math.log2(sorted.length));
    view.setUint32(0, source.getUint32(0)); view.setUint16(4, sorted.length); view.setUint16(6, 16 * 2 ** power);
    view.setUint16(8, power); view.setUint16(10, sorted.length * 16 - 16 * 2 ** power);
    const checksum = (at, length) => { let value = 0; for (let i = 0; i < Math.ceil(length / 4) * 4; i += 4) value = (value + view.getUint32(at + i)) >>> 0; return value; };
    sorted.forEach(([tag, data], i) => {
      const at = 12 + i * 16; [...tag].forEach((c, j) => view.setUint8(at + j, c.charCodeAt(0)));
      bytes.set(data, offset); view.setUint32(at + 4, checksum(offset, data.length)); view.setUint32(at + 8, offset); view.setUint32(at + 12, data.length);
      if (tag === 'head') headOffset = offset;
      offset += Math.ceil(data.length / 4) * 4;
    });
    view.setUint32(headOffset + 8, (0xb1b0afba - checksum(0, result.byteLength)) >>> 0);
    return result;
  } catch { return null; }
}
