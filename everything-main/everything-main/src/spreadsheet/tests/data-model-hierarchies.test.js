import { readModelHierarchyHash, encodeModelHierarchyHash } from '../src/core/data-model-hash-index.js';
import { it, expect } from 'vitest';
import { decodeModelColumnIds, decodeModelMappingIds, readModelMappingIdentifiers, readModelColumnIdentifiers } from '../src/core/data-model-columns.js';
import { readModelIntrinsicHierarchy } from '../src/core/data-model-hierarchies.js';
const ns = 'http://schemas.microsoft.com/analysisservices/imbi';
const props = values => `<Properties>${Object.entries(values).map(([k,v]) => `<${k}>${v}</${k}>`).join('')}</Properties>`;
const obj = (type, content, name = '') => `<XMObject class="${type.replaceAll('<', '&lt;')}" name="${name}">${content}</XMObject>`;
const member = (name, content) => `<Member><Name>${name}</Name>${content}</Member>`;
const coll = (name, content) => `<Collection><Name>${name}</Name>${content}</Collection>`;
const document = xml => xml.replace('<XMObject', `<XMObject xmlns="${ns}"`);
const join = (...parts) => Uint8Array.from(parts.flatMap(p => [...p]));
function packed(values, bits, min = 0, padding = 0) {
  const slots = Math.floor(64 / bits), body = new Uint8Array(Math.ceil(values.length / slots) * 8 + padding * 8), out = new Uint8Array(8 + body.length);
  // Arithmetic fixture construction is independent of the decoder's bit shifts.
  values.forEach((value, i) => { const start = Math.floor(i / slots) * 64 + i % slots * bits; for (let b = 0; b < bits; b++) if (Math.floor((value - min) / 2 ** b) % 2) body[Math.floor((start + b) / 8)] += 2 ** ((start + b) % 8); });
  new DataView(out.buffer).setBigUint64(0, BigInt(body.length / 8), true); out.set(body, 8); return out;
}
it('decodes short mapping segments without weakening ordinary row-storage rules', () => {
  const segments = [{ type: 'packed', bits: 3, min: 0, records: 4 }, { type: 'packed', bits: 4, min: 7, records: 2 }];
  const bytes = join(packed([5, 3, 4, 0], 3, 0, 1), packed([7, 12], 4, 7), new Uint8Array(4));
  expect([...decodeModelMappingIds(bytes, segments)]).toEqual([5, 3, 4, 0, 7, 12]);
  expect(() => decodeModelColumnIds(bytes, segments)).toThrow(/nonfinal/);
  expect(() => decodeModelMappingIds(bytes, segments, { maxIds: 5 })).toThrow(/limit/);
  expect(() => decodeModelMappingIds(bytes, [{ ...segments[0], type: 'hybrid' }, segments[1]])).toThrow(/mapping compression/);
});
it('retains frame bounds and padding validation for mapping files', () => {
  const segment = { type: 'packed', bits: 32, min: -2147483648, records: 3 }, bytes = packed([-2147483648, 0, 2147483647], 32, segment.min);
  for (let n = 0; n < bytes.length; n++) expect(() => decodeModelMappingIds(bytes.subarray(0, n), [segment])).toThrow();
  expect(() => decodeModelMappingIds(join(bytes, [1]), [segment])).toThrow(/padding/);
  const wrapped = join([1,2,3], bytes, [4]);
  expect([...decodeModelMappingIds(wrapped.subarray(3, -1), [segment])]).toEqual([-2147483648, 0, 2147483647]);
});
function column(name, file, segmentRecords) {
  const segments = segmentRecords.map(records => obj('XMColumnSegment', props({ Records: records }) + `<Members>${member('CompressionInfo', obj('XMRENoSplitCompressionInfo<3>', props({ Min: 0 })))}</Members>`)).join('');
  return obj('XMRawColumn', `<Collections>${coll('Segments', segments)}</Collections><DataObjects><DataObject>${obj('XMRawColumnPartitionDataObject', props({ Partition: 37, SegmentCount: segmentRecords.length }), file)}</DataObject></DataObjects>`, name);
}
function storage({ settings = 260, partitions = '', segmentRecords = [4, 2], map = obj('XMSegmentEqualMapEx<XMSegmentEqualMap_ComplexInstantiation>', props({ Segments: 2, Records: 6, RecordsPerSegment: 4 })) } = {}) {
  return document(obj('XMSimpleTable', props({ Settings: settings }) + `<Members>${member('SegmentMap', map)}</Members><Collections>${coll('Partitions', partitions)}${coll('Columns', column('ID_TO_POS', 'reverse.bin', segmentRecords) + column('POS_TO_ID', 'forward.bin', segmentRecords))}</Collections>`, 'DeclaredStore'));
}
function source({ position = 0, inverse = 1, hash = '', distinct = 3, materialization = 0, processed = true, store = 'DeclaredStore' } = {}) {
  const hierarchy = obj('XMHierarchy', props({ TableStore: store, TypeMaterialization: materialization, ColumnPosition2DataID: position, ColumnDataID2Position: inverse, DistinctDataIDs: distinct, SortOrder: 0, IsProcessed: processed }) + `<DataObjects>${hash}</DataObjects>`);
  return document(obj('XMSimpleTable', `<Collections>${coll('Columns', obj('XMRawColumn', `<Members>${member('IntrinsicHierarchy', hierarchy)}</Members>`, 'Business Caption'))}</Collections>`, 'Source'));
}
function archive(sourceXml = source(), storageXml = storage()) {
  const table = { path: 'scope/source.tbl.xml', read: () => new TextEncoder().encode(sourceXml) }, mapping = { path: 'scope/unrelated-physical-name.tbl.xml', read: () => new TextEncoder().encode(storageXml) };
  const files = [table, mapping,
    { path: 'scope/reverse.bin', read: () => join(packed([0, 0, 0, 1], 3), packed([2, 0], 3)) },
    { path: 'scope/forward.bin', read: () => join(packed([5, 3, 4, 0], 3), packed([0, 0], 3)) },
    { path: 'other/unrelated-physical-name.tbl.xml', read: () => { throw Error('foreign directory'); } }];
  return [{ files }, table, mapping];
}
it('resolves TableStore by declared identity and mapping columns by their defined roles, retaining reserved slots', () => {
  const [a, t] = archive(), result = readModelIntrinsicHierarchy(a, t, 'Business Caption');
  expect(result).toMatchObject({ tableStore: 'DeclaredStore', storagePath: 'scope/unrelated-physical-name.tbl.xml', distinctDataIds: 3, sortOrder: 0, isProcessed: true, hashIndex: null });
  expect([...result.positionToId]).toEqual([5, 3, 4, 0, 0, 0]);
  expect([...result.idToPosition]).toEqual([0, 0, 0, 1, 2, 0]);
  for (let i = 0; i < result.distinctDataIds; i++) expect(result.idToPosition[result.positionToId[i]]).toBe(i);
});
it('uses explicit unpartitioned storage identities but refuses them in the row-storage reader', () => {
  const [a, , m] = archive();
  expect([...readModelMappingIdentifiers(a, m, 'POS_TO_ID')]).toEqual([5, 3, 4, 0, 0, 0]);
  expect(() => readModelColumnIdentifiers(a, m, 'POS_TO_ID')).toThrow(/table partition map counts/);
  const [b, , n] = archive(source(), storage({ partitions: obj('XMPartition', props({ Partition: 37 })) }));
  expect([...readModelMappingIdentifiers(b, n, 'POS_TO_ID')]).toEqual([5, 3, 4, 0, 0, 0]);
});
it('keeps inverse hash storage explicit without claiming to decode its contents', () => {
  const hash = `<DataObject>${obj('XMHierarchyDataID2PositionHashIndex', '', 'opaque.hash')}</DataObject>`, [a, t] = archive(source({ inverse: -1, hash, materialization: 1 }));
  a.files.push({ path: 'scope/opaque.hash', size: 500, read: () => { throw Error('hash decoder required'); } });
  const result = readModelIntrinsicHierarchy(a, t, 'Business Caption');
  expect(result.idToPosition).toBeNull(); expect(result.hashIndex).toEqual({ path: 'scope/opaque.hash', size: 500 });
  a.files.pop(); expect(() => readModelIntrinsicHierarchy(a, t, 'Business Caption')).toThrow(/hash file/);
});
it('checks hierarchy type, segment-map counts and per-segment sizes', () => {
  for (const xml of [storage({ settings: 1 }), storage({ settings: 5 }), storage().replace('Records>6', 'Records>7'), storage().replace('Segments>2', 'Segments>3'), storage().replace('RecordsPerSegment>4', 'RecordsPerSegment>5'), storage().replace('ComplexInstantiation', 'Unknown'), storage().replaceAll('SegmentCount>2', 'SegmentCount>1')]) {
    const [a, , m] = archive(source(), xml); expect(() => readModelMappingIdentifiers(a, m, 'POS_TO_ID')).toThrow();
  }
  const [a, , m] = archive(source(), storage({ settings: '+260' }).replaceAll('ComplexInstantiation', 'FastInstantiation'));
  expect(readModelMappingIdentifiers(a, m, 'POS_TO_ID')).toHaveLength(6);
});
it('supports explicitly declared single-segment and empty mapping tables', () => {
  const map = obj('XMSegment1Map', props({ Records: 0 }));
  const xml = storage({ map, segmentRecords: [0] });
  const [a, , m] = archive(source({ distinct: 0 }), xml);
  a.files[2].read = a.files[3].read = () => packed([], 3);
  expect(readModelMappingIdentifiers(a, m, 'POS_TO_ID')).toHaveLength(0);
});
it('rejects missing, duplicate and foreign hierarchy identities', () => {
  const [a, t, m] = archive();
  expect(() => readModelIntrinsicHierarchy(a, { ...t }, 'Business Caption')).toThrow(/foreign/);
  expect(() => readModelIntrinsicHierarchy(a, t, 'Other')).toThrow(/column/);
  a.files.push({ ...m, path: 'scope/another.tbl.xml' });
  expect(() => readModelIntrinsicHierarchy(a, t, 'Business Caption')).toThrow(/duplicate/);
  a.files.pop(); a.files.splice(1, 1);
  expect(() => readModelIntrinsicHierarchy(a, t, 'Business Caption')).toThrow(/hierarchy table/);
});
it('rejects mapping flag/count errors and namespace or member corruption', () => {
  for (const xml of [source({ position: 2 }), source({ position: 1 }), source({ inverse: 0 }), source({ distinct: 7 }), source({ materialization: -1 }), source({ materialization: 1 }), source().replace('SortOrder>0', 'SortOrder>1'), source().replace('services/imbi', 'services/foreign'), source().replace('IsProcessed>true', 'IsProcessed>maybe'), source().replace('class="XMHierarchy"', 'class="Unknown"'), source().replace('<TableStore>DeclaredStore</TableStore>', '<TableStore>DeclaredStore</TableStore><TableStore>Other</TableStore>')]) {
    const [a, t] = archive(xml); expect(() => readModelIntrinsicHierarchy(a, t, 'Business Caption')).toThrow();
  }
});

