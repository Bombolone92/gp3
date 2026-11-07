import { expect, it } from 'vitest';
import { readDataModelArchive } from '../src/core/data-model-archive.js';

const utf16 = s => new Uint8Array(Buffer.from(s, 'utf16le'));
const xml = s => utf16('\ufeff' + s);
const tag = (key, value) => `<${key}>${String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;')}</${key}>`;
const PAGE = 4096;
function marker(data) {
  // Independent bit-at-a-time implementation; CRC-32/BZIP2 check vector
  // "123456789" is FC891918 (stored little-endian in MS-XLDM).
  let crc = 0xffffffff;
  for (const b of data) {
    crc ^= b << 24;
    for (let bit = 0; bit < 8; bit++) crc = crc & 0x80000000 ? (crc << 1) ^ 0x04c11db7 : crc << 1;
  }
  const result = new Uint8Array(data.length + 4);
  result.set(data); new DataView(result.buffer).setUint32(data.length, ~crc >>> 0, true);
  return result;
}
function storedChunk(data) {
  const out = new Uint8Array(data.length + 4), view = new DataView(out.buffer);
  view.setUint16(0, data.length, true); view.setUint16(2, data.length, true); out.set(data, 4); return out;
}
function fixture({ compressed = true, checksums = true, changeHeader = s => s, changeDirectory = s => s,
  changeLog = s => s, extraStored = [], payload = utf16('<Measure>SUM(Orders[Amount])</Measure>'), secondPayload = utf16('商品 & costs') } = {}) {
  const files = [payload, secondPayload].map((data, i) => ({ data: compressed ? storedChunk(data) : data,
    size: data.length, storagePath: `FILE${i}`, path: `C:\\Model\\${i}\\metadata.xml` }));
  const log = changeLog(`<BackupLog><FileGroups>${files.map((f, i) => `<FileGroup>${tag('ID', `id${i}`)}${tag('Name', `Group ${i}`)}${tag('Class', i + 1)}${tag('PersistLocationPath', `C:\\Model\\${i}`)}<FileList><BackupFile>${tag('Path', f.path)}${tag('StoragePath', f.storagePath)}${tag('Size', f.size)}</BackupFile></FileList></FileGroup>`).join('')}</FileGroups></BackupLog>`);
  files.push(...extraStored, { data: xml(log), storagePath: 'LOG' });
  let offset = PAGE;
  for (const f of files) { f.offset = offset; f.stored = checksums ? marker(f.data) : f.data; offset += f.stored.length; }
  const directoryOffset = Math.ceil(offset / PAGE) * PAGE;
  const directory = utf16(changeDirectory(`<VirtualDirectory>${files.map(f => `<BackupFile>${tag('Path', f.storagePath)}${tag('Size', f.stored.length)}${tag('m_cbOffsetHeader', f.offset)}${tag('Delete', false)}</BackupFile>`).join('')}</VirtualDirectory>`));
  const header = xml('STREAM_STORAGE_SIGNATURE_)!@#$%^&*(' + changeHeader(`<BackupLog>${tag('BackupRestoreSyncVersion', 150)}${tag('Fault', false)}${tag('ErrorCode', checksums)}${tag('EncryptionFlag', false)}${tag('ApplyCompression', compressed)}${tag('m_cbOffsetHeader', directoryOffset)}${tag('DataSize', directory.length)}${tag('Files', files.length)}${tag('m_cbOffsetData', PAGE)}</BackupLog>`));
  const out = new Uint8Array(Math.ceil((directoryOffset + directory.length) / PAGE) * PAGE);
  out.set(header); for (const f of files) out.set(f.stored, f.offset); out.set(directory, directoryOffset);
  return out;
}

