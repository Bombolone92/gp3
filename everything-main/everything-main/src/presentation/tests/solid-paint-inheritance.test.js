import { describe, it, expect } from "vitest";
import { unzipSync, strToU8, strFromU8 } from "fflate";
import { P, parseDeck, createDeck } from "../src/model.js";
import { renderSlideToSvg } from "../lib/pptx-preview/src/index.ts";
import {
  parseXml,
  walkElements,
  getAttrValue,
  qname,
} from "../lib/pptx/src/internal/xml/index.ts";
import {
  solidPaintCases,
  solidPaintInheritanceFixture,
} from "./solid-paint-inheritance-fixture.js";
import { paintStyleFixture } from "./paint-style-copy-fixture.js";

const attribute = (el, n) => getAttrValue(el, qname("", n, ""));
function paintedShapes(p, s) {
  const groups = [];
  walkElements(
    parseXml(renderSlideToSvg(p, s, { textLayout: "svg" })).root,
    (el) => {
      if (attribute(el, "data-pptx-shape-name") !== null) groups.push(el);
    },
  );
  return groups.map((g) => {
    let rect = null;
    let opacity = null;
    walkElements(g, (el) => {
      if (!rect && el.name.localName === "rect") rect = el;
      opacity ??= attribute(el, "fill-opacity");
    });
    return (
      rect && {
        fill: attribute(rect, "fill"),
        stroke: attribute(rect, "stroke"),
        opacity,
      }
    );
  });
}
const nativeRgb = (color, expected) => {
  if (expected === null) {
    expect(color).toBe("none");
    return;
  }
  expect(color).toMatch(/^#[0-9A-F]{6}$/i);
  // Native PDF/browser channel quantization differs by one at half steps.
  for (let i = 0; i < 3; i++)
    expect(
      Math.abs(parseInt(color.slice(1 + i * 2, 3 + i * 2), 16) - expected[i]),
    ).toBeLessThanOrEqual(1);
};
describe("inherited solid paint color transforms", () => {
  it.each(solidPaintCases.map((c, i) => [c.label, c, i]))(
    "paints the native %s color without changing authored XML",
    async (_label, c, i) => {
      const p = await parseDeck(await solidPaintInheritanceFixture()),
        s = P.getSlides(p)[0],
        before = unzipSync(await P.savePresentation(p));
      const rect = paintedShapes(p, s)[i * 2];
      nativeRgb(rect.fill, c.rgb);
      nativeRgb(rect.stroke, c.strokeRgb);
      expect(Number(rect.opacity ?? 1)).toBe(c.opacity);
      expect(unzipSync(await P.savePresentation(p))).toEqual(before);
    },
  );
});

const solid = (color) => `<a:solidFill>${color}</a:solidFill>`;
const line = (color) => `<a:ln>${solid(color)}</a:ln>`;
const resolvePaint = (f) => ({
  fill: P.getShapeFillColorResolvedEffective(f.pres, f.shape),
  stroke: P.getShapeStrokeColorResolvedEffective(f.pres, f.shape),
});
const alternateColors = [
  [
    "srgbClr",
    '<a:srgbClr val="315E87"><a:lumMod val="50000"/><a:alpha val="60000"/></a:srgbClr>',
    [24, 47, 67],
  ],
  [
    "schemeClr",
    '<a:schemeClr val="accent1"><a:lumMod val="50000"/><a:alpha val="60000"/></a:schemeClr>',
    [24, 47, 67],
  ],
  [
    "scrgbClr",
    '<a:scrgbClr r="20000" g="40000" b="60000"><a:lumMod val="50000"/><a:alpha val="60000"/></a:scrgbClr>',
    [46, 87, 117],
  ],
  [
    "hslClr",
    '<a:hslClr hue="12600000" sat="50000" lum="40000"><a:lumMod val="50000"/><a:alpha val="60000"/></a:hslClr>',
    [25, 51, 77],
  ],
  [
    "sysClr",
    '<a:sysClr val="windowText" lastClr="315E87"><a:lumMod val="50000"/><a:alpha val="60000"/></a:sysClr>',
    [24, 47, 67],
  ],
  [
    "prstClr",
    '<a:prstClr val="steelBlue"><a:lumMod val="50000"/><a:alpha val="60000"/></a:prstClr>',
    [35, 65, 90],
  ],
];
describe("effective solid color readers", () => {
  it.each(
    ["layout", "master"].flatMap((level) =>
      alternateColors.map(([name, color, rgb]) => [level, name, color, rgb]),
    ),
  )(
    "retains %s %s transforms, alpha and independently inherited width",
    async (level, _name, color, rgb) => {
      const properties = solid(color) + line(color);
      const f = await paintStyleFixture({
        shapeKind: "picture",
        layout: level === "layout" ? properties : "",
        master: level === "master" ? properties : "",
      });
      const before = unzipSync(await P.savePresentation(f.pres));
      expect(P.getShapeFillColorResolved(f.pres, f.shape)).toBeNull();
      expect(P.getShapeStrokeColorResolved(f.pres, f.shape)).toBeNull();
      const resolved = resolvePaint(f);
      nativeRgb(resolved.fill, rgb);
      nativeRgb(resolved.stroke, rgb);
      expect(P.getShapeFillEffective(f.pres, f.shape).opacity).toBe(0.6);
      expect(P.getShapeStrokeEffective(f.pres, f.shape)).toMatchObject({
        kind: "solid",
        opacity: 0.6,
      });
      expect(unzipSync(await P.savePresentation(f.pres))).toEqual(before);
    },
  );
  it.each([
    "<a:noFill/>",
    '<a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="00FF00"/></a:gs></a:gsLst><a:lin ang="0"/></a:gradFill>',
    '<a:pattFill prst="pct50"><a:fgClr><a:srgbClr val="00FF00"/></a:fgClr><a:bgClr><a:srgbClr val="000000"/></a:bgClr></a:pattFill>',
    "<a:blipFill/>",
    "<a:grpFill/>",
    "<a:solidFill/>",
    '<a:solidFill><a:schemeClr val="unknown"/></a:solidFill>',
  ])("a nearer fill choice blocks a farther solid color: %s", async (paint) => {
    const f = await paintStyleFixture({
      shapeKind: "picture",
      local: paint,
      layout: solid('<a:srgbClr val="FF0000"/>'),
      master: solid('<a:srgbClr val="00FF00"/>'),
    });
    expect(P.getShapeFillColorResolvedEffective(f.pres, f.shape)).toBeNull();
  });
  it("keeps fill and outline inheritance independent when only local width is authored", async () => {
    const f = await paintStyleFixture({
      shapeKind: "picture",
      local: '<a:ln w="17780"/>',
      layout:
        solid('<a:srgbClr val="D04432"/>') +
        line(
          '<a:schemeClr val="accent1"><a:lumMod val="50000"/></a:schemeClr>',
        ),
      master: solid('<a:srgbClr val="00FF00"/>'),
    });
    expect(resolvePaint(f).fill).toBe("#D04432");
    nativeRgb(resolvePaint(f).stroke, [24, 47, 67]);
    expect(P.getShapeStrokeEffective(f.pres, f.shape).widthEmu).toBe(17780);
  });
  it("honors a layout no-fill independently of a master outline", async () => {
    const f = await paintStyleFixture({
      shapeKind: "picture",
      layout: "<a:noFill/>",
      master:
        solid('<a:srgbClr val="00FF00"/>') + line('<a:srgbClr val="D04432"/>'),
    });
    expect(resolvePaint(f)).toEqual({ fill: null, stroke: "#D04432" });
  });
  it("observes replaced layout bytes and explicit host color maps without caching resolved paint", async () => {
    const f = await paintStyleFixture({
      shapeKind: "picture",
      layout:
        solid('<a:schemeClr val="tx1"><a:lumMod val="50000"/></a:schemeClr>') +
        line('<a:schemeClr val="tx1"><a:lumMod val="50000"/></a:schemeClr>'),
    });
    expect(
      P.getShapeFillColorResolvedEffective(f.pres, f.shape, { tx1: "accent1" }),
    ).toBe("#182F44");
    expect(
      P.getShapeStrokeColorResolvedEffective(f.pres, f.shape, {
        tx1: "accent1",
      }),
    ).toBe("#182F44");
    const part = P._internalPackageOf(f.pres).getPart(
      P.getSlideLayoutPartName(P.getSlideLayout(f.slide)),
    );
    part.data = strToU8(
      strFromU8(part.data).replaceAll(
        'lumMod val="50000"',
        'lumMod val="100000"',
      ),
    );
    expect(
      P.getShapeFillColorResolvedEffective(f.pres, f.shape, { tx1: "accent1" }),
    ).toBe("#315E87");
    expect(
      P.getShapeStrokeColorResolvedEffective(f.pres, f.shape, {
        tx1: "accent1",
      }),
    ).toBe("#315E87");
  });
  it("uses the owning master theme and observes relationship changes", async () => {
    const f = await paintStyleFixture({
      shapeKind: "picture",
      layout:
        solid(
          '<a:schemeClr val="accent1"><a:lumMod val="50000"/></a:schemeClr>',
        ) +
        line(
          '<a:schemeClr val="accent1"><a:lumMod val="50000"/></a:schemeClr>',
        ),
    });
    expect(resolvePaint(f)).toEqual({ fill: "#182F44", stroke: "#182F44" });
    const pkg = P._internalPackageOf(f.pres),
      theme = pkg.parts.find(
        (p) => p.name.includes("/theme/") && p.name.endsWith(".xml"),
      );
    pkg.addPart(
      "/ppt/theme/owner.xml",
      theme.contentType,
      strToU8(strFromU8(theme.data).replaceAll("315E87", "A45C38")),
    );
    const master = P.getSlideMasterPartName(f.slide),
      rels = pkg.getRels(master);
    rels.items.find((r) => r.type.endsWith("/theme")).target =
      "../theme/owner.xml";
    pkg.setRels(master, rels);
    expect(resolvePaint(f)).toEqual({ fill: "#522E1C", stroke: "#522E1C" });
  });
  it("preserves all rendered paint through save, edits and bidirectional slide transfer", async () => {
    const source = await parseDeck(await solidPaintInheritanceFixture()),
      s = P.getSlides(source)[0],
      before = paintedShapes(source, s);
    const check = async (pres, slide) => {
      expect(paintedShapes(pres, slide)).toEqual(before);
      const loaded = await parseDeck(await P.savePresentation(pres));
      expect(paintedShapes(loaded, P.getSlides(loaded).at(-1))).toEqual(before);
      return loaded;
    };
    await check(source, s);
    const target = createDeck("blank"),
      copied = P.importSlide(target, s, P.getSlideLayouts(target)[0], {
        preservePaintFormatting: true,
        preserveTextFormatting: true,
      });
    P.setShapeText(P.getSlideShapes(copied)[1], "Edited label");
    const loaded = await check(target, copied),
      returning = createDeck("blank"),
      returned = P.importSlide(
        returning,
        P.getSlides(loaded).at(-1),
        P.getSlideLayouts(returning)[0],
        { preservePaintFormatting: true, preserveTextFormatting: true },
      );
    await check(returning, returned);
  });
});
