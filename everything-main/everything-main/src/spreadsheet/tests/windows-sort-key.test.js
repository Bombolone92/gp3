import { expect, it } from 'vitest';
import { fixture } from './helpers/rewrite-model-storage.js';
import { rewriteModelDictionaryColumns } from '../src/core/data-model-rewrite.js';
import { readDataModelArchive } from '../src/core/data-model-archive.js';
import { readModelColumnValues } from '../src/core/data-model-values.js';
import { readModelDictionary } from '../src/core/data-model-dictionaries.js';
import { readModelIntrinsicHierarchy } from '../src/core/data-model-hierarchies.js';
import { createWindowsSortKey } from '../src/core/windows-sort-key.js';

// Synthetic reference-table records isolate the algorithm from any installed
// Windows/ICU version. The bytes below are test weights, not a locale database.
function tables() {
  return { release: 2, weights: new Map([
    [97, [14, 2, 2, 2]], [65, [14, 2, 2, 18]], [98, [14, 3, 2, 2]],
    [225, [14, 2, 6, 2]], [0x301, [1, 0, 4, 0]], [0xad, [0, 0, 0, 0]],
    [45, [6, 130, 2, 2]], [32, [7, 2, 2, 2]], [0xff41, [14, 2, 2, 3]],
    [0x3400, [5, 16, 2, 2]], [0x4e00, [128, 9, 2, 2]], [0x3b1, [15, 2, 2, 2]],
  ]), exceptions: new Map(), expansions: new Map(), contractions: new Map(), reverseDiacritics: new Set(), doubleCompression: new Set() };
}
const make = (t = tables(), options = {}) => createWindowsSortKey(t, { locale: 1033, profile: 'vista', ...options });
const bytes = (key, text) => [...key(text)];
const compare = (key, a, b) => {
  const left = key(a), right = key(b);
  for (let i = 0; i < Math.min(left.length, right.length); i++) if (left[i] !== right[i]) return Math.sign(left[i] - right[i]);
  return Math.sign(left.length - right.length);
};
it('builds terminated primary/accent/case/special levels and preserves empty strings', () => {
  const key = make();
  expect(bytes(key, '')).toEqual([1, 1, 1, 1, 0]);
  expect(bytes(key, 'a')).toEqual([14, 2, 1, 1, 1, 1, 0]);
  expect(bytes(key, 'A')).toEqual([14, 2, 1, 1, 18, 1, 1, 0]);
  expect(bytes(key, 'áb')).toEqual([14, 2, 14, 3, 1, 6, 1, 1, 1, 0]);
  expect(compare(key, 'a', 'A')).toBe(-1);
  expect(compare(key, 'áb', 'b')).toBe(-1); // Primary level wins over accents.
});
it('uses declared locale exceptions before default weights', () => {
  const t = tables(); t.exceptions.set(1033, new Map([[97, [14, 8, 2, 2]]]));
  expect(compare(make(t), 'a', 'b')).toBe(1);
  expect(compare(make(t, { locale: 1036 }), 'a', 'b')).toBe(-1);
});
it.each([1, 0x20001, 0x30001])('ignores case with flag %s', flags => {
  const key = make(tables(), { flags });
  expect(key('A')).toEqual(key('a'));
  expect(compare(key, 'a', 'á')).toBe(-1);
});
it('handles accent and width options independently', () => {
  const accent = make(tables(), { flags: 2 }), width = make(tables(), { flags: 0x20000 });
  expect(accent('a')).toEqual(accent('á'));
  expect(accent('a')).not.toEqual(accent('A'));
  expect(width('a')).toEqual(width('ａ'));
  expect(make()('a')).not.toEqual(make()('ａ'));
});
it('accumulates combining marks and skips unsortable/unassigned characters without normalization', () => {
  const key = make();
  expect(key('a\u0301')).toEqual(key('á'));
  expect(key('a\u00ad\u0301')).toEqual(key('á'));
  expect(key('a\uFFFF')).toEqual(key('a'));
  expect(bytes(key, '\u0301')).toEqual([1, 4, 1, 1, 1, 0]);
});
it('reverses accent significance for the selected locale', () => {
  const t = tables(); t.reverseDiacritics.add(1036);
  expect(compare(make(t), 'áa', 'aá')).toBe(1);
  expect(compare(make(t, { locale: 1036 }), 'áa', 'aá')).toBe(-1);
});
it('expands two- and three-weight characters while retaining table order', () => {
  const t = tables(); t.expansions.set(88, [97, 98]); t.expansions.set(89, [97, 88]);
  const key = make(t);
  expect(key('X')).toEqual(key('ab'));
  expect(key('Y')).toEqual(key('aab'));
  expect(key('Xá')).toEqual(key('abá'));
});
it('places variable punctuation in its own positional level', () => {
  const key = make();
  expect(bytes(key, '-a')).toEqual([14, 2, 1, 1, 1, 1, 128, 3, 6, 130, 0]);
  expect(bytes(key, 'a-')).toEqual([14, 2, 1, 1, 1, 1, 128, 7, 6, 130, 0]);
  expect(compare(key, 'ab', 'a-b')).toBe(-1);
  expect(compare(key, '-a', 'a-')).toBe(-1);
});
it('handles ordinary non-Latin weights and Extension A without using Unicode scalar order', () => {
  const key = make();
  expect(bytes(key, 'α')).toEqual([15, 2, 1, 1, 1, 1, 0]);
  expect(bytes(key, '㐀')).toEqual([254, 255, 16, 2, 1, 1, 1, 1, 0]);
  expect(compare(key, '一', '㐀')).toBe(-1);
});
it('takes longest declared contractions, including one ending at the last code unit', () => {
  const t = tables(); t.weights.set(97, [14, 2, 2, 0xc2]);
  t.contractions.set(1033, new Map([
    [2, [{ text: 'ab', weights: [14, 7, 2, 2] }]],
    [3, [{ text: 'aba', weights: [14, 8, 2, 2] }]],
    [8, [{ text: 'abababab', weights: [14, 9, 2, 2] }]],
  ]));
  const key = make(t);
  expect(bytes(key, 'a')).toEqual([14, 2, 1, 1, 1, 1, 0]);
  expect(bytes(key, 'ab')).toEqual([14, 7, 1, 1, 1, 1, 0]);
  expect(bytes(key, 'aba')).toEqual([14, 8, 1, 1, 1, 1, 0]);
  expect(bytes(key, 'abababab')).toEqual([14, 9, 1, 1, 1, 1, 0]);
});
it('honors contraction eligibility and permits identical repeated reference records', () => {
  const t = tables(), entry = { text: 'ab', weights: [14, 7, 2, 2] };
  t.contractions.set(1033, new Map([[2, [entry, entry]]]));
  expect(make(t)('ab')).toEqual(make()('ab'));
  t.weights.set(97, [14, 2, 2, 0x42]);
  expect(bytes(make(t), 'ab')).toEqual([14, 7, 1, 1, 1, 1, 0]);
});
it('snapshots selected reference data instead of retaining mutable caller arrays', () => {
  const t = tables(), key = make(t), expected = key('a');
  t.weights.get(97)[1] = 250; t.weights.clear(); t.reverseDiacritics.add(1033);
  expect(key('a')).toEqual(expected);
});
it('rejects ambiguous contractions and non-byte weights only in the selected locale', () => {
  const t = tables();
  t.contractions.set(1036, new Map([[2, [{ text: 'ab', weights: [14, 7, 2, 2] }, { text: 'ab', weights: [14, 8, 2, 2] }]]]));
  expect(() => make(t)).not.toThrow();
  expect(() => make(t, { locale: 1036 })).toThrow(/ambiguous contraction/);
  t.exceptions.set(1031, new Map([[97, [14, 256, 2, 2]]]));
  expect(() => make(t, { locale: 1031 })).toThrow(/weight bytes/);
});
it.each([3, 4])('refuses unimplemented script handler %s before returning a key', script => {
  const t = tables(); t.weights.set(88, [script, 1, 2, 2]);
  expect(() => make(t)('aX')).toThrow(/East Asian|Jamo/);
});
it('refuses double-compression profiles without substituting ordinary contraction rules', () => {
  const t = tables(); t.doubleCompression.add(1038);
  expect(() => make(t, { locale: 1038 })).toThrow(/double compression/);
});
it('emits resolved expansion records without redispatching their script identifiers', () => {
  const t = tables(); t.expansions.set(88, [97, 0x3400]);
  expect(bytes(make(t), 'X')).toEqual([14, 2, 5, 16, 1, 1, 1, 1, 0]);
});
it.each(['cycle', 'too-long', 'missing'])('rejects unsupported expansion data: %s', problem => {
  const t = tables(); t.weights.set(88, [2, 0, 0, 0]);
  if (problem === 'cycle') t.expansions.set(88, [97, 88]);
  if (problem === 'too-long') { t.expansions.set(88, [89, 89]); t.expansions.set(89, [97, 98]); }
  expect(() => make(t)('X')).toThrow(/expansion/);
});
it('bounds characters, intermediate weight bytes, and native punctuation positions', () => {
  expect(() => make(tables(), { maxChars: 1 })('ab')).toThrow(/string limit/);
  expect(() => make(tables(), { maxWorkBytes: 4 })('')).toThrow(/byte limit/);
  expect(make(tables(), { maxWorkBytes: 9 })('a')).toEqual(make()('a'));
  expect(() => make(tables(), { maxWorkBytes: 8 })('a')).toThrow(/byte limit/);
  expect(() => make()('a'.repeat(8192) + '-')).toThrow(/punctuation position/);
  expect(() => make()(12)).toThrow(/string limit/);
});
it.each([
  { profile: 'nt' }, { profile: undefined }, { locale: -1 }, { locale: 0 }, { locale: 0x400 }, { locale: 0x800 }, { locale: 0x1000 },
  { flags: 4 }, { flags: -1 }, { flags: NaN }, { maxChars: 1048577 }, { maxChars: 0.5 }, { maxWorkBytes: Infinity },
])('rejects invalid or unresolved profile options %j', options => {
  expect(() => make(tables(), options)).toThrow(/options/);
});


