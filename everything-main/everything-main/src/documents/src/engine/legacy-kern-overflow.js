// Recover only the unambiguous Windows format-0 length overflow. The source
// must contain one sorted horizontal table whose pair count exactly accounts
// for every byte; unknown versions/coverage and damaged lengths are untouched.
export function splitOverflowingKern(bytes) {
  try {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (v.getUint16(0) || v.getUint16(2) !== 1 || v.getUint16(4) || v.getUint16(8) !== 1) return null;
    const count = v.getUint16(10), length = 14 + count * 6;
    if (length <= 65535 || length + 4 !== bytes.length || v.getUint16(6) !== (length & 65535)) return null;
    let previous = -1;
    for (let i = 0; i < count; i++) {
      const pair = v.getUint32(18 + i * 6);
      if (pair <= previous) return null;
      previous = pair;
    }
    const capacity = Math.floor((65535 - 14) / 6), tables = Math.ceil(count / capacity);
    const result = new Uint8Array(4 + tables * 14 + count * 6), out = new DataView(result.buffer);
    out.setUint16(2, tables);
    let offset = 4;
    for (let start = 0; start < count; start += capacity) {
      const pairs = Math.min(capacity, count - start), size = 14 + pairs * 6;
      const selector = Math.floor(Math.log2(pairs)), search = 2 ** selector * 6;
      out.setUint16(offset + 2, size); out.setUint16(offset + 4, 1);
      out.setUint16(offset + 6, pairs); out.setUint16(offset + 8, search);
      out.setUint16(offset + 10, selector); out.setUint16(offset + 12, pairs * 6 - search);
      result.set(bytes.subarray(18 + start * 6, 18 + (start + pairs) * 6), offset + 14);
      offset += size;
    }
    return result;
  } catch { return null; }
}
