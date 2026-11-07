import { describe, it, expect } from "vitest";
import { P, preview, createDeck } from "../src/model.js";
import { strFromU8, strToU8, unzipSync } from "fflate";
import { shapeStyleDeck, solid } from "./shape-style-reference-fixture.js";
import { geometryImage } from "./geometry-fixture.js";
import { shapePropertySources } from "../lib/pptx/src/api/fn/shape-property-sources.ts";
import { shapeStyleReference } from "../lib/pptx/src/api/fn/shape-style-reference.ts";
import { serializeFragment } from "../lib/pptx/src/internal/xml/index.ts";
const svg = (f) =>
  decodeURIComponent(preview(f.pres, f.slide).split(",").slice(1).join(","));
const read = (f) => ({
  fill: P.getShapeFillEffective(f.pres, f.shape),
  stroke: P.getShapeStrokeEffective(f.pres, f.shape),
  fillColor: P.getShapeFillColorResolvedEffective(f.pres, f.shape),
  strokeColor: P.getShapeStrokeColorResolvedEffective(f.pres, f.shape),
  effects: P.getShapeEffectsEffective(f.pres, f.shape),
});
describe("read-only theme style references", () => {
  it.each(["slide", "layout", "master"])(
    "resolves %s paint with ordered placeholder transforms and alpha",
    async (level) => {
      const f = await shapeStyleDeck({ level }),
        before = unzipSync(await P.savePresentation(f.pres));
      // Native tint retains 20% of the base in linear light; shade then
      // halves that result. Transform order gives #AEABAA, not shade→tint.
      expect(read(f)).toMatchObject({
        fill: { kind: "solid", opacity: 0.6 },
        stroke: { kind: "solid", widthEmu: 30000, opacity: 0.6 },
        fillColor: "#AEABAA",
        strokeColor: "#AEABAA",
        effects: [
          { kind: "glow", color: "#AEABAA", radiusEmu: 20000, opacity: 0.6 },
        ],
      });
      expect(P.getShapeFill(f.shape)).toEqual({ kind: "inherit" });
      expect(P.getShapeStroke(f.shape)).toEqual({ kind: "inherit" });
      expect(P.getShapeEffects(f.pres, f.shape)).toEqual([]);
      expect(svg(f)).toContain('fill="#AEABAA"');
      expect(svg(f)).toContain('stroke="#AEABAA"');
      expect(svg(f)).toContain('stroke-width="3.15"');
      expect(svg(f)).toContain("stroke-dasharray=");
      expect(unzipSync(await P.savePresentation(f.pres))).toEqual(before);
    },
  );
  it.each([2, 3, 1001, 1002, 1003])(
    "renders the selected fill channel %s",
    async (fill) => {
      const f = await shapeStyleDeck({ fill });
      expect(P.getShapeFillEffective(f.pres, f.shape).kind).toBe(
        {
          2: "gradient",
          3: "image",
          1001: "pattern",
          1002: "solid",
          1003: "gradient",
        }[fill],
      );
      const markup = svg(f);
      if (fill === 2 || fill === 1003) {
        expect(markup).toContain("<linearGradient");
        expect(
          P.getShapeGradientFillEffective(f.pres, f.shape).stops[0],
        ).toMatchObject({ color: "#EDE8E7", opacity: 0.6 });
      }
      if (fill === 3) {
        expect(P.getShapeImagePaintEffective(f.pres, f.shape).bytes).toEqual(
          geometryImage,
        );
        expect(markup).toContain("data:image/png");
      }
      if (fill === 1001) {
        expect(P.getShapePatternFill(f.pres, f.shape)).toBeNull();
        expect(P.getShapePatternFillEffective(f.pres, f.shape)).toEqual({
          preset: "pct25",
          foreground: "#EDE8E7",
          background: "#228844",
          foregroundOpacity: 0.6,
        });
        expect(markup).toContain("<pattern");
      }
      if (fill === 1002) expect(markup).toContain('fill="#AA2200"');
    },
  );
  it.each([0, 1000])("explicit no fill %s blocks ancestors", async (fill) => {
    const f = await shapeStyleDeck({
      fill,
      line: 0,
      effect: 0,
      layout:
        solid('<a:srgbClr val="FF00FF"/>') +
        '<a:ln w="10000">' +
        solid() +
        '</a:ln><a:effectLst><a:blur rad="1000"/></a:effectLst>',
    });
    expect(read(f)).toMatchObject({
      fill: { kind: "none" },
      stroke: { kind: "none" },
      effects: [],
      fillColor: null,
      strokeColor: null,
    });
    expect(P.getShapeImagePaintEffective(f.pres, f.shape)).toBeNull();
  });
  it.each(["bad", "", -1, 1.5, "1e0", "0x1", 4294967296, 99])(
    "invalid/unavailable references %s remain unspecified",
    async (index) => {
      const f = await shapeStyleDeck({
        fill: index,
        line: index,
        effect: index,
      });
      expect(read(f)).toMatchObject({
        fill: { kind: "inherit" },
        stroke: { kind: "inherit" },
        effects: [],
      });
      expect(P.getShapeGradientFillEffective(f.pres, f.shape)).toBeNull();
      expect(svg(f)).not.toContain("NaN");
    },
  );
  it("validates each channel independently and accepts XML unsigned integer spelling", async () => {
    const f = await shapeStyleDeck({ fill: " +1 ", line: 2, effect: 3 });
    expect(read(f)).toMatchObject({
      fill: { kind: "solid" },
      stroke: { widthEmu: 60000 },
      effects: [{ radiusEmu: 60000 }],
    });
  });
  it("direct atomic choices override same-layer styles while width inherits independently", async () => {
    const f = await shapeStyleDeck({
      own: '<a:noFill/><a:ln w="12000"><a:noFill/></a:ln><a:effectLst/>',
    });
    expect(read(f)).toMatchObject({
      fill: { kind: "none" },
      stroke: { kind: "none" },
      effects: [],
    });
    const g = await shapeStyleDeck({ own: '<a:ln w="12000"/>' });
    expect(read(g)).toMatchObject({
      stroke: { kind: "solid", widthEmu: 12000, opacity: 0.6 },
    });
    const h = await shapeStyleDeck({
      own:
        solid('<a:srgbClr val="121212"/>') +
        "<a:ln>" +
        solid('<a:srgbClr val="343434"/>') +
        "</a:ln>",
    });
    expect(read(h)).toMatchObject({
      fillColor: "#121212",
      strokeColor: "#343434",
      stroke: { widthEmu: 30000 },
    });
  });
  it("nearer style choices block farther placeholder paint", async () => {
    const f = await shapeStyleDeck({
      layout: "<a:noFill/><a:ln><a:noFill/></a:ln><a:effectLst/>",
    });
    expect(read(f)).toMatchObject({
      fill: { kind: "solid" },
      stroke: { kind: "solid" },
      effects: [{ kind: "glow" }],
    });
  });
  it("retains theme image relationship ownership despite an identical slide rId", async () => {
    const f = await shapeStyleDeck({ fill: 3 }),
      pkg = P._internalPackageOf(f.pres),
      owner = P.getSlidePartName(f.slide),
      rels = pkg.getRels(owner);
    pkg.addPart("/assets/other.png", "image/png", Uint8Array.of(1, 2, 3));
    rels.items.push({
      id: "theme-pixel",
      type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image",
      target: "/assets/other.png",
      targetMode: "Internal",
    });
    pkg.setRels(owner, rels);
    expect(P.getShapeImagePaintEffective(f.pres, f.shape).bytes).toEqual(
      geometryImage,
    );
  });
  it("uses the owning theme and observes theme replacement without stale reads", async () => {
    const f = await shapeStyleDeck(),
      pkg = P._internalPackageOf(f.pres),
      theme = pkg.getPart(f.themeName),
      master = P.getSlideMasterPartName(f.slide),
      rels = pkg.getRels(master);
    pkg.addPart(
      "/ppt/theme/alternate.xml",
      theme.contentType,
      strToU8(strFromU8(theme.data).replace("804020", "204080")),
    );
    rels.items.find((r) => r.type.endsWith("/theme")).target =
      "../theme/alternate.xml";
    pkg.setRels(master, rels);
    expect(read(f).fillColor).toBe("#AAABAE");
    const alternate = pkg.getPart("/ppt/theme/alternate.xml");
    alternate.data = strToU8(
      strFromU8(alternate.data).replace("204080", "408020"),
    );
    expect(read(f).fillColor).toBe("#ABAEAA");
  });
  it("composes reference and matrix alpha transforms in order for effects", async () => {
    const f = await shapeStyleDeck({
        refColor: '<a:srgbClr val="123456"><a:alpha val="80000"/></a:srgbClr>',
      }),
      pkg = P._internalPackageOf(f.pres),
      part = pkg.getPart(f.themeName);
    part.data = strToU8(
      strFromU8(part.data).replace(
        '<a:glow rad="20000"><a:schemeClr val="phClr">',
        '<a:glow rad="20000"><a:schemeClr val="phClr"><a:alphaMod val="50000"/><a:alphaOff val="10000"/>',
      ),
    );
    expect(read(f).effects[0].opacity).toBe(0.5);
  });

  it("indexes qualified native entries while keeping foreign list children opaque", async () => {
    const f = await shapeStyleDeck({ line: 2 }),
      pkg = P._internalPackageOf(f.pres),
      part = pkg.getPart(f.themeName);
    part.data = strToU8(
      strFromU8(part.data).replace(
        "<a:lnStyleLst>",
        '<a:lnStyleLst><x:ln xmlns:x="urn:foreign" w="900000"/><a:extLst><a:ext uri="urn:opaque"><a:ln w="800000"/></a:ext></a:extLst>',
      ),
    );
    const before = part.data.slice();
    expect(read(f).stroke).toMatchObject({ widthEmu: 60000 });
    expect(read(f).strokeColor).toBe("#AEABAA");
    expect(part.data).toEqual(before);
    const target = createDeck("blank"),
      copiedSlide = P.importSlide(
        target,
        f.slide,
        P.getSlideLayouts(target)[0],
        { preservePaintFormatting: true },
      );
    expect(
      P.getShapeStrokeEffective(target, P.getSlideShapes(copiedSlide)[0]),
    ).toMatchObject({ widthEmu: 60000 });
    expect(
      P.getShapeStrokeColorResolvedEffective(
        target,
        P.getSlideShapes(copiedSlide)[0],
      ),
    ).toBe("#AEABAA");
  });

  it("does not bind colors inside opaque extension payloads", async () => {
    const f = await shapeStyleDeck(),
      pkg = P._internalPackageOf(f.pres),
      part = pkg.getPart(f.themeName);
    part.data = strToU8(
      strFromU8(part.data).replace(
        "</a:ln>",
        '<a:extLst><a:ext uri="urn:opaque"><a:schemeClr val="phClr"/></a:ext></a:extLst></a:ln>',
      ),
    );
    const entry = shapeStyleReference(
      f.shape,
      shapePropertySources(f.shape)[0],
      "lnRef",
    ).element;
    expect(serializeFragment(entry)).toContain('<a:schemeClr val="phClr"/>');
    expect(read(f).strokeColor).toBe("#AEABAA");
  });
  it("keeps paint through edit, save, formatting-preserving copy and return", async () => {
    const f = await shapeStyleDeck({ fill: 1001 });
    P.setShapeText(f.shape, "Styled label");
    const expected = read(f),
      target = createDeck("blank"),
      slide = P.importSlide(target, f.slide, P.getSlideLayouts(target)[0], {
        preservePaintFormatting: true,
      });
    const copied = { pres: target, slide, shape: P.getSlideShapes(slide)[0] };
    expect(read(copied)).toMatchObject({
      fillColor: expected.fillColor,
      strokeColor: expected.strokeColor,
      effects: expected.effects,
    });
    expect(P.getShapePatternFillEffective(target, copied.shape)).toEqual(
      P.getShapePatternFillEffective(f.pres, f.shape),
    );
    const reopened = await P.loadPresentation(await P.savePresentation(target)),
      back = P.importSlide(
        f.pres,
        P.getSlides(reopened).at(-1),
        P.getSlideLayout(f.slide),
        { preservePaintFormatting: true },
      );
    expect(
      read({ pres: f.pres, slide: back, shape: P.getSlideShapes(back)[0] }),
    ).toMatchObject({
      fillColor: expected.fillColor,
      strokeColor: expected.strokeColor,
      effects: expected.effects,
    });
    expect(P.validatePresentation(f.pres)).toEqual([]);
  });
});
