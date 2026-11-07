import { describe, expect, it } from "vitest";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { renderSlideToSvg } from "../lib/pptx-preview/src/index.ts";
import { P, createDeck, parseDeck, preview, text } from "../src/model.js";
import { slideFontResolver } from "../src/fonts.js";
import { createSharedFontDeck } from "./fixtures.js";

const svgOf = (pres, slide = P.getSlides(pres)[0]) => {
  const uri = preview(pres, slide);
  return decodeURIComponent(uri.slice(uri.indexOf(",") + 1));
};

async function withFontMetadata(
  pres,
  name,
  attributes,
  inLayout = false,
  slideIndex = null,
) {
  const files = unzipSync(await P.savePresentation(pres));
  const layoutDeck = createDeck();
  const layoutShape = text(P.getSlides(layoutDeck)[0], "", 1, 1, 8, 1);
  P.setShapeTextFormat(layoutShape, { font: name });
  P.setShapeHidden(layoutShape, true);
  const layoutXml = P.getShapeXmlString(layoutShape)
    .replace(/^<\?xml[^>]*>\s*/, "")
    .replace(/(<p:cNvPr )id="\d+"/, '$1id="9000"')
    .replaceAll(`typeface="${name}"`, `typeface="${name}" ${attributes}`);
  for (const [part, bytes] of Object.entries(files)) {
    if (
      !part.startsWith(inLayout ? "ppt/slideLayouts/" : "ppt/slides/") ||
      !part.endsWith(".xml")
    )
      continue;
    if (
      slideIndex !== null &&
      part !== P.getSlidePartName(P.getSlides(pres)[slideIndex]).slice(1)
    )
      continue;
    const xml = strFromU8(bytes);
    files[part] = strToU8(
      inLayout
        ? xml.replace("</p:spTree>", `${layoutXml}</p:spTree>`)
        : xml.replaceAll(
            `typeface="${name}"`,
            `typeface="${name}" ${attributes}`,
          ),
    );
  }
  return parseDeck(zipSync(files));
}

