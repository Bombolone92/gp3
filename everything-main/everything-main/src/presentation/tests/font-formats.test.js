import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  readEotFont,
  readOpenTypeFont,
  readFontEmbeddingPermissions,
  writeEotFont,
  unmaskEotFontData,
  FontFormatError,
} from "../lib/pptx/src/internal/fonts/index.ts";
import {
  eotFixture,
  fontNames,
  fontTables,
  metadataFont,
} from "./font-format-fixture.js";

const tableOffset = (bytes, tag) => {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < v.getUint16(4); i++) {
    const at = 12 + i * 16;
    if (String.fromCharCode(...bytes.subarray(at, at + 4)) === tag)
      return v.getUint32(at + 8);
  }
  throw Error(`missing fixture table ${tag}`);
};

describe("OpenType face identity and embedding metadata", () => {
  it("does not alias metadata back into Node Buffer input", () => {
    const input = Buffer.from(metadataFont()),
      before = Buffer.from(input);
    const info = readOpenTypeFont(input);
    info.panose.fill(99);
    expect(input).toEqual(before);
  });
  it("retains the four-style family instead of collapsing extended faces into name 16", () => {
    const a = readOpenTypeFont(metadataFont()),
      b = readOpenTypeFont(
        metadataFont({ family: "Independent ExtraLight", weight: 300 }),
      );
    expect(a).toMatchObject({
      family: "Independent Book",
      subfamily: "Regular",
      typographicFamily: "Independent",
      typographicSubfamily: "Book",
      weight: 400,
      bold: false,
      italic: false,
    });
    expect(b).toMatchObject({
      family: "Independent ExtraLight",
      typographicFamily: "Independent",
      weight: 300,
      bold: false,
    });
    expect(a.permissions).toMatchObject({
      level: "editable",
      temporary: true,
      canEdit: true,
    });
    expect(a.panose).toEqual(new Uint8Array([2, 4, 5, 3, 5, 4, 6, 2, 3, 4]));
    expect(a.unicodeRanges).toEqual([16, 32, 64, 128]);
    expect(a.codePageRanges).toEqual([0x80000001, 0x1020]);
  });
  it("handles sliced buffers, CFF signatures and actual table availability without changing bytes", () => {
    const input = metadataFont({
        cff: true,
        selection: 33,
        weight: 720,
        extraTables: [
          ["fvar", new Uint8Array([1])],
          ["kern", new Uint8Array([2])],
        ],
      }),
      before = input.slice();
    const wrapped = new Uint8Array(input.length + 21);
    wrapped.set(input, 7);
    expect(
      readOpenTypeFont(wrapped.subarray(7, 7 + input.length)),
    ).toMatchObject({
      format: "opentype",
      weight: 720,
      bold: true,
      italic: true,
      variable: true,
      legacyKerning: true,
      hasOutlines: true,
    });
    expect(input).toEqual(before);
  });
  it("prefers English names over localized records and preserves every decoded name", () => {
    const names = fontNames([
      { id: 1, value: "Famille", language: 0x40c },
      { id: 1, value: "British", language: 0x809 },
      { id: 1, value: "Universal", platform: 0, language: 0 },
      { id: 1, value: "American", language: 0x409 },
    ]);
    const info = readOpenTypeFont(metadataFont({ names }));
    expect(info.family).toBe("American");
    expect(info.names.map((n) => n.value)).toEqual([
      "Famille",
      "British",
      "Universal",
      "American",
    ]);
  });
  it("decodes format-1 language tags, supplementary Unicode and a literal BOM", () => {
    const names = fontNames(
      [
        { id: 1, value: "Français", language: 0x8000 },
        { id: 1, value: "\ufeffExtended 😀", language: 0x8001 },
      ],
      ["fr-CA", "en-GB"],
    );
    const info = readOpenTypeFont(metadataFont({ names }));
    expect(info.family).toBe("\ufeffExtended 😀");
    expect(info.names[1].languageTag).toBe("en-GB");
  });
  it("reads legacy Mac Roman and skips unsupported encodings without guessing", () => {
    const names = fontNames([
      {
        id: 1,
        platform: 1,
        language: 0,
        encoding: 0,
        bytes: new Uint8Array([67, 97, 102, 0x8e]),
      },
      { id: 1, value: "Wrong", platform: 3, encoding: 2 },
    ]);
    expect(readOpenTypeFont(metadataFont({ names })).family).toBe("Café");
  });
  it("allows older fonts without OS/2 and uses head style flags", () => {
    const info = readOpenTypeFont(metadataFont({ noOs2: true, macStyle: 3 }));
    expect(info).toMatchObject({
      os2Version: null,
      weight: 700,
      bold: true,
      italic: true,
    });
    expect(info.permissions.level).toBe("installable");
  });
  it("accepts shortened Apple version-0 OS/2 and ignores undefined high permission bits", () => {
    const info = readOpenTypeFont(
      metadataFont({ os2Version: 0, shortened: true, fsType: 0xfff8 }),
    );
    expect(info.permissions).toMatchObject({
      fsType: 8,
      noSubsetting: false,
      bitmapOnly: false,
    });
    expect(info.codePageRanges).toEqual([0, 0]);
  });
  it.each([0, 1, 2])(
    "honors historical least-restrictive permissions in OS/2 version %s",
    (version) => {
      expect(readFontEmbeddingPermissions(0xe, version).level).toBe("editable");
      expect(readFontEmbeddingPermissions(6, version).level).toBe(
        "previewPrint",
      );
    },
  );
  it.each([3, 4, 5])(
    "rejects conflicting permissions in OS/2 version %s",
    (version) => {
      expect(() => readFontEmbeddingPermissions(0xc, version)).toThrow(
        /conflicting/,
      );
    },
  );
  it.each([
    [0, "installable", true],
    [2, "restricted", false],
    [4, "previewPrint", false],
    [8, "editable", true],
  ])("reports permissions %s", (bits, level, canEdit) => {
    expect(readFontEmbeddingPermissions(bits, 4)).toMatchObject({
      level,
      canEdit,
      canEmbed: bits !== 2,
    });
  });
  it.each([-1, 65536, 1, 0x80, 1.5])(
    "rejects invalid permission bits %s",
    (bits) => {
      expect(() => readFontEmbeddingPermissions(bits, 4)).toThrow(
        FontFormatError,
      );
    },
  );
  it("rejects table-directory truncation, overlap, duplicates and out-of-bounds spans", () => {
    const bytes = metadataFont();
    expect(() => readOpenTypeFont(bytes.subarray(0, 15))).toThrow(/bounds/);
    for (const [offset, value, expected] of [
      [20, 0xfffffff0, /bounds/],
      [20, 12, /offset/],
      [36, tableOffset(bytes, "name"), /overlapping/],
    ]) {
      const bad = bytes.slice();
      new DataView(bad.buffer).setUint32(offset, value);
      expect(() => readOpenTypeFont(bad)).toThrow(expected);
    }
    expect(() =>
      readOpenTypeFont(
        fontTables([
          ["kern", new Uint8Array([1])],
          ["kern", new Uint8Array([2])],
        ]),
      ),
    ).toThrow(/duplicate/);
  });
  it("rejects invalid name storage, UTF-16 and language-tag references", () => {
    const bytes = metadataFont(),
      offset = tableOffset(bytes, "name");
    const bad = bytes.slice();
    new DataView(bad.buffer).setUint16(offset + 4, 6);
    expect(() => readOpenTypeFont(bad)).toThrow(/storage/);
    expect(() =>
      readOpenTypeFont(
        metadataFont({
          names: fontNames([{ id: 1, bytes: new Uint8Array([0, 65, 0]) }]),
        }),
      ),
    ).toThrow(/odd/);
    expect(() =>
      readOpenTypeFont(
        metadataFont({ names: fontNames([{ id: 1, value: "\ud800" }]) }),
      ),
    ).toThrow(/invalid UTF-16/);
    expect(() =>
      readOpenTypeFont(
        metadataFont({
          names: fontNames(
            [{ id: 1, value: "Bad", language: 0x8001 }],
            ["en-US"],
          ),
        }),
      ),
    ).toThrow(/language tag/);
  });
  it("distinguishes unsupported containers from individual SFNT faces", () => {
    for (const signature of [0x74746366, 0x774f4632, 0x776f6666, 0]) {
      const bytes = metadataFont();
      new DataView(bytes.buffer).setUint32(0, signature);
      expect(() => readOpenTypeFont(bytes)).toThrow(FontFormatError);
    }
  });
});

