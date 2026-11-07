import { expect, it } from 'vitest';
import { decodeModelColumnIds, encodeModelColumnIds, encodeModelMappingIds, decodeModelMappingIds, readModelColumnStorage, readModelColumnIdentifiers } from '../src/core/data-model-columns.js';
const widths = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 16, 21, 32];
const join = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let at = 0; for (const p of parts) { out.set(p, at); at += p.length; } return out; };
const framed = body => { const header = new Uint8Array(8); new DataView(header.buffer).setBigUint64(0, BigInt(body.length / 8), true); return join(header, body); };
// Independent byte/bit fixture construction avoids the decoder's 64-bit operations.
function packed(values, bits, min) {
  const slots = Math.floor(64 / bits), out = new Uint8Array(Math.ceil(values.length / slots) * 8);
  values.forEach((v, i) => {
    const position = Math.floor(i / slots) * 64 + i % slots * bits, delta = v - min;
    for (let bit = 0; bit < bits; bit++) if (Math.floor(delta / 2 ** bit) % 2) out[Math.floor((position + bit) / 8)] += 2 ** ((position + bit) % 8);
  });
  return framed(out);
}
function runs(entries, padding = 0) {
  const out = new Uint8Array((entries.length + padding) * 8), view = new DataView(out.buffer);
  entries.forEach(([value, count], i) => { view.setInt32(i * 8, value, true); view.setUint32(i * 8 + 4, count, true); });
  return framed(out);
}
it.each(widths)('decodes %s-bit no-split words across boundaries and byte-array offsets', bits => {
  const min = bits === 32 ? -2147483648 : -3, max = min + 2 ** bits - 1;
  const values = Array.from({ length: Math.floor(64 / bits) * 3 + 1 }, (_, i) => i % 3 ? min + i % Math.min(17, 2 ** bits) : max);
  const bytes = packed(values, bits, min), enveloped = join(new Uint8Array(3), bytes, new Uint8Array(5));
  expect([...decodeModelColumnIds(enveloped.subarray(3, -5), [{ type: 'packed', records: values.length, min, bits }])]).toEqual(values);
});
it('combines literal RLE runs with consecutive packed offsets and ignores zero file padding', () => {
  const values = [3, 4, 17, 9, 8];
  const bytes = join(runs([[55, 70], [-1, 2], [4, 64], [-3, 3]], 3), packed(values, 5, 3), new Uint8Array(3));
  const actual = decodeModelColumnIds(bytes, [{ type: 'hybrid', bits: 5, min: 3, records: 139, allocated: 14, used: 8 }]);
  expect([...actual]).toEqual([...Array(70).fill(55), 3, 4, ...Array(64).fill(4), 17, 9, 8]);
});
it('decodes all-RLE, empty and implicit sequence segments', () => {
  expect([...decodeModelColumnIds(join(runs([[19, 64]]), framed(new Uint8Array())), [{ type: 'hybrid', records: 64, bits: 1, min: 7 }])]).toEqual(Array(64).fill(19));
  expect(decodeModelColumnIds(join(framed(new Uint8Array()), framed(new Uint8Array())), [{ type: 'hybrid', records: 0, bits: 4, min: 3 }])).toHaveLength(0);
  expect([...decodeModelColumnIds(join(runs([[-1, 4]], 2), framed(new Uint8Array())), [{ type: 'sequence', records: 4, min: 31 }])]).toEqual([31, 32, 33, 34]);
});
it('uses each segment compression and minimum without assuming one width per file', () => {
  const bytes = join(runs([[7, 16384]]), framed(new Uint8Array()), packed([100, 108, 102], 4, 100));
  const ids = decodeModelColumnIds(bytes, [{ type: 'hybrid', bits: 1, min: 0, records: 16384 }, { type: 'packed', bits: 4, min: 100, records: 3 }]);
  expect(ids.length).toBe(16387); expect([...ids.slice(-4)]).toEqual([7, 100, 108, 102]);
});
it('rejects truncation, inconsistent lengths, invalid offsets, padding, and limits', () => {
  const spec = { type: 'hybrid', bits: 4, min: 3, records: 2 }, good = join(runs([[-1, 2]]), packed([3, 4], 4, 3));
  for (let length = 0; length < good.length; length++) expect(() => decodeModelColumnIds(good.subarray(0, length), [spec])).toThrow();
  const excessive = good.slice(); excessive.fill(255, 0, 8);
  const invalid = [excessive, join(runs([[-2, 2]]), packed([3, 4], 4, 3)), join(runs([[-1, 3]]), packed([3, 4], 4, 3)),
    join(runs([[3, 2]]), framed(new Uint8Array())), join(good, Uint8Array.of(1)), join(runs([[-1, 0]]), packed([3, 4], 4, 3))];
  for (const bytes of invalid) expect(() => decodeModelColumnIds(bytes, [spec])).toThrow();
  expect(() => decodeModelColumnIds(good, [spec], { maxIds: 1 })).toThrow(/limit/);
  expect(() => decodeModelColumnIds(good, [{ ...spec, allocated: 4 }])).toThrow(/allocation/);
  expect(() => decodeModelColumnIds(good, [{ ...spec, used: 1 }])).toThrow(/used/);
  expect(() => decodeModelColumnIds(good, [{ ...spec, bits: 11 }])).toThrow(/compression/);
  expect(() => decodeModelColumnIds(packed([2147483648], 1, 2147483647), [{ type: 'packed', bits: 1, min: 2147483647, records: 1 }])).toThrow(/bounds/);
  expect(() => decodeModelColumnIds(join(good, good), [spec, spec])).toThrow(/nonfinal/);
});
it('rejects malformed sequence compression instead of inventing row numbers', () => {
  const spec = { type: 'sequence', records: 3, min: 0 };
  expect(() => decodeModelColumnIds(join(runs([[-1, 3]]), framed(new Uint8Array(8))), [spec])).toThrow(/subsegment/);
  expect(() => decodeModelColumnIds(join(runs([[-1, 1], [-2, 2]]), framed(new Uint8Array())), [spec])).toThrow(/run/);
  expect(() => decodeModelColumnIds(join(runs([[-1, 3]]), framed(new Uint8Array())), [{ ...spec, min: 2000000000 }])).toThrow(/bounds/);
});
const ns = 'http://schemas.microsoft.com/analysisservices/imbi';
const object = (type, content, name = '') => `<XMObject class="${type.replaceAll('<', '&lt;')}" name="${name}">${content}</XMObject>`;
const props = values => `<Properties>${Object.entries(values).map(([k, v]) => `<${k}>${v}</${k}>`).join('')}</Properties>`;
const member = (name, content) => `<Member><Name>${name}</Name>${content}</Member>`;
const collection = (name, content) => `<Collection><Name>${name}</Name>${content}</Collection>`;
function metadata() {
  const info = object('XMRENoSplitCompressionInfo<6>', props({ Min: 10 }));
  const segment = object('XMColumnSegment', props({ Records: 3 }) + `<Members>${member('CompressionInfo', info)}</Members>`);
  const column = object('XMRawColumn', `<Collections>${collection('Segments', segment)}</Collections><DataObjects><DataObject>${object('XMRawColumnPartitionDataObject', props({ Partition: 9, SegmentCount: 1 }), 'opaque.idf')}</DataObject></DataObjects>`, 'Amounts');
  return object('XMSimpleTable', `<Collections>${collection('Partitions', object('XMPartition', props({ Partition: 9 })))}${collection('Columns', column)}</Collections>`, 'Orders').replace('<XMObject', `<XMObject xmlns="${ns}"`);
}
const comparisonMetadata = properties => metadata().replace('class="XMRawColumn" name="Amounts">', `class="XMRawColumn" name="Amounts">${properties}`);
it('reads native column locale and collation without applying ASSL or host defaults', () => {
  const xml = comparisonMetadata('<Properties><Locale xsi:type="xsd:long" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">1033</Locale><Collation>Latin1_General_100_AS</Collation><Language>1055</Language></Properties>');
  expect(readModelColumnStorage(xml).columns[0].comparison).toEqual({ locale: 1033, collation: 'Latin1_General_100_AS' });
  expect(readModelColumnStorage(metadata()).columns[0]).not.toHaveProperty('comparison');
  expect(readModelColumnStorage(comparisonMetadata('<Properties><Locale>0</Locale><Collation/></Properties>')).columns[0].comparison).toEqual({ locale: 0, collation: '' });
});
it('does not read comparison properties from foreign namespaces or nested objects', () => {
  const xml = comparisonMetadata('<Properties><x:Locale xmlns:x="urn:foreign">1033</x:Locale><x:Collation xmlns:x="urn:foreign">wrong</x:Collation><Other><Locale>1041</Locale></Other></Properties>');
  expect(readModelColumnStorage(xml).columns[0]).not.toHaveProperty('comparison');
});
it.each(['<Locale>-1</Locale>', '<Locale>1033</Locale><Locale>1041</Locale>', '<Collation>A</Collation><Collation>B</Collation>', '<Locale><Value>1033</Value></Locale>'])('rejects invalid native comparison properties %s', content => {
  expect(() => readModelColumnStorage(comparisonMetadata(`<Properties>${content}</Properties>`))).toThrow(/Data Model comparison/);
});
it('rejects ambiguous native property containers', () => {
  expect(() => readModelColumnStorage(comparisonMetadata('<Properties/><Properties/>'))).toThrow(/duplicate column Properties/);
});
it('resolves column data through declared partition file identities in the metadata folder', () => {
  const xml = metadata(), schema = readModelColumnStorage(xml);
  expect(schema).toMatchObject({ name: 'Orders', partitions: [9], columns: [{ name: 'Amounts', files: [{ name: 'opaque.idf', partition: 9, segments: 1 }], segments: [{ type: 'packed', bits: 6, min: 10, records: 3 }] }] });
  const table = { path: 'group/storage.xml', read: () => new TextEncoder().encode(xml) }, data = { path: 'group/opaque.idf', read: () => packed([10, 22, 13], 6, 10) };
  const archive = { files: [{ path: 'other/opaque.idf', read: () => { throw Error('wrong scope'); } }, table, data] };
  expect([...readModelColumnIdentifiers(archive, table, 'Amounts')]).toEqual([10, 22, 13]);
  expect(() => readModelColumnIdentifiers(archive, table, 'Caption')).toThrow(/column/);
  expect(() => readModelColumnIdentifiers(archive, { ...table }, 'Amounts')).toThrow(/foreign/);
  archive.files.push(data); expect(() => readModelColumnIdentifiers(archive, table, 'Amounts')).toThrow(/duplicate/);
});
it('rejects malformed or unsupported storage metadata', () => {
  const xml = metadata();
  for (const input of [xml.replace(ns, 'urn:foreign'), xml.replace('Records>3', 'Records>-1'), xml.replace('Info&lt;6>', 'Info&lt;11>'),
    xml.replace('SegmentCount>1', 'SegmentCount>0'), xml.replace('XMRawColumn"', 'OtherColumn"'), xml.replace('<Min>10</Min>', '<Min>10</Min><Min>11</Min>')]) {
    expect(() => readModelColumnStorage(input)).toThrow();
  }
});
it('checks both copies of hybrid metadata against actual subsegment records and allocation', () => {
  const info = object('XMRENoSplitCompressionInfo<6>', props({ Min: 10 }));
  const sub = object('XMColumnSegment', props({ Records: 3 }) + `<Members>${member('CompressionInfo', info)}</Members>`);
  const rle = object('XMRLECompressionInfo', props({ BookmarkBits: 1, StorageAllocSize: 2, StorageUsedSize: 2, SegmentNeedsResizing: false }));
  const hybrid = object('XMHybridRLECompressionInfo<class XMRENoSplitCompressionInfo<6>>', `<Members>${member('RLECompression', rle)}${member('SubCompression', info)}</Members>`);
  const xml = metadata().replace(`<Members>${member('CompressionInfo', info)}</Members>`, `<Members>${member('SubSegment', sub)}${member('CompressionInfo', hybrid)}</Members>`);
  const segment = readModelColumnStorage(xml).columns[0].segments[0], data = join(runs([[-1, 3]]), packed([12, 19, 13], 6, 10));
  expect([...decodeModelColumnIds(data, [segment])]).toEqual([12, 19, 13]);
  expect(() => readModelColumnStorage(xml.replace('<Min>10</Min>', '<Min>11</Min>'))).toThrow(/conflicting/);
  expect(() => decodeModelColumnIds(data, [{ ...segment, packedRecords: 2 }])).toThrow(/record count/);
  expect(() => readModelColumnStorage(xml.replace('SegmentNeedsResizing>false', 'SegmentNeedsResizing>true'))).toThrow(/unsettled/);
});

