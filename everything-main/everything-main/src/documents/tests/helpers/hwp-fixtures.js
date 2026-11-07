import { deflateSync, zipSync, strToU8 } from 'fflate';

export const concat = (...buffers) => new Uint8Array(Buffer.concat(buffers.map((b) => Buffer.from(b))));
export const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
export const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
export const utf16 = (s) => Buffer.from(s, 'utf16le');
export const string = (s) => concat(u16(s.length), utf16(s));
export function record(tag, level, data, extended = false) {
  return concat(u32(tag | level << 10 | (extended || data.length >= 4095 ? 4095 : data.length) << 20), extended || data.length >= 4095 ? u32(data.length) : [], data);
}
export const controlText = (code, id) => concat(u16(code), Buffer.from(id).reverse(), new Uint8Array(8), u16(code));
export function paragraph(text, { level = 0, char = 0, children = [], extended = false, changes = null } = {}) {
  const data = typeof text === 'string' ? utf16(text + '\r') : text;
  return concat(record(66, level, concat(u32(data.length / 2), u32(0), u16(0), [0, 0], u16(1), u16(0), u16(0), u32(1))), record(67, level + 1, data, extended), record(68, level + 1, changes ? concat(...changes.flatMap(([pos, shape]) => [u32(pos), u32(shape)])) : concat(u32(0), u32(char))), ...children);
}

/** Small CFB test writer with both regular and mini streams. */
export function cfb(streams, { sectorSize = 512 } = {}) {
  const FREE = 0xffffffff, END = 0xfffffffe, FAT = 0xfffffffd;
  const entries = [{ name: 'Root Entry', type: 5, children: [] }], paths = new Map([['', 0]]);
  for (const [path, bytes] of Object.entries(streams)) {
    const pieces = path.split('/'); let parent = 0, full = '';
    pieces.forEach((name, i) => {
      full += (full ? '/' : '') + name;
      if (!paths.has(full)) { const id = entries.length; entries[parent].children.push(id); paths.set(full, id); entries.push({ name, type: i === pieces.length - 1 ? 2 : 1, children: [], bytes: i === pieces.length - 1 ? bytes : undefined }); }
      parent = paths.get(full);
    });
  }
  const sectors = [], fat = [], miniFat = [], mini = [];
  function allocate(data) {
    if (!data.length) return END;
    const first = sectors.length;
    for (let p = 0; p < data.length; p += sectorSize) { const b = Buffer.alloc(sectorSize); b.set(data.subarray(p, p + sectorSize)); sectors.push(b); fat.push(p + sectorSize < data.length ? sectors.length : END); }
    return first;
  }
  for (const e of entries) if (e.bytes) {
    e.size = e.bytes.length;
    if (e.size >= 4096) e.start = allocate(e.bytes);
    else { e.start = e.size ? mini.length : END; for (let p = 0; p < e.size; p += 64) { const b = Buffer.alloc(64); b.set(e.bytes.subarray(p, p + 64)); mini.push(b); miniFat.push(p + 64 < e.size ? mini.length : END); } }
  }
  entries[0].start = allocate(concat(...mini)); entries[0].size = mini.length * 64;
  const miniData = Buffer.alloc(Math.ceil(miniFat.length * 4 / sectorSize) * sectorSize, 255); miniFat.forEach((n, i) => miniData.writeUInt32LE(n, i * 4)); const miniStart = allocate(miniData);
  const dir = Buffer.alloc(Math.ceil(entries.length * 128 / sectorSize) * sectorSize);
  entries.forEach((e, i) => {
    const p = i * 128; utf16(e.name + '\0').copy(dir, p); dir.writeUInt16LE((e.name.length + 1) * 2, p + 64); dir[p + 66] = e.type; dir[p + 67] = 1;
    dir.writeUInt32LE(FREE, p + 68); dir.writeUInt32LE(FREE, p + 72); dir.writeUInt32LE(e.children[0] ?? FREE, p + 76);
    dir.writeUInt32LE(e.start ?? END, p + 116); dir.writeUInt32LE(e.size || 0, p + 120);
    e.children.forEach((id, k) => dir.writeUInt32LE(e.children[k + 1] ?? FREE, id * 128 + 72));
  });
  // Write sibling links after all entries have been initialized.
  for (const e of entries) e.children.forEach((id, k) => dir.writeUInt32LE(e.children[k + 1] ?? FREE, id * 128 + 72));
  const dirStart = allocate(dir); let fatCount = 1;
  while (fatCount * sectorSize / 4 < sectors.length + fatCount) fatCount++;
  const fatStart = sectors.length; for (let i = 0; i < fatCount; i++) { sectors.push(Buffer.alloc(sectorSize, 255)); fat.push(FAT); }
  fat.forEach((v, i) => sectors[fatStart + Math.floor(i * 4 / sectorSize)].writeUInt32LE(v, i * 4 % sectorSize));
  const header = Buffer.alloc(sectorSize); Buffer.from('d0cf11e0a1b11ae1', 'hex').copy(header); header.writeUInt16LE(sectorSize === 512 ? 3 : 4, 26); header.writeUInt16LE(0xfffe, 28); header.writeUInt16LE(Math.log2(sectorSize), 30); header.writeUInt16LE(6, 32);
  header.writeUInt32LE(fatCount, 44); header.writeUInt32LE(dirStart, 48); header.writeUInt32LE(4096, 56); header.writeUInt32LE(miniStart, 60); header.writeUInt32LE(miniData.length / sectorSize, 64); header.writeUInt32LE(END, 68);
  header.fill(255, 76, 512); for (let i = 0; i < fatCount; i++) header.writeUInt32LE(fatStart + i, 76 + i * 4);
  return concat(header, ...sectors);
}
export function hwp({ compressed = true, flags = 0, sections = [paragraph('안녕하세요 Hanword')], sectorSize = 512, infoExtra = [], streams = {} } = {}) {
  const header = Buffer.alloc(256); header.write('HWP Document File'); header.writeUInt32LE(0x05000302, 32); header.writeUInt32LE((compressed ? 1 : 0) | flags, 36);
  const font = concat([0], string('맑은 고딕'));
  const char = (bold) => concat(new Uint8Array(14), new Uint8Array(7).fill(100), new Uint8Array(7), new Uint8Array(7).fill(100), new Uint8Array(7), u32(1200), u32(bold ? 2 : 0), [0, 0], u32(bold ? 0x000000ff : 0), u32(0), u32(0xffffffff), u32(0));
  const info = concat(record(16, 0, concat(u16(sections.length), new Uint8Array(24))), record(17, 1, concat(u32(0), ...Array(7).fill(u32(1)), new Uint8Array(40))), ...Array.from({ length: 7 }, () => record(19, 1, font)), record(21, 1, char(false)), record(21, 1, char(true)), record(25, 1, concat(u32(4), new Uint8Array(20), u32(160), new Uint8Array(18))), ...infoExtra);
  const encode = (b) => compressed ? deflateSync(b) : b;
  return cfb({ FileHeader: header, DocInfo: encode(info), ...Object.fromEntries(sections.map((s, i) => [`BodyText/Section${i}`, encode(s)])), ...streams }, { sectorSize });
}

