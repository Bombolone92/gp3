import { describe, expect, it } from "vitest";
import { parseCustomGeometry } from "../lib/pptx/src/internal/drawingml/custom-geometry.ts";
import { NS, parseXml } from "../lib/pptx/src/internal/xml/index.ts";
import { P, parseDeck, createDeck, textEditorRectangle } from "../src/model.js";
import {
  renderSlideToSvg,
  auditTextLayout,
} from "../lib/pptx-preview/src/index.ts";
import { resolveTextBodyModel } from "../lib/pptx-preview/src/render-slide.ts";
import {
  textRectGeometry,
  geometryTextRectFixture,
} from "./geometry-text-rect-fixture.js";
import { createGeometryDeck } from "./geometry-fixture.js";
import { strFromU8, unzipSync } from "fflate";

const resolve = (xml, w, h) =>
  parseCustomGeometry(
    parseXml(xml.replace("<a:custGeom>", `<a:custGeom xmlns:a="${NS.dml}">`))
      .root,
    w,
    h,
  );
const geometry = (p, slide = P.getSlides(p)[0]) =>
  P.getSlideShapes(slide).map((sh) => P.getShapeGeometryEffective(p, sh));
const svg = (p, slide = P.getSlides(p)[0], options = {}) =>
  renderSlideToSvg(p, slide, options);
const measure = (text) => ({
  widthPx: text.length * 10,
  ascentPx: 18,
  descentPx: 4,
  lineGapPx: 1,
});
const model = (p, sh, bounds = P.getShapeBoundsResolved(p, sh)) =>
  resolveTextBodyModel(
    p,
    sh,
    bounds,
    P.getPresentationTheme(p),
    null,
    measure,
    "#000000",
  );

