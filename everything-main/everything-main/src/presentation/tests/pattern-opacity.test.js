import { it, expect } from "vitest";
import { unzipSync } from "fflate";
import { P, preview, parseDeck, createDeck } from "../src/model.js";
import { readPatternFixture, patternXml } from "./pattern-opacity-fixture.js";
import { shapeStyleDeck } from "./shape-style-reference-fixture.js";
import { importSlideTemplate } from "../lib/pptx/src/api/fn/template-import.ts";

const cases = [
  ...["slide", "layout", "master", "layoutDecoration", "masterDecoration"].map(
    (level) => ({ kind: "shape", level }),
  ),
  ...["slide", "layout", "master"].flatMap((level) => [
    { kind: "reference", level },
    { kind: "background", level },
  ]),
  { kind: "table", level: "slide" },
];
it.each(cases)(
  "retains independent exact alpha in $kind at $level",
  async (options) => {
    const foreground =
        '<a:srgbClr val="ED3719"><a:alpha val="33333"/></a:srgbClr>',
      f = await readPatternFixture({ ...options, foreground }),
      before = unzipSync(await P.savePresentation(f.pres));
    expect(f.fill).toMatchObject({
      foregroundOpacity: 0.33333,
      backgroundOpacity: 0.70001,
    });
    const svg = decodeURIComponent(
      preview(f.pres, f.slide).split(",").slice(1).join(","),
    );
    expect(svg).toContain('flood-opacity="0.33333"');
    expect(svg).toContain('flood-opacity="0.70001"');
    expect(unzipSync(await P.savePresentation(f.pres))).toEqual(before);
    const reopened = await parseDeck(await P.savePresentation(f.pres));
    expect(preview(reopened, P.getSlides(reopened)[0])).toBe(
      preview(f.pres, f.slide),
    );
  },
);

it.each([
  [
    '<a:srgbClr val="ED3719"><a:alpha val="20000"/><a:alphaMod val="50000"/><a:alphaOff val="30000"/></a:srgbClr>',
    0.4,
  ],
  [
    '<a:scrgbClr r="80000" g="20000" b="10000"><a:alpha val="0"/></a:scrgbClr>',
    0,
  ],
  [
    '<a:hslClr hue="1200000" sat="70000" lum="50000"><a:alphaOff val="-30000"/></a:hslClr>',
    0.7,
  ],
  ['<a:schemeClr val="accent1"><a:alpha val="33333"/></a:schemeClr>', 0.33333],
  [
    '<a:sysClr val="windowText" lastClr="ED3719"><a:alpha val="20000"/></a:sysClr>',
    0.2,
  ],
  ['<a:prstClr val="red"><a:alphaMod val="10000"/></a:prstClr>', 0.1],
  [
    '<a:srgbClr val="ED3719"><a:alphaOff val="90000"/><a:alphaMod val="50000"/></a:srgbClr>',
    0.5,
  ],
])(
  "resolves color choice and ordered transforms %s",
  async (foreground, opacity) => {
    const f = await readPatternFixture({ kind: "shape", foreground });
    expect(f.fill.foregroundOpacity).toBeCloseTo(opacity, 10);
  },
);

it("keeps opaque public results unchanged and foreign alpha opaque", async () => {
  const f = await shapeStyleDeck({
    effect: 0,
    own: patternXml({
      foreground:
        '<a:srgbClr val="ED3719"><x:alpha xmlns:x="urn:opaque" val="0"/></a:srgbClr>',
      background: '<a:srgbClr val="29CD53"/>',
    }),
  });
  expect(P.getShapePatternFill(f.pres, f.shape)).toEqual({
    preset: "cross",
    foreground: "#ED3719",
    background: "#29CD53",
  });
  const markup = decodeURIComponent(
    preview(f.pres, f.slide).split(",").slice(1).join(","),
  );
  expect(markup).not.toContain("feComposite");
});

it("keeps legacy table CSS colors while exposing exact native alpha", async () => {
  const { fill } = await readPatternFixture({ kind: "table" });
  expect(fill).toEqual({
    kind: "pattern",
    preset: "cross",
    foreground: "#ED371955",
    background: "#29CD53b3",
    foregroundOpacity: 0.33333,
    backgroundOpacity: 0.70001,
  });
});

it("skips foreign colors and does not extract transforms from opaque wrappers", async () => {
  const f = await shapeStyleDeck({
    effect: 0,
    own: '<a:pattFill prst="cross"><a:fgClr><x:srgbClr xmlns:x="urn:opaque" val="FF00FF"><a:alpha val="0"/></x:srgbClr><a:srgbClr val="ED3719"><a:extLst><a:ext uri="opaque"><a:alpha val="0"/></a:ext></a:extLst><a:alpha val="33333"/></a:srgbClr></a:fgClr><a:bgClr/></a:pattFill>',
  });
  expect(P.getShapePatternFill(f.pres, f.shape)).toEqual({
    preset: "cross",
    foreground: "#ED3719",
    foregroundOpacity: 0.33333,
    background: "#FFFFFF",
  });
});

it.each(["shape", "reference", "table", "background"])(
  "preserves %s pattern opacity through imported templates and return copies",
  async (kind) => {
    const f = await readPatternFixture({
        kind,
        level: "master",
        foreground:
          '<a:srgbClr val="ED3719"><a:alpha val="33333"/></a:srgbClr>',
      }),
      expected = preview(f.pres, f.slide),
      target = createDeck("blank");
    P.setPresentationTheme(target, { accent1: "#1111FF", accent2: "#FFFF11" });
    const copied = P.importSlide(
      target,
      f.slide,
      importSlideTemplate(target, f.slide),
      { preserveGeometry: false },
    );
    expect(preview(target, copied)).toBe(expected);
    const back = P.importSlide(
      f.pres,
      copied,
      importSlideTemplate(f.pres, copied),
      { preserveGeometry: false },
    );
    expect(preview(f.pres, back)).toBe(expected);
    for (const p of [target, f.pres])
      expect(P.validatePresentation(p)).toEqual([]);
  },
);