export const HEAD_NS = 'http://www.hancom.co.kr/hwpml/2011/head';
export const PARA_NS = 'http://www.hancom.co.kr/hwpml/2011/paragraph';
export function hwpx({ sections = ['<hp:p paraPrIDRef="0" styleIDRef="0"><hp:run charPrIDRef="0"><hp:t>안녕하세요 HWPX</hp:t></hp:run></hp:p>'], header = '', extra = {}, spine = null, sectionNames = null } = {}) {
  const names = sectionNames || sections.map((_, i) => `section${i}.xml`);
  const files = {
    mimetype: strToU8('application/hwp+zip'),
    'Contents/content.hpf': strToU8(`<package xmlns="http://www.idpf.org/2007/opf"><manifest><item id="header" href="Contents/header.xml"/>${names.map((n, i) => `<item id="s${i}" href="Contents/${n}"/>`).join('')}</manifest><spine>${(spine || names.map((_, i) => i)).map((i) => `<itemref idref="s${i}"/>`).join('')}</spine></package>`),
    'Contents/header.xml': strToU8(`<hh:head xmlns:hh="${HEAD_NS}" secCnt="${sections.length}">${header || '<hh:charPr id="0" height="1200" textColor="#000000"/><hh:paraPr id="0"><hh:align horizontal="LEFT"/></hh:paraPr><hh:style id="0" name="본문" paraPrIDRef="0" charPrIDRef="0"/>'}</hh:head>`),
    ...Object.fromEntries(sections.map((s, i) => [`Contents/${names[i]}`, strToU8(`<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="${PARA_NS}">${s}</hs:sec>`)])), ...extra,
  };
  return zipSync(files);
}
