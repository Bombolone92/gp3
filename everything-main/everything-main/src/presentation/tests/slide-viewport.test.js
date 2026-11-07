import { it, expect } from "vitest";
import { preview } from "../src/model.js";
import { renderSlideToSvg } from "../lib/pptx-preview/src/index.ts";
import { slidePixelSizes, slideSvgSizeDeck } from "./slide-svg-size-fixture.js";

it.each([...slidePixelSizes, [1050.37, 642.19]])(
  "maps a %s by %s image preview to its complete destination while preserving standalone fitting",
  (w, h) => {
    const { pres, slide } = slideSvgSizeDeck(w, h);
    const ordinary = renderSlideToSvg(pres, slide),
      stretched = renderSlideToSvg(pres, slide, {
        preserveAspectRatio: "none",
      }),
      image = decodeURIComponent(
        preview(pres, slide).split(",").slice(1).join(","),
      );
    expect(ordinary).toContain('preserveAspectRatio="xMidYMid meet"');
    expect(
      renderSlideToSvg(pres, slide, { preserveAspectRatio: "xMidYMid meet" }),
    ).toBe(ordinary);
    expect(stretched).toBe(
      ordinary.replace(
        'preserveAspectRatio="xMidYMid meet"',
        'preserveAspectRatio="none"',
      ),
    );
    expect(image).toContain('preserveAspectRatio="none"');
  },
);
it("keeps ordinary fitting for malformed JavaScript viewport options", () => {
  const { pres, slide } = slideSvgSizeDeck(1000, 625),
    ordinary = renderSlideToSvg(pres, slide);
  for (const preserveAspectRatio of [null, 0, "slice", 'none" onload="evil'])
    expect(renderSlideToSvg(pres, slide, { preserveAspectRatio })).toBe(
      ordinary,
    );
});