describe("DrawingML custom geometry text rectangles", () => {
  it.each([
    [400, 200],
    [213, 571],
    [731, 731],
    [0, 17],
    [23, 0],
  ])("evaluates guides in shape coordinates at %i × %i", (w, h) => {
    expect(resolve(textRectGeometry(), w, h).textRect).toEqual({
      l: w / 4,
      t: h / 4,
      r: (3 * w) / 4,
      b: h,
    });
  });
  it("retains a default rectangle as absent and reads signed literal edges", () => {
    expect(resolve(textRectGeometry(""), 400, 200).textRect).toBeUndefined();
    expect(
      resolve(
        textRectGeometry('<a:rect l="-7" t="-13" r="412" b="239"/>'),
        400,
        200,
      ).textRect,
    ).toEqual({ l: -7, t: -13, r: 412, b: 239 });
  });
  it.each([
    '<a:rect l="bad" t="t" r="r" b="b"/>',
    '<a:rect l="l" r="r" b="b"/>',
    '<a:rect l="l" t="t" r="bad" b="b"/>',
  ])("keeps valid paths when the text rectangle is malformed: %s", (rect) => {
    const got = resolve(textRectGeometry(rect), 400, 200);
    expect(got.textRect).toBeNull();
    expect(got.paths).toEqual(resolve(textRectGeometry(""), 400, 200).paths);
  });
  it.each(["local", "layout", "master"])(
    "resolves inherited %s rectangle guides using the instance's extents",
    async (level) => {
      const p = await parseDeck(
          await createGeometryDeck({
            shapeKind: "shape",
            level,
            geometry: textRectGeometry(),
          }),
        ),
        sh = P.getSlideShapes(P.getSlides(p)[0])[0];
      P.setShapeSize(sh, 2130000, 5710000);
      expect(geometry(p)[0].geometry.textRect).toEqual({
        l: 532500,
        t: 1427500,
        r: 1597500,
        b: 5710000,
      });
    },
  );
  it("positions and wraps SVG, HTML and audit text within the same inset rectangle", async () => {
    const p = await parseDeck(await geometryTextRectFixture()),
      sh = P.getSlideShapes(P.getSlides(p)[0])[0],
      bounds = P.getShapeBoundsResolved(p, sh),
      m = model(p, sh);
    const expected = {
      x: bounds.x + bounds.w / 4 + P.inches(0.1),
      y: bounds.y + bounds.h / 4 + P.inches(0.15),
      w: bounds.w / 2 - P.inches(0.3),
      h: (bounds.h * 3) / 4 - P.inches(0.2),
    };
    expect(m.svgTextRect("none")).toEqual(expected);
    const html = svg(p);
    expect(html).toContain(
      `foreignObject x="${(expected.x / 9525).toFixed(2)}" y="${(expected.y / 9525).toFixed(2)}" width="${(expected.w / 9525).toFixed(2)}" height="${(expected.h / 9525).toFixed(2)}"`,
    );
    const issues = auditTextLayout(p, {
      measureText: measure,
      reportSoftWraps: true,
    });
    expect(
      issues.some(
        (issue) =>
          issue.kind === "soft-wrap" &&
          issue.shapeName === P.getShapeName(sh) &&
          issue.extraLines === 5,
      ),
    ).toBe(true);
    expect(
      svg(p, P.getSlides(p)[0], { textLayout: "svg", measureText: measure }),
    ).not.toContain("foreignObject");
    expect(textEditorRectangle(p, sh)).toMatchObject(expected);
  });
  it("uses local layout candidate extents instead of the saved bounds", async () => {
    const p = await parseDeck(await geometryTextRectFixture()),
      sh = P.getSlideShapes(P.getSlides(p)[0])[0],
      bounds = { x: 17000, y: 43000, w: P.inches(8), h: P.inches(5) };
    expect(model(p, sh, bounds).innerW).toBe(bounds.w / 2 - P.inches(0.3));
  });
  it.each(["cw90", "cw270"])(
    "applies asymmetric insets inside the custom rectangle for %s text",
    async (vertical) => {
      const p = await parseDeck(await geometryTextRectFixture()),
        sh = P.getSlideShapes(P.getSlides(p)[0])[0],
        b = P.getShapeBoundsResolved(p, sh);
      expect(model(p, sh).svgTextRect(vertical)).toEqual({
        x: b.x + b.w / 4 + P.inches(0.15),
        y: b.y + b.h / 4 + P.inches(0.1),
        w: b.w / 2 - P.inches(0.2),
        h: (b.h * 3) / 4 - P.inches(0.3),
      });
    },
  );
  it("preserves extended rectangles without clamping them to the shape", async () => {
    const p = await parseDeck(await geometryTextRectFixture()),
      sh = P.getSlideShapes(P.getSlides(p)[0])[1],
      b = P.getShapeBoundsResolved(p, sh),
      m = model(p, sh);
    expect(m.innerX).toBe(b.x);
    expect(m.innerW).toBe(b.w - P.inches(0.2));
  });
  it.each(["none", "cw90", "cw270"])(
    "retains the authored rectangle when body insets consume %s text",
    async (vertical) => {
      const p = await parseDeck(await geometryTextRectFixture()),
        sh = P.getSlideShapes(P.getSlides(p)[0])[0],
        b = P.getShapeBoundsResolved(p, sh);
      P.setShapeTextMargins(sh, {
        left: b.w,
        top: b.h,
        right: b.w,
        bottom: b.h,
      });
      expect(model(p, sh).svgTextRect(vertical)).toEqual({
        x: b.x + b.w / 4,
        y: b.y + b.h / 4,
        w: b.w / 2,
        h: (b.h * 3) / 4,
      });
    },
  );
  it.each(["sqrt -1", `*/ ${"9".repeat(308)} 2 1`])(
    "reports nonfinite text guide %s without losing valid paths",
    (formula) => {
      const source = textRectGeometry(
          '<a:rect l="bad" t="t" r="r" b="b"/>',
        ).replace(
          "</a:gdLst>",
          `<a:gd name="bad" fmla="${formula}"/></a:gdLst>`,
        ),
        got = resolve(source, 400, 200);
      expect(got.textRect).toBeNull();
      expect(got.paths).toEqual(resolve(textRectGeometry(""), 400, 200).paths);
    },
  );
  it.each(
    [0, 37, 90, 180, 270].flatMap((rotation) =>
      [false, true].map((vertical) => [rotation, vertical]),
    ),
  )(
    "places an offset editor at shape rotation %i with vertical flip %s",
    async (rotation, vertical) => {
      const p = await parseDeck(await geometryTextRectFixture()),
        sh = P.getSlideShapes(P.getSlides(p)[0])[0],
        b = P.getShapeBoundsResolved(p, sh),
        base = model(p, sh).svgTextRect("none");
      P.setShapeRotation(sh, rotation);
      P.setShapeFlip(sh, { horizontal: false, vertical });
      const angle = ((rotation + (vertical ? 180 : 0)) * Math.PI) / 180,
        cx = b.x + b.w / 2,
        cy = b.y + b.h / 2,
        dx = base.x + base.w / 2 - cx,
        dy = base.y + base.h / 2 - cy,
        rect = textEditorRectangle(p, sh);
      expect(rect.x + rect.w / 2).toBeCloseTo(
        cx + dx * Math.cos(angle) - dy * Math.sin(angle),
        7,
      );
      expect(rect.y + rect.h / 2).toBeCloseTo(
        cy + dx * Math.sin(angle) + dy * Math.cos(angle),
        7,
      );
      expect(rect.w).toBe(base.w);
      expect(rect.h).toBe(base.h);
      expect(rect.rotation).toBe((rotation + (vertical ? 180 : 0)) % 360);
    },
  );
  it("carries text rectangles through a resized group without materializing the guides", async () => {
    const p = await parseDeck(await geometryTextRectFixture()),
      slide = P.getSlides(p)[0],
      sh = P.getSlideShapes(slide)[0],
      base = model(p, sh).svgTextRect("none"),
      group = P.groupShapes(P.getSlideShapes(slide).slice(0, 2)),
      before = P.getGroupTransform(group);
    P.setShapeBounds(group, {
      x: before.outer.x + P.inches(1),
      y: before.outer.y + P.inches(0.5),
      w: before.outer.w * 2,
      h: before.outer.h * 3,
    });
    const transformed = P.getGroupTransform(group),
      rect = textEditorRectangle(p, sh);
    expect(rect.x).toBeCloseTo(
      transformed.outer.x + (base.x - transformed.inner.x) * 2,
      7,
    );
    expect(rect.y).toBeCloseTo(
      transformed.outer.y + (base.y - transformed.inner.y) * 3,
      7,
    );
    expect(rect.w).toBe(base.w * 2);
    expect(rect.h).toBe(base.h * 3);
    expect(P.getShapeGeometryEffective(p, sh).geometry.textRect.l).toBe(
      P.getShapeBoundsResolved(p, sh).w / 4,
    );
  });
  it.each([
    '<a:rect l="bad" t="t" r="r" b="b"/>',
    '<a:rect l="r" t="t" r="l" b="b"/>',
    '<a:rect l="hc" t="t" r="hc" b="b"/>',
    `<a:rect l="-${"9".repeat(308)}" t="t" r="${"9".repeat(308)}" b="b"/>`,
  ])(
    "keeps text visible and reports unusable text rectangles: %s",
    async (rect) => {
      const p = await parseDeck(await geometryTextRectFixture()),
        files = unzipSync(await P.savePresentation(p)),
        part = P.getSlidePartName(P.getSlides(p)[0]).slice(1);
      const { strToU8, zipSync } = await import("fflate");
      files[part] = strToU8(
        strFromU8(files[part]).replace(
          textRectGeometry(),
          textRectGeometry(rect),
        ),
      );
      const changed = await parseDeck(zipSync(files)),
        sh = P.getSlideShapes(P.getSlides(changed)[0])[0],
        b = P.getShapeBoundsResolved(changed, sh);
      expect(model(changed, sh).innerW).toBe(b.w - P.inches(0.3));
      expect(svg(changed)).toContain('data-pptx-text-rect="invalid"');
      expect(svg(changed)).not.toMatch(/NaN|Infinity/);
    },
  );
  it("retains authored guide formulas through reads, text edits, resizing, grouping, save and transfer", async () => {
    const bytes = await geometryTextRectFixture(),
      p = await parseDeck(bytes),
      slide = P.getSlides(p)[0],
      files = unzipSync(await P.savePresentation(p));
    expect(unzipSync(await P.savePresentation(p))).toEqual(files);
    const sh = P.getSlideShapes(slide)[0];
    P.setShapeText(sh, "Text rectangle edit");
    P.setShapeSize(sh, P.inches(4), P.inches(2));
    P.groupShapes(P.getSlideShapes(slide).slice(0, 2));
    const renderOptions = { textLayout: "svg", measureText: measure };
    const before = svg(p, slide, renderOptions),
      target = createDeck("blank");
    P.importSlide(target, slide, P.getSlideLayouts(target)[0], {
      preservePaintFormatting: true,
      preserveTextFormatting: true,
    });
    const saved = await parseDeck(await P.savePresentation(target)),
      returned = createDeck("blank");
    P.importSlide(
      returned,
      P.getSlides(saved).at(-1),
      P.getSlideLayouts(returned)[0],
      { preservePaintFormatting: true, preserveTextFormatting: true },
    );
    expect(svg(saved, P.getSlides(saved).at(-1), renderOptions)).toBe(before);
    expect(svg(returned, P.getSlides(returned).at(-1), renderOptions)).toBe(
      before,
    );
    const authored = strFromU8(
      unzipSync(await P.savePresentation(returned))[
        P.getSlidePartName(P.getSlides(returned).at(-1)).slice(1)
      ],
    ).match(/<a:custGeom\b[\s\S]*?<\/a:custGeom>/g);
    expect(authored).toEqual(
      strFromU8(unzipSync(bytes)[P.getSlidePartName(slide).slice(1)]).match(
        /<a:custGeom\b[\s\S]*?<\/a:custGeom>/g,
      ),
    );
  });
});
