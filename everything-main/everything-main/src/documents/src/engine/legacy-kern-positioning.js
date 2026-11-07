// Preserve a legacy horizontal pair table through the browser's OpenType path.
// Only the single, ordered format-0 table is supported. Unknown forms retain
// their original font; no glyph, outline, hint or advance table is changed.
export function legacyKernPositioning(bytes) {
  try {
    const k = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (k.getUint16(0) || k.getUint16(2) !== 1 || k.getUint16(4) || k.getUint16(8) !== 1) return null;
    const count = k.getUint16(10), length = 14 + count * 6;
    if (!count || bytes.length !== length + 4 || k.getUint16(6) !== (length & 65535)) return null;
    const groups = []; let previous = -1;
    for (let i = 0; i < count; i++) {
      const at = 18 + i * 6, pair = k.getUint32(at), first = k.getUint16(at);
      if (pair <= previous) return null;
      previous = pair;
      if (groups.at(-1)?.first !== first) groups.push({ first, pairs: [] });
      groups.at(-1).pairs.push([k.getUint16(at + 2), k.getInt16(at + 4)]);
    }
    const chunks = []; let chunk = [], size = 14;
    for (const group of groups) {
      const added = 6 + group.pairs.length * 4;
      if (14 + added > 65535) return null;
      if (size + added > 65535) { chunks.push(chunk); chunk = []; size = 14; }
      chunk.push(group); size += added;
    }
    chunks.push(chunk);
    const subtables = chunks.map(chunk => {
      const result = new Uint8Array(14 + 6 * chunk.length + 4 * chunk.reduce((n, g) => n + g.pairs.length, 0));
      const v = new DataView(result.buffer), coverage = 10 + 2 * chunk.length;
      v.setUint16(0, 1); v.setUint16(2, coverage); v.setUint16(4, 4);
      v.setUint16(8, chunk.length); v.setUint16(coverage, 1); v.setUint16(coverage + 2, chunk.length);
      let at = coverage + 4 + 2 * chunk.length;
      chunk.forEach((group, i) => {
        v.setUint16(10 + 2 * i, at); v.setUint16(coverage + 4 + 2 * i, group.first);
        v.setUint16(at, group.pairs.length); at += 2;
        for (const [second, advance] of group.pairs) {
          v.setUint16(at, second); v.setInt16(at + 2, advance); at += 4;
        }
      });
      return result;
    });
    // DFLT script, one kern feature, one extension lookup. Extension offsets
    // keep large pair tables from overflowing OpenType's 16-bit offsets.
    const extensions = 54 + 2 * chunks.length, payload = extensions + 8 * chunks.length;
    if (payload > 65535) return null;
    const result = new Uint8Array(payload + subtables.reduce((n, b) => n + b.length, 0));
    const v = new DataView(result.buffer);
    v.setUint32(0, 0x10000); v.setUint16(4, 10); v.setUint16(6, 30); v.setUint16(8, 44);
    v.setUint16(10, 1); v.setUint32(12, 0x44464c54); v.setUint16(16, 8);
    v.setUint16(18, 4); v.setUint16(24, 65535); v.setUint16(26, 1);
    v.setUint16(30, 1); v.setUint32(32, 0x6b65726e); v.setUint16(36, 8); v.setUint16(40, 1);
    v.setUint16(44, 1); v.setUint16(46, 4);
    v.setUint16(48, 9); v.setUint16(52, chunks.length);
    let at = payload;
    subtables.forEach((data, i) => {
      const extension = extensions + i * 8;
      v.setUint16(54 + i * 2, extension - 48);
      v.setUint16(extension, 1); v.setUint16(extension + 2, 2); v.setUint32(extension + 4, at - extension);
      result.set(data, at); at += data.length;
    });
    return result;
  } catch { return null; }
}