it('represents declared empty, identity and unprocessed hierarchies without inventing mappings', () => {
  for (const materialization of [-1, 2, 3]) {
    const [a, t] = archive(source({ position: -1, inverse: -1, distinct: 0, materialization, processed: materialization !== -1, store: '' }));
    a.files = [t];
    expect(readModelIntrinsicHierarchy(a, t, 'Business Caption')).toMatchObject({ materialization, storagePath: null, positionToId: null, idToPosition: null, hashIndex: null });
  }
  const [a, t] = archive(source({ materialization: 2 }));
  expect(() => readModelIntrinsicHierarchy(a, t, 'Business Caption')).toThrow(/unmaterialized/);
});

it('reads declared inverse hashes and rejects incomplete or inconsistent forward relationships', () => {
  const hash = `<DataObject>${obj('XMHierarchyDataID2PositionHashIndex', '', 'inverse.hash')}</DataObject>`;
  const [a, t] = archive(source({ inverse: -1, hash, materialization: 1 }));
  let bytes = encodeModelHierarchyHash(new Map([[5, 0], [3, 1], [4, 2]]));
  a.files.push({ path: 'scope/inverse.hash', size: bytes.length, read: () => bytes });
  expect([...readModelHierarchyHash(a, t, 'Business Caption')].sort()).toEqual([[3, 1], [4, 2], [5, 0]]);
  bytes = encodeModelHierarchyHash(new Map([[5, 0], [3, 2], [4, 1]]));
  expect(() => readModelHierarchyHash(a, t, 'Business Caption')).toThrow(/inverse mapping/);
  bytes = encodeModelHierarchyHash(new Map([[5, 0], [3, 1]]));
  expect(() => readModelHierarchyHash(a, t, 'Business Caption')).toThrow(/distinct identifier/);
  const [ordinary, table] = archive();
  expect(readModelHierarchyHash(ordinary, table, 'Business Caption')).toBeNull();
});
