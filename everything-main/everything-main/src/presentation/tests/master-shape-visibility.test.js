import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { P, createDeck, parseDeck, preview } from "../src/model.js";
import { importSlideTemplate } from "../lib/pptx/src/api/fn/template-import.ts";
import { masterShapeVisibilityFixture } from "./master-shape-visibility-fixture.js";

const nativeCases = [
  [null, null, true, true],
  [null, "0", false, true],
  [null, "1", true, true],
  ["0", null, false, false],
  ["0", "0", false, false],
  ["0", "1", false, false],
  ["1", null, true, true],
  ["1", "0", false, true],
  ["1", "1", true, true],
];
const assertVisible = (p, s, master, layout) => {
  const svg = decodeURIComponent(preview(p, s));
  expect(svg.includes("Mapped master")).toBe(master);
  expect(svg.includes("Mapped layout")).toBe(layout);
  expect(svg).toContain("Mapped slide");
  expect(svg).toContain('fill="#000000"');
  return preview(p, s);
};
const copy = (p, slide) =>
  P.importSlide(p, slide, importSlideTemplate(p, slide), {
    preserveGeometry: false,
  });

describe("native master artwork visibility", () => {
  it.each(nativeCases)(
    "slide %s / layout %s retains editable templates through transfer and return",
    async (slideFlag, layoutFlag, master, layout) => {
      const source = await masterShapeVisibilityFixture({
          slideFlag,
          layoutFlag,
        }),
        slide = P.getSlides(source)[0],
        before = unzipSync(await P.savePresentation(source)),
        expected = assertVisible(source, slide, master, layout),
        target = createDeck("blank"),
        untouched = preview(target, P.getSlides(target)[0]),
        copied = copy(target, slide);
      expect(assertVisible(target, copied, master, layout)).toBe(expected);
      expect(preview(target, P.getSlides(target)[0])).toBe(untouched);
      expect(
        P.getSlideLayoutShapes(target, P.getSlideLayout(copied)),
      ).toHaveLength(
        P.getSlideLayoutShapes(source, P.getSlideLayout(slide)).length,
      );
      expect(
        P.getSlideMasterShapes(target, P.getSlideLayout(copied)),
      ).toHaveLength(
        P.getSlideMasterShapes(source, P.getSlideLayout(slide)).length,
      );
      const bytes = await P.savePresentation(target),
        loaded = await parseDeck(bytes),
        restored = P.getSlides(loaded)[1],
        returned = createDeck("blank");
      expect(assertVisible(loaded, restored, master, layout)).toBe(expected);
      expect(
        assertVisible(returned, copy(returned, restored), master, layout),
      ).toBe(expected);
      expect(P.validatePresentation(loaded)).toEqual([]);
      expect(unzipSync(await P.savePresentation(source))).toEqual(before);
      const parts = unzipSync(bytes),
        root = strFromU8(parts[P.getSlidePartName(restored).slice(1)]),
        template = strFromU8(
          parts[P.getSlideLayoutPartName(P.getSlideLayout(restored)).slice(1)],
        );
      if (slideFlag === null) expect(root).not.toContain("showMasterSp=");
      else expect(root).toContain(`showMasterSp="${slideFlag}"`);
      if (layoutFlag === null) expect(template).not.toContain("showMasterSp=");
      else expect(template).toContain(`showMasterSp="${layoutFlag}"`);
    },
  );

  it.each([
    ["false", null, false, false],
    ["true", "false", false, true],
    [null, "false", false, true],
    [null, "true", true, true],
    [" false ", "true", false, false],
    ["true", " 0 ", false, true],
    ["invalid", "invalid", true, true],
  ])(
    "reads Boolean lexical forms (%s / %s)",
    async (slideFlag, layoutFlag, master, layout) => {
      const p = await masterShapeVisibilityFixture({ slideFlag, layoutFlag });
      assertVisible(p, P.getSlides(p)[0], master, layout);
    },
  );

  it("ignores similarly named foreign attributes", async () => {
    const p = await masterShapeVisibilityFixture({
      slideFlag: "0",
      layoutFlag: "false",
      foreign: true,
    });
    assertVisible(p, P.getSlides(p)[0], true, true);
  });

  it("keeps visibility local to each slide sharing a cached layout", async () => {
    const p = await masterShapeVisibilityFixture({ slideFlag: "0" }),
      hidden = P.getSlides(p)[0],
      visible = P.importSlide(p, hidden, P.getSlideLayout(hidden)),
      pkg = P._internalPackageOf(p),
      part = pkg.getPart(P.getSlidePartName(visible));
    part.data = new TextEncoder().encode(
      new TextDecoder()
        .decode(part.data)
        .replace('showMasterSp="0"', 'showMasterSp="1"'),
    );
    for (let i = 0; i < 3; i++) {
      assertVisible(p, visible, true, true);
      assertVisible(p, hidden, false, false);
    }
    const template = pkg.getPart(
      P.getSlideLayoutPartName(P.getSlideLayout(hidden)),
    );
    const bytes = template.data;
    template.data = new TextEncoder().encode(
      new TextDecoder()
        .decode(bytes)
        .replace(/<p:sldLayout\b/, '<p:sldLayout showMasterSp="0"'),
    );
    assertVisible(p, visible, false, true);
    assertVisible(p, hidden, false, false);
    template.data = bytes;
    assertVisible(p, visible, true, true);
  });
});
