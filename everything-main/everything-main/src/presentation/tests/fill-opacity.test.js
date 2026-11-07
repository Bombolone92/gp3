import { describe, expect, it } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { P, createDeck, parseDeck, preview } from "../src/model.js";
import { fillOpacityDeck } from "./fill-opacity-fixture.js";

const open = async (options) => {
  const p = await parseDeck(await fillOpacityDeck(options)),
    s = P.getSlides(p)[0];
  return { p, s, shape: P.getSlideShapes(s)[0] };
};
const markup = (p, s) => decodeURIComponent(preview(p, s));

describe("solid fill transparency", () => {
  it.each([
    ['<a:alpha val="0"/>', 0],
    ['<a:alpha val="30000"/>', 0.3],
    ['<a:alpha val="50%"/>', 0.5],
    ['<a:alpha val="100000"/>', 1],
    [
      '<a:alpha val="60000"/><a:alphaMod val="50000"/><a:alphaOff val="10000"/>',
      0.4,
    ],
    ['<a:alphaOff val="50000"/><a:alphaMod val="50000"/>', 0.5],
    ['<a:alphaOff val="-75000"/><a:alphaMod val="200000"/>', 0.5],
    ['<a:alpha val="bad"/>', 1],
  ])(
    "resolves ordered transforms %s without changing authored XML",
    async (transforms, opacity) => {
      const { p, s, shape } = await open({ transforms });
      const before = unzipSync(await P.savePresentation(p));
      expect(P.getShapeFill(shape).opacity ?? 1).toBeCloseTo(opacity, 10);
      expect(P.getShapeFillEffective(p, shape).opacity ?? 1).toBeCloseTo(
        opacity,
        10,
      );
      if (opacity < 1)
        expect(markup(p, s)).toContain(`fill-opacity="${opacity}"`);
      else expect(markup(p, s)).not.toContain("fill-opacity=");
      expect(unzipSync(await P.savePresentation(p))).toEqual(before);
    },
  );
  it.each([
    'srgbClr val="FFFFFF"',
    'schemeClr val="bg1"',
    'scrgbClr r="100000" g="100000" b="100000"',
    'hslClr hue="0" sat="0" lum="100000"',
    'sysClr val="window" lastClr="FFFFFF"',
    'prstClr val="white"',
  ])("reads alpha for every DrawingML color choice: %s", async (color) => {
    const { shape } = await open({ color });
    expect(P.getShapeFill(shape).opacity).toBe(0.3);
  });
  it.each(["layout", "master"])(
    "inherits %s opacity and lets a local fill replace it",
    async (level) => {
      const { p, s, shape } = await open({ level });
      expect(P.getShapeFill(shape)).toEqual({ kind: "inherit" });
      expect(P.getShapeFillEffective(p, shape)).toEqual({
        kind: "solid",
        color: "#FFFFFF",
        opacity: 0.3,
      });
      expect(markup(p, s)).toContain('fill-opacity="0.3"');
      for (const localFill of [
        "<a:noFill/>",
        '<a:solidFill><a:srgbClr val="FF0000"/></a:solidFill>',
      ]) {
        const own = await open({ level, localFill });
        expect(
          P.getShapeFillEffective(own.p, own.shape).opacity,
        ).toBeUndefined();
      }
    },
  );
  it.each(["layoutDecoration", "masterDecoration"])(
    "retains alpha on %s behind slide content",
    async (level) => {
      const { p, s } = await open({ level });
      const before = unzipSync(await P.savePresentation(p));
      expect(markup(p, s)).toContain('fill-opacity="0.3"');
      expect(unzipSync(await P.savePresentation(p))).toEqual(before);
    },
  );
  it("preserves alpha through geometry edits, copies, bidirectional slide import and export", async () => {
    const { p, s, shape } = await open();
    P.copyShape(s, shape);
    const target = createDeck("blank"),
      imported = P.importSlide(
        target,
        s,
        P.getSlideLayout(P.getSlides(target)[0]),
      );
    P.setShapeRotation(P.getSlideShapes(imported)[0], 17);
    const back = P.importSlide(p, imported, P.getSlideLayout(s));
    for (const [deck, slide] of [
      [target, imported],
      [p, back],
    ]) {
      const bytes = await P.savePresentation(deck),
        restored = await parseDeck(bytes),
        last = P.getSlides(restored).at(-1);
      expect(P.getSlideShapes(last)).toHaveLength(2);
      for (const sh of P.getSlideShapes(last))
        expect(P.getShapeFill(sh).opacity).toBe(0.3);
      expect(markup(restored, last)).toBe(markup(deck, slide));
      expect(
        strFromU8(unzipSync(bytes)[P.getSlidePartName(slide).slice(1)]).match(
          /<a:alpha val="30000"\/>/g,
        ),
      ).toHaveLength(2);
    }
  });
});
