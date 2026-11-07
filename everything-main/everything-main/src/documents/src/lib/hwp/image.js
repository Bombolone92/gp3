/** Image metadata only: no pixel decoding, network access, or DOM allocation. */
export const IMAGE_MIMES = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp', tif: 'image/tiff', emf: 'image/x-emf', wmf: 'image/x-wmf' };
const canonical = (ext) => ({ jpeg: 'jpg', jpe: 'jpg', tiff: 'tif', dib: 'bmp' }[ext] || ext);
const size = (width, height) => width > 0 && height > 0 && width <= 1000000 && height <= 1000000 ? { width, height } : null;
function dibHeader(bytes) {
  if (bytes.length < 12) return 0;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), header = v.getUint32(0, true);
  if (![12, 40, 52, 56, 108, 124].includes(header) || bytes.length < header) return 0;
  return v.getUint16(header === 12 ? 8 : 12, true) === 1 && [1, 4, 8, 16, 24, 32].includes(v.getUint16(header === 12 ? 10 : 14, true)) ? header : 0;
}
export function imageFormat(bytes) {
  const n = bytes.length, v = new DataView(bytes.buffer, bytes.byteOffset, n);
  if (n >= 8 && v.getUint32(0) === 0x89504e47 && v.getUint32(4) === 0x0d0a1a0a) return 'png';
  if (n >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'jpg';
  if (n >= 6 && /GIF8[79]a/.test(String.fromCharCode(...bytes.subarray(0, 6)))) return 'gif';
  if (n >= 26 && bytes[0] === 66 && bytes[1] === 77) return 'bmp';
  if (dibHeader(bytes)) return 'dib';
  if (n >= 12 && v.getUint32(0) === 0x52494646 && v.getUint32(8) === 0x57454250) return 'webp';
  if (n >= 8 && [0x49492a00, 0x4d4d002a].includes(v.getUint32(0))) return 'tif';
  if (n >= 88 && v.getUint32(0, true) === 1 && v.getUint32(40, true) === 0x464d4520) return 'emf';
  if (n >= 40 && v.getUint32(0, true) === 0x9ac6cdd7 || n >= 18 && [1, 2].includes(v.getUint16(0, true)) && v.getUint16(2, true) === 9 && [0x100, 0x300].includes(v.getUint16(4, true))) return 'wmf';
  return null;
}

export function imageResource(bytes, ext = '', mime = '') {
  let detected = imageFormat(bytes);
  if (detected === 'dib') {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), header = dibHeader(bytes), bits = v.getUint16(header === 12 ? 10 : 14, true);
    const compression = header === 12 ? 0 : v.getUint32(16, true), palette = bits <= 8 ? (header === 12 ? 0 : v.getUint32(32, true)) || 2 ** bits : 0;
    const offset = 14 + header + palette * (header === 12 ? 3 : 4) + (header === 40 && [3, 6].includes(compression) ? compression === 6 ? 16 : 12 : 0);
    const bmp = new Uint8Array(bytes.length + 14), out = new DataView(bmp.buffer); bmp.set([66, 77]); out.setUint32(2, bmp.length, true); out.setUint32(10, offset, true); bmp.set(bytes, 14); bytes = bmp; detected = 'bmp';
  }
  ext = detected || canonical(Object.keys(IMAGE_MIMES).find((key) => IMAGE_MIMES[key] === mime.toLowerCase()) || ext.toLowerCase());
  return { bytes, ext, dimensions: imageSize(bytes) };
}

