import { normalizeFontBuffer } from './font-container.js';
import {readScriptPositionMetrics} from './font-script-metrics.js';

// Read OpenType face, width and kerning metadata. Never infer capabilities
// from family names or PANOSE weight guesses.
function emptyPositioning(view, table) {
  try {
    const v = new DataView(view.buffer, view.byteOffset + table.offset, table.length);
    const version = v.getUint32(0), header = version === 0x10000 ? 10 : version === 0x10001 ? 14 : 0;
    if (!header || v.byteLength < header || header === 14 && v.getUint32(10)) return false;
    const [scripts, features, lookups] = [4, 6, 8].map(at => v.getUint16(at));
    if ([scripts, features, lookups].some(at => at < header || at + 2 > v.byteLength) || v.getUint16(features) || v.getUint16(lookups)) return false;
    const count = v.getUint16(scripts), end = scripts + 2 + count * 6;
    if (end > v.byteLength) return false;
    for (let i = 0; i < count; i++) {
      const script = scripts + v.getUint16(scripts + 6 + i * 6);
      if (script < end || script + 4 > v.byteLength) return false;
      const n = v.getUint16(script + 2), languageEnd = script + 4 + n * 6;
      if (languageEnd > v.byteLength) return false;
      const offsets = Array.from({ length: n }, (_, j) => v.getUint16(script + 8 + j * 6));
      if (v.getUint16(script)) offsets.push(v.getUint16(script));
      for (const offset of offsets) {
        const at = script + offset;
        if (at < languageEnd || at + 6 > v.byteLength || v.getUint16(at) || v.getUint16(at + 2) !== 65535 || v.getUint16(at + 4)) return false;
      }
    }
    return true;
  } catch { return false; }
}

// MVAR tags absent from the record array are constant across variation space.
// Script sizing reads these four fields; other varying metrics are irrelevant.
function invariantScriptSize(view, table,position=false) {
  if (!table) return true;
  try {
    const v = new DataView(view.buffer, view.byteOffset + table.offset, table.length);
    if (v.byteLength < 12 || v.getUint32(0) !== 0x10000 || v.getUint16(4)) return false;
    const size = v.getUint16(6), count = v.getUint16(8), store = v.getUint16(10);
    const end = 12 + size * count;
    if (!size || (count && size < 8) || end > v.byteLength || (count ? store < end || store + 8 > v.byteLength : store !== 0)) return false;
    let previous = -1;
    for (let i = 0; i < count; i++) {
      const tag = v.getUint32(12 + i * size);
      if (tag <= previous || [0x73627973, 0x7362796f, 0x73707973, 0x7370796f].includes(tag)||
          position&&[0x68617363,0x68647363,0x686c6770,0x68636c61,0x68636c64].includes(tag)) return false;
      previous = tag;
    }
    return true;
  } catch { return false; }
}

export function readFontMetadata(buffer) {
  try {
    buffer = normalizeFontBuffer(buffer);
    const v = new DataView(buffer);
    if (v.byteLength < 12 || ![0x00010000, 0x4f54544f, 0x74727565].includes(v.getUint32(0))) return null;
    const count = v.getUint16(4), tables = new Map();
    if (12 + count * 16 > v.byteLength) return null;
    for (let i = 0; i < count; i++) {
      const p = 12 + i * 16, tag = String.fromCharCode(...[0, 1, 2, 3].map(j => v.getUint8(p + j)));
      const offset = v.getUint32(p + 8), length = v.getUint32(p + 12);
      if (offset < 12 + count * 16 || offset + length > v.byteLength || tables.has(tag)) return null;
      tables.set(tag, { offset, length });
    }
    const head = tables.get('head'), os2 = tables.get('OS/2');
    if (!head || head.length < 54 || !os2 || os2.length < 64 || v.getUint32(head.offset + 12) !== 0x5f0f3cf5) return null;
    const unitsPerEm = v.getUint16(head.offset + 18), weight = v.getUint16(os2.offset + 4), selection = v.getUint16(os2.offset + 62);
    if (unitsPerEm < 16 || unitsPerEm > 16384 || weight < 1 || weight > 1000) return null;
    const gpos = tables.get('GPOS');
    // A valid empty GPOS table does not provide glyph positioning. Some static
    // fonts retain an empty script/language scaffold alongside legacy pairs.
    // Unknown or malformed tables remain conservative: do not infer legacy-only.
    const glyphPositioning = !!gpos && !emptyPositioning(v, gpos);
    const scriptMetrics = Array.from({ length: 8 }, (_, i) => v.getInt16(os2.offset + 10 + i * 2));
    const scriptPositionMetrics=readScriptPositionMetrics(v,tables);
    return { unitsPerEm, weight, widthClass: v.getUint16(os2.offset + 6), bold: !!(selection & 32), italic: !!(selection & 1), variable: tables.has('fvar'), legacyKerning: tables.has('kern'), glyphPositioning,
      ...(scriptMetrics.some(value => value !== 0) ? { scriptMetrics } : {}),
      ...(scriptPositionMetrics?{scriptPositionMetrics}:{}),
      ...(tables.has('fvar') ? { scriptSizeInvariant: invariantScriptSize(v, tables.get('MVAR')),
        scriptPositionInvariant:invariantScriptSize(v,tables.get('MVAR'),true) } : {}) };
  } catch { return null; }
}
