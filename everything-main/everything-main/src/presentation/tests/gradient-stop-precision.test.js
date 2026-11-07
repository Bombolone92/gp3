import { describe, expect, it } from "vitest";
import { P, createDeck, preview } from "../src/model.js";
import { renderSlideToSvg } from "../lib/pptx-preview/src/index.ts";

const positions = [
  [0, 0.00001, 0.00002, 1],
  [0, 0.12345, 0.67891, 1],
  [0, 0.49998, 0.50002, 1],
  [0, 0.99998, 0.99999, 1],
];
function make(offsets, preset, alpha, tiled) {
  const p = createDeck("blank"),
    slide = P.getSlides(p)[0],
    shape = P.addSlideShape(slide, {
      x: 0,
      y: 0,
      w: P.emu(300 * 9525),
      h: P.emu(180 * 9525),
      preset,
    });
  P.setShapeGradientFill(shape, {
    angleDeg: 0,
    ...(tiled ? { tileRect: { left: 0.15, right: 0.45 } } : {}),
    stops: offsets.map((offset, i) => ({
      offset,
      color: i < 2 ? "#C02040" : "#2050C0",
      opacity: alpha ? (i < 2 ? 0.2 : 0.8) : 1,
    })),
  });
  return { p, slide, shape };
}
function check(p, slide, offsets) {
  const svg = renderSlideToSvg(p, slide, { textLayout: "svg" }),
    mirrored = svg.includes('spreadMethod="repeat"'),
    actual = [...svg.matchAll(/<stop offset="([^"]+)"/g)].map((m) =>
      Number(m[1]),
    );
  // OOXML stop positions have 100,000 subdivisions. A paint server must
  // retain them, including the half positions in a reflected period.
  for (const offset of offsets) {
    const expected = mirrored ? [offset / 2, 1 - offset / 2] : [offset];
    for (const value of expected)
      expect(actual.some((n) => Math.abs(n - value) < 1e-14)).toBe(true);
  }
}
describe("DrawingML gradient stop precision", () => {
  for (const [i, offsets] of positions.entries())
    for (const preset of ["rect", "ellipse", "diamond"])
      for (const alpha of [false, true])
        for (const tiled of [false, true])
          it(`retains list ${i}, ${preset}, alpha=${alpha}, tiled=${tiled}`, () => {
            const { p, slide } = make(offsets, preset, alpha, tiled);
            check(p, slide, offsets);
          });

  it("retains distinct stops through independent copied edits and export", async () => {
    const offsets = positions[2],
      { p, slide, shape } = make(offsets, "rect", true, false),
      sourceFill = P.getShapeGradientFill(shape),
      sourcePreview = preview(p, slide),
      target = createDeck("blank"),
      copied = P.importSlide(
        target,
        slide,
        P.getSlideLayout(P.getSlides(target)[0]),
      ),
      copy = P.getSlideShapes(copied)[0];
    P.setShapeGradientFill(copy, {
      ...P.getShapeGradientFill(copy),
      angleDeg: 45,
      stops: sourceFill.stops.map((s) => ({ ...s, opacity: 0.5 })),
    });
    expect(P.getShapeGradientFill(shape)).toEqual(sourceFill);
    expect(preview(p, slide)).toBe(sourcePreview);
    const reloaded = await P.loadPresentation(await P.savePresentation(target)),
      reopened = P.getSlides(reloaded).at(-1);
    expect(P.getShapeGradientFill(P.getSlideShapes(reopened)[0])).toMatchObject(
      {
        angleDeg: 45,
        stops: sourceFill.stops.map((s) => ({ ...s, opacity: 0.5 })),
      },
    );
    check(reloaded, reopened, offsets);
    const returned = P.importSlide(p, reopened, P.getSlideLayout(slide));
    check(p, returned, offsets);
    expect(P.validatePresentation(reloaded)).toEqual([]);
  });
});
