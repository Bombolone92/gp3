/** Bounded TIFF directory reader. Never follow EXIF, SubIFD or page chains. */
import { check, LIMITS } from './binary.js';
import { imageSize } from './image.js';
import { Unzlib } from 'fflate';

export const MAX_IMAGE_PIXELS = 16 * 1024 * 1024;
export function checkPixels(width, height) {
  check(Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0 && width <= 32768 && height <= 32768 && width * height <= MAX_IMAGE_PIXELS, 'A picture exceeds the 16 megapixel decoding limit.');
}

export function tiffDirectory(bytes) {
  const dimensions = imageSize(bytes); check(dimensions, 'The TIFF picture has an invalid image directory.');
  checkPixels(dimensions.width, dimensions.height);
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), little = bytes[0] === 73;
  const start = v.getUint32(4, little), count = v.getUint16(start, little), ifd = {};
  // Only tags consumed by the pixel decoder. No metadata pointers are passed
  // to UTIF.decode(), whose directory walker is unbounded on cyclic input.
  const tags = new Set([256, 257, 258, 259, 262, 266, 273, 274, 277, 278, 279, 284, 292, 293, 317, 320, 322, 323, 324, 325, 338, 339, 347, 513, 514, 529, 530, 531, 532]);
  let values = 0;
  for (let i = 0; i < count; i++) {
    const p = start + 2 + 12 * i, tag = v.getUint16(p, little); if (!tags.has(tag)) continue;
    check(!ifd[`t${tag}`], 'The TIFF picture contains duplicate image tags.');
    const type = v.getUint16(p + 2, little), n = v.getUint32(p + 4, little), unit = { 1: 1, 3: 2, 4: 4, 5: 8, 7: 1 }[type];
    values += n; check(unit && values <= 262144, 'The TIFF picture has excessive or invalid image tags.');
    const offset = n * unit > 4 ? v.getUint32(p + 8, little) : p + 8;
    check(offset + n * unit <= bytes.length, 'The TIFF picture contains a truncated image tag.');
    ifd[`t${tag}`] = Array.from({ length: n }, (_, j) => {
      const q = offset + j * unit;
      return unit === 1 ? bytes[q] : unit === 2 ? v.getUint16(q, little) : unit === 4 ? v.getUint32(q, little) : v.getUint32(q, little) / (v.getUint32(q + 4, little) || 1);
    });
  }
  const get = (tag, fallback) => ifd[`t${tag}`]?.[0] ?? fallback;
  const bits = ifd.t258 || [1], channels = get(277, 1), compression = get(259, 1), photometric = get(262, 1);
  check([1, 3, 4, 5, 6, 7, 8, 32773].includes(compression), 'This TIFF compression is not supported.');
  check([0, 1, 2, 3, 5, 6].includes(photometric) && channels >= 1 && channels <= 4 && bits.length <= 4 && bits.every((n) => [1, 2, 4, 8, 16].includes(n)) && get(284, 1) === 1 && get(339, 1) === 1, 'This TIFF color layout is not supported.');
  const offsets = ifd.t273 || ifd.t324, sizes = ifd.t279 || ifd.t325;
  check(offsets?.length && sizes?.length === offsets.length && offsets.length <= 65536, 'The TIFF picture has invalid strip or tile data.');
  let packed = 0;
  for (let i = 0; i < offsets.length; i++) { check(sizes[i] > 0 && offsets[i] + sizes[i] <= bytes.length); packed += sizes[i]; }
  check(packed <= LIMITS.expanded, 'The TIFF picture reuses too much compressed data.');
  if (ifd.t322 || ifd.t323) {
    checkPixels(get(322, 0), get(323, 0));
    check(Math.ceil(dimensions.width / get(322)) * Math.ceil(dimensions.height / get(323)) === offsets.length, 'The TIFF picture has an invalid tile grid.');
  } else {
    const rows = get(278, dimensions.height); check(rows > 0 && Math.ceil(dimensions.height / rows) === offsets.length, 'The TIFF picture has an invalid strip count.');
  }
  return { ifd, multiplePages: v.getUint32(start + 2 + count * 12, little) !== 0 };
}

export async function decodeTiff(bytes) {
  const { ifd, multiplePages } = tiffDirectory(bytes), { default: UTIF } = await import('utif');
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const decompress = UTIF.decode._decompress;
  // UTIF's default DEFLATE path allocates the entire inflated stream before
  // copying it. Bound each strip/tile to its destination buffer instead.
  UTIF.decode._decompress = (img, ifds, data, offset, length, compression, target, targetOffset, fillOrder) => {
    if (compression !== 8) return decompress(img, ifds, data, offset, length, compression, target, targetOffset, fillOrder);
    let used = targetOffset;
    const stream = new Unzlib((chunk) => { check(used + chunk.length <= target.length, 'The TIFF strip expands beyond its image dimensions.'); target.set(chunk, used); used += chunk.length; });
    for (let p = 0; p < length; p += 1024) stream.push(data.subarray(offset + p, offset + Math.min(length, p + 1024)), p + 1024 >= length);
  };
  try { UTIF.decodeImage(buffer, ifd, [ifd]); } finally { UTIF.decode._decompress = decompress; }
  check(ifd.data?.length, 'The TIFF picture could not be decoded.');
  const pixels = UTIF.toRGBA8(ifd); check(pixels.length === ifd.width * ifd.height * 4);
  return { pixels, width: ifd.width, height: ifd.height, orientation: ifd.t274?.[0] || 1, multiplePages };
}
