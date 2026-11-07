import { describe, it, expect } from "vitest";
import { P, createDeck, preview } from "../src/model.js";
import { unzipSync } from "fflate";
import {
  gradientTileInheritanceCases,
  gradientTileInheritanceDeck,
} from "./gradient-tile-inheritance-fixture.js";

const bytes = gradientTileInheritanceDeck();
describe("complete linear shading with inherited tile rectangles", () => {
  for (const [i, c] of gradientTileInheritanceCases.entries()) {
    it(c.name, async () => {
      const p = await P.loadPresentation(await bytes),
        s = P.getSlides(p)[0],
        sh = P.getSlideShapes(s)[i],
        before = unzipSync(await P.savePresentation(p));
      expect(P.getShapeGradientFillEffective(p, sh)).toEqual({
        stops: [
          { offset: 0, color: "#000000" },
          { offset: 1, color: "#FFFFFF" },
        ],
        angleDeg: 0,
        ...(c.expected ? { tileRect: c.expected } : {}),
      });
      expect(P.getShapeGradientFill(sh).tileRect).toBeUndefined();
      expect(unzipSync(await P.savePresentation(p))).toEqual(before);
    });
    it(`copies ${c.name} independently through reload and return`, async () => {
      const p = await P.loadPresentation(await bytes),
        s = P.getSlides(p)[0],
        before = preview(p, s),
        q = createDeck("blank"),
        copied = P.importSlide(q, s, P.getSlideLayouts(q)[0], {
          preservePaintFormatting: true,
        });
      expect(
        P.getShapeGradientFillEffective(q, P.getSlideShapes(copied)[i])
          .tileRect,
      ).toEqual(c.expected);
      P.setShapeGradientFill(P.getSlideShapes(copied)[i], {
        stops: [
          { offset: 0, color: "#1F59A8" },
          { offset: 1, color: "#DA8B23" },
        ],
        angleDeg: 37,
        tileRect: { left: -0.2, right: 0.05 },
      });
      expect(preview(p, s)).toBe(before);
      const reloaded = await P.loadPresentation(await P.savePresentation(q)),
        rs = P.getSlides(reloaded).at(-1),
        returned = P.importSlide(p, rs, P.getSlideLayout(s), {
          preservePaintFormatting: true,
        });
      expect(preview(reloaded, rs)).toBe(preview(q, copied));
      expect(preview(p, returned)).toBe(preview(reloaded, rs));
      expect(P.validatePresentation(reloaded)).toEqual([]);
    });
  }
});