describe("native EOT container", () => {
  it("keeps Buffer payload views read-only and copies mutable header metadata", () => {
    const input = Buffer.from(eotFixture({ flags: 0x10000000 })),
      before = Buffer.from(input);
    const info = readEotFont(input);
    info.panose.fill(88);
    info.signature.fill(77);
    const decoded = unmaskEotFontData(info.font);
    decoded.fill(11);
    expect(input).toEqual(before);
  });
  it.each(["Regular", "Bold", "Italic", "BoldItalic"])(
    "retains an original renderable %s face byte-for-byte through EOT",
    (style) => {
      const bytes = new Uint8Array(
        readFileSync(
          new URL(`./data/font-formats/${style}.ttf`, import.meta.url),
        ),
      );
      const source = bytes.slice(),
        info = readOpenTypeFont(bytes),
        packet = readEotFont(
          writeEotFont(bytes, { embeddingAuthorized: true }),
        );
      expect(info).toMatchObject({
        family: "Font Format Regression",
        bold: style.includes("Bold"),
        italic: style.includes("Italic"),
        weight: style.includes("Bold") ? 700 : 400,
      });
      expect(unmaskEotFontData(packet.font)).toEqual(source);
      expect(bytes).toEqual(source);
    },
  );
  it.each([0x10000, 0x20001, 0x20002])(
    "reads version %s with its actual string/header layout",
    (version) => {
      const bytes = eotFixture({ version }),
        before = bytes.slice(),
        info = readEotFont(bytes);
      expect(info).toMatchObject({
        version,
        family: "Different Family",
        subfamily: "Italic",
        fullName: "Different Family Italic",
        versionName: "Version 9.876",
        weight: 650,
        italic: true,
      });
      expect(info.font.data).toEqual(new Uint8Array([23, 42, 89]));
      expect(info.rootString).toBe(
        version === 0x10000 ? "" : "https://example.test/\0",
      );
      expect(info.eudc?.codePage ?? null).toBe(
        version === 0x20002 ? 932 : null,
      );
      expect(bytes).toEqual(before);
    },
  );
  it("keeps compressed/XOR flags and EUDC payloads separate; unmasking does not mutate them", () => {
    const bytes = eotFixture({ flags: 0x10000005, eudcFlags: 4 }),
      info = readEotFont(bytes),
      original = bytes.slice();
    expect(info.font).toMatchObject({
      compressed: true,
      encrypted: true,
      subset: true,
    });
    expect(unmaskEotFontData(info.font)).toEqual(
      new Uint8Array([23 ^ 0x50, 42 ^ 0x50, 89 ^ 0x50]),
    );
    expect(info.eudc).toMatchObject({
      compressed: true,
      encrypted: false,
      codePage: 932,
    });
    expect(info.signature).toEqual(new Uint8Array([71, 72]));
    expect(bytes).toEqual(original);
  });
  it.each([false, true])(
    "wraps a full SFNT face without changing its tables, CFF=%s",
    (cff) => {
      const bytes = metadataFont({ cff, fsType: 0x108 }),
        before = bytes.slice(),
        info = readOpenTypeFont(bytes);
      const eot = writeEotFont(bytes, { embeddingAuthorized: true }),
        packet = readEotFont(eot),
        returned = unmaskEotFontData(packet.font);
      expect(returned).toEqual(bytes);
      expect(readOpenTypeFont(returned)).toEqual(info);
      expect(bytes).toEqual(before);
      expect(packet.permissions).toMatchObject({
        level: "editable",
        noSubsetting: true,
      });
      expect(packet).toMatchObject({
        family: info.family,
        subfamily: info.subfamily,
        italic: info.italic,
        weight: info.weight,
        checkSumAdjustment: info.checkSumAdjustment,
        rootString: "",
      });
      expect(packet.panose).toEqual(info.panose);
      expect(packet.unicodeRanges).toEqual(info.unicodeRanges);
      expect(packet.codePageRanges).toEqual(info.codePageRanges);
    },
  );
  it("masks preview/print fonts and retains their read-only permissions", () => {
    const bytes = metadataFont({ fsType: 4 }),
      eot = writeEotFont(bytes, { embeddingAuthorized: true }),
      info = readEotFont(eot);
    expect(info.font.encrypted).toBe(true);
    expect(info.font.data).not.toEqual(bytes);
    expect(unmaskEotFontData(info.font)).toEqual(bytes);
    expect(info.permissions).toMatchObject({
      level: "previewPrint",
      canEdit: false,
    });
  });
  it("requires explicit license authorization and respects restricted and bitmap-only fonts", () => {
    expect(() => writeEotFont(metadataFont())).toThrow(/authorized/);
    expect(() =>
      writeEotFont(metadataFont(), { embeddingAuthorized: false }),
    ).toThrow(/authorized/);
    expect(() =>
      writeEotFont(metadataFont({ fsType: 2 }), { embeddingAuthorized: true }),
    ).toThrow(/restricted/);
    expect(() =>
      writeEotFont(metadataFont({ fsType: 0x208 }), {
        embeddingAuthorized: true,
      }),
    ).toThrow(/bitmap/);
  });
  it("does not turn localized names into claimed English EOT names", () => {
    const bytes = metadataFont({
      names: fontNames([{ id: 1, value: "Famille", language: 0x40c }]),
    });
    expect(readOpenTypeFont(bytes).family).toBe("Famille");
    expect(() => writeEotFont(bytes, { embeddingAuthorized: true })).toThrow(
      /English font name/,
    );
  });
  it("validates root checksums and every declared variable section", () => {
    const bytes = eotFixture();
    const offsets = [0, 4, 8, 34, 64, 80, 82];
    for (const offset of offsets) {
      const bad = bytes.slice();
      bad[offset] ^= 0xff;
      expect(() => readEotFont(bad)).toThrow(FontFormatError);
    }
    const changedRoot = bytes.slice(),
      familyBytes = "Different Family".length * 2;
    const rootAt =
      80 +
      16 +
      [
        "Different Family",
        "Italic",
        "Version 9.876",
        "Different Family Italic",
      ].reduce((n, s) => n + s.length * 2, 0) +
      4;
    changedRoot[rootAt] ^= 1;
    expect(() => readEotFont(changedRoot)).toThrow(/checksum/);
    const odd = bytes.slice();
    new DataView(odd.buffer).setUint16(82, familyBytes - 1, true);
    expect(() => readEotFont(odd)).toThrow(/odd/);
    for (let length = 0; length < bytes.length; length++) {
      const truncated = bytes.slice(0, length);
      if (length >= 4)
        new DataView(truncated.buffer).setUint32(0, length, true);
      expect(() => readEotFont(truncated)).toThrow(FontFormatError);
    }
  });
  it("rejects empty font data and trailing data even with a matching container size", () => {
    expect(() =>
      readEotFont(eotFixture({ payload: new Uint8Array(0) })),
    ).toThrow(/no font data/);
    const valid = eotFixture(),
      bytes = new Uint8Array(valid.length + 1);
    bytes.set(valid);
    new DataView(bytes.buffer).setUint32(0, bytes.length, true);
    expect(() => readEotFont(bytes)).toThrow(/trailing/);
  });
});
