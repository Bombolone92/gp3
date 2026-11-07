import { zlibSync, strToU8, zipSync, unzipSync, strFromU8 } from 'fflate';
import { concat, u16, u32, hwpx } from './hwp-fixtures.js';

// Independently generated, tiny valid pictures. Pixels are red then blue.
export function png(width = 2, height = 1) {
  const be = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
  function chunk(type, bytes) {
    const body = concat(strToU8(type), bytes); let crc = 0xffffffff;
    for (const byte of body) { crc ^= byte; for (let i = 0; i < 8; i++) crc = crc >>> 1 ^ (crc & 1 ? 0xedb88320 : 0); }
    return concat(be(bytes.length), body, be((crc ^ 0xffffffff) >>> 0));
  }
  const pixels = new Uint8Array(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const p = y * (width * 4 + 1) + 1 + x * 4; pixels[p + (x < width / 2 ? 0 : 2)] = 255; pixels[p + 3] = 255; }
  return concat([137, 80, 78, 71, 13, 10, 26, 10], chunk('IHDR', concat(be(width), be(height), [8, 6, 0, 0, 0])), chunk('IDAT', zlibSync(pixels)), chunk('IEND', []));
}
export function bmp() {
  const b = Buffer.alloc(62); b.write('BM'); b.writeUInt32LE(62, 2); b.writeUInt32LE(54, 10); b.writeUInt32LE(40, 14); b.writeInt32LE(2, 18); b.writeInt32LE(1, 22); b.writeUInt16LE(1, 26); b.writeUInt16LE(24, 28); b.writeUInt32LE(8, 34); b.set([0, 0, 255, 255, 0, 0], 54); return b;
}
export function tiff({ little = true, orientation = 1 } = {}) {
  const b = Buffer.alloc(158), short = (p, n) => little ? b.writeUInt16LE(n, p) : b.writeUInt16BE(n, p), long = (p, n) => little ? b.writeUInt32LE(n, p) : b.writeUInt32BE(n, p);
  b.write(little ? 'II' : 'MM'); short(2, 42); long(4, 8); short(8, 11);
  const entries = [[256, 4, 1, 2], [257, 4, 1, 1], [258, 3, 3, 146], [259, 3, 1, 1], [262, 3, 1, 2], [273, 4, 1, 152], [274, 3, 1, orientation], [277, 3, 1, 3], [278, 4, 1, 1], [279, 4, 1, 6], [284, 3, 1, 1]];
  entries.forEach(([tag, type, count, value], i) => { const p = 10 + 12 * i; short(p, tag); short(p + 2, type); long(p + 4, count); if (type === 3 && count === 1) short(p + 8, value); else long(p + 8, value); });
  short(146, 8); short(148, 8); short(150, 8); b.set([255, 0, 0, 0, 0, 255], 152); return b;
}
export function wmf() {
  const rec = (fn, ...args) => concat(u32(3 + args.length), u16(fn), ...args.map(u16));
  const body = concat(rec(0x020b, 0, 0), rec(0x020c, 100, 200), rec(0x02fc, 0, 0x00ff, 0, 0), rec(0x012d, 0), rec(0x041b, 100, 200, 0, 0), rec(0));
  return concat(u16(1), u16(9), u16(0x300), u32((18 + body.length) / 2), u16(1), u32(7), u16(0), body);
}
export function emf() {
  const rec = (type, data) => concat(u32(type), u32(8 + data.length), data);
  const header = Buffer.alloc(88); header.writeUInt32LE(1); header.writeUInt32LE(88, 4); header.writeInt32LE(200, 16); header.writeInt32LE(100, 20); header.writeUInt32LE(0x464d4520, 40); header.writeUInt32LE(0x10000, 44); header.writeUInt16LE(1, 56); header.writeInt32LE(200, 72); header.writeInt32LE(100, 76); header.writeInt32LE(53, 80); header.writeInt32LE(26, 84);
  const body = concat(rec(9, concat(u32(200), u32(100))), rec(3, concat(u32(0), u32(0), u32(200), u32(100), u32(4), u32(0), u32(0), u32(200), u32(0), u32(200), u32(100), u32(0), u32(100))), rec(14, concat(u32(0), u32(0), u32(20))));
  header.writeUInt32LE(header.length + body.length, 48); header.writeUInt32LE(4, 52); return concat(header, body);
}
export const picture = (inner = '', attrs = '', id = 'image1') => `<hp:pic ${attrs}><hp:img binaryItemIDRef="${id}"/>${inner}</hp:pic>`;
export function imageHwpx(content, images = { 'image.png': png() }) {
  const archive = unzipSync(hwpx({ sections: [`<hp:p><hp:run>${content}</hp:run></hp:p>`] }));
  const manifest = Object.entries(images).map(([path, bytes], i) => { archive[`BinData/${path}`] = bytes; return `<item id="image${i + 1}" href="../BinData/${path}"/>`; }).join('');
  archive['Contents/content.hpf'] = strToU8(strFromU8(archive['Contents/content.hpf']).replace('</manifest>', manifest + '</manifest>'));
  return zipSync(archive);
}
