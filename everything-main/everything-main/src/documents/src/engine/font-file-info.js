import { readFontMetadata } from './font-metadata.js';
import { normalizeFontBuffer } from './font-container.js';
import { checkedFontName } from './font-families.js';

// Original, bounded readers for OpenType name and fvar tables. FontFace still
// validates the outlines before any face becomes available to the document.
export function readFontFileInfo(buffer) {
  buffer = normalizeFontBuffer(buffer);
  const metadata = readFontMetadata(buffer);
  if (!metadata) throw new Error('Choose a valid TrueType (.ttf), OpenType (.otf) or WOFF 1.0 font. Font collections and WOFF2 are not supported.');
  const v = new DataView(buffer), tables = new Map();
  for (let i = 0; i < v.getUint16(4); i++) {
    const p = 12 + i * 16;
    tables.set(String.fromCharCode(...[0, 1, 2, 3].map(j => v.getUint8(p + j))), new DataView(buffer, v.getUint32(p + 8), v.getUint32(p + 12)));
  }
  const n = tables.get('name');
  if (!n || n.byteLength < 6) throw new Error('The font has no usable naming table.');
  const version = n.getUint16(0), count = n.getUint16(2), storage = n.getUint16(4), end = 6 + count * 12;
  if (version > 1 || end > n.byteLength || storage < end || storage > n.byteLength) throw new Error('The font naming table is malformed.');
  const utf16 = (at, length) => {
    if (length % 2 || at + length > n.byteLength) return null;
    try { return new TextDecoder('utf-16be', { fatal: true }).decode(new Uint8Array(buffer, n.byteOffset + at, length)); } catch { return null; }
  };
  const languages = [];
  if (version === 1) {
    if (end + 2 > storage) throw new Error('The font language table is malformed.');
    const total = n.getUint16(end);
    if (end + 2 + total * 4 > storage) throw new Error('The font language table is malformed.');
    for (let i = 0; i < total; i++) languages.push(utf16(storage + n.getUint16(end + 4 + i * 4), n.getUint16(end + 2 + i * 4)));
  }
  const names = new Map(), allNames = new Map();
  for (let i = 0; i < count; i++) {
    const p = 6 + i * 12, platform = n.getUint16(p), encoding = n.getUint16(p + 2), language = n.getUint16(p + 4), id = n.getUint16(p + 6);
    if (![1, 4, 6, 16].includes(id) || language >= 0x8000 && (!version || !languages[language - 0x8000])) continue;
    const length = n.getUint16(p + 8), at = storage + n.getUint16(p + 10);
    if (!length || length > 506 || at + length > n.byteLength) continue;
    let value;
    if (platform === 0 || platform === 3 && [0, 1, 10].includes(encoding)) value = utf16(at, length);
    else if (platform === 1 && encoding === 0) {
      try { value = new TextDecoder('macintosh', { fatal: true }).decode(new Uint8Array(buffer, n.byteOffset + at, length)); } catch { continue; }
    } else continue;
    try { value = checkedFontName(value).trim(); } catch { continue; }
    if (id === 6 && (value.length > 63 || /[^\x21-\x7e]|[\[\](){}<>/%]/.test(value))) continue;
    if (!allNames.has(id)) allNames.set(id, new Set());
    allNames.get(id).add(value);
    const english = language >= 0x8000 ? /^en(?:-|$)/i.test(languages[language - 0x8000]) : platform === 3 ? (language & 1023) === 9 : language === 0;
    const score = (english ? 10 : 0) + (platform === 3 ? 3 : platform === 0 ? 2 : 1);
    if (!names.has(id) || names.get(id).score < score) names.set(id, { value, score });
  }
  const family = names.get(16)?.value || names.get(1)?.value, legacyFamily = names.get(1)?.value || family;
  const fullName = names.get(4)?.value, postscriptName = names.get(6)?.value;
  if (!family || !fullName || !postscriptName) throw new Error('The font needs family, full and PostScript names.');
  const axes = {}, f = tables.get('fvar');
  if (f) {
    if (f.byteLength < 16 || f.getUint32(0) !== 0x10000) throw new Error('The font variation table is malformed.');
    const start = f.getUint16(4), total = f.getUint16(8), size = f.getUint16(10);
    if (start < 16 || size < 20 || start + total * size > f.byteLength) throw new Error('The font variation axes are malformed.');
    for (let i = 0; i < total; i++) {
      const p = start + i * size, tag = String.fromCharCode(...[0, 1, 2, 3].map(j => f.getUint8(p + j)));
      const [min, initial, max] = [4, 8, 12].map(j => f.getInt32(p + j) / 65536);
      if (Object.hasOwn(axes, tag) || min > initial || initial > max) throw new Error('The font variation range is malformed.');
      axes[tag] = { min, initial, max };
    }
  }
  return { family, legacyFamily, fullName, postscriptName, metadata, axes,
    familyNames: [...(allNames.get(16) || allNames.get(1))], legacyNames: [...(allNames.get(1) || allNames.get(16))],
    exactNames: [...allNames.get(4), ...allNames.get(6)] };
}
