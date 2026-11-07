import { expect, it } from 'vitest';
import { readWindowsSortTables } from '../dev/windows-sort-tables.js';

// Synthetic values exercise the file grammar without distributing native
// Windows weight data or treating these weights as a real locale.
const fixture = () => `SORTKEY
DEFAULT 2
0x0041 14 7 2 18
0x0061 14 7 2 2
ENDSORTKEY
SORTTABLES
RELEASE 2
DEFINEDVERSION 0xffffffff 0x500
NLSVERSION 0xffffffff 0x400
REVERSEDIACRITICS 1
0x040c
DOUBLECOMPRESSION 1
0x040e
MULTIPLEWEIGHTS 1
169 6
EXPANSION 1
0x00c6 0x0041 0x0045
COMPATIBILITY 1
0x037e 0x003b
COMPRESSION 3
LCID 0x0406
LCID 0x0414
TWO 1
0x0061 0x0061 14 9 2 2
THREE 1
0x0061 0x0061 0x0061 14 10 2 2
LCID 0x0415
EIGHT 1
0x0061 0x0062 0x0063 0x0064 0x0065 0x0066 0x0067 0x0068 14 11 2 2
EXCEPTION 2
LCID 0x0406 1
LCID 0x0414
0x0041 14 8 2 18
JAMOSORT 3
0x1100 2
0x1100 0 0 0 0 3 1
0x1103 1 1 20 27 5 0
0x1101 1
0x1101 0 1 0 0 4 0
ENDSORTTABLES`;

it('reads all counted sections, versions and shared locale groups', () => {
  const t = readWindowsSortTables(fixture());
  expect(t.release).toBe(2);
  expect([...t.weights]).toEqual([[65, [14, 7, 2, 18]], [97, [14, 7, 2, 2]]]);
  expect(t.nlsVersions.get(0xffffffff)).toBe(0x400);
  expect(t.definedVersions.get(0xffffffff)).toBe(0x500);
  expect([...t.reverseDiacritics]).toEqual([0x40c]);
  expect([...t.doubleCompression]).toEqual([0x40e]);
  expect(t.multipleWeights).toEqual([[169, 6]]);
  expect(t.expansions.get(198)).toEqual([65, 69]);
  expect(t.compatibility.get(894)).toEqual([59]);
  expect(t.contractions.get(0x406)).toBe(t.contractions.get(0x414));
  expect(t.contractions.get(0x406).get(3)).toEqual([{ text: 'aaa', weights: [14, 10, 2, 2] }]);
  expect(t.contractions.get(0x415).get(8)[0].text).toBe('abcdefgh');
  expect(t.exceptions.get(0x406)).toBe(t.exceptions.get(0x414));
  expect(t.exceptions.get(0x414).get(65)).toEqual([14, 8, 2, 18]);
  expect(t.jamo.get(0x1100)).toEqual([[0x1100, 0, 0, 0, 0, 3, 1], [0x1103, 1, 1, 20, 27, 5, 0]]);
  expect(t.jamo.size).toBe(2); // The section's count is records, not roots.
});
it('ignores comments, blank lines, BOM and line-ending differences', () => {
  const original = fixture(), variant = '\ufeff; reference header\r\n\r\n' + original.split('\n').map(line => ' \t' + line.replaceAll(' ', '\t') + ' ; arbitrary comment').join('\r\n');
  expect(readWindowsSortTables(variant)).toEqual(readWindowsSortTables(original));
});
it('accepts version records in either order and the older layout without compatibility mappings', () => {
  const text = fixture().replace('DEFINEDVERSION 0xffffffff 0x500\nNLSVERSION 0xffffffff 0x400', 'NLSVERSION 0xffffffff 0x400\nDEFINEDVERSION 0xffffffff 0x500').replace('COMPATIBILITY 1\n0x037e 0x003b\n', '');
  const t = readWindowsSortTables(text);
  expect(t.compatibility.size).toBe(0); expect(t.nlsVersions.get(0xffffffff)).toBe(0x400);
});
it('retains conflicting contraction records and out-of-byte weights for semantic validation', () => {
  const text = fixture().replace('TWO 1\n0x0061 0x0061 14 9 2 2', 'TWO 2\n0x0061 0x0061 14 9 2 2\n0x0061 0x0061 14 9 2 18').replace('0x0041 14 8 2 18', '0x0041 14 256 2 18');
  const t = readWindowsSortTables(text);
  expect(t.contractions.get(0x406).get(2)).toEqual([{ text: 'aa', weights: [14, 9, 2, 2] }, { text: 'aa', weights: [14, 9, 2, 18] }]);
  expect(t.exceptions.get(0x406).get(65)[1]).toBe(256);
});
it.each([
  ['DEFAULT 2', 'DEFAULT 3'], ['DEFAULT 2', 'DEFAULT 1'], ['DEFAULT 2', 'DEFAULT 1048577'],
  ['COMPRESSION 3', 'COMPRESSION 2'], ['COMPRESSION 3', 'COMPRESSION 4'],
  ['EXCEPTION 2', 'EXCEPTION 1'], ['EXCEPTION 2', 'EXCEPTION 3'],
  ['JAMOSORT 3', 'JAMOSORT 2'], ['JAMOSORT 3', 'JAMOSORT 4'],
  ['0x1100 2', '0x1100 0'], ['0x1100 2', '0x1102 2'],
  ['LCID 0x0414\n0x0041', 'LCID 0x0414 2\n0x0041'],
  ['0x0041 14 7 2 18', '0x0041 14 7 2'],
  ['0x0041 14 7 2 18', '0x10000 14 7 2 18'],
  ['0x0041 14 7 2 18', '0x0041 -1 7 2 18'],
  ['0x0041 14 7 2 18', '0x0041 14 4294967296 2 18'],
  ['0x0041 14 7 2 18', '0x0041 14 1.5 2 18'],
  ['0x0041 14 7 2 18', '0x0041 14 1e2 2 18'],
  ['0x0041 14 7 2 18', '0x0041 14 NaN 2 18'],
  ['TWO 1', 'NINE 1'], ['ENDSORTTABLES', 'ENDSORTTABLES\nUNKNOWN 0'],
])('rejects bad framing/values: %s → %s', (from, to) => {
  expect(() => readWindowsSortTables(fixture().replace(from, to))).toThrow(/Invalid Windows sorting table/);
});
it.each([
  ['0x0061 14 7 2 2', '0x0041 14 7 2 2'],
  ['LCID 0x0414', 'LCID 0x0406'],
  ['NLSVERSION 0xffffffff 0x400', 'NLSVERSION 0xffffffff 0x400\nNLSVERSION 0xffffffff 0x500'],
  ['REVERSEDIACRITICS 1\n0x040c', 'REVERSEDIACRITICS 2\n0x040c\n0x040c'],
  ['THREE 1\n0x0061 0x0061 0x0061 14 10 2 2', 'TWO 1\n0x0061 0x0062 14 10 2 2'],
])('rejects ambiguous table/section identities: %s', (from, to) => {
  expect(() => readWindowsSortTables(fixture().replace(from, to))).toThrow(/duplicate/);
});
it('bounds input before tokenizing and rejects truncated input', () => {
  for (const input of [null, {}, 'x'.repeat(32 * 1048576 + 1), fixture().slice(0, -14)]) expect(() => readWindowsSortTables(input)).toThrow(/Invalid Windows sorting table/);
});
