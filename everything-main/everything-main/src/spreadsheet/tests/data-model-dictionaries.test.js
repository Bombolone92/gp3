import { it, expect } from 'vitest';
import { decodeModelStringDictionary, encodeModelStringDictionary, readModelDictionary, readModelStringDictionary } from '../src/core/data-model-dictionaries.js';
const join = (...parts) => Uint8Array.from(parts.flatMap(p => [...p]));
const num = (n, size) => { const b = new Uint8Array(size), v = new DataView(b.buffer); if (size === 8) v.setBigUint64(0, BigInt(n), true); else v.setUint32(0, n, true); return b; };
const u64 = n => num(n, 8), u32 = n => num(n, 4), flag = n => Uint8Array.of(+n);
function textBytes(text) { const out = new Uint8Array(text.length * 2), view = new DataView(out.buffer); for (let i = 0; i < text.length; i++) view.setUint16(i * 2, text.charCodeAt(i), true); return out; }
function plain(strings, order = strings.map((_, i) => i), padding = 4) {
  const offsets = []; let at = 0;
  for (const s of strings) { offsets.push(at); at += s.length + 1; }
  const data = textBytes(strings.join('\0') + (strings.length ? '\0' : ''));
  return { count: strings.length, longest: Math.max(0, ...strings.map(s => s.length)), compressed: false, offsets: order.map(i => offsets[i]), body: join(u64(0), u64(at), u64(data.length + padding), data, new Uint8Array(padding)) };
}
// MS-XLDM 2.7.4.2's published bit sequence, independent of an encoder.
function compressed({ bits = '1000011111001001011100100', offsets = [0, 15], mode = 703121, charset = 0, lengths = { 70: 3, 77: 3, 97: 3, 101: 2, 108: 2, 109: 3 }, longest = 6, decodeBits = 3, exactBuffer = false } = {}) {
  const alphabet = new Uint8Array(128); for (const [symbol, length] of Object.entries(lengths)) alphabet[symbol >> 1] |= length << ((symbol & 1) * 4);
  const stream = new Uint8Array(exactBuffer ? Math.ceil(bits.length / 8) : Math.ceil(bits.length / 16) * 2 + 2);
  [...bits].forEach((bit, i) => { const byte = Math.floor(i / 8), paired = byte ^ 1; stream[paired < stream.length ? paired : byte] |= Number(bit) << (7 - i % 8); });
  return { count: offsets.length, longest, compressed: true, offsets, body: join(u32(bits.length), u32(mode), u64(stream.length), mode === 703121 ? flag(charset) : [], u32(decodeBits), alphabet, u64(stream.length), stream) };
}
function dictionary(pages, { hash = true, storeCompressed = pages.some(p => p.compressed), padding = 0 } = {}) {
  const count = pages.reduce((n, p) => n + p.count, 0); let start = 0;
  return join(u32(2), hash ? join(u32(1), u32(8), u32(64), u32(6), new Uint8Array(8).fill(255)) : [], u64(count), flag(storeCompressed), u64(Math.max(0, ...pages.map(p => p.longest))), u64(pages.length), ...pages.map(p => {
    const out = join(u64(+p.compressed), flag(false), u64(start), u64(p.count), flag(p.compressed), u32(0xAABBCCDD), p.body, u32(0xABCDABCD)); start += p.count; return out;
  }), u64(count), u32(8), ...pages.flatMap((p, page) => p.offsets.map(offset => join(u32(offset), u32(page)))), new Uint8Array(padding));
}
it('reads native UTF-16 code-unit offsets, arbitrary handle order, pages, whitespace and BOM characters', () => {
  const a = ['é', '東京😀', '', 'A ', '\uFEFFkept'], b = ['second page'];
  const bytes = dictionary([plain(a, [2, 4, 0, 3, 1]), plain(b)], { storeCompressed: true, padding: 7 });
  const wrapped = join(new Uint8Array(3), bytes, new Uint8Array(2));
  expect(decodeModelStringDictionary(wrapped.subarray(3, -2), { flags: 3 })).toEqual(['', '\uFEFFkept', 'é', 'A ', '東京😀', ...b]);
});
it('supports absent hash headers and empty dictionaries', () => {
  expect(decodeModelStringDictionary(dictionary([plain(['x'])], { hash: false }))).toEqual(['x']);
  expect(decodeModelStringDictionary(dictionary([], { hash: false }))).toEqual([]);
  expect(decodeModelStringDictionary(dictionary([plain([])], { hash: false }))).toEqual([]);
});
it('decodes the published Huffman example and mixed compressed/uncompressed pages', () => {
  expect(decodeModelStringDictionary(dictionary([compressed(), plain(['after'])]), { flags: 3 })).toEqual(['Female', 'Male', 'after']);
});
it('restores nonzero single-byte character sets and supports empty compressed strings', () => {
  const page = compressed({ charset: 4, offsets: [0, 0, 15] });
  expect(decodeModelStringDictionary(dictionary([page]), { flags: 3 })).toEqual(['', ...['Female', 'Male'].map(s => [...s].map(c => String.fromCharCode(c.charCodeAt(0) + 1024)).join(''))]);
});
it('decodes multi-character-set UTF-16 and codes longer than the fast-lookup hint', () => {
  // Canonical alphabet: 0=00, 1=01, 65=10, 78=110...0 (13 bits).
  // UTF-16LE bytes 65,0,0,78 represent A and 一.
  const page = compressed({ bits: '10' + '00' + '00' + '1100000000000', offsets: [0, 4], mode: 703122, lengths: { 0: 2, 1: 2, 65: 2, 78: 13 }, decodeBits: 2, longest: 1 });
  expect(decodeModelStringDictionary(dictionary([page]), { flags: 3 })).toEqual(['A', '一']);
});
it('handles odd compressed buffers, empty pages, and total decoded-character limits', () => {
  const page = compressed({ bits: '00', offsets: [0], lengths: { 65: 2, 66: 2, 67: 2, 68: 2 }, longest: 1, exactBuffer: true });
  expect(decodeModelStringDictionary(dictionary([plain([]), page, plain([])]), { flags: 3 })).toEqual(['A']);
  expect(() => decodeModelStringDictionary(dictionary([compressed(), compressed()]), { flags: 3, maxChars: 12 })).toThrow(/limit/);
});
it('rejects truncated pages and record vectors at every byte boundary', () => {
  for (const page of [plain(['test', '😀']), compressed()]) {
    const bytes = dictionary([page]);
    for (let n = 0; n < bytes.length; n++) expect(() => decodeModelStringDictionary(bytes.subarray(0, n), { flags: 3 })).toThrow();
  }
});
it('rejects invalid headers, counts, markers, handles and padding', () => {
  const good = dictionary([plain(['abc'])]);
  const patch = (at, data) => { const b = good.slice(); b.set(data, at); return b; };
  for (const bytes of [patch(0, u32(1)), patch(4, u32(3)), patch(20, u64(0)), patch(28, u64(2)), patch(36, flag(2)), patch(53, u64(1)), patch(61, flag(1)), patch(62, u64(1)), patch(79, u32(0)), patch(good.length - 8, u32(1)), patch(good.length - 4, u32(1)), join(good, flag(1))]) {
    expect(() => decodeModelStringDictionary(bytes, { flags: 3 })).toThrow();
  }
  expect(() => decodeModelStringDictionary(dictionary([plain(['a', 'b'], [0, 0])]), { flags: 3 })).toThrow(/offset/);
});
it('bounds file declarations, decoded output and incomplete or invalid Huffman words', () => {
  const good = dictionary([plain(['abcd', 'efgh'])]);
  expect(() => decodeModelStringDictionary(good, { flags: 3, maxItems: 1 })).toThrow(/limit/);
  expect(() => decodeModelStringDictionary(good, { flags: 3, maxChars: 6 })).toThrow(/limit/);
  expect(() => decodeModelStringDictionary(good, { flags: 8 })).toThrow(/flags/);
  for (const options of [{ lengths: { 0: 1 } }, { lengths: { 0: 2, 1: 2, 2: 2, 3: 2, 4: 2 } }, { bits: '1', offsets: [0] }, { bits: '000', offsets: [0], mode: 703122 }, { decodeBits: 13 }, { mode: 1 }, { offsets: [1, 15] }, { offsets: [0, 26] }]) {
    expect(() => decodeModelStringDictionary(dictionary([compressed(options)]), { flags: 3 })).toThrow();
  }
});
function metadata() {
  return '<XMObject xmlns="http://schemas.microsoft.com/analysisservices/imbi" class="XMSimpleTable"><Collections><Collection><Name>Columns</Name><XMObject class="XMRawColumn" name="Labels"><DataObjects><DataObject><XMObject class="XMHashDataDictionary&lt;XM_String>" name="declared.dictionary"><Properties><DictionaryFlags>3</DictionaryFlags><LastId>27</LastId><Nullable>false</Nullable></Properties></XMObject></DataObject></DataObjects></XMObject></Collection></Collections></XMObject>';
}
it('binds dictionary storage by explicit metadata identities and keeps LastId separate from values', () => {
  const table = { path: 'folder/table.xml', read: () => new TextEncoder().encode(metadata()) }, file = { path: 'folder/declared.dictionary', read: () => dictionary([plain(['first', 'last'])]) };
  const archive = { files: [table, file, { path: 'elsewhere/declared.dictionary', read: () => { throw Error('wrong folder'); } }] };
  expect(readModelStringDictionary(archive, table, 'Labels')).toEqual({ lastId: 27, nullable: false, values: ['first', 'last'] });
  expect(() => readModelStringDictionary(archive, { ...table }, 'Labels')).toThrow(/metadata file/);
  expect(() => readModelStringDictionary(archive, table, 'Other')).toThrow(/column/);
  archive.files.push(file); expect(() => readModelStringDictionary(archive, table, 'Labels')).toThrow(/duplicate/);
});
it('rejects malformed dictionary metadata before reading binary storage', () => {
  for (const xml of [metadata().replace('services/imbi', 'services/foreign'), metadata().replace('Nullable>false', 'Nullable>maybe'), metadata().replace('LastId>27', 'LastId>2147483648'), metadata().replace('DictionaryFlags>3', 'DictionaryFlags>-1'), metadata().replace('<LastId>27</LastId>', '<LastId>27</LastId><LastId>3</LastId>')]) {
    const table = { path: 'folder/table.xml', read: () => new TextEncoder().encode(xml) }, file = { path: 'folder/declared.dictionary', read: () => dictionary([plain(['a'])]) };
    expect(() => readModelStringDictionary({ files: [table, file] }, table, 'Labels')).toThrow();
  }
});

