/** Pictures inside embedded OLE objects: the native bitmap of a Paintbrush object or the cached presentation metafile. */
import { Reader, check, compoundFile } from './binary.js';
import { imageFormat } from './image.js';

const CLIPBOARD = { 2: null, 3: 'wmf', 8: 'dib', 14: 'emf' }; // CF_BITMAP has no file form; CF_METAFILEPICT, CF_DIB, CF_ENHMETAFILE do.
const stream = (cfb, suffix) => { const name = cfb.names.find((n) => n.endsWith(suffix)); return name ? cfb.read(name) : null; };

/** The picture a viewer would show for an OLE object, or null when the object carries none we can read. */
export function oleImage(bytes) {
  if (!bytes || bytes.length < 8) return null;
  // Hanword stores the OLE compound file behind a 4-byte length; other producers store it bare.
  let cfb;
  for (const offset of [0, 4]) {
    try { cfb = compoundFile(bytes.subarray(offset)); break; } catch { cfb = null; }
  }
  if (!cfb) return imageFormat(bytes) ? bytes : null;
  const candidates = [];
  // Ole10Native: a 4-byte length, then the object's own bytes (a bitmap for Paintbrush objects).
  const native = stream(cfb, 'Ole10Native');
  if (native && native.length > 4) {
    const length = new Reader(native).u32();
    if (length > 0 && length <= native.length - 4) candidates.push(native.subarray(4, 4 + length));
  }
  for (const name of cfb.names.filter((n) => /OlePres\d{3}$/.test(n)).sort()) {
    try { const picture = presentation(cfb.read(name)); if (picture) candidates.push(picture); } catch { /* a damaged cache is not the object */ }
  }
  const contents = stream(cfb, 'CONTENTS');
  if (contents) candidates.push(contents);
  return candidates.find((c) => imageFormat(c)) || null;
}

/** MS-OLEDS OLEPresentationStream: clipboard format, optional target device, aspect, sizes, then the data. */
function presentation(bytes) {
  const r = new Reader(bytes), marker = r.u32();
  let format;
  if (marker === 0xffffffff || marker === 0xfffffffe) format = r.u32();
  else { check(marker <= r.remaining); r.skip(marker); format = null; } // a registered format name: not a bitmap or metafile
  const deviceSize = r.u32(); if (deviceSize > 4) { check(deviceSize - 4 <= r.remaining); r.skip(deviceSize - 4); }
  r.skip(16); // aspect, lindex, advf, reserved
  r.skip(8); // width, height
  const size = r.u32(); check(size <= r.remaining);
  let data = bytes.subarray(r.pos, r.pos + size);
  if (!CLIPBOARD[format]) return null;
  // Some producers write the 8-byte METAFILEPICT header before the metafile.
  if (format === 3 && !imageFormat(data) && data.length > 8 && imageFormat(data.subarray(8))) data = data.subarray(8);
  return imageFormat(data) ? data : null;
}
