// Bounded readers for OpenType (big endian) and EOT (little endian).
export class FontFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FontFormatError";
  }
}

export const requireBytes = (
  bytes: Uint8Array,
  offset: number,
  length: number,
  context: string,
): void => {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    offset < 0 ||
    length < 0 ||
    offset > bytes.length - length
  )
    throw new FontFormatError(`${context}: data exceeds font bounds`);
};

export const viewOf = (bytes: Uint8Array): DataView =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

export const utf16 = (bytes: Uint8Array, littleEndian: boolean): string => {
  if (bytes.length % 2)
    throw new FontFormatError("font string has an odd UTF-16 byte length");
  try {
    // ignoreBOM retains U+FEFF: font strings are arrays of code units, not
    // encoded text files with an optional byte-order marker.
    return new TextDecoder(littleEndian ? "utf-16le" : "utf-16be", {
      fatal: true,
      ignoreBOM: true,
    }).decode(bytes);
  } catch {
    throw new FontFormatError("font string contains invalid UTF-16");
  }
};

export const utf16le = (text: string): Uint8Array => {
  const bytes = new Uint8Array(text.length * 2);
  const view = viewOf(bytes);
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff))
        throw new FontFormatError("font string contains invalid UTF-16");
      view.setUint16(i * 2, unit, true);
      view.setUint16(++i * 2, next, true);
    } else {
      if (unit >= 0xdc00 && unit <= 0xdfff)
        throw new FontFormatError("font string contains invalid UTF-16");
      view.setUint16(i * 2, unit, true);
    }
  }
  return bytes;
};
