import { crc32 } from '../../src/lib/crc32.js';

/** Legal private JPEG application segments, without changing its pixel data. */
export function jpegMetadata(bytes, count) {
  const parts = [bytes.subarray(0, 2)];
  while (count > 0) {
    const size = Math.min(count, 65533);
    const part = new Uint8Array(size + 4);
    part.set([0xff, 0xef, (size + 2) >> 8, (size + 2) & 255]);
    parts.push(part);
    count -= size;
  }
  parts.push(bytes.subarray(2));
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

/** A legal private PNG ancillary chunk, without changing its pixel data. */
export function pngMetadata(bytes, count) {
  const extra = new Uint8Array(count + 12);
  const view = new DataView(extra.buffer);
  view.setUint32(0, count);
  extra.set(new TextEncoder().encode('raNd'), 4);
  view.setUint32(extra.length - 4, crc32(extra.subarray(4, extra.length - 4)));
  const result = new Uint8Array(bytes.length + extra.length);
  result.set(bytes.subarray(0, 33));
  result.set(extra, 33);
  result.set(bytes.subarray(33), 33 + extra.length);
  return result;
}
