import { describe, expect, it } from "vitest";
import { P, createDeck } from "../src/model.js";
import { unzipSync, strFromU8 } from "fflate";

const rect = (slide, x) =>
  P.addSlideShape(slide, {
    x: P.inches(x),
    y: P.inches(1),
    w: P.inches(2),
    h: P.inches(1),
    preset: "rect",
  });

describe("copyShapeFormatting (Format Painter)", () => {
  it("copies fill, line and effects as authored, keeping theme colours", async () => {
    const pres = createDeck("blank");
    const slide = P.getSlides(pres)[0];
    const a = rect(slide, 1),
      b = rect(slide, 4);
    P.setShapeFill(a, "scheme:accent2/lumMod=75000");
    P.setShapeStroke(a, { color: "scheme:accent6", widthEmu: P.pt(3) });
    P.setShapeShadow(a, {
      opacity: 0.4,
      blurEmu: 50800,
      offsetEmu: 38100,
      angleDeg: 45,
    });
    P.setShapeFill(b, "#00FF00");
    expect(P.copyShapeFormatting(a, b)).toBe(true);
    const xml = strFromU8(
      unzipSync(await P.savePresentation(pres))[
        P.getSlidePartName(slide).slice(1)
      ],
    );
    expect(xml).not.toContain("00FF00");
    expect(
      xml.match(
        /<a:schemeClr val="accent2"><a:lumMod val="75000"\/><\/a:schemeClr>/g,
      ),
    ).toHaveLength(2);
    expect(xml.match(/<a:ln w="38100"/g)).toHaveLength(2);
    expect(xml.match(/<a:outerShdw/g)).toHaveLength(2);
  });
  it("keeps spPr in schema order", async () => {
    const pres = createDeck("blank");
    const slide = P.getSlides(pres)[0];
    const a = rect(slide, 1),
      b = rect(slide, 4);
    P.setShapeFill(a, "#123456");
    P.setShapeStroke(a, { color: "#654321", widthEmu: P.pt(1) });
    P.copyShapeFormatting(a, b);
    const xml = strFromU8(
      unzipSync(await P.savePresentation(pres))[
        P.getSlidePartName(slide).slice(1)
      ],
    );
    const spPr = xml.match(/<p:spPr>[\s\S]*?<\/p:spPr>/g).at(-1);
    expect(spPr.indexOf("<a:prstGeom")).toBeLessThan(
      spPr.indexOf("<a:solidFill"),
    );
    expect(spPr.indexOf("<a:solidFill")).toBeLessThan(spPr.indexOf("<a:ln"));
  });
});
