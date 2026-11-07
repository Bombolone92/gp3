import {
  FontFormatError,
  requireBytes,
  utf16,
  utf16le,
  viewOf,
} from "./binary.ts";
import { readOpenTypeFont } from "./opentype.ts";
import {
  readFontEmbeddingPermissions,
  type FontEmbeddingPermissions,
} from "./permissions.ts";

// EOT member submission, including versions 1, 2.1 and 2.2. This container
// reader retains packed payloads: MTX is a separate font-table codec, not ZIP.
// https://www.w3.org/submissions/EOT/
const VERSION_1 = 0x00010000;
const VERSION_21 = 0x00020001;
const VERSION_22 = 0x00020002;
const ROOT_CHECKSUM_XOR = 0x50475342;

export interface EotFontData {
  /** Read-only view of the encoded font payload in the original container. */
  readonly data: Uint8Array;
  readonly flags: number;
  readonly compressed: boolean;
  readonly encrypted: boolean;
  readonly subset: boolean;
}

export interface EotFontInfo {
  readonly version: number;
  readonly family: string;
  readonly subfamily: string;
  readonly fullName: string;
  readonly versionName: string;
  readonly rootString: string;
  readonly panose: Uint8Array;
  readonly charset: number;
  readonly italic: boolean;
  readonly weight: number;
  readonly unicodeRanges: ReadonlyArray<number>;
  readonly codePageRanges: ReadonlyArray<number>;
  readonly checkSumAdjustment: number;
  readonly permissions: FontEmbeddingPermissions;
  readonly font: EotFontData;
  readonly eudc: (EotFontData & { readonly codePage: number }) | null;
  /** Reserved signature bytes are retained, never interpreted as font data. */
  readonly signature: Uint8Array;
}

const checksum = (bytes: Uint8Array): number => {
  let sum = 0;
  for (const byte of bytes) sum = (sum + byte) >>> 0;
  return (sum ^ ROOT_CHECKSUM_XOR) >>> 0;
};

const fontData = (data: Uint8Array, flags: number): EotFontData => ({
  data,
  flags,
  compressed: !!(flags & 4),
  encrypted: !!(flags & 0x10000000),
  subset: !!(flags & 1),
});

/** Inspect the actual header layout; no end-of-file or font-signature guesses. */
export const readEotFont = (bytes: Uint8Array): EotFontInfo => {
  requireBytes(bytes, 0, 82, "EOT header");
  const view = viewOf(bytes),
    total = view.getUint32(0, true),
    length = view.getUint32(4, true),
    version = view.getUint32(8, true),
    flags = view.getUint32(12, true);
  if (total !== bytes.length)
    throw new FontFormatError("EOT container size does not match its data");
  if (![VERSION_1, VERSION_21, VERSION_22].includes(version))
    throw new FontFormatError("unsupported EOT version");
  if (view.getUint16(34, true) !== 0x504c)
    throw new FontFormatError("invalid EOT magic number");
  for (const at of [64, 68, 72, 76])
    if (view.getUint32(at, true) !== 0)
      throw new FontFormatError("nonzero EOT reserved field");
  let at = 80;
  const u16 = () => {
    requireBytes(bytes, at, 2, "EOT field");
    const value = view.getUint16(at, true);
    at += 2;
    return value;
  };
  const u32 = () => {
    requireBytes(bytes, at, 4, "EOT field");
    const value = view.getUint32(at, true);
    at += 4;
    return value;
  };
  const take = (size: number) => {
    requireBytes(bytes, at, size, "EOT data");
    const data = bytes.subarray(at, at + size);
    at += size;
    return data;
  };
  const padding = () => {
    if (u16() !== 0) throw new FontFormatError("nonzero EOT padding");
  };
  const stringBytes = () => {
    padding();
    return take(u16());
  };
  const family = utf16(stringBytes(), true),
    subfamily = utf16(stringBytes(), true),
    versionName = utf16(stringBytes(), true),
    fullName = utf16(stringBytes(), true);
  let rootString = "",
    signature = new Uint8Array(0),
    eudc: EotFontInfo["eudc"] = null;
  if (version >= VERSION_21) {
    const root = stringBytes();
    rootString = utf16(root, true);
    if (version === VERSION_22) {
      if (u32() !== checksum(root))
        throw new FontFormatError("invalid EOT root-string checksum");
      const codePage = u32();
      padding();
      signature = Uint8Array.from(take(u16()));
      const eudcFlags = u32(),
        eudcData = take(u32());
      if (eudcData.length)
        eudc = { ...fontData(eudcData, eudcFlags), codePage };
    }
  }
  if (length === 0) throw new FontFormatError("EOT contains no font data");
  const data = take(length);
  if (at !== bytes.length)
    throw new FontFormatError("EOT contains unexpected trailing data");
  const italic = bytes[27];
  if (italic !== 0 && italic !== 1)
    throw new FontFormatError("invalid EOT italic flag");
  return {
    version,
    family,
    subfamily,
    fullName,
    versionName,
    rootString,
    signature,
    panose: Uint8Array.from(bytes.subarray(16, 26)),
    charset: bytes[26]!,
    italic: !!italic,
    weight: view.getUint32(28, true),
    unicodeRanges: [36, 40, 44, 48].map((offset) =>
      view.getUint32(offset, true),
    ),
    codePageRanges: [52, 56].map((offset) => view.getUint32(offset, true)),
    checkSumAdjustment: view.getUint32(60, true),
    permissions: readFontEmbeddingPermissions(view.getUint16(32, true)),
    font: fontData(data, flags),
    eudc,
  };
};