const hashHeader = { algorithm: 1, entrySize: 8, binSize: 64, localCount: 6 };
const dense = strings => plain(strings, undefined, 0);
it('writes independent UTF-16 page and handle fixtures without changing string contents', () => {
  const values = ['ab', 'é', '', '😀', '東京', '\uFEFF ', 'tail '];
  const bytes = encodeModelStringDictionary(values, { flags: 3, hashHeader, pageChars: 6 });
  expect(bytes).toEqual(dictionary([dense(values.slice(0, 3)), dense(values.slice(3, 5)), dense(values.slice(5, 6)), dense(values.slice(6))]));
  expect(decodeModelStringDictionary(bytes, { flags: 3 })).toEqual(values);
});
it('writes empty dictionaries, exact character budgets and strings larger than the page target', () => {
  expect(encodeModelStringDictionary([])).toEqual(dictionary([], { hash: false }));
  for (const values of [[''], ['abcdef', 'g']]) {
    const maxChars = values.join('').length, bytes = encodeModelStringDictionary(values, { pageChars: 2, maxChars });
    expect(decodeModelStringDictionary(bytes, { maxChars })).toEqual(values);
  }
  expect(() => encodeModelStringDictionary(['abcdef', 'g'], { maxChars: 6 })).toThrow(/limit/);
});
it('rewrites compressed strings losslessly as native uncompressed pages', () => {
  const values = decodeModelStringDictionary(dictionary([compressed()]), { flags: 3 });
  const bytes = encodeModelStringDictionary(values, { flags: 3, hashHeader });
  expect(bytes).toEqual(dictionary([dense(['Female', 'Male'])]));
});
it('requires the declared hash profile and allows duplicate values only with a persisted hash', () => {
  const values = ['', '', 'x', 'x'];
  expect(decodeModelStringDictionary(encodeModelStringDictionary(values, { flags: 1, hashHeader }), { flags: 1 })).toEqual(values);
  expect(() => encodeModelStringDictionary(values)).toThrow(/duplicate/);
  expect(() => encodeModelStringDictionary(['a'], { flags: 1 })).toThrow(/hash/);
  expect(() => encodeModelStringDictionary(['a'], { hashHeader })).toThrow(/unexpected/);
  for (const header of [{ ...hashHeader, algorithm: -1 }, { ...hashHeader, entrySize: 0 }, { ...hashHeader, binSize: 7 }, { ...hashHeader, localCount: 8 }]) expect(() => encodeModelStringDictionary(['a'], { flags: 1, hashHeader: header })).toThrow(/hash/);
});
it('rejects invalid UTF-16, embedded terminators and excessive encoder declarations', () => {
  for (const value of ['x\0y', '\uD800', '\uDC00', '\uD800a', null, 12]) expect(() => encodeModelStringDictionary([value])).toThrow();
  for (const options of [{ flags: 8 }, { pageChars: 0 }, { pageChars: Infinity }, { maxChars: -1 }, { maxItems: 0 }]) expect(() => encodeModelStringDictionary(['a'], options)).toThrow();
});
it('exposes explicit dictionary storage and hash policy for coordinated write operations', () => {
  const table = { path: 'folder/table.xml', read: () => new TextEncoder().encode(metadata()) }, file = { path: 'folder/declared.dictionary', read: () => dictionary([plain(['first', 'last'])]) };
  const result = readModelDictionary({ files: [table, file] }, table, 'Labels');
  expect(result.storage).toEqual({ path: file.path, flags: 3, operatingOn32: false, hashHeader });
  expect(decodeModelStringDictionary(encodeModelStringDictionary(result.values, result.storage), result.storage)).toEqual(result.values);
});
