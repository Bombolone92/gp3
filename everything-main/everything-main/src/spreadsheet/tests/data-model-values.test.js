import { it, expect } from 'vitest';
import { decodeModelNumericDictionary, encodeModelNumericDictionary, readModelDictionary } from '../src/core/data-model-dictionaries.js';
import { decodeModelValues, readModelColumnValues } from '../src/core/data-model-values.js';
const join = (...parts) => Uint8Array.from(parts.flatMap(p => [...p]));
function vector(values, type = 'long', width = 8, padding = 0) {
  const bytes = new Uint8Array(40 + width * values.length + padding), v = new DataView(bytes.buffer);
  v.setUint32(0, type === 'real' ? 1 : 0, true); v.setInt32(4, -1, true); v.setUint32(8, 8, true); v.setUint32(12, 64, true); v.setUint32(16, 6, true); v.setBigInt64(20, -1n, true); v.setBigUint64(28, BigInt(values.length), true); v.setUint32(36, width, true);
  values.forEach((value, i) => { if (type === 'real') v.setFloat64(40 + i * width, value, true); else if (width === 4) v.setInt32(40 + i * width, Number(value), true); else v.setBigInt64(40 + i * width, value, true); });
  return bytes;
}
it('reads signed 32-bit and 64-bit numeric vectors without Number precision loss', () => {
  for (const [width, values] of [[4, [-2147483648n, 0n, 2147483647n]], [8, [-9223372036854775808n, 9007199254740993n, 9223372036854775807n]]]) {
    const bytes = vector(values, 'long', width, 5), wrapped = join([1, 2, 3], bytes, [4]);
    expect(decodeModelNumericDictionary(wrapped.subarray(3, -1), { type: 'long', operatingOn32: width === 4 })).toEqual(values);
  }
});
it('reads real vectors, signed zero and empty numeric dictionaries', () => {
  const values = [-0, Number.MIN_VALUE, -1.25, Number.MAX_VALUE];
  const actual = decodeModelNumericDictionary(vector(values, 'real'), { type: 'real' });
  expect(actual).toEqual(values); expect(Object.is(actual[0], -0)).toBe(true);
  expect(decodeModelNumericDictionary(vector([]), { type: 'long' })).toEqual([]);
});
it('rejects malformed numeric framing, widths, nonfinite values, padding and counts', () => {
  const good = vector([1n, 2n]);
  for (let n = 0; n < good.length; n++) expect(() => decodeModelNumericDictionary(good.subarray(0, n), { type: 'long' })).toThrow();
  for (const [at, value] of [[0, 2], [4, 0], [8, 0], [12, 1], [20, 0], [28, 0xffffffff], [36, 4]]) {
    const bytes = good.slice(); new DataView(bytes.buffer).setUint32(at, value, true);
    expect(() => decodeModelNumericDictionary(bytes, { type: 'long' })).toThrow();
  }
  expect(() => decodeModelNumericDictionary(good, { type: 'long', maxItems: 1 })).toThrow(/limit/);
  expect(() => decodeModelNumericDictionary(join(good, [1]), { type: 'long' })).toThrow(/padding/);
  for (const value of [NaN, Infinity, -Infinity]) expect(() => decodeModelNumericDictionary(vector([value], 'real'), { type: 'real' })).toThrow(/nonfinite/);
});
const stats = (rows, min = 3, max = 100, hasNulls = false, xmType = 0) => ({ rows, min, max, hasNulls, xmType, dbType: 20 });
const valueDict = (rows, more = {}) => ({ kind: 'value', type: 'long', baseId: -3n, magnitude: 1, stats: stats(rows), ...more });
it('handles the reserved null ID separately from arithmetic and from segment/column minima', () => {
  const dictionary = valueDict(4, { baseId: -1000n, magnitude: 0.1, stats: stats(4, 1000, 1008, true) });
  expect(decodeModelValues(Int32Array.of(1001, 2, 1000, 1008), dictionary)).toEqual([10n, null, 0n, 80n]);
  expect(decodeModelValues(Int32Array.of(2, 2), valueDict(2, { stats: stats(2, 2, 2, true) }))).toEqual([null, null]);
  expect(() => decodeModelValues(Int32Array.of(2), valueDict(1))).toThrow(/undeclared null/);
});
it('preserves exact signed 64-bit endpoints and cancellation before scaling', () => {
  expect(decodeModelValues(Int32Array.of(3, 4), valueDict(2, { baseId: 9223372036854775803n }))).toEqual([9223372036854775806n, 9223372036854775807n]);
  expect(decodeModelValues(Int32Array.of(3), valueDict(1, { baseId: -9223372036854775808n }))).toEqual([-9223372036854775805n]);
  expect(() => decodeModelValues(Int32Array.of(3), valueDict(1, { baseId: 9007199254740993n, magnitude: 0 }))).toThrow(/magnitude/);
  expect(decodeModelValues(Int32Array.of(3), valueDict(1, { baseId: 9223372036854775805n, magnitude: -1 }))).toEqual([-9223372036854775808n]);
  expect(() => decodeModelValues(Int32Array.of(5), valueDict(1, { baseId: 9223372036854775803n }))).toThrow(/bounds/);
});
it('applies the XML value-dictionary multiplier to reals without replacing it with a divisor', () => {
  const dictionary = { kind: 'value', type: 'real', baseId: -10n, magnitude: 0.125, stats: stats(3, 3, 12, true, 1) };
  expect(decodeModelValues(Int32Array.of(3, 2, 12), dictionary)).toEqual([-56, null, 16]);
  expect(() => decodeModelValues(Int32Array.of(4), valueDict(1, { magnitude: 0.3 }))).toThrow(/fractional/);
});
it('uses the full declared hash dictionary range, including unused entries below a column minimum', () => {
  const dictionary = { kind: 'hash', type: 'long', values: [10n, 20n, 30n, 40n, 50n], lastId: 7, stats: stats(3, 6, 7, true) };
  expect(decodeModelValues(Int32Array.of(7, 2, 6), dictionary)).toEqual([50n, null, 40n]);
  expect(decodeModelValues(Int32Array.of(26, 27), { kind: 'hash', type: 'string', values: ['x ', ''], lastId: 27, stats: stats(2, 26, 27, false, 2) })).toEqual(['x ', '']);
  expect(decodeModelValues(Int32Array.of(2), { kind: 'hash', type: 'long', values: [], lastId: 2, stats: stats(1, 2, 2, true) })).toEqual([null]);
});
it('refuses missing statistics, type mismatches, invalid IDs and dictionary gaps', () => {
  for (const dictionary of [valueDict(2), valueDict(1, { stats: null }), valueDict(1, { stats: stats(1, 3, 100, false, 2) }), valueDict(1, { baseId: 2 }), valueDict(1, { magnitude: Infinity }), { kind: 'hash', type: 'long', values: [3], lastId: 3, stats: stats(1) }]) {
    expect(() => decodeModelValues(Int32Array.of(3), dictionary)).toThrow();
  }
  expect(() => decodeModelValues(Int32Array.of(101), valueDict(1))).toThrow(/statistics/);
  expect(() => decodeModelValues(Int32Array.of(7), { kind: 'hash', type: 'long', values: [1n], lastId: 6, stats: stats(1) })).toThrow(/outside dictionary/);
});
const ns = 'http://schemas.microsoft.com/analysisservices/imbi';
const props = values => `<Properties>${Object.entries(values).map(([k, v]) => `<${k}>${v}</${k}>`).join('')}</Properties>`;
const object = (name, content, file = '') => `<XMObject class="${name.replaceAll('<', '&lt;')}" name="${file}">${content}</XMObject>`;
const member = (name, content) => `<Member><Name>${name}</Name>${content}</Member>`;
const collection = (name, content) => `<Collection><Name>${name}</Name>${content}</Collection>`;
function metadata(dict, { min = 3, max = 4, hasNulls = true, xmType = 0 } = {}) {
  const segment = object('XMColumnSegment', props({ Records: 3 }) + `<Members>${member('CompressionInfo', object('XMRENoSplitCompressionInfo<3>', props({ Min: 2 })))}</Members>`);
  const column = object('XMRawColumn', `<Members>${member('ColumnStats', object('XMColumnStats', props({ MinDataID: min, MaxDataID: max, RowCount: 3, HasNulls: hasNulls, XMType: xmType, DBType: 20 })))}</Members><Collections>${collection('Segments', segment)}</Collections><DataObjects><DataObject>${dict}</DataObject><DataObject>${object('XMRawColumnPartitionDataObject', props({ Partition: 17, SegmentCount: 1 }), 'rows.idf')}</DataObject></DataObjects>`, 'Amounts');
  return object('XMSimpleTable', `<Collections>${collection('Partitions', object('XMPartition', props({ Partition: 17 })))}${collection('Columns', column)}</Collections>`).replace('<XMObject', `<XMObject xmlns="${ns}"`);
}
function archive(xml, values = [100n, 9007199254740993n]) {
  const data = new Uint8Array(16), view = new DataView(data.buffer); view.setBigUint64(0, 1n, true); view.setBigUint64(8, 1n | (2n << 6n), true); // IDs 3,2,4.
  const table = { path: 'nested/table.xml', read: () => new TextEncoder().encode(xml) };
  return [{ files: [table, { path: 'nested/rows.idf', read: () => data }, { path: 'nested/numbers.dictionary', read: () => vector(values) }] }, table];
}
it('reads numeric value columns through the archive, preserving blanks and exact large integers', () => {
  const xml = metadata(object('XMValueDataDictionary<XM_Long>', props({ BaseId: '+0000000000009007199254740990', Magnitude: '1.' })));
  const [a, t] = archive(xml);
  expect(readModelColumnValues(a, t, 'Amounts')).toEqual([9007199254740993n, null, 9007199254740994n]);
  expect(readModelDictionary(a, t, 'Amounts')).toMatchObject({ kind: 'value', type: 'long', baseId: 9007199254740990n, magnitude: 1, stats: { hasNulls: true } });
});
it('reads numeric hash columns through declared paths and OperatingOn32 metadata', () => {
  const xml = metadata(object('XMHashDataDictionary<XM_Long>', props({ LastId: 4, Nullable: true, OperatingOn32: false }), 'numbers.dictionary'));
  const [a, t] = archive(xml);
  expect(readModelColumnValues(a, t, 'Amounts')).toEqual([100n, null, 9007199254740993n]);
  a.files.push({ path: 'nested/numbers.dictionary', read: () => vector([0n]) });
  expect(() => readModelColumnValues(a, t, 'Amounts')).toThrow(/duplicate/);
});
it('rejects malformed numeric metadata and statistics before value reconstruction', () => {
  const xml = metadata(object('XMValueDataDictionary<XM_Long>', props({ BaseId: '-3', Magnitude: '1' })));
  for (const input of [xml.replace('BaseId>-3', 'BaseId>9223372036854775808'), xml.replace('Magnitude>1', 'Magnitude>NaN'), xml.replace('HasNulls>true', 'HasNulls>maybe'), xml.replace('RowCount>3', 'RowCount>4'), xml.replace('XMValueDataDictionary&lt;XM_Long', 'XMValueDataDictionary&lt;XM_Unknown'), xml.replace('<BaseId>-3</BaseId>', '<BaseId>-3</BaseId><BaseId>0</BaseId>')]) {
    const [a, t] = archive(input); expect(() => readModelColumnValues(a, t, 'Amounts')).toThrow();
  }
});

