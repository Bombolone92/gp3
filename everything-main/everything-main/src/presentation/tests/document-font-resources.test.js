import { afterEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { P, createDeck } from "../src/model.js";
import { metadataFont, eotFixture } from "./font-format-fixture.js";
import {
  writeEotFont,
  decodeMtxFont,
  readEotFont,
} from "../lib/pptx/src/internal/fonts/index.ts";
import { embedMtxFont, mtxFont, mtxEot } from "./mtx-font-fixture.js";
const bytes = (style) =>
  new Uint8Array(
    readFileSync(new URL(`./data/font-formats/${style}.ttf`, import.meta.url)),
  );
const full = () => {
  const p = createDeck();
  for (const style of ["Regular", "Bold", "Italic", "BoldItalic"])
    P.embedFont(p, bytes(style), { embeddingAuthorized: true });
  return p;
};
const part = (p) =>
  P._internalPackageOf(p).getPart(
    P.getEmbeddedFonts(p)[0].faces.regular.partName,
  );
const edit = (p, fn) => {
  const part = P._internalPackageOf(p).getPart("/ppt/presentation.xml");
  part.data = new TextEncoder().encode(fn(new TextDecoder().decode(part.data)));
};
async function runtime(load = (face) => Promise.resolve(face)) {
  vi.resetModules();
  const fonts = new Set(),
    created = [];
  class Face {
    constructor(family, source, descriptors) {
      Object.assign(this, { family, source, descriptors });
      created.push(this);
    }
    load() {
      return load(this);
    }
  }
  vi.stubGlobal("document", { fonts });
  vi.stubGlobal("FontFace", Face);
  return {
    ...(await import("../src/document-font-resources.js")),
    fonts,
    created,
  };
}
afterEach(() => vi.unstubAllGlobals());
it("loads exact faces under private aliases and leaves encoded package parts untouched", async () => {
  const r = await runtime(),
    p = full(),
    before = P._internalPackageOf(p).parts.map((part) => ({
      name: part.name,
      data: part.data,
    }));
  expect(await r.prepareDocumentFonts(p)).toBe(true);
  expect(r.fonts.size).toBe(4);
  expect(r.created.map((f) => f.source)).toEqual(
    ["Regular", "Bold", "Italic", "BoldItalic"].map(bytes),
  );
  const alias = r.documentFontAlias(p, "FONT FORMAT REGRESSION");
  expect(alias).not.toBe("Font Format Regression");
  expect(r.created.every((f) => f.family === alias)).toBe(true);
  expect(
    r.created.map((f) => [f.descriptors.style, f.descriptors.weight]),
  ).toEqual([
    ["normal", "400"],
    ["normal", "700"],
    ["italic", "400"],
    ["italic", "700"],
  ]);
  const css = r.documentFontStyles(
    new Map([["Font Format Regression", new Set(["normal", "normal/700"])]]),
    p,
  );
  expect(css.match(/@font-face/g)).toHaveLength(1);
  expect(css).toContain("font-weight:700");
  expect(css).toContain("data:font/ttf");
  expect(r.documentFontFamilyForCss(p, `${JSON.stringify(alias)}, Arial`)).toBe(
    "Font Format Regression",
  );
  expect(
    r.documentFontKerning({
      family: `${JSON.stringify(alias)}, Arial`,
      bold: true,
    }),
  ).toBe("none");
  expect(await r.prepareDocumentFonts(p)).toBe(false);
  expect(r.created).toHaveLength(4);
  expect(
    P._internalPackageOf(p).parts.map((part) => ({
      name: part.name,
      data: part.data,
    })),
  ).toEqual(before);
  r.disposeDocumentFonts(p);
  expect(r.fonts.size).toBe(0);
  expect(r.documentFontAlias(p, "Font Format Regression")).toBeNull();
});
it("isolates unrelated documents and shares only explicitly related history snapshots", async () => {
  const r = await runtime(),
    a = full(),
    b = await P.loadPresentation(await P.savePresentation(a));
  await r.prepareDocumentFonts(a);
  await r.prepareDocumentFonts(b);
  expect(r.fonts.size).toBe(8);
  expect(r.documentFontStamp(a)).not.toBe(r.documentFontStamp(b));
  const c = await P.loadPresentation(await P.savePresentation(a));
  await r.prepareDocumentFonts(c, { reuseFrom: a });
  expect(r.created).toHaveLength(8);
  expect(r.documentFontStamp(c)).toBe(r.documentFontStamp(a));
  r.disposeDocumentFonts(a);
  expect(r.fonts.size).toBe(8);
  expect(r.documentFontAlias(c, "Font Format Regression")).toBeTruthy();
  r.disposeDocumentFonts(c);
  expect(r.fonts.size).toBe(4);
  r.disposeDocumentFonts(b);
  expect(r.fonts.size).toBe(0);
});
it("pins reused faces while another family loads even if the source snapshot closes", async () => {
  let release;
  const r = await runtime((face) =>
    face.family.includes("document font 2 ")
      ? new Promise((resolve) => (release = () => resolve(face)))
      : Promise.resolve(face),
  );
  const a = full();
  await r.prepareDocumentFonts(a);
  const b = await P.loadPresentation(await P.savePresentation(a));
  P.embedFont(b, metadataFont({ family: "Second family" }), {
    embeddingAuthorized: true,
  });
  const pending = r.prepareDocumentFonts(b, { reuseFrom: a });
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  r.disposeDocumentFonts(a);
  expect(r.fonts.size).toBe(4);
  release();
  await pending;
  expect(r.fonts.size).toBe(5);
  expect(r.documentFontAlias(b, "Font Format Regression")).toBeTruthy();
  r.disposeDocumentFonts(b);
  expect(r.fonts.size).toBe(0);
});
it("never publishes pending faces for a closed document or resurrects it", async () => {
  const releases = [],
    r = await runtime(
      (face) => new Promise((resolve) => releases.push(() => resolve(face))),
    ),
    p = full();
  const pending = r.prepareDocumentFonts(p);
  r.disposeDocumentFonts(p);
  releases.forEach((release) => release());
  expect(await pending).toBe(false);
  expect(r.fonts.size).toBe(0);
  expect(await r.prepareDocumentFonts(p)).toBe(false);
  expect(r.created).toHaveLength(4);
});
it("keeps concurrent callers waiting through a stale-load retry and discards old faces", async () => {
  const releases = [],
    r = await runtime(
      (face) => new Promise((resolve) => releases.push(() => resolve(face))),
    ),
    p = createDeck();
  P.embedFont(p, bytes("Regular"), { embeddingAuthorized: true });
  const a = r.prepareDocumentFonts(p),
    b = r.prepareDocumentFonts(p);
  expect(a).toBe(b);
  part(p).data = writeEotFont(
    metadataFont({ family: "Font Format Regression", weight: 500 }),
    { embeddingAuthorized: true },
  );
  releases.shift()();
  await vi.waitFor(() => expect(releases).toHaveLength(1));
  let complete = false;
  b.then(() => (complete = true));
  await Promise.resolve();
  expect(complete).toBe(false);
  expect(r.fonts.size).toBe(0);
  releases.shift()();
  expect(await a).toBe(true);
  await b;
  expect(r.fonts.size).toBe(1);
  expect(r.created).toHaveLength(2);
});
it("reports damaged families separately, skips ambiguous entries and recovers when repaired", async () => {
  const r = await runtime(),
    p = full();
  P.embedFont(p, metadataFont({ family: "Damaged" }), {
    embeddingAuthorized: true,
  });
  const damaged = P.getEmbeddedFonts(p).find((f) => f.typeface === "Damaged")
    .faces.regular;
  const pkg = P._internalPackageOf(p),
    saved = pkg.getPart(damaged.partName).data;
  pkg.removePart(damaged.partName);
  expect(() => P.getEmbeddedFonts(p)).toThrow(/missing/);
  await r.prepareDocumentFonts(p);
  expect(r.fonts.size).toBe(4);
  expect(r.declaresDocumentFont(p, "Damaged")).toBe(true);
  expect(r.documentFontStatus(p).errors[0].family).toBe("Damaged");
  pkg.addPart(damaged.partName, damaged.contentType, saved);
  await r.prepareDocumentFonts(p);
  expect(r.fonts.size).toBe(5);
  expect(r.documentFontStatus(p).errors).toEqual([]);
  edit(p, (s) =>
    s.replace(
      "</p:embeddedFontLst>",
      s.match(/<p:embeddedFont>.*?<\/p:embeddedFont>/s)[0] +
        "</p:embeddedFontLst>",
    ),
  );
  await r.prepareDocumentFonts(p);
  expect(r.fonts.size).toBe(1);
  expect(r.documentFontStatus(p).errors).toHaveLength(2);
});
it("publishes a family atomically and clears warnings after the list is removed", async () => {
  const r = await runtime((face) =>
      face.descriptors.style === "italic"
        ? Promise.reject(Error("Damaged face"))
        : Promise.resolve(face),
    ),
    p = full();
  await r.prepareDocumentFonts(p);
  expect(r.fonts.size).toBe(0);
  expect(r.documentFontStatus(p).errors).toHaveLength(1);
  edit(p, (s) => s.replace(/<p:embeddedFontLst>.*?<\/p:embeddedFontLst>/s, ""));
  await r.prepareDocumentFonts(p);
  expect(r.documentFontStatus(p).errors).toEqual([]);
  expect(r.declaresDocumentFont(p, "Font Format Regression")).toBe(false);
});
it("uses native permissions even for malformed compressed data and decodes masked preview-print fonts", async () => {
  const r = await runtime(),
    p = createDeck();
  P.embedFont(p, bytes("PreviewPrint"), { embeddingAuthorized: true });
  await r.prepareDocumentFonts(p);
  expect(r.created[0].source).toEqual(bytes("PreviewPrint"));
  expect(r.documentFontStatus(p)).toEqual({ readOnly: true, errors: [] });
  part(p).data = eotFixture({ flags: 4, fsType: 4, eudc: new Uint8Array() });
  await r.prepareDocumentFonts(p);
  expect(r.fonts.size).toBe(0);
  expect(r.documentFontStatus(p).readOnly).toBe(true);
  expect(r.documentFontStatus(p).errors[0].message).toMatch(/MTX/);
});
it("loads all MTX faces and preserves original compressed data through native transfers", async () => {
  const r = await runtime(),
    p = createDeck();
  for (const style of ["Regular", "Bold", "Italic", "BoldItalic"])
    embedMtxFont(p, style);
  const original = P.getEmbeddedFonts(p)[0];
  expect(await r.prepareDocumentFonts(p)).toBe(true);
  expect(r.fonts.size).toBe(4);
  expect(r.documentFontStatus(p)).toEqual({ readOnly: false, errors: [] });
  expect(r.created.map((face) => face.source)).toEqual(
    ["Regular", "Bold", "Italic", "BoldItalic"].map((style) =>
      decodeMtxFont(mtxFont(style)),
    ),
  );
  const copy = createDeck();
  P.importEmbeddedFonts(copy, p, ["Font Format Regression"]);
  const reloaded = await P.loadPresentation(await P.savePresentation(copy)),
    back = createDeck();
  P.importEmbeddedFonts(back, reloaded, ["Font Format Regression"]);
  for (const candidate of [p, copy, reloaded, back])
    for (const [style, face] of Object.entries(
      P.getEmbeddedFonts(candidate)[0].faces,
    )) {
      expect(face.data).toEqual(original.faces[style].data);
      expect(readEotFont(face.data).font.compressed).toBe(true);
    }
});
it("unmasks MTX preview-print data before decoding and keeps permissions", async () => {
  const r = await runtime(),
    p = createDeck();
  embedMtxFont(p, "PreviewPrint");
  const original = part(p).data.slice();
  expect(readEotFont(original).font).toMatchObject({
    encrypted: true,
    compressed: true,
  });
  await r.prepareDocumentFonts(p);
  expect(r.created[0].source).toEqual(decodeMtxFont(mtxFont("PreviewPrint")));
  expect(r.documentFontStatus(p)).toEqual({ readOnly: true, errors: [] });
  expect(part(p).data).toEqual(original);
});
it("refuses forbidden embedding before decoding otherwise valid MTX", async () => {
  const r = await runtime(),
    p = createDeck();
  embedMtxFont(p, "Regular");
  const data = mtxEot("Regular");
  new DataView(data.buffer).setUint16(32, 2, true);
  part(p).data = data;
  await r.prepareDocumentFonts(p);
  expect(r.created).toHaveLength(0);
  expect(r.fonts.size).toBe(0);
  expect(r.documentFontStatus(p).errors[0].message).toMatch(
    /does not permit embedding/,
  );
});
it("supports native raw TrueType and CFF payloads and notices content-type changes", async () => {
  const r = await runtime(),
    p = createDeck();
  P.embedFont(p, bytes("CFF"), { embeddingAuthorized: true });
  await r.prepareDocumentFonts(p);
  const css = r.documentFontStyles(
    new Map([["Font Format Regression CFF", new Set(["normal/400"])]]),
    p,
  );
  expect(css).toContain("data:font/otf");
  expect(css).toContain('format("opentype")');
  part(p).data = bytes("CFF");
  part(p).contentType = "application/x-font-ttf";
  await r.prepareDocumentFonts(p);
  expect(r.fonts.size).toBe(1);
  part(p).contentType = "application/octet-stream";
  await r.prepareDocumentFonts(p);
  expect(r.fonts.size).toBe(0);
  expect(r.documentFontStatus(p).errors[0].message).toMatch(/Unsupported/);
});
it("rejects restricted and bitmap-only outline payloads without installing them", async () => {
  const r = await runtime(),
    p = full();
  part(p).data = eotFixture({
    fsType: 2,
    payload: bytes("Regular"),
    eudc: new Uint8Array(),
  });
  await r.prepareDocumentFonts(p);
  expect(r.fonts.size).toBe(0);
  expect(r.documentFontStatus(p).readOnly).toBe(true);
  part(p).data = writeEotFont(metadataFont({ fsType: 8 }), {
    embeddingAuthorized: true,
  });
  // An invalid permissions combination authored by another producer must not
  // be smuggled into the browser through a trustworthy container header.
  part(p).data = eotFixture({
    fsType: 8,
    payload: metadataFont({ fsType: 0x208 }),
    eudc: new Uint8Array(),
  });
  await r.prepareDocumentFonts(p);
  expect(r.fonts.size).toBe(0);
  expect(r.documentFontStatus(p).errors[0].message).toMatch(/bitmap/);
});

it("includes the matching available face and its capabilities when requested native slots are absent", async () => {
  const r = await runtime(),
    p = createDeck();
  P.embedFont(p, bytes("Regular"), { embeddingAuthorized: true });
  await r.prepareDocumentFonts(p);
  const alias = r.documentFontAlias(p, "Font Format Regression");
  const css = r.documentFontStyles(
    new Map([
      ["Font Format Regression", new Set(["normal/700"])],
      [alias, new Set(["italic/700"])],
    ]),
    p,
  );
  expect(css.match(/@font-face/g)).toHaveLength(1);
  expect(css).toContain("font-weight:400");
  expect(css).toContain("font-style:normal");
  expect(
    r.documentFontKerning({ family: alias, bold: true, italic: true }),
  ).toBe("none");
});

it("retains fonts for a captured slideshow until its last lease closes", async () => {
  const r = await runtime(),
    p = full();
  await r.prepareDocumentFonts(p);
  const first = r.retainDocumentFonts(p),
    second = r.retainDocumentFonts(p),
    alias = r.documentFontAlias(p, "Font Format Regression");
  r.disposeDocumentFonts(p);
  expect(r.fonts.size).toBe(4);
  expect(r.documentFontAlias(p, "Font Format Regression")).toBe(alias);
  expect(await r.prepareDocumentFonts(p)).toBe(false);
  first();
  first();
  expect(r.fonts.size).toBe(4);
  second();
  expect(r.fonts.size).toBe(0);
  expect(r.documentFontAlias(p, "Font Format Regression")).toBeNull();
  r.disposeDocumentFonts(p);
});