it('keeps Windows 7 private-use distinctions in the primary level when ignoring accents', () => {
  const t = tables();
  t.weights.set(0xe000, [0xa9, 8, 3, 2]); t.weights.set(0xe001, [0xa9, 8, 4, 2]);
  const key = make(t, { profile: 'windows7', flags: 2 });
  expect(bytes(key, '\ue000')).toEqual([0xa9, 8, 3, 1, 1, 1, 1, 0]);
  expect(compare(key, '\ue000', '\ue001')).toBe(-1);
  expect(make(t, { flags: 2 })('\ue000')).toEqual(make(t, { flags: 2 })('\ue001'));
  // A primary distinction must win over a later character, not just accents.
  expect(compare(key, '\ue000b', '\ue001a')).toBe(-1);
});
it.each([0x404, 0x804, 0xc04, 0x1004, 0x1404, 0x20804, 0x21004, 0x21404, 0x30404, 0x40411])('uses three-byte CJK weights for Windows 7 sort LCID %s', locale => {
  const t = tables(); t.weights.set(0x4e00, [0xc0, 8, 3, 2]);
  expect(bytes(make(t, { profile: 'windows7', locale, flags: 2 }), '一')).toEqual([0xc0, 8, 3, 1, 1, 1, 1, 0]);
  expect(bytes(make(t, { locale, flags: 2 }), '一')).toEqual([0xc0, 8, 1, 1, 1, 1, 0]);
});
it.each([1033, 1041, 1042, 0x10404])('retains two-byte CJK weights for other Windows 7 sort LCID %s', locale => {
  const t = tables(); t.weights.set(0x4e00, [0xc0, 8, 3, 2]);
  expect(bytes(make(t, { profile: 'windows7', locale }), '一')).toEqual([0xc0, 8, 1, 3, 1, 1, 1, 0]);
});
it.each([[0xa8, false], [0xa9, true], [0xaf, true], [0xb0, false], [0xbf, false], [0xc0, true], [0xf9, true], [0xfa, false]])('uses script-range boundaries for weight %s', (script, third) => {
  const t = tables(); t.weights.set(88, [script, 8, 3, 2]);
  const key = make(t, { profile: 'windows7', locale: 0x804 });
  expect(bytes(key, 'X')).toEqual(third ? [script, 8, 3, 1, 1, 1, 1, 0] : [script, 8, 1, 3, 1, 1, 1, 0]);
});
it('counts primary weight records for punctuation positions, independently of encoded byte length', () => {
  const t = tables(); t.weights.set(0xe000, [0xa9, 8, 3, 2]);
  const key = make(t, { profile: 'windows7' });
  expect(bytes(key, '\ue000-')).toEqual([0xa9, 8, 3, 1, 1, 1, 1, 128, 7, 6, 130, 0]);
  expect(bytes(key, '㐀\ue000-').slice(-5)).toEqual([128, 15, 6, 130, 0]);
  expect(() => key('\ue000'.repeat(8191) + '-')).not.toThrow();
  expect(() => key('\ue000'.repeat(8192) + '-')).toThrow(/punctuation position/);
});
it('does not emit zero third-byte sentinels or move contraction and expansion diacritics', () => {
  const t = tables(); t.weights.set(0xe000, [0xa9, 8, 0, 2]);
  t.weights.set(97, [14, 2, 2, 0x42]);
  t.contractions.set(1033, new Map([[2, [{ text: 'ab', weights: [0xa9, 8, 3, 2] }]]]));
  t.expansions.set(88, [0xe000, 98]);
  const key = make(t, { profile: 'windows7' });
  expect(bytes(key, '\ue000')).toEqual([0xa9, 8, 1, 1, 1, 1, 0]);
  expect(bytes(key, 'ab')).toEqual([0xa9, 8, 1, 3, 1, 1, 1, 0]);
  expect(bytes(key, 'X')).toEqual([0xa9, 8, 14, 3, 1, 1, 1, 1, 0]);
});
it('bounds Windows 7 intermediate weights without dropping primary distinctions', () => {
  const t = tables(); t.weights.set(0xe000, [0xa9, 8, 3, 2]);
  expect(() => make(t, { profile: 'windows7', maxWorkBytes: 8 })('\ue000')).toThrow(/byte limit/);
  expect(bytes(make(t, { profile: 'windows7', maxWorkBytes: 9 }), '\ue000')).toEqual([0xa9, 8, 3, 1, 1, 1, 1, 0]);
});