it.each([true, false])('reads compressed=%s archives without collapsing equal basenames in distinct groups', compressed => {
  const source = fixture({ compressed });
  const padded = new Uint8Array(source.length + 2); padded.set(source, 1);
  const model = readDataModelArchive(padded.subarray(1, -1));
  expect(model.version).toBe(150); expect(model.compressed).toBe(compressed);
  expect(model.files).toHaveLength(2);
  expect(model.files.map(f => f.path)).toEqual(['C:\\Model\\0\\metadata.xml', 'C:\\Model\\1\\metadata.xml']);
  expect(model.files[1].group).toEqual({ id: 'id1', name: 'Group 1', class: 2, persistPath: 'C:\\Model\\1' });
  expect(model.files[0].read()).toEqual(utf16('<Measure>SUM(Orders[Amount])</Measure>'));
  expect(model.files[1].read()).toEqual(utf16('商品 & costs'));
  const copy = model.files[0].read(); copy.fill(0); expect(model.files[0].read()).not.toEqual(copy);
  expect(model.size).toBe(model.files.reduce((sum, f) => sum + f.size, 0));
});
it('supports stored archives without CRC and optional XML declarations', () => {
  const model = readDataModelArchive(fixture({ compressed: false, checksums: false,
    changeLog: s => '<?xml version="1.0" encoding="UTF-16"?>' + s }));
  expect(model.files[1].read()).toEqual(utf16('商品 & costs'));
});
it('checks file checksums using the non-reflected algorithm', () => {
  expect([...marker(new TextEncoder().encode('123456789')).slice(-4)]).toEqual([0x18, 0x19, 0x89, 0xfc]);
  const source = fixture(); source[PAGE + 8] ^= 1;
  expect(() => readDataModelArchive(source)).toThrow(/checksum/);
});
it.each([
  ['EncryptionFlag', 'false', 'true', 'encrypted'], ['Fault', 'false', 'true', 'faulted'],
  ['Files', '3', '4', 'file count'], ['m_cbOffsetData', '4096', '4097', 'directory bounds'],
  ['DataSize', null, '9007199254740992', 'DataSize'], ['ErrorCode', 'true', 'yes', 'ErrorCode'],
])('rejects invalid %s metadata', (name, old, value, message) => {
  const source = fixture({ changeHeader: s => s.replace(new RegExp(`<${name}>[^<]*</${name}>`), tag(name, value)) });
  expect(() => readDataModelArchive(source)).toThrow(message);
});
it('rejects bad signatures, short input, duplicate required tags and DTDs', () => {
  expect(() => readDataModelArchive(new Uint8Array(PAGE - 1))).toThrow(/header/);
  const source = fixture(); source[4] ^= 1; expect(() => readDataModelArchive(source)).toThrow(/signature/);
  expect(() => readDataModelArchive(fixture({ changeHeader: s => s.replace('</BackupLog>', '<Files>3</Files></BackupLog>') }))).toThrow(/duplicate Files/);
  expect(() => readDataModelArchive(fixture({ changeLog: s => '<!DOCTYPE BackupLog>' + s }))).toThrow(/BackupLog/);
});
it('rejects missing and duplicate file mappings', () => {
  for (const changeLog of [s => s.replace('FILE0', 'MISSING'), s => s.replace('C:\\Model\\1\\metadata.xml', 'C:\\Model\\0\\metadata.xml')]) {
    expect(() => readDataModelArchive(fixture({ changeLog }))).toThrow(/file mapping/);
  }
  expect(() => readDataModelArchive(fixture({ changeDirectory: s => s.replace('FILE1', 'FILE0') }))).toThrow(/storage path/);
});
it('rejects invalid file extents and overlap before checking their checksums', () => {
  for (const value of [0, 999999]) expect(() => readDataModelArchive(fixture({ changeDirectory: s => s.replace('<m_cbOffsetHeader>4096', `<m_cbOffsetHeader>${value}`) }))).toThrow(/file bounds/);
  expect(() => readDataModelArchive(fixture({ changeDirectory: s => s.replace(/(<m_cbOffsetHeader>)(\d+)(<\/m_cbOffsetHeader>)/g, '$14096$3') }))).toThrow(/overlapping/);
});
it('enforces aggregate and per-file unpacked limits before lazy decoding', () => {
  const source = fixture();
  expect(() => readDataModelArchive(source, { maxBytes: 1 })).toThrow(/unpacked size/);
  expect(() => readDataModelArchive(source, { maxBytes: Infinity })).toThrow(/size limit/);
  expect(() => readDataModelArchive(fixture({ changeLog: s => s.replace(/<Size>\d+/, '<Size>268435457') }))).toThrow(/unpacked size/);
  expect(() => readDataModelArchive(fixture({ compressed: false, changeLog: s => s.replace(/<Size>\d+/, '<Size>1') }))).toThrow(/stored size mismatch/);
});
it('validates compressed payloads when read and never returns partial output', () => {
  const source = fixture({ checksums: false }); source[PAGE + 2] = 255;
  const model = readDataModelArchive(source);
  expect(() => model.files[0].read()).toThrow(/chunk size/);
});

