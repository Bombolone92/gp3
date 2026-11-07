import { describe, expect, it } from "vitest";
import { unzipSync } from "fflate";
import { P, parseDeck, preview } from "../src/model.js";
import { parseXml } from "../lib/pptx/src/internal/xml/index.ts";
import {
  resolveDrawingColor,
  resolveDrawingOpacity,
} from "../lib/pptx/src/api/fn/shape-color.ts";
import { createTransformedBackgroundDeck } from "./fixtures.js";

const svgOf = (pres, slide = P.getSlides(pres)[0]) => {
  const uri = preview(pres, slide);
  return decodeURIComponent(uri.slice(uri.indexOf(",") + 1));
};
const colorElement = (content, hex = "000000") =>
  parseXml(
    `<a:srgbClr xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" val="${hex}">${content}</a:srgbClr>`,
  ).root;

describe("transformed solid backgrounds", () => {
  it("resolves literal colors without looking up the theme or master color map", async () => {
    const pres = await parseDeck(
      await createTransformedBackgroundDeck({
        level: "slide",
        color: '<a:srgbClr val="000000"><a:lumOff val="50000"/></a:srgbClr>',
      }),
    );
    const context = {
      get theme() {
        throw new Error("Unnecessary theme lookup");
      },
      get clrMap() {
        throw new Error("Unnecessary master lookup");
      },
    };
    expect(P.getSlideBackground(P.getSlides(pres)[0], context)).toEqual({
      kind: "solid",
      color: "#808080",
    });
  });

  it.each(["slide", "layout", "master"])(
    "resolves a %s background without changing authored colors or exported parts",
    async (level) => {
      const pres = await parseDeck(
        await createTransformedBackgroundDeck({ level }),
      );
      const before = unzipSync(await P.savePresentation(pres));
      const slide = P.getSlides(pres)[0],
        layout = P.getSlideLayout(slide);
      const context = {
        theme: P.getPresentationTheme(pres),
        clrMap: P.getEffectiveColorMap(slide),
      };
      const read = (context) =>
        level === "slide"
          ? P.getSlideBackground(slide, context)
          : level === "layout"
            ? P.getSlideLayoutBackground(layout, context)
            : P.getSlideMasterBackground(pres, layout, context);
      expect(read()).toEqual({ kind: "solid", color: "scheme:accent5" });
      expect(read(context)).toEqual({ kind: "solid", color: "#EDE0E8" });
      expect(svgOf(pres)).toMatch(/<rect[^>]+fill="#EDE0E8"/);
      expect(unzipSync(await P.savePresentation(pres))).toEqual(before);
      const duplicate = P.duplicateSlide(pres, slide);
      expect(svgOf(pres, duplicate)).toMatch(/<rect[^>]+fill="#EDE0E8"/);
      const restored = await parseDeck(await P.savePresentation(pres));
      for (const s of P.getSlides(restored))
        expect(svgOf(restored, s)).toContain('fill="#EDE0E8"');
    },
  );

  it("applies the color map before transforms and paints alpha over the white page", async () => {
    const pres = await parseDeck(
      await createTransformedBackgroundDeck({
        level: "slide",
        color:
          '<a:schemeClr val="accent1"><a:lumMod val="20%"/><a:lumOff val="80%"/><a:alpha val="50000"/></a:schemeClr>',
      }),
    );
    const slide = P.getSlides(pres)[0];
    expect(
      P.getSlideBackground(slide, {
        theme: P.getPresentationTheme(pres),
        clrMap: { accent1: "accent5" },
      }),
    ).toEqual({ kind: "solid", color: "#EDE0E8", opacity: 0.5 });
    const svg = svgOf(pres);
    expect(svg).toMatch(
      /<rect[^>]+fill="#FFFFFF"\/><rect[^>]+fill-opacity="0.5"/,
    );
  });

  it("lets an explicit slide background replace a transformed master", async () => {
    const pres = await parseDeck(await createTransformedBackgroundDeck());
    P.setSlideBackground(P.getSlides(pres)[0], "#123456");
    expect(svgOf(pres)).toContain('fill="#123456"');
    expect(svgOf(pres)).not.toContain('fill="#EDE0E8"');
  });
});

describe("DrawingML transform units and opacity", () => {
  it.each(["80000", "80%", "0.8"])(
    "reads a luminance offset of %s",
    (value) => {
      expect(
        resolveDrawingColor(colorElement(`<a:lumOff val="${value}"/>`), null),
      ).toBe("#CCCCCC");
    },
  );
  it("keeps small integer percentages and angles in their specified units", () => {
    expect(resolveDrawingColor(colorElement('<a:lumOff val="1"/>'), null)).toBe(
      "#000000",
    );
    expect(
      resolveDrawingColor(
        colorElement('<a:hueOff val="7200000"/>', "FF0000"),
        null,
      ),
    ).toBe("#00FF00");
  });
  it("applies alpha operations in order with per-operation clamping", () => {
    expect(
      resolveDrawingOpacity(
        colorElement(
          '<a:alpha val="50%"/><a:alphaMod val="50000"/><a:alphaOff val="10000"/>',
        ),
      ),
    ).toBeCloseTo(0.35);
    expect(
      resolveDrawingOpacity(
        colorElement(
          '<a:alpha val="50000"/><a:alphaOff val="-100000"/><a:alphaMod val="200000"/>',
        ),
      ),
    ).toBe(0);
    expect(
      resolveDrawingOpacity(
        colorElement(
          '<a:alpha val="50000"/><a:alphaMod val="300000"/><a:alphaOff val="-25000"/>',
        ),
      ),
    ).toBe(0.75);
    expect(resolveDrawingOpacity(colorElement('<a:alpha val="1"/>'))).toBe(
      0.00001,
    );
    expect(
      resolveDrawingOpacity(colorElement('<a:alpha val="invalid"/>')),
    ).toBe(1);
  });
});
