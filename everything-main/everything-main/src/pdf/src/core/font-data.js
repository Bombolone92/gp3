/** Reject error pages and truncated SFNT downloads before they enter the font cache.
 * The font parsers still validate the individual tables when reading the font. */
export function checkedFontData(bytes, purpose) {
  const invalid = () => new Error(`Could not load the ${purpose} font. Please retry.`);
  if (!(bytes instanceof ArrayBuffer) || bytes.byteLength < 12) throw invalid();
  const data = new DataView(bytes);
  // TrueType, OpenType with CFF outlines, and the Apple TrueType signature.
  if (![0x00010000, 0x4f54544f, 0x74727565].includes(data.getUint32(0))) throw invalid();
  const tables = data.getUint16(4);
  if (!tables || 12 + tables * 16 > bytes.byteLength) throw invalid();
  for (let i = 0; i < tables; i++) {
    const record = 12 + i * 16;
    const offset = data.getUint32(record + 8),
      length = data.getUint32(record + 12);
    if (offset > bytes.byteLength || length > bytes.byteLength - offset) throw invalid();
  }
  return bytes;
}