it.each([true, false])('replaces declared payloads with compression=%s while preserving the original', async compressed => {
  const { replaceDataModelArchiveFiles: replace } = await import('../src/core/data-model-archive.js');
  for (const checksums of [true, false]) {
    const input = fixture({ compressed, checksums }), copy = input.slice(), original = readDataModelArchive(input);
    const replacement = Uint8Array.from({ length: 140001 }, (_, i) => i * 31 % 256);
    const result = replace(input, new Map([[original.files[0].path, replacement]])), reopened = readDataModelArchive(result);
    expect(reopened.files[0].read()).toEqual(replacement);
    expect(reopened.files[1].read()).toEqual(original.files[1].read());
    expect(reopened.files.map(f => f.group)).toEqual(original.files.map(f => f.group));
    expect(input).toEqual(copy);
    expect(reopened.size).toBe(replacement.length + original.files[1].size);
    const empty = readDataModelArchive(replace(result, new Map([[reopened.files[0].path, new Uint8Array()]])));
    expect(empty.files[0].read()).toEqual(new Uint8Array());
  }
});
it('preserves opaque control fields and updates directory bounds and independent CRCs', async () => {
  const { replaceDataModelArchiveFiles: replace } = await import('../src/core/data-model-archive.js');
  const input = fixture({ changeHeader: s => s.replace('</BackupLog>', '<ObjectID>opaque-id</ObjectID></BackupLog>'),
    changeLog: s => s.replace('<FileGroups>', '<ServerVersion>old &amp; new</ServerVersion><FileGroups>'),
    changeDirectory: s => s.replace('</VirtualDirectory>', '<Extension>retain me</Extension></VirtualDirectory>') });
  const a = readDataModelArchive(input), output = replace(input, new Map([[a.files[1].path, new Uint8Array([9, 8, 7])]]));
  const head = Buffer.from(output.subarray(0, PAGE)).toString('utf16le');
  expect(head).toContain('<ObjectID>opaque-id</ObjectID>');
  const offset = Number(head.match(/<m_cbOffsetHeader>(\d+)/)[1]), length = Number(head.match(/<DataSize>(\d+)/)[1]);
  expect(offset % PAGE).toBe(0); expect(output.length % PAGE).toBe(0);
  const directory = Buffer.from(output.subarray(offset, offset + length)).toString('utf16le');
  expect(directory).toContain('<Extension>retain me</Extension>');
  for (const entry of directory.matchAll(/<BackupFile>(.*?)<\/BackupFile>/g)) {
    const start = Number(entry[1].match(/<m_cbOffsetHeader>(\d+)/)[1]), size = Number(entry[1].match(/<Size>(\d+)/)[1]);
    const stored = output.subarray(start, start + size);
    expect(stored).toEqual(marker(stored.subarray(0, -4)));
    if (entry[1].includes('<Path>LOG</Path>')) expect(Buffer.from(stored.subarray(0, -4)).toString('utf16le')).toContain('<ServerVersion>old &amp; new</ServerVersion>');
  }
});
it('rejects unknown, oversized and aliased replacements without mutating the source', async () => {
  const { replaceDataModelArchiveFiles: replace } = await import('../src/core/data-model-archive.js');
  const input = fixture(), a = readDataModelArchive(input), path = a.files[0].path;
  expect(() => replace(input, {})).toThrow(/Map/);
  expect(() => replace(input, new Map([['not-a-file', new Uint8Array()]]))).toThrow(/unknown/);
  expect(() => replace(input, new Map([[path, [1]]]))).toThrow(/size/);
  expect(() => replace(input, new Map([[path, new Uint8Array(500)]]), { maxBytes: 200 })).toThrow(/size/);
  const alias = fixture({ changeLog: s => s.replace('<StoragePath>FILE1', '<StoragePath>FILE0') });
  expect(() => replace(alias, new Map([[path, new Uint8Array()]]))).toThrow(/shared/);
  expect(replace(input, new Map())).toEqual(input);
  expect(replace(input, new Map())).not.toBe(input);
});

