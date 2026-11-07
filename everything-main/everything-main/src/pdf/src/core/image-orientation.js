import { crc32 } from '../lib/crc32.js';

export const IMAGE_ORIENTATION_KEY = 'PuterImageOrientation';

/** Locate a standard, inline EXIF orientation tag without reading outside its APP1 segment. */
function jpegOrientationTag(bytes) {
  if (!(bytes?.[0] === 0xff && bytes[1] === 0xd8)) return null;
  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let at = 2;
    while (at + 4 <= bytes.length && bytes[at] === 0xff) {
      while (bytes[at + 1] === 0xff) at++;
      if (at + 4 > bytes.length) break;
      const marker = bytes[at + 1];
      if (marker === 0xda || marker === 0xd9) break;
      // TEM is a standalone marker: the next two bytes belong to the next marker,
      // not to a segment length. EXIF metadata can follow it.
      if (marker === 1) {
        at += 2;
        continue;
      }
      const length = view.getUint16(at + 2);
      const end = at + 2 + length;
      if (length < 2 || end > bytes.length) return null;
      if (
        marker === 0xe1 &&
        String.fromCharCode(...bytes.subarray(at + 4, at + 10)) === 'Exif\0\0'
      ) {
        return tiffOrientationTag(view, at + 10, end);
      }
      at = end;
    }
  } catch {
    // A truncated or malformed header counts as upright.
  }
  return null;
}

/** Read the first TIFF directory's inline orientation, bounded by the metadata container. */
function tiffOrientationTag(view, tiff, end) {
  if (tiff + 8 > end) return null;
  const order = view.getUint16(tiff);
  if (order !== 0x4949 && order !== 0x4d4d) return null;
  const little = order === 0x4949;
  if (view.getUint16(tiff + 2, little) !== 42) return null;
  const ifd = tiff + view.getUint32(tiff + 4, little);
  if (ifd < tiff + 8 || ifd + 2 > end) return null;
  const entries = view.getUint16(ifd, little);
  for (let i = 0; i < entries; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > end) return null;
    if (view.getUint16(entry, little) !== 0x0112) continue;
    if (view.getUint16(entry + 2, little) !== 3 || view.getUint32(entry + 4, little) !== 1)
      return null;
    const value = view.getUint16(entry + 8, little);
    return value >= 1 && value <= 8 ? { value, offset: entry + 8, little } : null;
  }
  return null;
}

/** PNG eXIf contains a TIFF profile without the JPEG APP1/Exif prefix. */
function pngOrientationTag(bytes) {
  if (bytes?.length < 8) return null;
  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint32(0) !== 0x89504e47 || view.getUint32(4) !== 0x0d0a1a0a) return null;
    for (let at = 8; at + 12 <= bytes.length;) {
      const length = view.getUint32(at);
      const start = at + 4;
      const end = at + 8 + length;
      if (end + 4 > bytes.length) return null;
      const type = view.getUint32(start);
      if (type === 0x65584966) {
        if (crc32(bytes.subarray(start, end)) !== view.getUint32(end)) return null;
        const tag = tiffOrientationTag(view, at + 8, end);
        return tag ? { ...tag, crc: { start, end } } : null;
      }
      // eXIf must precede IDAT; browsers ignore later orientation hints too.
      if (type === 0x49444154 || type === 0x49454e44) return null;
      at = end + 4;
    }
  } catch {
    // A truncated or malformed header counts as upright.
  }
  return null;
}

/** The EXIF orientation of a JPEG, 1 to 8; 1 when it is upright or has none. */
export const jpegOrientation = (bytes) => jpegOrientationTag(bytes)?.value ?? 1;

/**
 * Remove the decoder's orientation hint while preserving every encoded pixel. The caller
 * must apply imageOrientationMatrix in PDF graphics space, so viewers agree on orientation.
 */
export function prepareImageOrientation(bytes) {
  const tag = jpegOrientationTag(bytes) ?? pngOrientationTag(bytes);
  if (!tag || tag.value === 1) return { bytes, orientation: 1 };
  const copy = new Uint8Array(bytes);
  const view = new DataView(copy.buffer, copy.byteOffset, copy.byteLength);
  view.setUint16(tag.offset, 1, tag.little);
  if (tag.crc) view.setUint32(tag.crc.end, crc32(copy.subarray(tag.crc.start, tag.crc.end)));
  return { bytes: copy, orientation: tag.value };
}

/** Map a raw image's unit square into its upright square, in PDF's upward y coordinates. */
export function imageOrientationMatrix(orientation) {
  return [
    [1, 0, 0, 1, 0, 0],
    [-1, 0, 0, 1, 1, 0],
    [-1, 0, 0, -1, 1, 1],
    [1, 0, 0, -1, 0, 1],
    [0, -1, -1, 0, 1, 1],
    [0, -1, 1, 0, 0, 1],
    [0, 1, 1, 0, 0, 0],
    [0, 1, -1, 0, 1, 0],
  ][orientation - 1];
}
