import { readFontMetadata } from './font-metadata.js';
import { normalizeFontBuffer } from './font-container.js';
import { splitOverflowingKern } from './legacy-kern-overflow.js';
import { legacyKernPositioning } from './legacy-kern-positioning.js';

export function legacyKerningAsPositioning(buffer) {
  buffer = normalizeFontBuffer(buffer);
  const metadata = readFontMetadata(buffer);
  if (!metadata || metadata.variable || !metadata.legacyKerning || metadata.glyphPositioning) return null;
  try {
    const source = new DataView(buffer);
    for (let i = 0; i < source.getUint16(4); i++) {
      const at = 12 + i * 16;
      if (source.getUint32(at) !== 0x6b65726e) continue;
      const positioning = legacyKernPositioning(new Uint8Array(buffer, source.getUint32(at + 8), source.getUint32(at + 12)));
      return positioning ? rewriteLegacyKerning(buffer, undefined, positioning) : null;
    }
  } catch { return null; }
  return null;
}

// A private OpenType face without legacy kerning. Keep glyphs, instructions,
// metrics and substitution tables unchanged; the browser still shapes fallback
// fonts with their own kerning. Never modify or serialize the original bytes.
export function withoutLegacyKerning(buffer) {
  buffer = normalizeFontBuffer(buffer);
  const metadata = readFontMetadata(buffer);
  if (!metadata || metadata.variable || !metadata.legacyKerning || metadata.glyphPositioning) return null;
  return rewriteLegacyKerning(buffer);
}

export function repairLegacyKerning(buffer) {
  buffer = normalizeFontBuffer(buffer);
  const metadata = readFontMetadata(buffer);
  if (!metadata || metadata.variable || !metadata.legacyKerning || metadata.glyphPositioning) return null;
  const source = new DataView(buffer);
  for (let i = 0; i < source.getUint16(4); i++) {
    const p = 12 + i * 16;
    if (source.getUint32(p) !== 0x6b65726e) continue;
    const repaired = splitOverflowingKern(new Uint8Array(buffer, source.getUint32(p + 8), source.getUint32(p + 12)));
    return repaired ? rewriteLegacyKerning(buffer, repaired) : null;
  }
  return null;
}

function rewriteLegacyKerning(buffer, repaired, positioning) {
  try {
    const source = new DataView(buffer), tables = [];
    for (let i = 0; i < source.getUint16(4); i++) {
      const p = 12 + i * 16, tag = String.fromCharCode(...new Uint8Array(buffer, p, 4));
      if (tag === 'DSIG' || tag === 'kern' && !repaired || tag === 'GPOS' && (repaired || positioning)) continue;
      const offset = source.getUint32(p + 8), length = source.getUint32(p + 12);
      const bytes = tag === 'kern' && repaired ? repaired : new Uint8Array(buffer.slice(offset, offset + length));
      if (tag === 'head') new DataView(bytes.buffer).setUint32(8, 0);
      if (tag === 'cmap') {
        const cmap = new DataView(bytes.buffer), records = cmap.getUint16(2);
        if (4 + records * 8 > bytes.length) return null;
        for (let r = 0; r < records; r++) {
          const record = 4 + r * 8;
          if (cmap.getUint16(record) === 1) continue;
          const start = cmap.getUint32(record + 4);
          if (start < 4 + records * 8) return null;
          const format = cmap.getUint16(start);
          // OpenType requires zero language on non-Macintosh subtables. Some
          // installed legacy faces violate that metadata rule; browsers reject
          // their bytes although local() renders them. Character maps stay intact.
          if ([0, 2, 4, 6].includes(format)) {
            const length = cmap.getUint16(start + 2);
            if (length < 6 || start + length > bytes.length) return null;
            cmap.setUint16(start + 4, 0);
          } else if ([8, 10, 12, 13].includes(format)) {
            const length = cmap.getUint32(start + 4);
            if (length < 12 || start + length > bytes.length) return null;
            cmap.setUint32(start + 8, 0);
          }
        }
      }
      tables.push([tag, bytes]);
    }
    if (positioning) tables.push(['GPOS', positioning]);
    tables.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    const directory = 12 + tables.length * 16;
    const result = new ArrayBuffer(directory + tables.reduce((n, [, bytes]) => n + Math.ceil(bytes.length / 4) * 4, 0));
    const view = new DataView(result), bytes = new Uint8Array(result);
    view.setUint32(0, source.getUint32(0)); view.setUint16(4, tables.length);
    const selector = Math.floor(Math.log2(tables.length)), range = 16 * 2 ** selector;
    view.setUint16(6, range); view.setUint16(8, selector); view.setUint16(10, tables.length * 16 - range);
    const checksum = (offset, length) => {
      let sum = 0;
      for (let i = 0; i < Math.ceil(length / 4) * 4; i += 4) sum = (sum + view.getUint32(offset + i)) >>> 0;
      return sum;
    };
    let offset = directory, head;
    tables.forEach(([tag, data], i) => {
      const record = 12 + i * 16;
      [...tag].forEach((c, j) => view.setUint8(record + j, c.charCodeAt(0)));
      bytes.set(data, offset); view.setUint32(record + 4, checksum(offset, data.length));
      view.setUint32(record + 8, offset); view.setUint32(record + 12, data.length);
      if (tag === 'head') head = offset;
      offset += Math.ceil(data.length / 4) * 4;
    });
    view.setUint32(head + 8, (0xb1b0afba - checksum(0, result.byteLength)) >>> 0);
    return result;
  } catch { return null; }
}
