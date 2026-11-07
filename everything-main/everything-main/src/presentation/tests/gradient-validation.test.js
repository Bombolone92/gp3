import { describe, expect, it } from "vitest";
import { unzipSync } from "fflate";
import { P, createDeck, parseDeck } from "../src/model.js";
import { setGradientFill } from "../lib/pptx/src/internal/drawingml/fill.ts";
import { parseXml } from "../lib/pptx/src/internal/xml/index.ts";

const good = { offset: 0, color: "#123456" };
const invalidStops = [
  { offset: 1, color: "not-a-color" },
  { offset: 1, color: "scheme:missing" },
  { offset: NaN, color: "#FFFFFF" },
  { offset: 1.1, color: "#FFFFFF" },
];
const fills = [
  '<a:solidFill><a:srgbClr val="654321"/></a:solidFill>',
  '<a:gradFill><a:gsLst><a:gs pos="0"><a:schemeClr val="accent2"/></a:gs><a:gs pos="100000"><a:srgbClr val="FFFFFF"/></a:gs></a:gsLst><a:lin ang="5400000"/></a:gradFill>',
  '<a:blipFill><a:blip r:embed="rId9"/><a:stretch><a:fillRect/></a:stretch></a:blipFill>',
  '<a:pattFill prst="pct50"><a:fgClr><a:srgbClr val="000000"/></a:fgClr><a:bgClr><a:srgbClr val="FFFFFF"/></a:bgClr></a:pattFill>',
  "<a:noFill/>",
];

describe("gradient mutation validation", () => {
  it.each(fills)(
    "keeps the previous fill and sibling XML intact on failure: %s",
    (fill) => {
      const host = parseXml(
        `<p:spPr xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${fill}<a:ln w="12700"><a:noFill/></a:ln><a:extLst/></p:spPr>`,
      ).root;
      const before = structuredClone(host);
      for (const bad of invalidStops) {
        expect(() => setGradientFill(host, { stops: [good, bad] })).toThrow();
        expect(host).toEqual(before);
      }
      // The same object remains usable after a rejected replacement.
      setGradientFill(host, { stops: [good, { offset: 1, color: "#ABCDEF" }] });
      expect(
        host.children
          .filter((node) => node.kind === "element")
          .map((node) => node.name.localName),
      ).toEqual(["prstGeom", "gradFill", "ln", "extLst"]);
    },
  );

  it.each([false, true])(
    "does not persist a rejected change on the next edit (gradient=%s)",
    async (gradient) => {
      const p = createDeck("blank"),
        s = P.getSlides(p)[0];
      const shape = P.addSlideShape(s, {
        x: P.inches(1),
        y: P.inches(1),
        w: P.inches(3),
        h: P.inches(2),
        preset: "rect",
      });
      if (gradient)
        P.setShapeGradientFill(shape, {
          stops: [good, { offset: 1, color: "#ABCDEF" }],
        });
      else P.setShapeFill(shape, "#654321");
      const expected = await parseDeck(await P.savePresentation(p));
      expect(() =>
        P.setShapeGradientFill(shape, { stops: [good, invalidStops[0]] }),
      ).toThrow();
      P.setShapeRotation(shape, 37);
      P.setShapeRotation(P.getSlideShapes(P.getSlides(expected)[0])[0], 37);
      expect(unzipSync(await P.savePresentation(p))).toEqual(
        unzipSync(await P.savePresentation(expected)),
      );
    },
  );
});
