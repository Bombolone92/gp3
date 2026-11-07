import { crc32 } from '../../src/core/split.js';

/** Add a standard PNG eXIf chunk after IHDR, without touching its encoded pixels. */
export function pngExif(png, orientation, little = true) {
  const chunk = Buffer.alloc(38);
  chunk.writeUInt32BE(26, 0);
  chunk.write('eXIf', 4);
  const view = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  view.setUint16(8, little ? 0x4949 : 0x4d4d);
  view.setUint16(10, 42, little);
  view.setUint32(12, 8, little);
  view.setUint16(16, 1, little);
  view.setUint16(18, 0x0112, little);
  view.setUint16(20, 3, little);
  view.setUint32(22, 1, little);
  view.setUint16(26, orientation, little);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, -4)), chunk.length - 4);
  return Buffer.concat([png.subarray(0, 33), chunk, png.subarray(33)]);
}
