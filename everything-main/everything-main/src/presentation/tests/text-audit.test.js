import { describe, expect, it } from "vitest";
import { P, createDeck } from "../src/model.js";
import { auditTextLayout } from "../lib/pptx-preview/src/audit.ts";

const measure = (text) => ({
  widthPx: text.length * 10,
  ascentPx: 18,
  descentPx: 4,
  lineGapPx: 1,
});

describe("text audit uses shared wrap provenance", () => {
  it.each([false, true])(
    "counts wraps without counting blank paragraphs or columns: %s",
    (columns) => {
      const p = createDeck("blank"),
        s = P.getSlides(p)[0];
      const shape = P.addSlideTextBox(s, {
        x: 0,
        y: 0,
        w: (columns ? 100 : 50) * 9525,
        h: 1000 * 9525,
        text: "\nab cd ef\n",
      });
      P.setShapeTextFormat(shape, { font: "Arial", size: 15 });
      P.setShapeTextMargins(shape, { left: 0, right: 0, top: 0, bottom: 0 });
      P.setShapeTextAutoFit(shape, "none");
      P.setShapeTextWrap(shape, "square");
      if (columns) P.setShapeTextColumns(shape, { count: 2, gapEmu: 0 });
      const result = auditTextLayout(p, {
        measureText: measure,
        reportSoftWraps: true,
      });
      expect(result.filter((issue) => issue.kind === "soft-wrap")).toEqual([
        expect.objectContaining({
          slideIndex: 0,
          paragraphIndex: 1,
          extraLines: 1,
        }),
      ]);
      expect(
        auditTextLayout(p, { measureText: measure }).some(
          (issue) => issue.kind === "soft-wrap",
        ),
      ).toBe(false);
    },
  );
});
