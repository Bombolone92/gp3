import { expect, it } from 'vitest';
import { decompressXpress, decompressXpressChunks } from '../src/core/xpress.js';

const bytes = (...values) => new Uint8Array(values.flat());
const text = value => new TextEncoder().encode(value);
const le32 = n => [n & 255, n >>> 8 & 255, n >>> 16 & 255, n >>> 24];
const chunk = (original, payload) => bytes(original & 255, original >>> 8, payload.length & 255, payload.length >>> 8, [...payload]);
it('decodes literal and overlapping back-reference vectors', () => {
  expect(decompressXpress(bytes(255, 255, 255, 31, 97, 98, 99), 3)).toEqual(text('abc'));
  expect(decompressXpress(bytes(255, 255, 255, 31, 97, 98, 99, 19, 0), 9)).toEqual(text('abcabcabc'));
  expect(decompressXpress(bytes(255, 255, 255, 127, 97, 7, 0, 0x10, 7, 0), 22)).toEqual(text('a'.repeat(22)));
});
it.each([
  [25, [15, 0]], [279, [15, 254]], [280, [15, 255, 21, 1]],
  [65535, [15, 255, 0, 0, ...le32(65532)]],
])('decodes an extended match of %i bytes', (length, extension) => {
  expect(decompressXpress(bytes(255, 255, 255, 127, 120, 7, 0, extension), length + 1)).toEqual(text('x'.repeat(length + 1)));
});
it('reloads flags at the 32-token boundary and supports sliced input', () => {
  const raw = bytes(0, 0, 0, 0, [...text('abcdefghijklmnopqrstuvwxyz012345')], 255, 255, 255, 255);
  const padded = bytes(99, [...raw], 88);
  expect(decompressXpress(padded.subarray(1, -1), 32)).toEqual(text('abcdefghijklmnopqrstuvwxyz012345'));
  expect(decompressXpress(bytes(255, 255, 255, 255), 0)).toEqual(bytes());
});
it('retains the pending length nibble across flag-word boundaries', () => {
  const raw = bytes(0, 0, 0, 64, 97, 7, 0, 0x20, Array(30).fill(98), 255, 255, 255, 255, 7, 0);
  expect(decompressXpress(raw, 53)).toEqual(text('a'.repeat(11) + 'b'.repeat(42)));
});
it('supports the maximum 13-bit match distance', () => {
  const literals = Uint8Array.from({ length: 8192 }, (_, i) => i % 251), raw = [];
  for (let i = 0; i < literals.length; i += 32) raw.push(0, 0, 0, 0, ...literals.subarray(i, i + 32));
  raw.push(255, 255, 255, 255, 248, 255);
  expect(decompressXpress(new Uint8Array(raw), 8195)).toEqual(bytes([...literals], [0, 1, 2]));
});
it('rejects truncated streams, missing termination and incorrect output sizes', () => {
  const raw = bytes(255, 255, 255, 127, 120, 7, 0, 15, 255, 21, 1);
  for (let end = 0; end < raw.length; end++) expect(() => decompressXpress(raw.subarray(0, end), 281)).toThrow(/Invalid XPRESS/);
  expect(() => decompressXpress(raw, 280)).toThrow(/exceeds output/);
  expect(() => decompressXpress(raw, 282)).toThrow(/size mismatch/);
  expect(() => decompressXpress(bytes(0, 0, 0, 0, 1), 1)).toThrow(/exceeds output/);
});
it('rejects impossible back-references and invalid long lengths', () => {
  expect(() => decompressXpress(bytes(255, 255, 255, 255, 0, 0), 3)).toThrow(/precedes output/);
  expect(() => decompressXpress(bytes(255, 255, 255, 127, 120, 7, 0, 15, 255, 1, 0), 10)).toThrow(/extended match/);
  expect(() => decompressXpress(bytes(255, 255, 255, 127, 120, 7, 0, 15, 255, 0, 0, 255, 255, 255, 255), 100)).toThrow(/exceeds output/);
});
it('validates sizes before allocating output', () => {
  for (const length of [-1, .5, NaN, Infinity, 65537, Number.MAX_SAFE_INTEGER]) expect(() => decompressXpress(bytes(), length)).toThrow(/output size/);
  expect(() => decompressXpress([], 0)).toThrow(TypeError);
  expect(() => decompressXpressChunks(bytes(), 2 ** 32)).toThrow(/output size/);
  expect(() => decompressXpressChunks(bytes(), 0, Infinity)).toThrow(/output size/);
});
it('decodes independent stored and compressed chunks into one bounded output', () => {
  const compressed = bytes(255, 255, 255, 127, 120, 7, 0, 15, 0);
  const input = bytes([...chunk(3, text('abc'))], [...chunk(26, compressed)], [...chunk(3, text('def'))]);
  expect(decompressXpressChunks(input, 32)).toEqual(text('abc' + 'x'.repeat(26) + 'def'));
  expect(() => decompressXpressChunks(input, 32, 31)).toThrow(/output size/);
  expect(decompressXpressChunks(bytes(), 0)).toEqual(bytes());
});
it('rejects malformed framing, invalid chunk lengths and cross-chunk references', () => {
  for (const input of [bytes(1), bytes(1, 0, 1, 0), bytes(0, 0, 0, 0), bytes(1, 0, 2, 0, 1, 2)]) {
    expect(() => decompressXpressChunks(input, 1)).toThrow(/Invalid XPRESS/);
  }
  expect(() => decompressXpressChunks(chunk(1, bytes(65)), 2)).toThrow(/size mismatch/);
  expect(() => decompressXpressChunks(chunk(1, bytes(65)), 0)).toThrow(/exceeds size/);
  const badMatch = bytes(255, 255, 255, 255, 7, 0, 0);
  expect(() => decompressXpressChunks(bytes([...chunk(1, bytes(65))], [...chunk(10, badMatch)]), 11)).toThrow(/precedes output/);
});