it.each(widths)('encodes %s-bit identifiers to an independent byte fixture', bits => {
  const min = bits === 32 ? -2147483648 : -3, max = min + 2 ** bits - 1;
  const values = Array.from({ length: Math.floor(64 / bits) * 3 + 1 }, (_, i) => i % 3 ? min + i % Math.min(17, 2 ** bits) : max);
  const segments = [{ type: 'packed', records: values.length, min, bits }];
  const result = encodeModelColumnIds(values, segments);
  expect(result.bytes).toEqual(packed(values, bits, min));
  expect(result.segments).toEqual(segments);
  expect([...decodeModelColumnIds(result.bytes, result.segments)]).toEqual(values);
});
it('encodes mixed RLE runs and packed values with consecutive subsegment offsets', () => {
  const values = [...Array(70).fill(99), 3, 4, 17, ...Array(64).fill(25), 5, 6];
  const original = [{ type: 'hybrid', records: values.length, bits: 5, min: 3, allocated: 2, used: 2, packedRecords: 1 }];
  const result = encodeModelColumnIds(values, original);
  expect(result.bytes).toEqual(join(runs([[99, 70], [-1, 3], [25, 64], [-4, 2]]), packed([3, 4, 17, 5, 6], 5, 3)));
  expect(result.segments[0]).toMatchObject({ allocated: 8, used: 8, packedRecords: 5 });
  expect(original[0]).toMatchObject({ allocated: 2, used: 2, packedRecords: 1 });
  expect([...decodeModelColumnIds(result.bytes, result.segments)]).toEqual(values);
});
it('uses the 64-record threshold and packs negative identifiers even in long runs', () => {
  const values = [...Array(63).fill(7), ...Array(64).fill(9), ...Array(65).fill(-2)];
  const result = encodeModelColumnIds(values, [{ type: 'hybrid', records: values.length, bits: 4, min: -2 }]);
  expect(result.bytes).toEqual(join(runs([[-1, 63], [9, 64], [-64, 65]]), packed([...Array(63).fill(7), ...Array(65).fill(-2)], 4, -2)));
  expect([...decodeModelColumnIds(result.bytes, result.segments)]).toEqual(values);
});
it('preserves declared RLE allocation padding and supports empty/all-RLE segments', () => {
  const result = encodeModelColumnIds(Array(64).fill(1000), [{ type: 'hybrid', records: 64, bits: 1, min: 0, allocated: 8, used: 4 }]);
  expect(result.bytes).toEqual(join(runs([[1000, 64]], 3), framed(new Uint8Array())));
  expect(result.segments[0]).toMatchObject({ allocated: 8, used: 4, packedRecords: 0 });
  const empty = encodeModelColumnIds([], [{ type: 'hybrid', records: 0, bits: 1, min: 0 }]);
  expect(empty.bytes).toEqual(join(framed(new Uint8Array()), framed(new Uint8Array())));
  expect(decodeModelColumnIds(empty.bytes, empty.segments)).toHaveLength(0);
});
it('encodes implicit row numbers across full and partial segments without storing their values', () => {
  const values = Int32Array.from({ length: 16387 }, (_, i) => 20 + i);
  const segments = [{ type: 'sequence', records: 16384, min: 20 }, { type: 'sequence', records: 3, min: 16404 }];
  const result = encodeModelColumnIds(values, segments);
  expect(result.bytes).toEqual(join(runs([[-1, 16384]]), framed(new Uint8Array()), runs([[-1, 3]]), framed(new Uint8Array())));
  expect(decodeModelColumnIds(result.bytes, result.segments)).toEqual(values);
  values[16385]++; expect(() => encodeModelColumnIds(values, segments)).toThrow(/sequence/);
});
it('supports independently sized mapping segments with the same exact packing', () => {
  const values = [-4, -1, 0, 2147483647], segments = [{ type: 'packed', records: 2, min: -4, bits: 2 }, { type: 'packed', records: 2, min: 0, bits: 32 }];
  const result = encodeModelMappingIds(values, segments);
  expect(result.bytes).toEqual(join(packed(values.slice(0, 2), 2, -4), packed(values.slice(2), 32, 0)));
  expect([...decodeModelMappingIds(result.bytes, result.segments)]).toEqual(values);
  expect(() => encodeModelColumnIds(values, segments)).toThrow(/nonfinal/);
  expect(() => encodeModelMappingIds([], [{ type: 'hybrid', records: 0, bits: 1, min: 0 }])).toThrow(/mapping/);
});
it('refuses invalid input, insufficient widths, inconsistent counts and excessive allocation', () => {
  const spec = { type: 'packed', records: 1, bits: 2, min: 3 };
  for (const values of [[2], [7], [NaN], [Infinity], [3.5], [2147483648], [,]]) expect(() => encodeModelColumnIds(values, [spec])).toThrow();
  expect(() => encodeModelColumnIds([3, 4], [spec])).toThrow(/count/);
  expect(() => encodeModelColumnIds(new Uint32Array([3]), [spec])).toThrow(/input/);
  expect(() => encodeModelColumnIds([3], [spec], { maxIds: 0 })).toThrow(/limit/);
  expect(() => encodeModelColumnIds([3], [{ ...spec, bits: 11 }])).toThrow(/compression/);
  expect(() => encodeModelColumnIds([3], [{ ...spec, type: 'hybrid', allocated: 67108864 }])).toThrow(/size limit/);
});

