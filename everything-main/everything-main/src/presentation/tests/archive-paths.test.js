import { beforeAll, describe, expect, it } from "vitest";
import { strToU8, unzipSync, zipSync } from "fflate";
import { P, createDeck, parseDeck, preview } from "../src/model.js";
import { withBackslashPaths } from "./fixtures.js";

describe("PPTX archive paths", () => {
  let original, entries, slideText;
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEUlEQVR4nGMwSJjwH4QZYAwARzQIfaOzYgMAAAAASUVORK5CYII=",
    "base64",
  );
  const opaqueXml = strToU8('<data path="C:\\assets\\original.png"/>');
  beforeAll(async () => {
    const pres = createDeck("story");
    const slide = P.getSlides(pres)[0];
    P.setSlideNotes(slide, "Notes survive path normalization.");
    P.addSlideImage(slide, png, {
      x: P.inches(1),
      y: P.inches(1),
      w: P.inches(1),
      h: P.inches(1),
    });
    slideText = P.getSlides(pres).map(P.getSlideText);
    entries = unzipSync(await P.savePresentation(pres));
    entries["customXml/item1.xml"] = opaqueXml;
    original = zipSync(entries);
  });

  it.each([false, true])(
    "imports Windows ZIP paths and exports canonical paths (mixed: %s)",
    async (mixed) => {
      const input = withBackslashPaths(original, mixed);
      const before = input.slice();
      const loaded = await parseDeck(input);
      const slides = P.getSlides(loaded);
      expect(slides.map(P.getSlideText)).toEqual(slideText);
      expect(P.getSlideNotes(slides[0])).toBe(
        "Notes survive path normalization.",
      );
      const picture = P.getSlideShapes(slides[0]).find(
        (shape) => P.getShapeKind(shape) === "picture",
      );
      expect(Buffer.from(P.getShapeImageBytes(picture))).toEqual(png);
      for (const slide of slides) {
        const svg = decodeURIComponent(preview(loaded, slide));
        expect(svg).toContain("<svg");
        expect(svg).not.toContain("data-pptx-fallback");
      }
      expect(input).toEqual(before);
      const exported = unzipSync(await P.savePresentation(loaded));
      expect(Object.keys(exported).some((name) => name.includes("\\"))).toBe(
        false,
      );
      expect(exported["customXml/item1.xml"]).toEqual(opaqueXml);
      for (const [name, data] of Object.entries(entries)) {
        if (name.endsWith(".rels") || name.startsWith("ppt/media/"))
          expect(exported[name]).toEqual(data);
      }
      const restored = await parseDeck(zipSync(exported));
      expect(P.getSlides(restored).map(P.getSlideText)).toEqual(slideText);
    },
  );

  it("ignores Windows directory records and [trash] parts", async () => {
    const windows = unzipSync(withBackslashPaths(original));
    windows["ppt\\"] = new Uint8Array();
    windows["ppt\\slides\\"] = new Uint8Array();
    windows["[trash]\\0000.dat"] = new Uint8Array([1, 2, 3]);
    const loaded = await parseDeck(zipSync(windows));
    expect(P.getSlides(loaded).map(P.getSlideText)).toEqual(slideText);
    const saved = Object.keys(unzipSync(await P.savePresentation(loaded)));
    expect(
      saved.some((name) => name.endsWith("/") || name.includes("[trash]")),
    ).toBe(false);
  });

  it.each([
    ["ppt/slides/slide1.xml", "ppt\\slides\\slide1.xml"],
    ["ppt/slides/slide1.xml", "ppt\\slides/slide1.xml"],
    ["ppt/slides/slide1.xml", "PPT\\SLIDES\\SLIDE1.XML"],
    ["ppt/slides/slide1.xml", "PPT/SLIDES/SLIDE1.XML"],
    ["[Content_Types].xml", "[CONTENT_TYPES].XML"],
  ])("rejects ambiguous entries %s and %s", async (source, duplicate) => {
    const archive = zipSync({ ...entries, [duplicate]: entries[source] });
    await expect(P.loadPresentation(archive)).rejects.toThrow(
      /duplicate.*part/i,
    );
    await expect(parseDeck(archive)).rejects.toThrow("could not be opened");
  });

  it("rejects identical duplicate ZIP names before decompression can overwrite them", async () => {
    const bytes = zipSync({ ...entries, "customXml/item2.xml": opaqueXml });
    // Equal-length replacement in both ZIP headers; file bodies remain intact.
    const name = strToU8("customXml/item2.xml");
    for (let i = 0; i <= bytes.length - name.length; i++) {
      if (name.every((byte, offset) => bytes[i + offset] === byte))
        bytes[i + name.length - 5] = "1".charCodeAt(0);
    }
    await expect(P.loadPresentation(bytes)).rejects.toThrow(/duplicate.*part/i);
  });

  it.each([
    "ppt\\..\\escape.xml",
    "ppt\\.\\escape.xml",
    "ppt\\\\escape.xml",
    "\\escape.xml",
  ])("does not repair invalid path segments in %s", async (name) => {
    await expect(
      parseDeck(zipSync({ ...entries, [name]: opaqueXml })),
    ).rejects.toThrow("could not be opened");
  });
});