export function imageSize(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), n = bytes.length;
  if (n >= 24 && view.getUint32(0) === 0x89504e47 && view.getUint32(4) === 0x0d0a1a0a && view.getUint32(12) === 0x49484452) return size(view.getUint32(16), view.getUint32(20));
  if (n >= 10 && bytes[0] === 71 && bytes[1] === 73 && bytes[2] === 70) return size(view.getUint16(6, true), view.getUint16(8, true));
  if (n >= 26 && bytes[0] === 66 && bytes[1] === 77) {
    if (view.getUint32(14, true) === 12) return size(view.getUint16(18, true), view.getUint16(20, true));
    return size(view.getInt32(18, true), Math.abs(view.getInt32(22, true)));
  }
  const format = imageFormat(bytes);
  if (format === 'webp') {
    const end = Math.min(n, view.getUint32(4, true) + 8), u24 = (p) => bytes[p] | bytes[p + 1] << 8 | bytes[p + 2] << 16;
    for (let p = 12; p + 8 <= end;) {
      const type = view.getUint32(p), length = view.getUint32(p + 4, true), start = p + 8;
      if (start + length > end) return null;
      if (type === 0x56503858 && length >= 10) return size(1 + u24(start + 4), 1 + u24(start + 7));
      if (type === 0x5650384c && length >= 5 && bytes[start] === 0x2f) { const bits = view.getUint32(start + 1, true); return size(1 + (bits & 16383), 1 + ((bits >>> 14) & 16383)); }
      if (type === 0x56503820 && length >= 10 && bytes[start + 3] === 0x9d && bytes[start + 4] === 1 && bytes[start + 5] === 0x2a) return size(view.getUint16(start + 6, true) & 16383, view.getUint16(start + 8, true) & 16383);
      p = start + length + (length & 1);
    }
  }
  if (format === 'tif') {
    const little = bytes[0] === 73, p = view.getUint32(4, little);
    if (p < 8 || p + 2 > n) return null;
    const count = view.getUint16(p, little); if (p + 2 + count * 12 + 4 > n) return null;
    let width, height;
    for (let i = 0; i < count; i++) {
      const q = p + 2 + i * 12, tag = view.getUint16(q, little), type = view.getUint16(q + 2, little);
      if ((tag === 256 || tag === 257) && view.getUint32(q + 4, little) === 1 && [3, 4].includes(type)) {
        const value = type === 3 ? view.getUint16(q + 8, little) : view.getUint32(q + 8, little);
        if (tag === 256) width = value; else height = value;
      }
    }
    return size(width, height);
  }
  if (format === 'emf') return size(view.getInt32(16, true) - view.getInt32(8, true), view.getInt32(20, true) - view.getInt32(12, true));
  if (format === 'wmf' && view.getUint32(0, true) === 0x9ac6cdd7) {
    const units = view.getUint16(14, true);
    return units ? size((view.getInt16(10, true) - view.getInt16(6, true)) * 96 / units, (view.getInt16(12, true) - view.getInt16(8, true)) * 96 / units) : null;
  }
  if (n >= 4 && bytes[0] === 255 && bytes[1] === 216) {
    let p = 2;
    while (p + 3 < n) {
      if (bytes[p++] !== 255) return null;
      while (p < n && bytes[p] === 255) p++;
      const marker = bytes[p++];
      if (marker === 217 || marker === 218) break;
      if (marker === 1 || marker >= 208 && marker <= 215) continue;
      if (p + 2 > n) break;
      const length = view.getUint16(p);
      if (length < 2 || p + length > n) break;
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker) && length >= 7) return size(view.getUint16(p + 5), view.getUint16(p + 3));
      p += length;
    }
  }
  return null;
}

/** HWP and HWPX store a source-coordinate rectangle, not four crop insets. */
export function imageCrop(clip, dimensions, warnings) {
  if (!clip || Object.values(clip).every((n) => n === -1) || Object.values(clip).every((n) => n === 0)) return null;
  const { left = 0, top = 0, right = dimensions?.width, bottom = dimensions?.height } = clip;
  if (!dimensions || ![left, top, right, bottom].every(Number.isFinite) || right <= left || bottom <= top) {
    warnings.add('A picture crop could not be resolved; the complete image is retained.'); return null;
  }
  const { width, height } = dimensions;
  if (!(width > 0 && height > 0)) return null;
  // Negative insets are intentional outsets in DrawingML. Clamping them to
  // zero changes both the crop and the scale of the visible source pixels.
  const pct = (n) => Math.round(Math.max(-21474, Math.min(21474, n)) * 100000);
  return { l: pct(left / width), t: pct(top / height), r: pct(1 - right / width), b: pct(1 - bottom / height) };
}

export function imageDimensions(run) {
  const intrinsic = run.image?.dimensions;
  let width = run.width, height = run.height;
  if (!(width > 0)) width = height > 0 && intrinsic ? height * intrinsic.width / intrinsic.height : intrinsic?.width * 75 || 14400;
  if (!(height > 0)) height = intrinsic ? width * intrinsic.height / intrinsic.width : 14400;
  return { width, height };
}