/** Unmask a payload before MTX decoding when compressed; never mutate it. */
export const unmaskEotFontData = (font: EotFontData): Uint8Array =>
  font.encrypted ? font.data.map((byte) => byte ^ 0x50) : font.data;

/**
 * Wrap a complete individual SFNT face for native document embedding without
 * subsetting, recompressing, renaming or otherwise rewriting any font table.
 * The caller must have permission under the font's license. This explicit
 * attestation is separate from the OS/2 bits and is not a license grant.
 * This produces a document font, not an EOT web-font authorization.
 */
export const writeEotFont = (
  bytes: Uint8Array,
  options: { embeddingAuthorized: true },
): Uint8Array => {
  if (options?.embeddingAuthorized !== true)
    throw new FontFormatError(
      "font embedding must be authorized by its license",
    );
  const info = readOpenTypeFont(bytes);
  if (!info.permissions.canEmbed)
    throw new FontFormatError("font embedding is restricted");
  if (info.permissions.bitmapOnly && info.hasOutlines)
    throw new FontFormatError("font permits bitmap embedding only");
  const names = [1, 2, 5, 4].map((id) => {
    const name = info.englishNames.get(id);
    if (name === undefined)
      throw new FontFormatError(`EOT requires English font name ${id}`);
    const data = utf16le(name);
    if (data.length > 0xffff)
      throw new FontFormatError("EOT font name exceeds its length field");
    return data;
  });
  // Fixed header + four padded strings + empty RootString + version-2.2
  // checksum/EUDC/signature fields. All integers except the SFNT are LE.
  const headerSize =
    80 + names.reduce((size, name) => size + 4 + name.length, 0) + 24;
  const total = headerSize + bytes.length;
  if (total > 0xffffffff)
    throw new FontFormatError("EOT font exceeds its size field");
  const output = new Uint8Array(total),
    view = viewOf(output);
  view.setUint32(0, total, true);
  view.setUint32(4, bytes.length, true);
  view.setUint32(8, VERSION_22, true);
  // Native Windows embedding requires preview/print font data to be masked.
  // EOT defines this XOR flag/key; the underlying SFNT remains unchanged.
  // https://learn.microsoft.com/en-us/windows/win32/gdi/embedded-fonts
  const mask = info.permissions.level === "previewPrint";
  if (mask) view.setUint32(12, 0x10000000, true);
  output.set(info.panose, 16);
  output[26] = 1; // DEFAULT_CHARSET: no character-set preference.
  output[27] = Number(info.italic);
  view.setUint32(28, info.weight, true);
  view.setUint16(32, info.permissions.fsType, true);
  view.setUint16(34, 0x504c, true);
  info.unicodeRanges.forEach((range, i) =>
    view.setUint32(36 + i * 4, range, true),
  );
  info.codePageRanges.forEach((range, i) =>
    view.setUint32(52 + i * 4, range, true),
  );
  view.setUint32(60, info.checkSumAdjustment, true);
  let at = 80;
  for (const name of names) {
    view.setUint16(at + 2, name.length, true);
    output.set(name, at + 4);
    at += 4 + name.length;
  }
  view.setUint32(at + 4, ROOT_CHECKSUM_XOR, true);
  if (mask)
    for (let i = 0; i < bytes.length; i++)
      output[headerSize + i] = bytes[i]! ^ 0x50;
  else output.set(bytes, headerSize);
  return output;
};
