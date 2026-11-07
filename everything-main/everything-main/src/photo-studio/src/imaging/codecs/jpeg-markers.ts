// JPEG marker-segment surgery (ITU-T T.81 annex B), JFIF density (JFIF 1.02),
// ICC profiles in APP2 "ICC_PROFILE" chunks (ICC.1 annex B.4) and the EXIF
// orientation tag (Exif 2.3, a TIFF structure inside APP1 "Exif\0\0").
import { ByteWriter, CodecError, asciiAt, concatBytes } from './bytes';

export type JpegSegment = {
  marker: number;
  // Offset of the 0xFF marker byte.
  offset: number;
  // Payload after the two length bytes (empty for standalone markers).
  data: Uint8Array;
};

export function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

// Segments from SOI up to and including SOS; the entropy-coded data after
// SOS is not parsed.
export function readJpegSegments(jpeg: Uint8Array): { segments: JpegSegment[]; scanOffset: number } {
  if (!isJpeg(jpeg)) throw new CodecError('Not a JPEG file.');
  const segments: JpegSegment[] = [{ marker: 0xd8, offset: 0, data: new Uint8Array(0) }];
  let p = 2;
  while (p < jpeg.length) {
    if (jpeg[p] !== 0xff) throw new CodecError('Corrupt JPEG marker structure.');
    while (jpeg[p] === 0xff && p < jpeg.length) p++; // fill bytes
    const marker = jpeg[p++];
    const offset = p - 2;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      segments.push({ marker, offset, data: new Uint8Array(0) });
      continue;
    }
    if (marker === 0xd9) {
      segments.push({ marker, offset, data: new Uint8Array(0) });
      return { segments, scanOffset: p };
    }
    if (p + 2 > jpeg.length) throw new CodecError('JPEG segment is truncated.');
    const len = (jpeg[p] << 8) | jpeg[p + 1];
    if (len < 2 || p + len > jpeg.length) throw new CodecError('JPEG segment is truncated.');
    segments.push({ marker, offset, data: jpeg.subarray(p + 2, p + len) });
    p += len;
    if (marker === 0xda) return { segments, scanOffset: p };
  }
  throw new CodecError('JPEG has no image data.');
}

function segmentBytes(marker: number, data: Uint8Array): Uint8Array {
  if (data.length + 2 > 0xffff) throw new CodecError('JPEG segment is too large.');
  const out = new Uint8Array(data.length + 4);
  out[0] = 0xff;
  out[1] = marker;
  out[2] = (data.length + 2) >> 8;
  out[3] = (data.length + 2) & 255;
  out.set(data, 4);
  return out;
}

const isIcc = (s: JpegSegment) => s.marker === 0xe2 && asciiAt(s.data, 0, 12) === 'ICC_PROFILE\0';
const isJfif = (s: JpegSegment) => s.marker === 0xe0 && asciiAt(s.data, 0, 5) === 'JFIF\0';
const isExif = (s: JpegSegment) => s.marker === 0xe1 && asciiAt(s.data, 0, 6) === 'Exif\0\0';

// Rebuilds the file: drops segments matching `drop`, inserts `insert` after
// the leading APP0/APP1 run (JFIF must stay first, EXIF right after it).
function rewrite(jpeg: Uint8Array, drop: (s: JpegSegment) => boolean, insert: Uint8Array[], atStart = false): Uint8Array {
  const { segments, scanOffset } = readJpegSegments(jpeg);
  const parts: Uint8Array[] = [new Uint8Array([0xff, 0xd8])];
  let inserted = false;
  const body = segments.slice(1);
  const ends = body.map((_, i) => (i + 1 < body.length ? body[i + 1].offset : scanOffset));
  if (atStart) {
    parts.push(...insert);
    inserted = true;
  }
  for (let i = 0; i < body.length; i++) {
    const s = body[i];
    if (!inserted && s.marker !== 0xe0 && s.marker !== 0xe1) {
      parts.push(...insert);
      inserted = true;
    }
    if (drop(s)) continue;
    parts.push(jpeg.subarray(s.offset, ends[i]));
  }
  if (!inserted) parts.push(...insert);
  parts.push(jpeg.subarray(scanOffset));
  return concatBytes(parts);
}

// Max ICC bytes per APP2 segment: 65535 - 2 (length) - 12 (tag) - 2 (seq/count).
export const ICC_CHUNK_SIZE = 65519;

export function insertJpegIcc(jpeg: Uint8Array, profile: Uint8Array): Uint8Array {
  const count = Math.ceil(profile.length / ICC_CHUNK_SIZE);
  if (!count) return rewrite(jpeg, isIcc, []);
  if (count > 255) throw new CodecError('ICC profile is too large for a JPEG file.');
  const segs: Uint8Array[] = [];
  for (let i = 0; i < count; i++) {
    const part = profile.subarray(i * ICC_CHUNK_SIZE, (i + 1) * ICC_CHUNK_SIZE);
    const w = new ByteWriter(part.length + 14);
    w.ascii('ICC_PROFILE');
    w.u8(0);
    w.u8(i + 1);
    w.u8(count);
    w.bytes(part);
    segs.push(segmentBytes(0xe2, w.result()));
  }
  return rewrite(jpeg, isIcc, segs);
}

