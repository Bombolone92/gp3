import { describe, expect, it } from "vitest";
import { P, createDeck } from "../src/model.js";
import { unzipSync, strFromU8 } from "fflate";

// The ribbon's palette writes theme colours as lumMod/lumOff luminance
// steps; they must reach the file as schemeClr children.
describe("theme colour tints and shades", () => {
  it("writes lumMod and lumOff under the scheme colour", async () => {
    const pres = createDeck("blank");
    const slide = P.getSlides(pres)[0];
    const shape = P.addSlideShape(slide, {
      x: P.inches(1),
      y: P.inches(1),
      w: P.inches(2),
      h: P.inches(1),
      preset: "rect",
    });
    P.setShapeFill(shape, "scheme:accent1/lumMod=60000/lumOff=40000");
    const files = unzipSync(await P.savePresentation(pres));
    const xml = strFromU8(files[P.getSlidePartName(slide).slice(1)]);
    expect(xml).toContain(
      '<a:schemeClr val="accent1"><a:lumMod val="60000"/><a:lumOff val="40000"/></a:schemeClr>',
    );
  });
  it("rejects unknown modifiers and tokens", () => {
    const pres = createDeck("blank");
    const shape = P.addSlideShape(P.getSlides(pres)[0], {
      x: 0,
      y: 0,
      w: P.inches(1),
      h: P.inches(1),
      preset: "rect",
    });
    expect(() => P.setShapeFill(shape, "scheme:accent1/bogus=1")).toThrow();
    expect(() => P.setShapeFill(shape, "scheme:accent9/lumMod=1")).toThrow();
  });
});
describe("sRGB colours with modifiers", () => {
  it("writes alpha under srgbClr, as a highlighter's ink needs", async () => {
    const pres = createDeck("blank");
    const slide = P.getSlides(pres)[0];
    const shape = P.addSlideShape(slide, {
      x: 0,
      y: 0,
      w: P.inches(1),
      h: P.inches(1),
      preset: "rect",
    });
    P.setShapeStroke(shape, {
      color: "#FFFF00/alpha=50000",
      widthEmu: P.pt(6),
    });
    P.setShapeFreeformPaths(shape, [
      {
        w: 100,
        h: 50,
        fill: false,
        commands: [
          { type: "moveTo", x: 0, y: 0 },
          { type: "cubicTo", x1: 30, y1: 50, x2: 60, y2: 0, x: 100, y: 50 },
        ],
      },
    ]);
    const xml = strFromU8(
      unzipSync(await P.savePresentation(pres))[
        P.getSlidePartName(slide).slice(1)
      ],
    );
    expect(xml).toContain(
      '<a:srgbClr val="FFFF00"><a:alpha val="50000"/></a:srgbClr>',
    );
    expect(xml).toContain('<a:path w="100" h="50" fill="none">');
    expect(xml).not.toContain("<a:prstGeom");
  });
});