const numericHash = { algorithm: -1, entrySize: 8, binSize: 64, localCount: 6 };
it('writes exact numeric dictionary vectors with explicit header geometry', () => {
  for (const [width, values] of [[4, [-2147483648n, 0n, 2147483647n]], [8, [-9223372036854775808n, 9007199254740993n, 9223372036854775807n]]]) {
    const options = { type: 'long', operatingOn32: width === 4, hashHeader: numericHash };
    const bytes = encodeModelNumericDictionary(values, options);
    expect(bytes).toEqual(vector(values, 'long', width));
    expect(decodeModelNumericDictionary(bytes, options)).toEqual(values);
  }
  const values = [-0, Number.MIN_VALUE, -1.25, Number.MAX_VALUE], options = { type: 'real', hashHeader: numericHash };
  expect(encodeModelNumericDictionary(values, options)).toEqual(vector(values, 'real'));
  expect(decodeModelNumericDictionary(encodeModelNumericDictionary(values, options), options)).toEqual(values);
  expect(encodeModelNumericDictionary([], { type: 'long', hashHeader: numericHash })).toEqual(vector([]));
});
it('rejects numeric rounding, width overflow, nonfinite values and missing policies', () => {
  for (const value of [1, 9007199254740992, -9223372036854775809n, 9223372036854775808n, null]) expect(() => encodeModelNumericDictionary([value], { type: 'long', hashHeader: numericHash })).toThrow(/entry/);
  expect(() => encodeModelNumericDictionary([2147483648n], { type: 'long', operatingOn32: true, hashHeader: numericHash })).toThrow(/entry/);
  for (const value of [NaN, Infinity, -Infinity, 1n]) expect(() => encodeModelNumericDictionary([value], { type: 'real', hashHeader: numericHash })).toThrow(/entry/);
  expect(() => encodeModelNumericDictionary([], { type: 'long' })).toThrow(/hash/);
  expect(() => encodeModelNumericDictionary([1n], { type: 'long', hashHeader: numericHash, maxItems: 0 })).toThrow(/input/);
});

it.each([
  [0.002, 2500n, 5000n], [1e-9, 5000000000n, 10000000000n],
  [-0.002, -2500n, -5000n], [2.5, 2n, 4n], [0.125, 40n, 80n],
])('decodes native integer value dictionaries by dividing by magnitude %s', (magnitude, first, second) => {
  expect(decodeModelValues(Int32Array.of(8, 2, 13), valueDict(3, { magnitude, stats: stats(3, 8, 13, true) }))).toEqual([first, null, second]);
});
it('preserves large integer precision through decimal scaling and rejects fractional or overflowing results', () => {
  expect(decodeModelValues(Int32Array.of(3), valueDict(1, { baseId: 9007199254740993n, magnitude: 0.1 }))).toEqual([90071992547409960n]);
  expect(() => decodeModelValues(Int32Array.of(4), valueDict(1, { magnitude: 2.5 }))).toThrow(/fractional integer value/);
  expect(() => decodeModelValues(Int32Array.of(4), valueDict(1, { magnitude: 1e-20 }))).toThrow(/bounds/);
  expect(decodeModelValues(Int32Array.of(3), valueDict(1, { magnitude: Number.MIN_VALUE }))).toEqual([0n]);
});
