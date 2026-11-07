import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { P, createDeck, parseDeck } from "../src/model.js";
import { INTERNAL_PACKAGE } from "../lib/pptx/src/api/_internal-symbols.ts";
import {
  readEotFont,
  unmaskEotFontData,
} from "../lib/pptx/src/internal/fonts/index.ts";
import { REL_TYPES } from "../lib/pptx/src/internal/presentationml/index.ts";
import {
  getEmbeddedFonts,
  embedFont,
  importEmbeddedFonts,
} from "../lib/pptx/src/api/index.ts";
import { parseXml, childElements } from "../lib/pptx/src/internal/xml/index.ts";
import { relsPartNameFor } from "../lib/pptx/src/internal/opc/index.ts";
import { metadataFont } from "./font-format-fixture.js";

const enc = new TextEncoder(),
  dec = new TextDecoder(),
  pkg = (p) => p[INTERNAL_PACKAGE];
const bytes = (style) =>
  new Uint8Array(
    readFileSync(new URL(`./data/font-formats/${style}.ttf`, import.meta.url)),
  );
const authorized = { embeddingAuthorized: true };
const snapshot = (p) =>
  pkg(p).parts.map((x) => ({
    name: x.name,
    type: x.contentType,
    data: [...x.data],
  }));
const edit = (p, fn) => {
  const part = pkg(p).getPart("/ppt/presentation.xml");
  part.data = enc.encode(fn(dec.decode(part.data)));
};
const full = () => {
  const p = createDeck();
  for (const style of ["Regular", "Bold", "Italic", "BoldItalic"])
    embedFont(p, bytes(style), authorized);
  return p;
};
describe("presentation-owned native font resources", () => {
  it("reads empty documents without changing their parts", () => {
    const p = createDeck(),
      before = snapshot(p);
    expect(getEmbeddedFonts(p)).toEqual([]);
    expect(snapshot(p)).toEqual(before);
    expect(REL_TYPES.font).toBe(
      "http://schemas.openxmlformats.org/officeDocument/2006/relationships/font",
    );
  });
  it("embeds all four licensed original faces with exact payloads and schema ordering", () => {
    const p = full(),
      fonts = getEmbeddedFonts(p);
    expect(fonts).toHaveLength(1);
    expect(fonts[0].typeface).toBe("Font Format Regression");
    for (const [style, file] of [
      ["regular", "Regular"],
      ["bold", "Bold"],
      ["italic", "Italic"],
      ["boldItalic", "BoldItalic"],
    ]) {
      const face = fonts[0].faces[style];
      expect(face.contentType).toBe("application/x-fontdata");
      expect(unmaskEotFontData(readEotFont(face.data).font)).toEqual(
        bytes(file),
      );
    }
    const root = parseXml(
      dec.decode(pkg(p).getPart("/ppt/presentation.xml").data),
    ).root;
    expect(childElements(root).map((e) => e.name.localName)).toEqual([
      "sldMasterIdLst",
      "sldIdLst",
      "sldSz",
      "notesSz",
      "embeddedFontLst",
    ]);
    const list = childElements(root).find(
      (e) => e.name.localName === "embeddedFontLst",
    );
    expect(
      childElements(childElements(list)[0]).map((e) => e.name.localName),
    ).toEqual(["font", "regular", "bold", "italic", "boldItalic"]);
    expect(P.validatePresentation(p)).toEqual([]);
  });
  it("inserts fonts before trailing native preferences and preserves unknown XML", () => {
    const p = createDeck();
    edit(p, (s) =>
      s.replace(
        "</p:presentation>",
        '<p:custShowLst/><p:defaultTextStyle/><p:extLst><p:ext uri="test"><x:data xmlns:x="urn:font-test" value="keep"/></p:ext></p:extLst></p:presentation>',
      ),
    );
    embedFont(p, bytes("Bold"), authorized);
    const text = dec.decode(pkg(p).getPart("/ppt/presentation.xml").data);
    expect(text.indexOf("embeddedFontLst")).toBeLessThan(
      text.indexOf("custShowLst"),
    );
    expect(text).toContain('value="keep"');
    expect(text).toContain('embedTrueTypeFonts="1"');
    expect(text).toContain('saveSubsetFonts="1"');
  });
  it("does not allocate parts or rewrite XML for an identical existing face", () => {
    const p = full(),
      before = snapshot(p);
    embedFont(p, bytes("Italic"), authorized);
    expect(snapshot(p)).toEqual(before);
  });
  it("rejects a same-family/style collision before package mutation", () => {
    const p = createDeck();
    embedFont(p, metadataFont(), authorized);
    const before = snapshot(p);
    expect(() =>
      embedFont(p, metadataFont({ weight: 500 }), authorized),
    ).toThrow(/conflicting/);
    expect(snapshot(p)).toEqual(before);
  });
  it("requires embedding authorization and observes restricted font permissions", () => {
    const p = createDeck(),
      before = snapshot(p);
    expect(() => embedFont(p, bytes("Regular"), {})).toThrow(/authorized/);
    expect(() => embedFont(p, metadataFont({ fsType: 2 }), authorized)).toThrow(
      /restricted/,
    );
    expect(snapshot(p)).toEqual(before);
  });
  it("keeps returned bytes independent of the presentation", () => {
    const p = full(),
      before = snapshot(p);
    getEmbeddedFonts(p)[0].faces.regular.data.fill(0);
    expect(snapshot(p)).toEqual(before);
  });
  it("allocates font part names around case-insensitive part and relationship collisions", () => {
    const p = createDeck();
    pkg(p).addPart(
      "/PPT/FONTS/FONT1.FNTDATA",
      "application/octet-stream",
      new Uint8Array([9]),
    );
    pkg(p).addPart(
      relsPartNameFor("/ppt/fonts/font2.fntdata"),
      "application/vnd.openxmlformats-package.relationships+xml",
      enc.encode(
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>',
      ),
    );
    embedFont(p, bytes("Regular"), authorized);
    expect(getEmbeddedFonts(p)[0].faces.regular.partName).toBe(
      "/ppt/fonts/font3.fntdata",
    );
    expect(pkg(p).getPart("/PPT/FONTS/FONT1.FNTDATA").data).toEqual(
      new Uint8Array([9]),
    );
  });
  it("follows a relocated actual main part and relative font targets", () => {
    const p = full(),
      op = pkg(p),
      original = op.getPart("/ppt/presentation.xml"),
      rels = op.getRels(original.name);
    op.addPart("/custom/document.xml", original.contentType, original.data);
    op.setRels("/custom/document.xml", {
      items: rels.items.map((r) => ({
        ...r,
        target:
          r.type === REL_TYPES.font
            ? `../ppt/fonts/${r.target.split("/").pop()}`
            : r.target.startsWith("/")
              ? r.target
              : `/ppt/${r.target}`,
      })),
    });
    op.removePart(original.name);
    op.removePart(relsPartNameFor(original.name));
    op.setRootRels({
      items: op
        .rootRels()
        .items.map((r) =>
          r.type === REL_TYPES.officeDocument
            ? { ...r, target: "custom/document.xml" }
            : r,
        ),
    });
    expect(getEmbeddedFonts(p)[0].faces.regular.partName).toBe(
      "/ppt/fonts/font1.fntdata",
    );
    embedFont(p, bytes("Regular"), authorized);
  });
  it("preserves font bytes and descriptors through export, import and reverse transfer", async () => {
    const source = full(),
      target = createDeck();
    importEmbeddedFonts(target, source, ["Font Format Regression"]);
    const loaded = await parseDeck(pkg(target).save());
    expect(getEmbeddedFonts(loaded)).toEqual(getEmbeddedFonts(target));
    const returned = createDeck();
    importEmbeddedFonts(returned, loaded, ["Font Format Regression"]);
    for (const style of ["regular", "bold", "italic", "boldItalic"])
      expect(getEmbeddedFonts(returned)[0].faces[style].data).toEqual(
        getEmbeddedFonts(source)[0].faces[style].data,
      );
    expect(P.validatePresentation(loaded)).toEqual([]);
    expect(P.validatePresentation(returned)).toEqual([]);
    const before = snapshot(loaded);
    importEmbeddedFonts(loaded, source, ["Font Format Regression"]);
    expect(snapshot(loaded)).toEqual(before);
  });
  it("preserves packed data without pretending to decode it", () => {
    const source = full(),
      op = pkg(source),
      face = getEmbeddedFonts(source)[0].faces.regular,
      data = op.getPart(face.partName).data;
    new DataView(data.buffer, data.byteOffset, data.byteLength).setUint32(
      12,
      4,
      true,
    ); // Opaque MTX fixture payload, not a valid decoded font.
    const target = createDeck();
    importEmbeddedFonts(target, source, ["Font Format Regression"]);
    expect(getEmbeddedFonts(target)[0].faces.regular.data).toEqual(data);
    expect(
      readEotFont(getEmbeddedFonts(target)[0].faces.regular.data).font
        .compressed,
    ).toBe(true);
  });
  it("merges complementary styles while reusing identical destination parts", () => {
    const source = full(),
      target = createDeck();
    embedFont(target, bytes("Regular"), authorized);
    const before = getEmbeddedFonts(target)[0].faces.regular;
    importEmbeddedFonts(target, source, ["Font Format Regression"]);
    expect(getEmbeddedFonts(target)[0].faces.regular).toEqual(before);
    expect(Object.keys(getEmbeddedFonts(target)[0].faces)).toHaveLength(4);
    expect(
      pkg(target).parts.filter(
        (p) => p.contentType === "application/x-fontdata",
      ),
    ).toHaveLength(4);
    const regularOnly = createDeck();
    embedFont(regularOnly, bytes("Regular"), authorized);
    const saved = snapshot(target);
    importEmbeddedFonts(target, regularOnly, ["Font Format Regression"]);
    expect(snapshot(target)).toEqual(saved);
  });
  it("copies unknown entry extensions with namespace closure and their own dependency graphs", () => {
    const source = full(),
      op = pkg(source),
      rels = op.getRels("/ppt/presentation.xml");
    op.addPart(
      "/custom/font-extra.bin",
      "application/octet-stream",
      new Uint8Array([1, 2, 3]),
    );
    rels.items.push({
      id: "fontExtra",
      type: "urn:font-extra",
      target: "/custom/font-extra.bin",
      targetMode: "Internal",
    });
    op.setRels("/ppt/presentation.xml", rels);
    edit(source, (s) =>
      s
        .replace("xmlns:p=", 'xmlns:x="urn:font-extra" xmlns:p=')
        .replace(
          "</p:embeddedFont>",
          '<x:entry r:id="fontExtra" tokens="x:label"/></p:embeddedFont>',
        ),
    );
    const target = createDeck();
    importEmbeddedFonts(target, source, ["Font Format Regression"]);
    const text = dec.decode(pkg(target).getPart("/ppt/presentation.xml").data);
    expect(text).toContain('xmlns:x="urn:font-extra"');
    expect(text).toContain('tokens="x:label"');
    expect(pkg(target).getPart("/custom/font-extra.bin").data).toEqual(
      new Uint8Array([1, 2, 3]),
    );
    expect(P.validatePresentation(target)).toEqual([]);
  });
  it("rejects conflicting face sets and missing dependencies before any destination change", () => {
    const source = full(),
      target = createDeck();
    embedFont(
      target,
      metadataFont({ family: "Font Format Regression" }),
      authorized,
    );
    let before = snapshot(target);
    expect(() =>
      importEmbeddedFonts(target, source, ["Font Format Regression"]),
    ).toThrow(/conflicting/);
    expect(snapshot(target)).toEqual(before);
    const empty = createDeck();
    before = snapshot(empty);
    pkg(source).removePart(getEmbeddedFonts(source)[0].faces.italic.partName);
    expect(() =>
      importEmbeddedFonts(empty, source, ["Font Format Regression"]),
    ).toThrow(/missing/);
    expect(snapshot(empty)).toEqual(before);
  });
  it.each(["missing", "external", "wrongType", "duplicate"])(
    "rejects %s font relationships without modifying the package",
    (kind) => {
      const p = full(),
        op = pkg(p),
        rels = op.getRels("/ppt/presentation.xml"),
        id = getEmbeddedFonts(p)[0].faces.regular.relationshipId,
        rel = rels.items.find((r) => r.id === id);
      if (kind === "missing")
        rels.items = rels.items.filter((r) => r.id !== id);
      if (kind === "external") rel.targetMode = "External";
      if (kind === "wrongType") rel.type = REL_TYPES.image;
      if (kind === "duplicate") rels.items.push({ ...rel });
      op.setRels("/ppt/presentation.xml", rels);
      const before = snapshot(p);
      expect(() => getEmbeddedFonts(p)).toThrow(/invalid/);
      expect(snapshot(p)).toEqual(before);
    },
  );
  it("reads supported namespaces rather than similarly named extension nodes", () => {
    const p = full();
    edit(p, (s) =>
      s.replace(
        "</p:presentation>",
        '<x:embeddedFontLst xmlns:x="urn:foreign"><x:embeddedFont><x:font typeface="Wrong"/></x:embeddedFont></x:embeddedFontLst></p:presentation>',
      ),
    );
    expect(getEmbeddedFonts(p).map((f) => f.typeface)).toEqual([
      "Font Format Regression",
    ]);
  });
  it("selects native fallback lists while preserving every compatibility branch on export", async () => {
    const p = full();
    edit(p, (s) =>
      s
        .replace(
          "<p:embeddedFontLst>",
          '<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:x="urn:future"><mc:Choice Requires="x"><x:embeddedFontLst/></mc:Choice><mc:Fallback><p:embeddedFontLst>',
        )
        .replace(
          "</p:embeddedFontLst>",
          "</p:embeddedFontLst></mc:Fallback></mc:AlternateContent>",
        ),
    );
    const before = snapshot(p);
    expect(getEmbeddedFonts(p)[0].typeface).toBe("Font Format Regression");
    expect(snapshot(p)).toEqual(before);
    expect(
      dec.decode(
        pkg(await parseDeck(pkg(p).save())).getPart("/ppt/presentation.xml")
          .data,
      ),
    ).toContain('Requires="x"');
  });
  it("adds a face to an omitted fallback style without duplicating the choice style", () => {
    const p = createDeck();
    embedFont(p, bytes("Regular"), authorized);
    edit(p, (s) =>
      s.replace(
        /(<p:regular[^>]*\/>)/,
        '<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:x="urn:future"><mc:Choice Requires="x">$1</mc:Choice><mc:Fallback/></mc:AlternateContent>',
      ),
    );
    expect(getEmbeddedFonts(p)[0].faces.regular).toBeUndefined();
    embedFont(p, bytes("Regular"), authorized);
    expect(getEmbeddedFonts(p)[0].faces.regular).toBeDefined();
    expect(
      pkg(p).parts.filter(
        (part) => part.contentType === "application/x-fontdata",
      ),
    ).toHaveLength(1);
    const text = dec.decode(pkg(p).getPart("/ppt/presentation.xml").data);
    expect(text.match(/<p:regular/g)).toHaveLength(2);
    expect(text).toContain('Requires="x"');
    const before = snapshot(p);
    embedFont(p, bytes("Regular"), authorized);
    expect(snapshot(p)).toEqual(before);
  });
  it("does not reuse a font entry while dropping an extension dependency", () => {
    const source = full(),
      target = full(),
      op = pkg(source),
      rels = op.getRels("/ppt/presentation.xml");
    op.addPart(
      "/font-extra.bin",
      "application/octet-stream",
      new Uint8Array([7]),
    );
    rels.items.push({
      id: "extra",
      type: "urn:font-extra",
      target: "/font-extra.bin",
      targetMode: "Internal",
    });
    op.setRels("/ppt/presentation.xml", rels);
    edit(source, (s) =>
      s.replace(
        "</p:embeddedFont>",
        '<x:extra xmlns:x="urn:font-extra" r:id="extra"/></p:embeddedFont>',
      ),
    );
    const before = snapshot(target);
    expect(() =>
      importEmbeddedFonts(target, source, ["Font Format Regression"]),
    ).toThrow(/conflicting|merge required/);
    expect(snapshot(target)).toEqual(before);
  });
});

