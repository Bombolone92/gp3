import { describe, expect, it } from "vitest";
import { parseCustomGeometry } from "../lib/pptx/src/internal/drawingml/custom-geometry.ts";
import { NS, parseXml } from "../lib/pptx/src/internal/xml/index.ts";
import { P, parseDeck, createDeck } from "../src/model.js";
import { renderSlideToSvg } from "../lib/pptx-preview/src/index.ts";
import { createGeometryDeck } from "./geometry-fixture.js";
import {
  geometryGuidesFixture,
  guideControlGeometry,
} from "./geometry-guides-fixture.js";
import { unzipSync } from "fflate";

const resolve = (body, w, h) =>
  parseCustomGeometry(
    parseXml(`<a:custGeom xmlns:a="${NS.dml}">${body}</a:custGeom>`).root,
    w,
    h,
  );
const point = (x, y) => `<a:pt x="${x}" y="${y}"/>`;
const geometryOf = (p, slide = P.getSlides(p)[0]) =>
  P.getSlideShapes(slide).map((shape) => P.getShapeGeometryEffective(p, shape));
const svgOf = (p, slide = P.getSlides(p)[0]) =>
  renderSlideToSvg(p, slide, { textLayout: "svg" });

describe("DrawingML width and short-side built-in guides", () => {
  const dimensions = [
    [0, 0],
    [0, 136],
    [157, 0],
    [2873339, 1237109],
    [1246811, 2071471],
    [1666621, 1666621],
    [101, 8192],
    [8192, 101],
  ];
  it.each(
    dimensions.flatMap(([w, h]) =>
      ["line", "quadratic", "cubic", "arc"].map((kind) => [w, h, kind]),
    ),
  )("evaluates %i × %i guides in %s commands", (w, h, kind) => {
    const xy = point("wd32", "ssd16"),
      other = point("ssd32", "wd32"),
      commands = {
        line: `<a:lnTo>${other}</a:lnTo>`,
        quadratic: `<a:quadBezTo>${xy}${other}</a:quadBezTo>`,
        cubic: `<a:cubicBezTo>${xy}${other}${xy}</a:cubicBezTo>`,
        arc: '<a:arcTo wR="wd32" hR="ssd32" stAng="cd4" swAng="cd8"/>',
      },
      geometry = resolve(
        `<a:pathLst><a:path><a:moveTo>${xy}</a:moveTo>${commands[kind]}</a:path></a:pathLst>`,
        w,
        h,
      );
    const short = Math.min(w, h),
      first = { x: w / 32, y: short / 16 },
      second = { x: short / 32, y: w / 32 };
    expect(geometry).not.toBeNull();
    expect(geometry.paths[0].commands[0].pt).toEqual(first);
    const command = geometry.paths[0].commands[1];
    if (kind === "line") expect(command.pt).toEqual(second);
    else if (kind === "arc")
      expect(command).toEqual({
        kind: "arcTo",
        wR: w / 32,
        hR: short / 32,
        stAng: 5400000,
        swAng: 2700000,
      });
    else
      expect(command.pts).toEqual(
        kind === "quadratic" ? [first, second] : [first, second, first],
      );
  });
  it("uses the built-ins in ordered adjustment and guide formulas", () => {
    const body = guideControlGeometry(true)
      .replace("<a:custGeom>", "")
      .replace("</a:custGeom>", "");
    expect(resolve(body, 640, 160).paths[0].commands[1].pt).toEqual({
      x: 60,
      y: 15,
    });
    expect(resolve(body, 96, 320).paths[0].commands[1].pt).toEqual({
      x: 9,
      y: 9,
    });
  });
  it("retains document-order guide shadowing", () => {
    const geometry = resolve(
      `<a:avLst><a:gd name="wd32" fmla="val 7"/></a:avLst><a:gdLst><a:gd name="ssd32" fmla="+- wd32 5 0"/><a:gd name="ssd16" fmla="*/ ssd32 2 1"/></a:gdLst><a:pathLst><a:path><a:moveTo>${point("wd32", "ssd16")}</a:moveTo><a:lnTo>${point("ssd32", "wd32")}</a:lnTo></a:path></a:pathLst>`,
      640,
      160,
    );
    expect(geometry.paths[0].commands.map((c) => c.pt)).toEqual([
      { x: 7, y: 24 },
      { x: 12, y: 7 },
    ]);
  });
  it.each(["ssd12", "wd16", "hd32", "WD32", "undefinedGuide"])(
    "does not invent an implicit value for %s",
    (name) => {
      expect(
        resolve(
          `<a:pathLst><a:path><a:moveTo>${point(name, "0")}</a:moveTo></a:path></a:pathLst>`,
          640,
          160,
        ),
      ).toBeNull();
    },
  );
});

describe("effective built-in geometry", () => {
  it.each(
    ["layout", "master"].flatMap((level) =>
      ["picture", "shape"].map((shapeKind) => [level, shapeKind]),
    ),
  )(
    "evaluates inherited %s geometry at the %s instance's size",
    async (level, shapeKind) => {
      const p = await parseDeck(
        await createGeometryDeck({
          level,
          shapeKind,
          geometry: guideControlGeometry(),
        }),
      );
      const shape = P.getSlideShapes(P.getSlides(p)[0])[0];
      P.setShapeSize(shape, 640, 160);
      expect(geometryOf(p)[0].geometry.paths[0].commands[0].pt).toEqual({
        x: 20,
        y: 10,
      });
      P.setShapeSize(shape, 96, 320);
      expect(geometryOf(p)[0].geometry.paths[0].commands[0].pt).toEqual({
        x: 3,
        y: 6,
      });
      expect(svgOf(p)).not.toContain('data-pptx-fallback="custGeom"');
    },
  );
  it("retains authored guides and geometry through save, grouping and forward/return transfer", async () => {
    const bytes = await geometryGuidesFixture(),
      source = await parseDeck(bytes),
      slide = P.getSlides(source)[0],
      part = P.getSlidePartName(slide).slice(1),
      original = unzipSync(bytes)[part],
      before = svgOf(source),
      geometry = geometryOf(source);
    expect(geometry.every((g) => g.geometry !== null)).toBe(true);
    expect(before).not.toContain('data-pptx-fallback="custGeom"');
    expect(unzipSync(await P.savePresentation(source))[part]).toEqual(original);
    P.groupShapes(P.getSlideShapes(slide).slice(0, 2));
    const grouped = svgOf(source);
    expect(grouped.match(/<path\b[^>]*>/g)).toEqual(
      before.match(/<path\b[^>]*>/g),
    );
    expect(
      P.getGroupChildren(P.getSlideShapes(slide)[0]).map((shape) =>
        P.getShapeGeometryEffective(source, shape),
      ),
    ).toEqual(geometry.slice(0, 2));
    const target = createDeck("blank");
    P.importSlide(target, slide, P.getSlideLayouts(target)[0]);
    const imported = P.getSlides(target).at(-1);
    expect(svgOf(target, imported)).toBe(grouped);
    const saved = await parseDeck(await P.savePresentation(target)),
      returned = createDeck("blank");
    P.importSlide(
      returned,
      P.getSlides(saved).at(-1),
      P.getSlideLayouts(returned)[0],
    );
    expect(svgOf(returned, P.getSlides(returned).at(-1))).toBe(grouped);
  });
});