export function readJpegIcc(jpeg: Uint8Array): Uint8Array | undefined {
  const parts = readJpegSegments(jpeg).segments.filter(isIcc);
  if (!parts.length) return undefined;
  const sorted = parts.map((s) => ({ seq: s.data[12], data: s.data.subarray(14) })).sort((a, b) => a.seq - b.seq);
  return concatBytes(sorted.map((s) => s.data));
}

// Sets the JFIF density in dots per inch, adding a JFIF APP0 if missing.
export function setJpegDensity(jpeg: Uint8Array, dpiX: number, dpiY = dpiX): Uint8Array {
  const x = Math.max(1, Math.min(65535, Math.round(dpiX)));
  const y = Math.max(1, Math.min(65535, Math.round(dpiY)));
  const { segments } = readJpegSegments(jpeg);
  const jfif = segments.find(isJfif);
  if (jfif && jfif.data.length >= 12) {
    const out = jpeg.slice();
    const at = jfif.offset + 4;
    out[at + 7] = 1;
    out[at + 8] = x >> 8;
    out[at + 9] = x & 255;
    out[at + 10] = y >> 8;
    out[at + 11] = y & 255;
    return out;
  }
  const app0 = segmentBytes(0xe0, new Uint8Array([0x4a, 0x46, 0x49, 0x46, 0, 1, 2, 1, x >> 8, x & 255, y >> 8, y & 255, 0, 0]));
  return rewrite(jpeg, () => false, [app0], true);
}

export function readJpegDensity(jpeg: Uint8Array): { x: number; y: number; unit: 'none' | 'inch' | 'cm' } | undefined {
  const jfif = readJpegSegments(jpeg).segments.find(isJfif);
  if (!jfif || jfif.data.length < 12) return undefined;
  const d = jfif.data;
  return { x: (d[8] << 8) | d[9], y: (d[10] << 8) | d[11], unit: d[7] === 1 ? 'inch' : d[7] === 2 ? 'cm' : 'none' };
}

export type JpegInfo = { width: number; height: number; components: number; bitsPerSample: number; progressive: boolean };
export function readJpegInfo(jpeg: Uint8Array): JpegInfo {
  const sof = readJpegSegments(jpeg).segments.find((s) => s.marker >= 0xc0 && s.marker <= 0xcf && s.marker !== 0xc4 && s.marker !== 0xc8 && s.marker !== 0xcc);
  if (!sof || sof.data.length < 6) throw new CodecError('JPEG has no frame header.');
  const d = sof.data;
  return { bitsPerSample: d[0], height: (d[1] << 8) | d[2], width: (d[3] << 8) | d[4], components: d[5], progressive: sof.marker === 0xc2 || sof.marker === 0xc6 || sof.marker === 0xca || sof.marker === 0xce };
}

// Locates the orientation value inside a TIFF-structured EXIF block.
// Returns the byte offset of the SHORT value and the byte order.
function findOrientation(tiff: Uint8Array): { at: number; le: boolean } | undefined {
  if (tiff.length < 8) return undefined;
  const le = tiff[0] === 0x49 && tiff[1] === 0x49;
  if (!le && !(tiff[0] === 0x4d && tiff[1] === 0x4d)) return undefined;
  const dv = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
  if (dv.getUint16(2, le) !== 42) return undefined;
  const ifd = dv.getUint32(4, le);
  if (ifd + 2 > tiff.length) return undefined;
  const n = dv.getUint16(ifd, le);
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12;
    if (e + 12 > tiff.length) return undefined;
    if (dv.getUint16(e, le) === 0x0112 && dv.getUint16(e + 2, le) === 3) return { at: e + 8, le };
  }
  return undefined;
}

// Orientation 1-8 from a TIFF-structured EXIF block (also used by HEIF/WebP/PNG eXIf).
export function readExifOrientation(tiff: Uint8Array): number | undefined {
  const f = findOrientation(tiff);
  if (!f) return undefined;
  const v = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength).getUint16(f.at, f.le);
  return v >= 1 && v <= 8 ? v : undefined;
}

export function readJpegExifOrientation(jpeg: Uint8Array): number | undefined {
  const exif = readJpegSegments(jpeg).segments.find(isExif);
  return exif ? readExifOrientation(exif.data.subarray(6)) : undefined;
}

// Rewrites an existing orientation tag (for example to 1 after the pixels
// were rotated). Files without the tag are returned unchanged.
export function setJpegExifOrientation(jpeg: Uint8Array, value: number): Uint8Array {
  const exif = readJpegSegments(jpeg).segments.find(isExif);
  if (!exif) return jpeg;
  const f = findOrientation(exif.data.subarray(6));
  if (!f) return jpeg;
  const out = jpeg.slice();
  const at = exif.offset + 4 + 6 + f.at;
  if (f.le) {
    out[at] = value & 255;
    out[at + 1] = value >> 8;
  } else {
    out[at] = value >> 8;
    out[at + 1] = value & 255;
  }
  return out;
}
