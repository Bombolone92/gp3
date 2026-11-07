import { FontFormatError, requireBytes, utf16, viewOf } from "./binary.ts";
import {
  readFontEmbeddingPermissions,
  type FontEmbeddingPermissions,
} from "./permissions.ts";

export interface OpenTypeName {
  readonly platform: number;
  readonly encoding: number;
  readonly language: number;
  readonly languageTag: string | null;
  readonly id: number;
  readonly value: string;
}

export interface OpenTypeFontInfo {
  readonly format: "truetype" | "opentype";
  /** Name ID 1: the legacy four-style family, not name ID 16. */
  readonly family: string | null;
  readonly subfamily: string | null;
  readonly fullName: string | null;
  readonly postScriptName: string | null;
  readonly typographicFamily: string | null;
  readonly typographicSubfamily: string | null;
  readonly versionName: string | null;
  /** English/universal names used by the native EOT header. */
  readonly englishNames: ReadonlyMap<number, string>;
  readonly names: ReadonlyArray<OpenTypeName>;
  readonly os2Version: number | null;
  readonly weight: number;
  readonly italic: boolean;
  readonly bold: boolean;
  readonly panose: Uint8Array;
  readonly unicodeRanges: ReadonlyArray<number>;
  readonly codePageRanges: ReadonlyArray<number>;
  readonly checkSumAdjustment: number;
  readonly permissions: FontEmbeddingPermissions;
  /** Table availability, not a claim to validate their shaping contents. */
  readonly legacyKerning: boolean;
  readonly variable: boolean;
  readonly hasOutlines: boolean;
}

const readTables = (bytes: Uint8Array) => {
  requireBytes(bytes, 0, 12, "OpenType header");
  const view = viewOf(bytes),
    signature = view.getUint32(0);
  if (signature === 0x74746366)
    throw new FontFormatError(
      "OpenType collection requires an individual face",
    );
  if (![0x00010000, 0x74727565, 0x4f54544f].includes(signature))
    throw new FontFormatError("expected an OpenType or TrueType font");
  const count = view.getUint16(4),
    end = 12 + count * 16;
  requireBytes(bytes, 0, end, "OpenType table directory");
  const tables = new Map<string, Uint8Array>();
  const spans: Array<{ start: number; end: number }> = [];
  for (let i = 0; i < count; i++) {
    const record = 12 + i * 16;
    const tag = String.fromCharCode(...bytes.subarray(record, record + 4));
    if (tables.has(tag))
      throw new FontFormatError(`duplicate font table ${tag}`);
    const start = view.getUint32(record + 8),
      length = view.getUint32(record + 12);
    requireBytes(bytes, start, length, `font table ${tag}`);
    if (length) {
      if (start < end || start % 4)
        throw new FontFormatError(`invalid font table offset for ${tag}`);
      spans.push({ start, end: start + length });
    }
    tables.set(tag, bytes.subarray(start, start + length));
  }
  spans.sort((a, b) => a.start - b.start);
  for (let i = 1; i < spans.length; i++)
    if (spans[i]!.start < spans[i - 1]!.end)
      throw new FontFormatError("overlapping font tables");
  return {
    format:
      signature === 0x4f54544f ? ("opentype" as const) : ("truetype" as const),
    tables,
  };
};

const readNames = (bytes: Uint8Array): OpenTypeName[] => {
  requireBytes(bytes, 0, 6, "OpenType naming table");
  const view = viewOf(bytes),
    format = view.getUint16(0);
  if (format > 1)
    throw new FontFormatError("unsupported OpenType naming table version");
  const count = view.getUint16(2),
    storage = view.getUint16(4);
  let end = 6 + count * 12;
  requireBytes(bytes, 0, end, "OpenType name records");
  const tags: string[] = [];
  const string = (start: number, length: number) => {
    requireBytes(bytes, storage + start, length, "OpenType name string");
    return bytes.subarray(storage + start, storage + start + length);
  };
  if (format === 1) {
    requireBytes(bytes, end, 2, "OpenType language-tag count");
    const tagCount = view.getUint16(end);
    end += 2;
    requireBytes(bytes, end, tagCount * 4, "OpenType language-tag records");
    for (let i = 0; i < tagCount; i++)
      tags.push(
        utf16(
          string(view.getUint16(end + i * 4 + 2), view.getUint16(end + i * 4)),
          false,
        ),
      );
    end += tagCount * 4;
  }
  if (storage < end || storage > bytes.length)
    throw new FontFormatError("invalid OpenType name string storage");
  const result: OpenTypeName[] = [];
  for (let i = 0; i < count; i++) {
    const at = 6 + i * 12;
    const platform = view.getUint16(at),
      encoding = view.getUint16(at + 2),
      language = view.getUint16(at + 4),
      id = view.getUint16(at + 6);
    const data = string(view.getUint16(at + 10), view.getUint16(at + 8));
    let languageTag: string | null = null;
    if (language >= 0x8000 && format === 1) {
      languageTag = tags[language - 0x8000] ?? null;
      if (languageTag === null)
        throw new FontFormatError("missing OpenType language tag");
    }
    let value: string;
    if (platform === 0 || (platform === 3 && [0, 1, 10].includes(encoding)))
      value = utf16(data, false);
    else if (platform === 1 && encoding === 0)
      value = new TextDecoder("macintosh").decode(data);
    else continue; // The record remains in the original table; never guess its encoding.
    result.push({ platform, encoding, language, languageTag, id, value });
  }
  return result;
};

