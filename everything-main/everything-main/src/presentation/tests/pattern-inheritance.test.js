import { describe, expect, it } from "vitest";
import { P, createDeck, preview } from "../src/model.js";
import { unzipSync } from "fflate";
import {
  patternInheritanceCases,
  patternInheritanceExpected,
  patternInheritanceDeck,
  pattern,
  rgb,
} from "./pattern-inheritance-fixture.js";

const bytes = patternInheritanceDeck();
const read = async () => {
  const pres = await P.loadPresentation(await bytes);
  return { pres, slides: P.getSlides(pres) };
};
describe("partial native pattern inheritance", () => {
  for (const [i, c] of patternInheritanceCases.entries()) {
    it(`resolves ${c.name} without rewriting literal declarations`, async () => {
      const { pres, slides } = await read(),
        slide = slides[Math.floor(i / 8)],
        shape = P.getSlideShapes(slide)[i % 8],
        before = unzipSync(await P.savePresentation(pres)),
        literal = P.getShapePatternFill(pres, shape);
      expect(P.getShapePatternFillEffective(pres, shape)).toEqual(
        patternInheritanceExpected[i],
      );
      expect(P.getShapePatternFill(pres, shape)).toEqual(literal);
      expect(unzipSync(await P.savePresentation(pres))).toEqual(before);
    });
    it(`preserves ${c.name} through independent copy, palette edit and return`, async () => {
      const { pres, slides } = await read(),
        source = slides[Math.floor(i / 8)],
        before = preview(pres, source),
        target = createDeck("blank"),
        copy = P.importSlide(target, source, P.getSlideLayouts(target)[0], {
          preservePaintFormatting: true,
        }),
        shape = P.getSlideShapes(copy)[i % 8];
      expect(P.getShapePatternFillEffective(target, shape)).toEqual(
        patternInheritanceExpected[i],
      );
      const original = P.getSlideShapes(source)[i % 8];
      if (patternInheritanceExpected[i]) {
        P.setShapePatternFill(shape, {
          preset: "shingle",
          foreground: "#9752BC/alpha=33333",
          background: "#26A179/alpha=0",
        });
        expect(P.getShapePatternFillEffective(pres, original)).toEqual(
          patternInheritanceExpected[i],
        );
      }
      expect(preview(pres, source)).toBe(before);
      const reloaded = await P.loadPresentation(
          await P.savePresentation(target),
        ),
        s = P.getSlides(reloaded).at(-1);
      expect(preview(reloaded, s)).toBe(preview(target, copy));
      const back = P.importSlide(pres, s, P.getSlideLayout(source), {
        preservePaintFormatting: true,
      });
      expect(preview(pres, back)).toBe(preview(reloaded, s));
      expect(P.validatePresentation(reloaded)).toEqual([]);
    });
  }
  it("merges the master's own pattern with its style before inheriting it", async () => {
    const p = await P.loadPresentation(
        await patternInheritanceDeck([{ own: pattern() }], {
          masterFill: pattern("wave"),
          masterStyle: 1,
        }),
      ),
      sh = P.getSlideShapes(P.getSlides(p)[0])[0];
    expect(P.getShapePatternFillEffective(p, sh)).toEqual({
      preset: "wave",
      foreground: "#D7A82B",
      background: "#2763C4",
      foregroundOpacity: 0.8,
      backgroundOpacity: 0.6,
    });
  });
  it("retains an explicit color choice and zero alpha instead of merging fallback transforms", async () => {
    const p = await P.loadPresentation(
        await patternInheritanceDeck([
          { own: pattern(undefined, rgb("123456", 0)), ownStyle: 1 },
        ]),
      ),
      sh = P.getSlideShapes(P.getSlides(p)[0])[0];
    expect(P.getShapePatternFillEffective(p, sh)).toEqual({
      preset: "weave",
      foreground: "#123456",
      background: "#2763C4",
      foregroundOpacity: 0,
      backgroundOpacity: 0.6,
    });
  });
});