it("can copy selected valid fonts without decoding malformed unselected entries in either document", () => {
  const source = full(),
    target = createDeck();
  embedFont(
    source,
    metadataFont({ family: "Damaged source family" }),
    authorized,
  );
  const badSource = getEmbeddedFonts(source).find(
    (font) => font.typeface === "Damaged source family",
  ).faces.regular;
  pkg(source).removePart(badSource.partName);
  embedFont(
    target,
    metadataFont({ family: "Damaged destination family" }),
    authorized,
  );
  const badTarget = getEmbeddedFonts(target)[0].faces.regular;
  pkg(target).removePart(badTarget.partName);
  const before = snapshot(target);
  expect(() =>
    importEmbeddedFonts(target, source, ["Damaged source family"]),
  ).toThrow(/missing/);
  expect(snapshot(target)).toEqual(before);
  importEmbeddedFonts(target, source, ["Font Format Regression"]);
  const errors = [];
  const valid = getEmbeddedFonts(target, {
    onError: (error, family) => errors.push({ error: error.message, family }),
  });
  expect(valid.map((font) => font.typeface)).toEqual([
    "Font Format Regression",
  ]);
  expect(errors).toEqual([
    {
      error: "embedded fonts: font part is missing",
      family: "Damaged destination family",
    },
  ]);
  expect(
    dec.decode(pkg(target).getPart("/ppt/presentation.xml").data),
  ).toContain("Damaged destination family");
});
