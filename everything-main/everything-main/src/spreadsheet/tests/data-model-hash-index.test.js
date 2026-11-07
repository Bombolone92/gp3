import { it, expect } from 'vitest';
import { decodeModelHierarchyHash as decode, encodeModelHierarchyHash as encode } from '../src/core/data-model-hash-index.js';
// Independent BigInt arithmetic, including signed keys, avoids imul/shift reuse.
const bucket = (key, bins) => Number(BigInt.asUintN(32, BigInt(key) * 314160805n) * BigInt(bins) / 4294967296n);
const sorted = m => [...m].sort((a, b) => a[0] - b[0]);
function fixture(entries, binSize = 64, stats = false) {
  const bins = 16, local = Math.floor((binSize - 12) / 8), groups = Array.from({ length: bins }, () => []);
  for (const pair of entries) groups[bucket(pair[0], bins)].push(pair);
  const overflow = groups.flatMap(g => g.slice(local)), start = stats ? 109 : 41;
  const b = new Uint8Array(start + bins * binSize + 8 + overflow.length * 8), v = new DataView(b.buffer);
  v.setInt32(0, -1, true); [8, binSize, local].forEach((n, i) => v.setUint32(4 + i * 4, n, true));
  [bins, entries.length, bins - 1].forEach((n, i) => v.setBigUint64(16 + i * 8, BigInt(n), true)); b[40] = +stats;
  if (stats) {
    [entries.length, bins, groups.filter(g => g.length).length, groups.reduce((s, g) => s + Math.min(g.length, local), 0), local, Math.max(...groups.map(g => g.length)), 1].forEach((n, i) => v.setBigUint64(41 + i * 8, BigInt(n), true));
    v.setUint32(97, 8, true); // Single optional histogram element at 101.
  }
  const write = (at, pair) => pair.forEach((n, i) => v.setInt32(at + i * 4, n, true));
  groups.forEach((g, bin) => { const at = start + bin * binSize; v.setUint32(at + 8, g.length, true); g.slice(0, local).forEach((p, i) => write(at + 12 + i * 8, p)); });
  const end = start + bins * binSize; v.setBigUint64(end, BigInt(overflow.length), true); overflow.forEach((p, i) => write(end + 8 + i * 8, p));
  return b;
}
const entries = Array.from({ length: 400 }, (_, i) => [i - 200, 399 - i]);
it('reads independent compact fixtures with optional statistics and overflow in multiple bins', () => {
  for (const size of [64, 128]) for (const stats of [false, true]) expect(sorted(decode(fixture(entries, size, stats)))).toEqual(sorted(new Map(entries)));
});
it('writes the independently constructed bin and overflow layout exactly', () => {
  for (const size of [64, 128]) expect(encode(new Map(entries), { binCount: 16, binSize: size })).toEqual(fixture(entries, size));
});
it('supports empty indexes, signed extrema, byte offsets and zero trailing padding', () => {
  for (const pairs of [[], [[-2147483648, 2147483647], [2147483647, -2147483648], [0, 0]]]) {
    const bytes = fixture(pairs), wrapped = new Uint8Array(bytes.length + 9); wrapped.set(bytes, 3);
    expect(sorted(decode(wrapped.subarray(3)))).toEqual(sorted(new Map(pairs)));
    expect(sorted(decode(encode(new Map(pairs))))).toEqual(sorted(new Map(pairs)));
  }
});
it('rejects every truncated prefix including incomplete overflow', () => {
  const b = fixture(entries, 64, true);
  for (let i = 0; i < b.length; i++) expect(() => decode(b.subarray(0, i))).toThrow();
});
it('rejects unsupported policies, malformed geometry, masks, flags and excessive sizes', () => {
  for (const [at, n] of [[0, 0], [4, 16], [8, 32], [12, 5], [16, 15], [24, 1048577], [32, 7], [40, 2]]) {
    const b = fixture(entries); new DataView(b.buffer).setUint32(at, n, true); expect(() => decode(b)).toThrow();
  }
  expect(() => decode(fixture(entries), { maxEntries: 399 })).toThrow(/limit/);
  expect(() => decode(fixture([]), { maxEntries: -1 })).toThrow(/limit/);
});
it('checks pointers, local counts, bucket ownership, duplicate keys and overflow counts', () => {
  const base = fixture(entries), v = new DataView(base.buffer), first = 41 + 12;
  for (const mutate of [
    b => { b[41] = 1; },
    b => new DataView(b.buffer).setUint32(49, 401, true),
    b => new DataView(b.buffer).setInt32(first, entries.find(p => bucket(p[0], 16) !== 0)[0], true),
    b => b.set(b.slice(first, first + 8), first + 8),
    b => new DataView(b.buffer).setBigUint64(1065, 0n, true),
    b => new DataView(b.buffer).setInt32(1073, v.getInt32(first, true), true),
  ]) { const b = base.slice(); mutate(b); expect(() => decode(b)).toThrow(); }
});
it('checks statistics independently of optional histogram indexing and rejects nonzero tail bytes', () => {
  for (const at of [41, 49, 57, 65, 73, 81, 97]) {
    const b = fixture(entries, 64, true); b[at] ^= 1; expect(() => decode(b)).toThrow();
  }
  const b = fixture([]), extra = new Uint8Array(b.length + 1); extra.set(b); extra[b.length] = 1;
  expect(() => decode(extra)).toThrow(/padding/);
});
it('bounds encoder inputs and grows default geometry for larger maps', () => {
  expect(new DataView(encode(new Map(entries)).buffer).getBigUint64(16, true)).toBe(128n);
  for (const pair of [[NaN, 0], [0, Infinity], [1.1, 0], [2147483648, 0], [0, -2147483649]]) expect(() => encode(new Map([pair]))).toThrow(/entry/);
  for (const options of [{ binCount: 3 }, { binCount: 32.5 }, { binCount: 2097152 }, { binSize: 256 }]) expect(() => encode(new Map(), options)).toThrow(/geometry/);
});