it('retains opaque stored files and physical ordering when directory entries are reversed', async () => {
  const { replaceDataModelArchiveFiles: replace } = await import('../src/core/data-model-archive.js');
  const input = fixture({ extraStored: [{ data: xml('<Partitions><Partition><Name>opaque</Name></Partition></Partitions>'), storagePath: 'PARTITIONS' }, { data: new Uint8Array([99, 10, 20]), storagePath: 'deleted-file' }],
    changeDirectory: s => '<VirtualDirectory>' + [...s.matchAll(/<BackupFile>.*?<\/BackupFile>/g)].map(m => m[0].includes('deleted-file') ? m[0].replace('<Delete>false', '<Delete>true') : m[0]).reverse().join('') + '</VirtualDirectory>' });
  const a = readDataModelArchive(input), output = replace(input, new Map([[a.files[0].path, new Uint8Array([42])]]));
  function stored(bytes) {
    const header = Buffer.from(bytes.subarray(0, PAGE)).toString('utf16le'), at = Number(header.match(/<m_cbOffsetHeader>(\d+)/)[1]), len = Number(header.match(/<DataSize>(\d+)/)[1]);
    return [...Buffer.from(bytes.subarray(at, at + len)).toString('utf16le').matchAll(/<BackupFile>(.*?)<\/BackupFile>/g)].map(m => {
      const start = Number(m[1].match(/<m_cbOffsetHeader>(\d+)/)[1]), size = Number(m[1].match(/<Size>(\d+)/)[1]);
      return { path: m[1].match(/<Path>(.*?)<\/Path>/)[1], start, data: bytes.slice(start, start + size), deleted: m[1].includes('<Delete>true') };
    });
  }
  const before = stored(input), after = stored(output);
  for (const path of ['PARTITIONS', 'deleted-file', 'FILE1']) expect(after.find(f => f.path === path).data).toEqual(before.find(f => f.path === path).data);
  expect(after.find(f => f.path === 'deleted-file').deleted).toBe(true);
  expect(after.map(f => f.path)).toEqual(before.map(f => f.path));
  expect(after.sort((a,b) => a.start-b.start).map(f => f.path)).toEqual(before.sort((a,b) => a.start-b.start).map(f => f.path));
  expect(readDataModelArchive(output).files[0].read()).toEqual(new Uint8Array([42]));
});

it('allows empty unchecked files to share offsets regardless of directory order', async () => {
  const { replaceDataModelArchiveFiles: replace } = await import('../src/core/data-model-archive.js');
  const input = fixture({ compressed: false, checksums: false, payload: new Uint8Array(),
    changeDirectory: s => '<VirtualDirectory>' + [...s.matchAll(/<BackupFile>.*?<\/BackupFile>/g)].map(m => m[0]).reverse().join('') + '</VirtualDirectory>' });
  const a = readDataModelArchive(input);
  expect(a.files[0].read()).toEqual(new Uint8Array());
  const result = replace(input, new Map([[a.files[1].path, new Uint8Array([5, 6])]]));
  expect(readDataModelArchive(result).files.map(f => [...f.read()])).toEqual([[], [5, 6]]);
});

it.each([true,false])('ignores unused Delete flags on payloads and LOG with compression=%s',async compressed=>{
  const {replaceDataModelArchiveFiles:replace}=await import('../src/core/data-model-archive.js');
  for(const flag of ['true','1','false','0']) {
    const input=fixture({compressed,changeDirectory:s=>s.replaceAll('<Delete>false</Delete>',`<Delete>${flag}</Delete>`)}),before=input.slice();
    const archive=readDataModelArchive(input);expect(archive.files).toHaveLength(2);expect(archive.files[0].read()).toEqual(utf16('<Measure>SUM(Orders[Amount])</Measure>'));
    const data=new Uint8Array([8,6,7,5,3,0,9]),output=replace(input,new Map([[archive.files[0].path,data]])),reopened=readDataModelArchive(output);
    expect(reopened.files[0].read()).toEqual(data);expect(reopened.files[1].read()).toEqual(archive.files[1].read());expect(input).toEqual(before);
    const header=new TextDecoder('utf-16le').decode(output.subarray(0,PAGE)),offset=Number(header.match(/<m_cbOffsetHeader>(\d+)<\/m_cbOffsetHeader>/)[1]),size=Number(header.match(/<DataSize>(\d+)<\/DataSize>/)[1]);
    const directory=new TextDecoder('utf-16le').decode(output.subarray(offset,offset+size));
    expect([...directory.matchAll(/<Delete>(.*?)<\/Delete>/g)].map(m=>m[1])).toEqual([flag,flag,flag]);
    expect(replace(input,new Map())).toEqual(input);
  }
});
it('still validates checksums, bounds and mappings when Delete is set',()=>{
  const flagged={changeDirectory:s=>s.replaceAll('<Delete>false</Delete>','<Delete>true</Delete>')};
  const corrupt=fixture(flagged);corrupt[PAGE+8]^=1;expect(()=>readDataModelArchive(corrupt)).toThrow(/checksum/);
  expect(()=>readDataModelArchive(fixture({...flagged,changeLog:s=>s.replace('FILE0','MISSING')}))).toThrow(/file mapping/);
  expect(()=>readDataModelArchive(fixture({changeDirectory:s=>flagged.changeDirectory(s).replace('<m_cbOffsetHeader>4096','<m_cbOffsetHeader>0')}))).toThrow(/file bounds/);
});