const englishRank = (name: OpenTypeName): number => {
  if (name.languageTag !== null)
    return /^en(?:-|$)/i.test(name.languageTag)
      ? name.platform === 3
        ? 0
        : 1
      : 10;
  if (name.platform === 3 && (name.language & 0x3ff) === 9)
    return name.language === 0x409 ? 0 : 1;
  if (name.platform === 0 && (name.language === 0 || name.language === 0xffff))
    return 2;
  if (name.platform === 1 && name.language === 0) return 3;
  return 10;
};

/** Read identity/capabilities without changing font tables or installing a font. */
export const readOpenTypeFont = (bytes: Uint8Array): OpenTypeFontInfo => {
  const { format, tables } = readTables(bytes);
  const name = tables.get("name"),
    names = name ? readNames(name) : [];
  const chosen = new Map<number, OpenTypeName>(),
    englishNames = new Map<number, string>();
  for (const entry of names) {
    if (!entry.value) continue;
    const previous = chosen.get(entry.id);
    if (!previous || englishRank(entry) < englishRank(previous))
      chosen.set(entry.id, entry);
  }
  for (const [id, entry] of chosen)
    if (englishRank(entry) < 10) englishNames.set(id, entry.value);
  const value = (id: number) => chosen.get(id)?.value ?? null;
  const os2 = tables.get("OS/2");
  let os2Version: number | null = null,
    weight = 400,
    italic = false,
    bold = false,
    fsType = 0;
  let panose = new Uint8Array(10),
    unicodeRanges = [0, 0, 0, 0],
    codePageRanges = [0, 0];
  if (os2) {
    requireBytes(os2, 0, 2, "OS/2 version");
    const view = viewOf(os2);
    os2Version = view.getUint16(0);
    // Early Apple version-0 tables end at usLastCharIndex (68 bytes).
    // Code-page fields start in version 1; later optional metrics are unused.
    requireBytes(
      os2,
      0,
      os2Version === 0 ? 68 : os2Version === 1 ? 86 : os2Version < 5 ? 96 : 100,
      "OS/2 table",
    );
    weight = view.getUint16(4);
    fsType = view.getUint16(8);
    const selection = view.getUint16(62);
    italic = !!(selection & 1);
    bold = !!(selection & 0x20);
    panose = Uint8Array.from(os2.subarray(32, 42));
    unicodeRanges = [42, 46, 50, 54].map((at) => view.getUint32(at));
    if (os2Version >= 1)
      codePageRanges = [78, 82].map((at) => view.getUint32(at));
  }
  let checkSumAdjustment = 0;
  const head = tables.get("head");
  if (head) {
    requireBytes(head, 0, 54, "OpenType head table");
    const view = viewOf(head);
    if (view.getUint32(12) !== 0x5f0f3cf5)
      throw new FontFormatError("invalid OpenType head magic number");
    checkSumAdjustment = view.getUint32(8);
    if (!os2) {
      const style = view.getUint16(44);
      italic = !!(style & 2);
      bold = !!(style & 1);
      weight = bold ? 700 : 400;
    }
  }
  return {
    format,
    family: value(1),
    subfamily: value(2),
    fullName: value(4),
    postScriptName: value(6),
    typographicFamily: value(16),
    typographicSubfamily: value(17),
    versionName: value(5),
    englishNames,
    names,
    os2Version,
    weight,
    italic,
    bold,
    panose,
    unicodeRanges,
    codePageRanges,
    checkSumAdjustment,
    permissions: readFontEmbeddingPermissions(fsType, os2Version ?? undefined),
    legacyKerning: tables.has("kern"),
    variable: tables.has("fvar"),
    hasOutlines: ["glyf", "CFF ", "CFF2"].some(
      (tag) => (tables.get(tag)?.length ?? 0) > 0,
    ),
  };
};
