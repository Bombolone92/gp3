/** Portable BMP decoding and PNG encoding, including indexed and RLE bitmaps. */
import { zlibSync, strToU8 } from 'fflate';
import { check, joinBytes } from './binary.js';
import { checkPixels } from './tiff.js';

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let i = 0; i < 8; i++) value = value >>> 1 ^ (value & 1 ? 0xedb88320 : 0);
  return value >>> 0;
});

export function decodeBmp(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), n = bytes.length;
  check(n >= 26 && bytes[0] === 66 && bytes[1] === 77, 'The BMP header is damaged.');
  const offset = v.getUint32(10, true), header = v.getUint32(14, true), core = header === 12;
  check([12, 40, 52, 56, 108, 124].includes(header) && 14 + header <= n && offset >= 14 + header && offset <= n, 'The BMP header is not supported.');
  const width = core ? v.getUint16(18, true) : v.getInt32(18, true), rawHeight = core ? v.getUint16(20, true) : v.getInt32(22, true), height = Math.abs(rawHeight);
  checkPixels(width, height);
  const planes = v.getUint16(core ? 22 : 26, true), bits = v.getUint16(core ? 24 : 28, true), compression = core ? 0 : v.getUint32(30, true);
  check(planes === 1 && [1, 4, 8, 16, 24, 32].includes(bits) && [0, 1, 2, 3, 6].includes(compression), 'The BMP pixel layout is not supported.');
  check(compression !== 1 || bits === 8); check(compression !== 2 || bits === 4); check(![3, 6].includes(compression) || [16, 32].includes(bits));
  const pixels = new Uint8Array(width * height * 4), masks = bits === 16 ? [0x7c00, 0x3e0, 0x1f, 0] : [0xff0000, 0xff00, 0xff, 0];
  let paletteStart = 14 + header;
  if ([3, 6].includes(compression)) {
    const count = compression === 6 || header >= 56 ? 4 : 3;
    check(54 + count * 4 <= offset);
    for (let i = 0; i < count; i++) masks[i] = v.getUint32(54 + i * 4, true);
    if (header === 40) paletteStart += count * 4;
    check(masks.slice(0, 3).every(Boolean) && !(masks[0] & masks[1]) && !(masks[0] & masks[2]) && !(masks[1] & masks[2]));
  }
  const palette = [], paletteSize = bits <= 8 ? (core ? 0 : v.getUint32(46, true)) || 2 ** bits : 0, entrySize = core ? 3 : 4;
  check(paletteSize <= 256 && paletteStart + paletteSize * entrySize <= offset);
  for (let i = 0; i < paletteSize; i++) { const p = paletteStart + i * entrySize; palette.push([bytes[p + 2], bytes[p + 1], bytes[p], 255]); }
  function indexed(x, y, index) {
    check(x >= 0 && x < width && y >= 0 && y < height && palette[index], 'The BMP pixel data is damaged.');
    pixels.set(palette[index], ((height - 1 - y) * width + x) * 4);
  }
  if (compression === 1 || compression === 2) {
    check(rawHeight > 0); for (let i = 0; i < width * height; i++) pixels.set(palette[0], i * 4);
    let p = offset, x = 0, y = 0, done = false;
    while (p + 2 <= n) {
      const count = bytes[p++], value = bytes[p++];
      if (count) { for (let i = 0; i < count; i++) indexed(x++, y, bits === 8 ? value : (i & 1 ? value & 15 : value >>> 4)); }
      else if (value === 0) { x = 0; y++; check(y <= height); }
      else if (value === 1) { done = true; break; }
      else if (value === 2) { check(p + 2 <= n); x += bytes[p++]; y += bytes[p++]; check(x <= width && y < height); }
      else {
        const length = bits === 8 ? value : Math.ceil(value / 2); check(p + length + (length & 1) <= n);
        for (let i = 0; i < value; i++) indexed(x++, y, bits === 8 ? bytes[p + i] : (i & 1 ? bytes[p + (i >>> 1)] & 15 : bytes[p + (i >>> 1)] >>> 4));
        p += length + (length & 1);
      }
    }
    check(done, 'The RLE bitmap is truncated.');
  } else {
    const stride = Math.ceil(width * bits / 32) * 4; check(offset + stride * height <= n, 'The BMP pixel data is truncated.');
    const channel = (value, mask) => { if (!mask) return 255; let shift = 0; while (!((mask >>> shift) & 1)) shift++; const max = mask >>> shift; return Math.round(((value & mask) >>> shift) * 255 / max); };
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const row = offset + (rawHeight < 0 ? y : height - 1 - y) * stride, out = (y * width + x) * 4; let rgba;
      if (bits <= 8) { const index = bits === 8 ? bytes[row + x] : bits === 4 ? bytes[row + (x >>> 1)] >>> (x & 1 ? 0 : 4) & 15 : bytes[row + (x >>> 3)] >>> (7 - (x & 7)) & 1; rgba = palette[index]; check(rgba); }
      else if (bits === 24) { const p = row + x * 3; rgba = [bytes[p + 2], bytes[p + 1], bytes[p], 255]; }
      else { const value = bits === 16 ? v.getUint16(row + x * 2, true) : v.getUint32(row + x * 4, true); rgba = masks.map((mask) => channel(value, mask)); }
      pixels.set(rgba, out);
    }
  }
  return { pixels, width, height };
}

export function encodePng({ pixels, width, height }) {
  checkPixels(width, height); check(pixels.length === width * height * 4);
  const be = (n) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n); return b; };
  function chunk(type, bytes) {
    const body = joinBytes([strToU8(type), bytes]); let crc = 0xffffffff;
    for (const byte of body) crc = crc >>> 8 ^ crcTable[(crc ^ byte) & 255];
    return joinBytes([be(bytes.length), body, be((crc ^ 0xffffffff) >>> 0)]);
  }
  const stride = width * 4, data = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) data.set(pixels.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  return joinBytes([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', joinBytes([be(width), be(height), new Uint8Array([8, 6, 0, 0, 0])])), chunk('IDAT', zlibSync(data)), chunk('IEND', new Uint8Array())]);
}