it.each([0, 1])('retains distinct three-byte members through repeated model dictionary rebuilds (%s)', materialization => {
  const t = tables(); t.weights.set(99, [14, 4, 2, 2]);
  t.weights.set(0xe000, [0xa9, 8, 3, 2]); t.weights.set(0xe001, [0xa9, 8, 4, 2]);
  const key = make(t, { profile: 'windows7', flags: 2 });
  const f = fixture({ dictionaryValues: ['a', 'b', 'c'], materialization }), original = f.input.slice();
  const values = ['\ue001a', null, '\ue000b', '\ue001a', 'a'];
  const keys = new Map(['a', 'b', 'c', ...values.filter(v => v !== null)].map(v => [v, key(v)]));
  let input = f.input;
  for (let cycle = 0; cycle < 2; cycle++) {
    input = rewriteModelDictionaryColumns(input, f.path, new Map([['Amount', values]]), { stringSortKeys: new Map([['Amount', keys]]) });
    const archive = readDataModelArchive(input), table = archive.files.find(entry => entry.path === f.path);
    expect(readModelColumnValues(archive, table, 'Amount')).toEqual(values);
    const dict = readModelDictionary(archive, table, 'Amount'), h = readModelIntrinsicHierarchy(archive, table, 'Amount');
    const first = dict.lastId - dict.values.length + 1;
    expect([...h.positionToId.slice(0, h.distinctDataIds)].map(id => id === 2 ? null : dict.values[id - first])).toEqual([null, 'a', '\ue000b', '\ue001a']);
  }
  expect(f.input).toEqual(original);
});
