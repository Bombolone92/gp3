import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { P, createDeck, parseDeck, preview } from "../src/model.js";
import { duotoneDeck, colorXml } from "./duotone-fixture.js";
const svg = (p, s = P.getSlides(p)[0]) =>
  decodeURIComponent(preview(p, s).split(",").slice(1).join(","));

describe("DrawingML picture duotone", () => {
  it.each(["picture", "shape"])(
    "maps sRGB endpoints with an exact matrix on a %s",
    async (kind) => {
      const p = await parseDeck(await duotoneDeck({ kind })),
        s = P.getSlides(p)[0],
        sh = P.getSlideShapes(s)[0],
        before = unzipSync(await P.savePresentation(p));
      expect(P.getShapeImageDuotone(p, sh)).toEqual({
        firstColor: "#204080",
        secondColor: "#E0A030",
      });
      const markup = svg(p);
      expect(markup).toContain('color-interpolation-filters="sRGB"');
      expect(markup).not.toContain("tableValues=");
      const matrix = markup
        .match(/<feColorMatrix[^>]*values="([^"]+)"/)[1]
        .split(" ")
        .map(Number);
      for (const [input, expected] of [
        [0, [32, 64, 128]],
        [1, [224, 160, 48]],
      ])
        for (let i = 0; i < 3; i++)
          expect(
            255 *
              (input * (matrix[i * 5] + matrix[i * 5 + 1] + matrix[i * 5 + 2]) +
                matrix[i * 5 + 4]),
          ).toBeCloseTo(expected[i], 10);
      expect(matrix.slice(15)).toEqual([0, 0, 0, 1, 0]);
      expect(unzipSync(await P.savePresentation(p))).toEqual(before);
    },
  );
  it("accepts all DrawingML color forms, including transforms", async () => {
    for (const [first, expected] of [
      ['<a:scrgbClr r="50000" g="0" b="100000"/>', "#BC00FF"],
      ['<a:hslClr hue="7200000" sat="100%" lum="50%"/>', "#00FF00"],
      [
        '<a:sysClr val="window" lastClr="FFFFFF"><a:shade val="50000"/></a:sysClr>',
        "#BCBCBC",
      ],
      ['<a:prstClr val="red"/>', "#FF0000"],
      [colorXml("808080"), "#808080"],
    ]) {
      const p = await parseDeck(await duotoneDeck({ first })),
        sh = P.getSlideShapes(P.getSlides(p)[0])[0];
      expect(P.getShapeImageDuotone(p, sh)).toEqual({
        firstColor: expected,
        secondColor: "#E0A030",
      });
    }
  });
  it("preserves the endpoint positions when a recognized color is malformed", async () => {
    const p = await parseDeck(
      await duotoneDeck({ first: "<a:hslClr/>", second: colorXml("123456") }),
    );
    expect(
      P.getShapeImageDuotone(p, P.getSlideShapes(P.getSlides(p)[0])[0]),
    ).toEqual({ firstColor: null, secondColor: "#123456" });
  });
  it("preserves authored effect XML through edits, copies in both directions, and export", async () => {
    const source = await parseDeck(
        await duotoneDeck({
          first: '<a:scrgbClr r="50000" g="0" b="100000"/>',
        }),
      ),
      s = P.getSlides(source)[0];
    P.copyShape(s, P.getSlideShapes(s)[0]);
    const target = createDeck("blank"),
      imported = P.importSlide(
        target,
        s,
        P.getSlideLayout(P.getSlides(target)[0]),
      );
    P.setShapeRotation(P.getSlideShapes(imported)[0], 13);
    const returned = P.importSlide(source, imported, P.getSlideLayout(s));
    for (const [p, slide] of [
      [target, imported],
      [source, returned],
    ]) {
      const bytes = await P.savePresentation(p),
        reopened = await parseDeck(bytes),
        copy = P.getSlides(reopened).at(-1);
      const authored = strFromU8(
        unzipSync(bytes)[P.getSlidePartName(slide).slice(1)],
      );
      expect(authored.match(/<a:duotone>[\s\S]*?<\/a:duotone>/g)).toEqual([
        '<a:duotone><a:scrgbClr r="50000" g="0" b="100000"/><a:srgbClr val="E0A030"/></a:duotone>',
        '<a:duotone><a:scrgbClr r="50000" g="0" b="100000"/><a:srgbClr val="E0A030"/></a:duotone>',
      ]);
      expect(P.getSlideShapes(copy)).toHaveLength(2);
      expect(P.getShapeRotation(P.getSlideShapes(copy)[0])).toBe(13);
      for (const sh of P.getSlideShapes(copy))
        expect(P.getShapeImageDuotone(reopened, sh)).toEqual({
          firstColor: "#BC00FF",
          secondColor: "#E0A030",
        });
      expect(svg(reopened, copy)).toBe(svg(p, slide));
    }
  });
});