function partitionedMetadata({records=[3,2],equal=false}={}) {
  const maps=records.map(n=>object(equal?'XMSegmentEqualMapEx<XMSegmentEqualMap_FastInstantiation>':'XMSegment1Map',props(equal?{Segments:1,Records:n,RecordsPerSegment:n}:{Records:n}))).join('');
  const segments=records.map(n=>object('XMColumnSegment',props({Records:n})+`<Members>${member('CompressionInfo',object('XMRENoSplitCompressionInfo<6>',props({Min:10})))}</Members>`)).join('');
  const files=[1,0].map(i=>`<DataObject>${object('XMRawColumnPartitionDataObject',props({Partition:[9,4][i],SegmentCount:1}),'p'+i+'.idf')}</DataObject>`).join('');
  const column=object('XMRawColumn',`<Collections>${collection('Segments',segments)}</Collections><DataObjects>${files}</DataObjects>`,'Amounts');
  const map=object('XMMultiPartSegmentMap',props({FirstPartitionRecordCount:987654321,FirstPartitionSegmentCount:987654321})+`<Collections>${collection('Partitions',maps)}</Collections>`);
  return object('XMSimpleTable',`<Members>${member('SegmentMap',map)}</Members><Collections>${collection('Partitions',[9,4].map(Partition=>object('XMPartition',props({Partition}))).join(''))}${collection('Columns',column)}</Collections>`,'Orders').replace('<XMObject',`<XMObject xmlns="${ns}"`);
}
it.each([false,true])('uses table partition maps with equal=%s and ignores unused first-partition fields',equal=>{
  const xml=partitionedMetadata({equal}),table={path:'scope/table.xml',read:()=>new TextEncoder().encode(xml)},archive={files:[table,{path:'scope/p0.idf',read:()=>packed([10,22,13],6,10)},{path:'scope/p1.idf',read:()=>packed([11,14],6,10)}]};
  expect(readModelColumnStorage(xml).partitionMaps).toEqual([{partition:9,segments:1,records:3,perSegment:equal?3:null},{partition:4,segments:1,records:2,perSegment:equal?2:null}]);
  expect([...readModelColumnIdentifiers(archive,table,'Amounts')]).toEqual([10,22,13,11,14]);
});
it('rejects table/column partition disagreements before reading identifier files',()=>{
  const xml=partitionedMetadata();
  for(const altered of [xml.replace('<Records>3</Records>','<Records>4</Records>'),xml.replace('<SegmentCount>1','<SegmentCount>2'),xml.replace('<Partition>4','<Partition>5'),xml.replace('XMMultiPartSegmentMap','UnknownMap')]) {
    const table={path:'scope/table.xml',read:()=>new TextEncoder().encode(altered)},archive={files:[table,{path:'scope/p0.idf',read:()=>{throw Error('must not read')}}]};
    expect(()=>readModelColumnIdentifiers(archive,table,'Amounts')).toThrow(/partition.*map|partition file|unsupported segment map/);
  }
  const shape=partitionedMetadata({equal:true}).replace('<Segments>1','<Segments>2');
  expect(()=>readModelColumnStorage(shape)).toThrow(/partition segment map/);
});
