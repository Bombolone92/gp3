import { describe, expect, it } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { P, createDeck, parseDeck, preview } from "../src/model.js";
import { strokeOpacityDeck } from "./stroke-opacity-fixture.js";
const open = async (options) => {
  const p = await parseDeck(await strokeOpacityDeck(options)),
    s = P.getSlides(p)[0];
  return { p, s, sh: P.getSlideShapes(s)[0] };
};
const markup = (p, s) =>
  decodeURIComponent(preview(p, s).split(",").slice(1).join(","));
describe("solid outline transparency", () => {
  it.each([
    ['<a:alpha val="0"/>', 0],
    ['<a:alpha val="25000"/>', 0.25],
    ['<a:alpha val="50%"/>', 0.5],
    ['<a:alpha val="100000"/>', 1],
    [
      '<a:alpha val="60000"/><a:alphaMod val="50000"/><a:alphaOff val="10000"/>',
      0.4,
    ],
    ['<a:alphaOff val="-75000"/><a:alphaMod val="200000"/>', 0.5],
    ['<a:alphaOff val="50000"/><a:alphaMod val="50000"/>', 0.5],
    ['<a:alpha val="bad"/>', 1],
  ])(
    "resolves %s without rewriting authored XML",
    async (transforms, alpha) => {
      const { p, s, sh } = await open({ transforms }),
        before = unzipSync(await P.savePresentation(p));
      expect(P.getShapeStroke(sh).opacity ?? 1).toBeCloseTo(alpha, 10);
      expect(P.getShapeStrokeEffective(p, sh).opacity ?? 1).toBeCloseTo(
        alpha,
        10,
      );
      const svg = markup(p, s);
      if (alpha > 0 && alpha < 1) expect(svg).toContain(`opacity="${alpha}"`);
      expect(unzipSync(await P.savePresentation(p))).toEqual(before);
    },
  );
  it.each([
    'srgbClr val="1267B2"',
    'schemeClr val="accent1"',
    'scrgbClr r="0" g="0" b="100000"',
    'hslClr hue="0" sat="100000" lum="50000"',
    'sysClr val="window" lastClr="1267B2"',
    'prstClr val="blue"',
  ])("reads alpha for %s", async (color) => {
    const { sh } = await open({ color });
    expect(P.getShapeStroke(sh).opacity).toBe(0.5);
  });
  it.each(["layout", "master"])(
    "inherits %s fill alpha while preserving local width",
    async (level) => {
      const { p, s, sh } = await open({ level });
      expect(P.getShapeStroke(sh)).toEqual({ kind: "inherit" });
      expect(P.getShapeStrokeEffective(p, sh)).toEqual({
        kind: "solid",
        color: "#1267B2",
        widthEmu: 101600,
        opacity: 0.5,
      });
      expect(markup(p, s)).toContain('opacity="0.5"');
    },
  );
  it.each([
    '<a:ln w="101600"><a:noFill/></a:ln>',
    '<a:ln w="101600"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:ln>',
  ])("a local fill replaces inherited alpha: %s", async (localLine) => {
    const { p, sh } = await open({ level: "layout", localLine });
    expect(P.getShapeStrokeEffective(p, sh).opacity).toBeUndefined();
  });
  it.each(["shape", "picture", "connector"])(
    "preserves %s stroke alpha through edit, copy, import in both directions and export",
    async (kind) => {
      const { p, s, sh } = await open({ kind });
      P.copyShape(s, sh);
      const target = createDeck("blank"),
        ts = P.importSlide(target, s, P.getSlideLayout(P.getSlides(target)[0]));
      P.setShapeRotation(P.getSlideShapes(ts)[0], 17);
      const back = P.importSlide(p, ts, P.getSlideLayout(s));
      for (const [deck, slide] of [
        [target, ts],
        [p, back],
      ]) {
        const bytes = await P.savePresentation(deck),
          reopened = await parseDeck(bytes),
          last = P.getSlides(reopened).at(-1);
        expect(P.getSlideShapes(last)).toHaveLength(2);
        for (const shape of P.getSlideShapes(last))
          expect(P.getShapeStroke(shape).opacity).toBe(0.5);
        expect(markup(reopened, last)).toBe(markup(deck, slide));
        expect(
          strFromU8(unzipSync(bytes)[P.getSlidePartName(slide).slice(1)]).match(
            /<a:alpha val="50000"\/>/g,
          ),
        ).toHaveLength(2);
      }
    },
  );
});