describe("authored fonts in slide previews", () => {
  it("refreshes inherited geometry after a layout edit or relationship change", async () => {
    const pres = createDeck();
    const slide = P.addTitleSlide(pres, "Inherited geometry");
    const title = P.findSlidePlaceholder(slide, "ctrTitle");
    const layout = P.getSlideLayout(slide);
    const original = P.getShapeBoundsResolved(pres, title);
    const part = P._internalPackageOf(pres).getPart(
      P.getSlideLayoutPartName(layout),
    );
    part.data = strToU8(
      strFromU8(part.data).replace(
        `x="${original.x}"`,
        `x="${original.x + P.inches(1)}"`,
      ),
    );
    expect(P.getShapeBoundsResolved(pres, title).x).toBe(
      original.x + P.inches(1),
    );
    const replacement = P.getSlideLayouts(pres).find(
      (l) => P.getSlideLayoutPartName(l) !== part.name,
    );
    P.setSlideLayout(slide, replacement);
    expect(P.getSlideLayoutPartName(P.getSlideLayout(slide))).toBe(
      P.getSlideLayoutPartName(replacement),
    );
    const other = createDeck();
    const otherSlide = P.addTitleSlide(other, "Separate deck");
    expect(
      P.getShapeBoundsResolved(
        other,
        P.findSlidePlaceholder(otherSlide, "ctrTitle"),
      ),
    ).toEqual(original);
  });

  it.each(["layout", "slide"])(
    "uses a classification declared only in another %s without changing exported fonts",
    async (location) => {
      const pres = await parseDeck(await createSharedFontDeck({ location }));
      const before = unzipSync(await P.savePresentation(pres));
      const family =
        "&quot;Unavailable Shared Serif&quot;, Georgia, &quot;Times New Roman&quot;, serif";
      expect(svgOf(pres)).toContain(family);
      expect(
        slideFontResolver(
          P.getSlides(pres)[0],
          pres,
        )("Unavailable Shared Serif"),
      ).toContain("Georgia");
      const saved = await P.savePresentation(pres);
      expect(unzipSync(saved)).toEqual(before);
      const restored = await parseDeck(saved);
      expect(svgOf(restored)).toContain(family);
      const copied = P.copyShape(
        P.getSlides(pres)[0],
        P.getSlideShapes(P.getSlides(pres)[0])[0],
      );
      expect(P.getShapeRunFormat(copied, 0, 0).font).toBe(
        "Unavailable Shared Serif",
      );
      expect(svgOf(pres)).toContain(family);
    },
  );

  it("refreshes shared hints after metadata changes or is removed and isolates decks", async () => {
    const pres = await parseDeck(await createSharedFontDeck());
    expect(svgOf(pres)).toContain("Times New Roman");
    const pkg = P._internalPackageOf(pres);
    const part = pkg.getPart("/ppt/slideLayouts/slideLayout2.xml");
    part.data = strToU8(
      strFromU8(part.data).replace('pitchFamily="18"', 'pitchFamily="49"'),
    );
    expect(svgOf(pres)).toContain("Courier New");
    part.data = strToU8(
      strFromU8(part.data).replace('pitchFamily="49"', 'pitchFamily="0"'),
    );
    expect(svgOf(pres)).toContain("Arial, Helvetica, sans-serif");
    const other = createDeck();
    expect(
      slideFontResolver(
        P.getSlides(other)[0],
        other,
      )("Unavailable Shared Serif"),
    ).toContain("sans-serif");
  });

  it("prefers local font metadata and does not infer a class from conflicting layouts", async () => {
    const files = unzipSync(await createSharedFontDeck());
    const part = "ppt/slideLayouts/slideLayout3.xml";
    files[part] = strToU8(
      strFromU8(files[part]).replace(
        "<a:lstStyle/>",
        '<a:lstStyle><a:defPPr><a:defRPr><a:latin typeface="Unavailable Shared Serif" pitchFamily="49"/></a:defRPr></a:defPPr></a:lstStyle>',
      ),
    );
    const pres = await parseDeck(zipSync(files));
    expect(svgOf(pres)).toContain("Arial, Helvetica, sans-serif");
    const local = await withFontMetadata(
      pres,
      "Unavailable Shared Serif",
      'pitchFamily="18"',
      false,
      0,
    );
    expect(svgOf(local)).toContain("Times New Roman");
  });

  it("updates shared slide hints after edits, duplication, deletion and import", async () => {
    const pres = await parseDeck(
      await createSharedFontDeck({ location: "slide" }),
    );
    const [visible, donor] = P.getSlides(pres);
    const face = "Unavailable Shared Serif";
    const family = () => slideFontResolver(visible, pres)(face);
    expect(family()).toContain("Georgia");
    const hint = P.getSlideShapes(donor)[0];
    P.setShapeTextFormat(hint, { font: "Renamed Shared Serif" });
    expect(family()).toContain("sans-serif");
    // Setting a new face removes metadata specific to the old face.
    P.setShapeTextFormat(hint, { font: face });
    expect(family()).toContain("sans-serif");
    P.removeSlide(pres, donor);
    const other = await parseDeck(
      await createSharedFontDeck({ location: "slide" }),
    );
    const imported = P.importSlide(
      pres,
      P.getSlides(other)[1],
      P.getSlideLayout(visible),
    );
    expect(family()).toContain("Georgia");
    const copy = P.duplicateSlide(pres, imported);
    P.removeSlide(pres, imported);
    expect(family()).toContain("Georgia");
    P.removeSlide(pres, copy);
    expect(family()).toContain("sans-serif");
  });

  it("does not guess from conflicting slide and layout font classifications", async () => {
    const original = await createSharedFontDeck({ location: "slide" });
    const files = unzipSync(original);
    const part = "ppt/slideLayouts/slideLayout2.xml";
    files[part] = strToU8(
      strFromU8(files[part]).replace(
        "<a:lstStyle/>",
        '<a:lstStyle><a:defPPr><a:defRPr><a:latin typeface="Unavailable Shared Serif" pitchFamily="49"/></a:defRPr></a:defPPr></a:lstStyle>',
      ),
    );
    const pres = await parseDeck(zipSync(files));
    expect(svgOf(pres)).toContain("Arial, Helvetica, sans-serif");
    // Explicit metadata on the visible slide still wins over shared hints.
    const local = await withFontMetadata(
      pres,
      "Unavailable Shared Serif",
      'pitchFamily="18"',
      false,
      0,
    );
    expect(svgOf(local)).toContain("Georgia");
  });

  it("keeps conflicts within slides ambiguous until the conflicting slide is removed", async () => {
    const pres = await parseDeck(
      await createSharedFontDeck({ location: "slide" }),
    );
    const source = await parseDeck(
      await createSharedFontDeck({ location: "slide" }),
    );
    const conflicting = await withFontMetadata(
      source,
      "Unavailable Shared Serif",
      'pitchFamily="49"',
      false,
      0,
    );
    const [visible] = P.getSlides(pres);
    const added = P.importSlide(
      pres,
      P.getSlides(conflicting)[0],
      P.getSlideLayout(visible),
    );
    expect(svgOf(pres)).toContain("Arial, Helvetica, sans-serif");
    P.removeSlide(pres, added);
    expect(svgOf(pres)).toContain("Georgia");
  });

  it.each([
    ["66", "030804020302050B0404", "Brush Script MT"],
    ["66", "030304020206070D0D06", "Savoye LET"],
    ["18", "02070606080606020203", "Bodoni 72"],
  ])(
    "refines generic family %s with compatible PANOSE metadata %s",
    async (pitch, panose, expected) => {
      const files = unzipSync(
        await createSharedFontDeck({ location: "slide" }),
      );
      const donor = "ppt/slides/slide2.xml";
      files[donor] = strToU8(
        strFromU8(files[donor]).replace(
          'pitchFamily="18"',
          `pitchFamily="${pitch}" panose="${panose}"`,
        ),
      );
      const layout = "ppt/slideLayouts/slideLayout2.xml";
      files[layout] = strToU8(
        strFromU8(files[layout]).replace(
          "<a:lstStyle/>",
          `<a:lstStyle><a:defPPr><a:defRPr><a:latin typeface="Unavailable Shared Serif" pitchFamily="${pitch}"/></a:defRPr></a:defPPr></a:lstStyle>`,
        ),
      );
      const pres = await parseDeck(zipSync(files));
      expect(
        slideFontResolver(
          P.getSlides(pres)[0],
          pres,
        )("Unavailable Shared Serif"),
      ).toContain(`, "${expected}"`);
    },
  );

  it("resolves theme fonts and preserves table, grouped text, and bullet faces", async () => {
    const pres = createDeck();
    P.setPresentationFonts(pres, {
      majorLatin: "Georgia",
      minorLatin: "Verdana",
    });
    const titleSlide = P.addTitleSlide(pres, "Theme heading");
    P.setShapeText(
      P.findSlidePlaceholder(titleSlide, "subTitle"),
      "Theme body",
    );
    expect(svgOf(pres, titleSlide)).toContain("&quot;Georgia&quot;");
    expect(svgOf(pres, titleSlide)).toContain("&quot;Verdana&quot;");
    const slide = P.getSlides(pres)[0];
    const one = text(slide, "Grouped serif", 1, 1, 4, 1);
    const two = text(slide, "Grouped mono", 6, 1, 4, 1);
    P.setShapeTextFormat(one, { font: "Georgia" });
    P.setShapeTextFormat(two, { font: "Courier New" });
    P.groupShapes([one, two]);
    const table = P.addSlideTable(slide, {
      x: P.inches(1),
      y: P.inches(3),
      w: P.inches(8),
      h: P.inches(1),
      rows: [["Table face"]],
    });
    P.setTableCellTextFormat(P.getTableCell(table, 0, 0), {
      font: "Trebuchet MS",
      size: 20,
    });
    const bullet = text(slide, "Bullet face", 1, 5, 8, 1);
    P.setParagraphBullet(bullet, 0, "bullet");
    const files = unzipSync(await P.savePresentation(pres));
    const part = P.getSlidePartName(slide).replace(/^\//, "");
    files[part] = strToU8(
      strFromU8(files[part]).replace(
        "<a:buChar",
        '<a:buFont typeface="Wingdings"/><a:buChar',
      ),
    );
    const loaded = await parseDeck(zipSync(files));
    const svg = svgOf(loaded);
    for (const font of ["Georgia", "Courier New", "Trebuchet MS", "Wingdings"])
      expect(svg).toContain(`&quot;${font}&quot;`);
  });

  it.each([
    "Georgia",
    "Verdana",
    "Trebuchet MS",
    "Aptos Display",
    "Sagona Book",
    "Noto Sans CJK JP",
  ])(
    "keeps %s available to the browser and preserves it on save",
    async (font) => {
      const pres = createDeck();
      const slide = P.getSlides(pres)[0];
      const shape = text(slide, "Authored typeface", 1, 1, 8, 1);
      P.setShapeTextFormat(shape, { font });
      const before = P.getSlideXmlString(slide);
      expect(svgOf(pres)).toContain(`font-family="&quot;${font}&quot;,`);
      expect(P.getSlideXmlString(slide)).toBe(before);
      const loaded = await parseDeck(await P.savePresentation(pres));
      expect(
        P.getShapeRunFormatEffective(
          loaded,
          P.getSlideShapes(P.getSlides(loaded)[0])[0],
          0,
          0,
        ).font,
      ).toBe(font);
    },
  );

  it.each([
    ['pitchFamily="18"', "serif"],
    ['pitchFamily="34"', "sans-serif"],
    ['pitchFamily="49"', "monospace"],
    ['pitchFamily="66"', "cursive"],
    ['pitchFamily="66" panose="030304020206070D0D06"', "cursive"],
    ['pitchFamily="66" panose="030804020302050B0404"', "cursive"],
    ['pitchFamily="82"', "fantasy"],
    ['panose="02020503050505020204"', "serif"],
    ['panose="020B0503050505020204"', "sans-serif"],
    ['panose="020B0509050505020204"', "monospace"],
    ['pitchFamily="999" panose="invalid"', "sans-serif"],
  ])(
    "uses the declared font class (%s) when the font is unavailable",
    async (attrs, generic) => {
      const pres = createDeck();
      const shape = text(P.getSlides(pres)[0], "Fallback typeface", 1, 1, 8, 1);
      P.setShapeTextFormat(shape, { font: "Unavailable Test Face" });
      const loaded = await withFontMetadata(
        pres,
        "Unavailable Test Face",
        attrs,
      );
      const family = slideFontResolver(P.getSlides(loaded)[0])(
        "Unavailable Test Face",
      );
      expect(family).toMatch(new RegExp(`, ${generic}$`));
      expect(svgOf(loaded)).toContain(family.replaceAll('"', "&quot;"));
    },
  );

  it("uses font metadata from the layout without changing the slide or layout", async () => {
    const pres = createDeck();
    const shape = text(
      P.getSlides(pres)[0],
      "Layout font metadata",
      1,
      1,
      8,
      1,
    );
    P.setShapeTextFormat(shape, { font: "Layout Serif Face" });
    const loaded = await withFontMetadata(
      pres,
      "Layout Serif Face",
      'pitchFamily="18"',
      true,
    );
    const before = await P.savePresentation(loaded);
    expect(svgOf(loaded)).toContain(
      "&quot;Layout Serif Face&quot;, Georgia, &quot;Times New Roman&quot;, serif",
    );
    const after = await P.savePresentation(loaded);
    expect(unzipSync(after)).toEqual(unzipSync(before));
  });

  it("does not retain stale font metadata after an edit or leak metadata between decks", async () => {
    const pres = createDeck();
    P.setShapeTextFormat(
      text(P.getSlides(pres)[0], "Change font", 1, 1, 8, 1),
      { font: "Original Serif" },
    );
    const loaded = await withFontMetadata(
      pres,
      "Original Serif",
      'pitchFamily="18"',
    );
    expect(svgOf(loaded)).toContain("Times New Roman");
    P.setShapeTextFormat(P.getSlideShapes(P.getSlides(loaded)[0])[0], {
      font: "Verdana",
    });
    expect(svgOf(loaded)).toContain(
      "&quot;Verdana&quot;, Arial, Helvetica, sans-serif",
    );
    const other = createDeck();
    expect(
      slideFontResolver(P.getSlides(other)[0])("Original Serif"),
    ).toContain("Arial, Helvetica, sans-serif");
  });

  it("escapes a typeface as one CSS family and then as XML", () => {
    const pres = createDeck();
    const slide = P.getSlides(pres)[0];
    const font = 'A" & <B>, \\ serif';
    P.setShapeTextFormat(text(slide, "Escaped font", 1, 1, 8, 1), { font });
    const resolved = slideFontResolver(slide)(font);
    expect(resolved).toBe(
      '"A\\22  & <B>, \\5c  serif", Arial, Helvetica, sans-serif',
    );
    expect(svgOf(pres)).toContain("A\\22  &amp; &lt;B&gt;, \\5c  serif");
    expect(svgOf(pres)).not.toContain("<B>");
  });

  it("keeps the preview library's default font substitution for callers that do not opt in", () => {
    const pres = createDeck();
    const slide = P.getSlides(pres)[0];
    P.setShapeTextFormat(text(slide, "Default renderer", 1, 1, 8, 1), {
      font: "Georgia",
    });
    expect(renderSlideToSvg(pres, slide, { textLayout: "svg" })).toContain(
      'font-family="Carlito"',
    );
    expect(svgOf(pres)).toContain("&quot;Georgia&quot;");
  });
});
